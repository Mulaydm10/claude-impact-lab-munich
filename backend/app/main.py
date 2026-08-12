"""Glassbox — FastAPI surface.

The workflow is an explicit state machine and every transition is logged, so the
frontend can render the cascade live rather than waiting on a black box:

    POST /api/start          INTAKE            -> opens a session, first survey questions
    POST /api/answer         INTENT_CONFIRM    -> answers back; loops until intent is settled
    POST /api/scout          SOURCE_SCOUTING   -> acquires + categorises sources
    POST /api/rate-sources   SOURCE_RATING     -> human checkpoint: approve / exclude
    POST /api/verify         VERIFYING..REVIEW -> scores sources, checks claims, reviews
    GET  /api/events/{id}                      -> SSE stream of the whole cascade
    GET  /api/report/{id}                      -> the finished report

Sessions live in memory. One-day build; a restart loses them and that is fine.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app import claims as claims_mod
from app import events, review, scoring, sources, survey
from app import handoff as handoff_mod
from app.schemas import (
    AnswerRequest,
    AnswerResponse,
    Claim,
    Disagreement,
    FullReport,
    Intent,
    JobState,
    RateSourcesRequest,
    ReviewVerdict,
    ScoutRequest,
    ScoutResponse,
    Source,
    StartRequest,
    StartResponse,
    SurveyAnswer,
    SurveyQuestion,
    VerificationReport,
    VerifyRequest,
)

app = FastAPI(title="Glassbox", version="0.1.0")

# The frontend is still being decided, so let anything local talk to us.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_SURVEY_ROUNDS = 3
ENABLE_SECOND_ANCHOR = True


@dataclass
class Session:
    research_output: str
    supplied_sources: list[str]
    original_prompt: str | None
    asked: list[SurveyQuestion] = field(default_factory=list)
    answers: list[SurveyAnswer] = field(default_factory=list)
    rounds: int = 0
    intent: Intent | None = None
    sources: list[Source] = field(default_factory=list)
    excluded: set[str] = field(default_factory=set)
    full: FullReport | None = None


SESSIONS: dict[str, Session] = {}


def _get(session_id: str) -> Session:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="unknown session_id")
    return session


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/start", response_model=StartResponse)
async def start(req: StartRequest) -> StartResponse:
    session_id = uuid.uuid4().hex[:12]
    SESSIONS[session_id] = Session(
        research_output=req.research_output,
        supplied_sources=req.sources,
        original_prompt=req.original_prompt,
    )
    session = SESSIONS[session_id]
    log = events.get_log(session_id)

    log.emit(
        actor="user",
        message="Research submitted for checking",
        payload={"chars": len(req.research_output), "sources": len(req.sources)},
        state_to=JobState.INTAKE,
    )
    log.emit(actor="interviewer", message="Working out what you actually asked for")

    questions = await survey.opening_questions(
        research_output=req.research_output,
        supplied_sources=req.sources,
        original_prompt=req.original_prompt,
    )
    session.asked = list(questions)
    session.rounds = 1
    log.emit(
        actor="interviewer",
        message=f"{len(questions)} questions for you",
        payload={"questions": [q.question for q in questions]},
    )
    return StartResponse(session_id=session_id, questions=questions)


@app.post("/api/answer", response_model=AnswerResponse)
async def answer(req: AnswerRequest) -> AnswerResponse:
    session = _get(req.session_id)
    log = events.get_log(req.session_id)
    session.answers.extend(req.answers)
    log.emit(actor="user", message=f"Answered {len(req.answers)} questions")

    # Give the survey room to dig, but never let it grill forever.
    more: list[SurveyQuestion] = []
    if session.rounds < MAX_SURVEY_ROUNDS:
        more = await survey.followup_questions(
            research_output=session.research_output,
            asked=session.asked,
            answers=session.answers,
        )

    if more:
        session.asked.extend(more)
        session.rounds += 1
        log.emit(actor="interviewer", message=f"{len(more)} follow-ups")
        return AnswerResponse(session_id=req.session_id, done=False, questions=more)

    session.intent = await survey.build_intent(
        research_output=session.research_output,
        original_prompt=session.original_prompt,
        asked=session.asked,
        answers=session.answers,
    )
    log.emit(
        actor="interviewer",
        message="Intent settled",
        payload={"question": session.intent.restated_question},
        state_to=JobState.INTENT_CONFIRM,
    )
    return AnswerResponse(session_id=req.session_id, done=True, intent=session.intent)


@app.post("/api/scout", response_model=ScoutResponse)
async def scout(req: ScoutRequest) -> ScoutResponse:
    """Find and categorise the sources, then hand them back for the human checkpoint."""
    session = _get(req.session_id)
    if session.intent is None:
        raise HTTPException(status_code=409, detail="survey not finished")
    log = events.get_log(req.session_id)

    log.emit(
        actor="scout",
        message="Looking for sources: supplied, cited in the text, and live on the web",
        state_to=JobState.SOURCE_SCOUTING,
    )
    found = await sources.acquire_sources(
        research_output=session.research_output,
        supplied=session.supplied_sources,
        intent=session.intent,
    )
    reachable = sum(1 for s in found if s.fetched_ok)
    log.emit(
        actor="scout",
        message=f"{len(found)} sources found, {reachable} reachable",
        payload={"ids": [s.id for s in found]},
    )

    session.sources = await sources.categorise_sources(found)
    log.emit(
        actor="scout",
        message="Sources categorised — your turn to approve or exclude",
        payload={s.id: s.category.value for s in session.sources},
        state_to=JobState.SOURCE_RATING,
    )
    return ScoutResponse(
        session_id=req.session_id, state=JobState.SOURCE_RATING, sources=session.sources
    )


@app.post("/api/rate-sources", response_model=ScoutResponse)
async def rate_sources(req: RateSourcesRequest) -> ScoutResponse:
    """Human-in-the-loop checkpoint. Excluded sources are not used downstream."""
    session = _get(req.session_id)
    log = events.get_log(req.session_id)

    session.excluded = {r.source_id for r in req.ratings if not r.approved}
    reasons = {r.source_id: r.exclusion_reason for r in req.ratings if not r.approved}
    log.emit(
        actor="user",
        message=f"{len(session.excluded)} sources excluded, "
        f"{len(session.sources) - len(session.excluded)} approved",
        payload={"excluded": reasons},
    )
    kept = [s for s in session.sources if s.id not in session.excluded]
    return ScoutResponse(
        session_id=req.session_id, state=JobState.SOURCE_RATING, sources=kept
    )


@app.post("/api/verify", response_model=FullReport)
async def verify(req: VerifyRequest) -> FullReport:
    """Score the approved sources, then check what the research actually claims."""
    session = _get(req.session_id)
    if session.intent is None:
        raise HTTPException(status_code=409, detail="survey not finished")
    log = events.get_log(req.session_id)

    # Scout is optional — if the caller skipped straight here, do it inline.
    if not session.sources:
        await scout(ScoutRequest(session_id=req.session_id))

    approved = [s for s in session.sources if s.id not in session.excluded]
    if not approved:
        raise HTTPException(status_code=409, detail="every source was excluded")

    log.emit(
        actor="scorer",
        message=f"Scoring {len(approved)} approved sources",
        state_to=JobState.VERIFYING,
    )
    scored = await scoring.score_all(approved, session.intent)
    log.emit(
        actor="scorer",
        message="Per-source credibility done",
        payload={s.id: (s.credibility.score if s.credibility else None) for s in scored},
    )

    # Provenance: a credible source proves nothing if the research misused it.
    log.emit(actor="scorer", message="Pulling out the checkable claims")
    extracted = await claims_mod.extract_claims(session.research_output, session.intent)
    log.emit(actor="scorer", message=f"{len(extracted)} claims to check")

    checked: list[Claim] = await claims_mod.check_all(extracted, scored)
    counts = claims_mod.provenance_summary(checked)
    log.emit(
        actor="scorer",
        message="Claims checked against their sources",
        payload=counts,
        state_to=JobState.REPORT_READY,
    )

    report: VerificationReport = await scoring.aggregate(scored, session.intent)

    log.emit(actor="reviewer", message="Second opinion", state_to=JobState.REVIEW)
    verdicts: list[ReviewVerdict] = []
    disagreements: list[Disagreement] = []
    try:
        verdicts, disagreements = await review.full_review(
            checked, scored, session.intent, enable_second_anchor=ENABLE_SECOND_ANCHOR
        )
        log.emit(
            actor="reviewer",
            message=f"{len(verdicts)} verdicts, {len(disagreements)} disagreements",
            payload={"disagreements": [d.claim_id for d in disagreements]},
        )
    except Exception as exc:  # review is a bonus; never let it sink the report
        log.emit(actor="system", message=f"Review failed, continuing: {exc}")

    log.emit(actor="system", message="Writing a sharpened research prompt")
    handoff = None
    try:
        h = await handoff_mod.build_handoff(report, checked, session.intent, verdicts)
        handoff = h.model_dump()
        log.emit(actor="system", message="Hand-off prompt ready")
    except Exception as exc:
        log.emit(actor="system", message=f"Hand-off skipped: {exc}")

    full = FullReport(
        session_id=req.session_id,
        state=JobState.USER_EVALUATION,
        report=report,
        claims=checked,
        provenance_counts=counts,
        verdicts=verdicts,
        disagreements=disagreements,
        handoff=handoff,
    )
    session.full = full
    log.emit(
        actor="system",
        message=f"Verdict: {report.verdict} ({report.overall_score}/100)",
        state_to=JobState.USER_EVALUATION,
    )
    log.close()
    return full


@app.get("/api/events/{session_id}")
async def stream_events(session_id: str) -> StreamingResponse:
    """Live cascade. Replays everything so far, then streams as it happens."""
    _get(session_id)
    return StreamingResponse(
        events.sse_stream(session_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/report/{session_id}", response_model=FullReport)
async def get_report(session_id: str) -> FullReport:
    session = _get(session_id)
    if session.full is None:
        raise HTTPException(status_code=404, detail="no report yet — call /api/verify")
    return session.full
