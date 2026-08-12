"""FastAPI surface for the trust layer.

Three steps, mirroring the architecture:
    POST /api/start   -> opens a session, returns the first survey questions
    POST /api/answer  -> feeds answers back, either asks more or settles the intent
    POST /api/verify  -> acquires + categorises + scores sources, returns the report

Sessions live in memory. This is a one-day build; a restart loses them, and that is
fine for the demo.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import scoring, sources, survey
from .schemas import (
    AnswerRequest,
    AnswerResponse,
    Intent,
    StartRequest,
    StartResponse,
    SurveyAnswer,
    SurveyQuestion,
    VerificationReport,
    VerifyRequest,
)

app = FastAPI(title="Trust Layer", version="0.1.0")

# The frontend is still being decided, so let anything local talk to us.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_SURVEY_ROUNDS = 3


@dataclass
class Session:
    research_output: str
    supplied_sources: list[str]
    original_prompt: str | None
    asked: list[SurveyQuestion] = field(default_factory=list)
    answers: list[SurveyAnswer] = field(default_factory=list)
    rounds: int = 0
    intent: Intent | None = None
    report: VerificationReport | None = None


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
    session = Session(
        research_output=req.research_output,
        supplied_sources=req.sources,
        original_prompt=req.original_prompt,
    )
    questions = await survey.opening_questions(
        research_output=req.research_output,
        supplied_sources=req.sources,
        original_prompt=req.original_prompt,
    )
    session.asked = list(questions)
    session.rounds = 1
    SESSIONS[session_id] = session
    return StartResponse(session_id=session_id, questions=questions)


@app.post("/api/answer", response_model=AnswerResponse)
async def answer(req: AnswerRequest) -> AnswerResponse:
    session = _get(req.session_id)
    session.answers.extend(req.answers)

    # Give the survey a chance to dig, but never let it grill forever.
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
        return AnswerResponse(session_id=req.session_id, done=False, questions=more)

    session.intent = await survey.build_intent(
        research_output=session.research_output,
        original_prompt=session.original_prompt,
        asked=session.asked,
        answers=session.answers,
    )
    return AnswerResponse(session_id=req.session_id, done=True, intent=session.intent)


@app.post("/api/verify", response_model=VerificationReport)
async def verify(req: VerifyRequest) -> VerificationReport:
    session = _get(req.session_id)
    if session.intent is None:
        raise HTTPException(
            status_code=409, detail="survey not finished — call /api/answer until done"
        )

    found = await sources.acquire_sources(
        research_output=session.research_output,
        supplied=session.supplied_sources,
        intent=session.intent,
    )
    categorised = await sources.categorise_sources(found)
    scored = await scoring.score_all(categorised, session.intent)
    report = await scoring.aggregate(scored, session.intent)

    session.report = report
    return report


@app.get("/api/report/{session_id}", response_model=VerificationReport)
async def get_report(session_id: str) -> VerificationReport:
    session = _get(session_id)
    if session.report is None:
        raise HTTPException(status_code=404, detail="no report yet — call /api/verify")
    return session.report
