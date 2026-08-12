"""The last step: turn "here is what's wrong" into "here is how to fix it".

Pipeline stage: everything (VerificationReport, checked Claims, Intent, ReviewVerdicts) ->
Handoff. By the time this module runs, the pipeline already knows which sources failed,
which claims came back unsupported or contradicted, and what the two reviewers flagged.
None of that is useful to a user sitting in front of a bad research report unless it turns
into something they can act on — so this module's whole job is to compress the audit into
a single paste-ready prompt for a fresh research agent, plus the specifics (bad sources,
unverified claims, gaps) that back it up.

`Handoff` is a response shape, not a cross-module contract, so it lives here rather than
in schemas.py. `failing_sources` is deterministic and side-effect free, used both to shape
the LLM call below and available on its own (e.g. for a UI list) without spending a token.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.llm import MODEL_AGGREGATE, structured
from app.schemas import Claim, ClaimSupport, Intent, ReviewVerdict, Source, SourceCategory, VerificationReport

_MAX_SOURCES = 15
_MAX_CLAIMS = 15
_MAX_CLAIM_TEXT = 200


class Handoff(BaseModel):
    """What the user takes away: a prompt to paste into a fresh research agent, plus the
    receipts behind it."""

    prompt: str = Field(
        description="paste-ready research instruction: second person, imperative, "
        "self-contained, no markdown"
    )
    must_replace: list[str] = Field(
        default_factory=list,
        description="sources that have to go, by id, with the specific reason",
    )
    must_verify: list[str] = Field(
        default_factory=list,
        description="claims that need a real source before anyone should trust them, by id",
    )
    open_questions: list[str] = Field(
        default_factory=list,
        description="what the intent required that the original research never addressed at all",
    )


class _HandoffFindings(BaseModel):
    """Internal-only schema for the LLM call. Kept separate from `Handoff` so the public
    response shape and the model's output contract can drift independently."""

    prompt: str = ""
    must_replace: list[str] = Field(default_factory=list)
    must_verify: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------
# failing_sources() — deterministic, no LLM
# --------------------------------------------------------------------------


def _is_failing(source: Source) -> bool:
    """Unreachable, never scored, or scored too low to lean on."""
    if source.category == SourceCategory.UNREACHABLE or not source.fetched_ok:
        return True
    if source.credibility is None:
        return True
    return source.credibility.score < 40


def _severity_key(source: Source) -> int:
    """Lower sorts first ('worst first'). No credibility at all — unreachable or never
    scored — is treated as worse than any source that at least got a number, because
    there is nothing on record to vouch for it."""
    if source.credibility is None:
        return -1
    return source.credibility.score


def failing_sources(report: VerificationReport) -> list[Source]:
    """Sources too broken to lean on again: unreachable, uncategorised-as-unreachable,
    never scored, or scored below 40. Worst first.

    Deterministic — this is the one part of the hand-off a human should be able to trust
    without re-checking it, same reasoning as `review.find_disagreements`.
    """
    bad = [s for s in report.sources if _is_failing(s)]
    return sorted(bad, key=_severity_key)


def _prioritized_sources(sources: list[Source], cap: int = _MAX_SOURCES) -> list[Source]:
    """Failing sources first (worst first), then the rest, capped so the call stays bounded."""
    bad = sorted((s for s in sources if _is_failing(s)), key=_severity_key)
    bad_ids = {s.id for s in bad}
    rest = [s for s in sources if s.id not in bad_ids]
    return (bad + rest)[:cap]


def _prioritized_claims(claims: list[Claim], cap: int = _MAX_CLAIMS) -> list[Claim]:
    """Unsupported / contradicted claims first, then the rest, capped."""
    bad = [c for c in claims if c.support in (ClaimSupport.UNSUPPORTED, ClaimSupport.CONTRADICTED)]
    bad_ids = {c.id for c in bad}
    rest = [c for c in claims if c.id not in bad_ids]
    return (bad + rest)[:cap]


# --------------------------------------------------------------------------
# formatting helpers
# --------------------------------------------------------------------------


def _truncate(text: str, limit: int = _MAX_CLAIM_TEXT) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _format_intent(intent: Intent) -> str:
    criteria = "\n".join(f"  - {c}" for c in intent.success_criteria) or "  (none given)"
    deal_breakers = "\n".join(f"  - {d}" for d in intent.deal_breakers) or "  (none given)"
    return (
        f"Restated question: {intent.restated_question}\n"
        f"Domain: {intent.domain}\n"
        f"Recency requirement: {intent.recency_requirement or 'not time-sensitive'}\n"
        f"Success criteria:\n{criteria}\n"
        f"Deal breakers:\n{deal_breakers}"
    )


def _format_sources(sources: list[Source]) -> str:
    if not sources:
        return "(no sources)"
    lines = []
    for s in sources:
        score = s.credibility.score if s.credibility else None
        red_flags = (
            "; ".join(s.credibility.red_flags) if s.credibility and s.credibility.red_flags else "(none)"
        )
        lines.append(
            f"id: {s.id} | url: {s.url or '(none)'} | category: {s.category.value} | "
            f"score: {score if score is not None else 'not scored'} | fetched_ok: {s.fetched_ok} | "
            f"red_flags: {red_flags}"
        )
    return "\n".join(lines)


def _format_claims(claims: list[Claim]) -> str:
    if not claims:
        return "(no claims)"
    lines = []
    for c in claims:
        lines.append(
            f"id: {c.id} | support: {c.support.value}\n"
            f"  text: {_truncate(c.text)}\n"
            f"  reasoning: {c.reasoning or '(none given)'}"
        )
    return "\n".join(lines)


def _format_reviewer_findings(verdicts: list[ReviewVerdict]) -> str:
    if not verdicts:
        return "(no reviewer verdicts)"
    lines = []
    for v in verdicts:
        unsupported = ", ".join(v.unsupported_claims) or "(none)"
        cannot_verify = "; ".join(v.cannot_verify) or "(none)"
        lines.append(
            f"{v.reviewer} reviewer\n"
            f"  unsupported_claims: {unsupported}\n"
            f"  cannot_verify: {cannot_verify}\n"
            f"  note: {v.note or '(none given)'}"
        )
    return "\n\n".join(lines)


# --------------------------------------------------------------------------
# system prompt
# --------------------------------------------------------------------------

_SYSTEM_PROMPT = """You are writing the final output of a research-audit pipeline: a sharpened research \
prompt the user pastes into a fresh research agent to redo the work properly. Everything upstream \
of you has already found the problems — bad sources, unsupported claims, reviewer disagreements. \
Your job is not to describe those problems again. It is to turn them into instructions precise \
enough that a different agent, with no memory of any of this, cannot repeat them.

You will receive the original Intent (what the user actually wanted), the scored sources \
(worst first), the checked claims (unsupported/contradicted first), and what the internal and \
second-anchor reviewers flagged. Produce four fields.

`prompt` — the actual deliverable. Everything else is supporting detail; if the user reads nothing \
else, this is what they paste into a fresh research agent. Write it in second person, imperative \
mood — "Find primary sources for...", "Do not cite...", "State plainly where the evidence is \
thin..." — as a direct instruction to whoever runs it next. No preamble, no "Here is a prompt", no \
markdown headers, no bullet points — it must read as one continuous piece of instruction a user can \
paste with zero editing. It must be fully self-contained: assume the reader has never seen this \
audit and has no other context. Concretely it must:
  - open by restating the real question from the Intent, so the reader knows what they are \
    actually answering, before anything else
  - state every one of the Intent's success criteria as an explicit requirement the new research \
    must meet
  - state every one of the Intent's deal-breakers as an explicit prohibition
  - name each source that failed, by id and url where it has one, and say plainly why it cannot be \
    reused — dead link, a vendor selling the thing it was cited to support, a citation with no \
    working url or content behind it, or a credibility score too low to rely on — and instruct the \
    new research to find independent replacements, not just re-verify the same ones
  - name each claim that came back unsupported, contradicted, or flagged by a reviewer, restate the \
    specific assertion in your own words, and require it be backed by primary evidence this time, \
    or dropped from the answer entirely
  - explicitly instruct the new research to state uncertainty plainly rather than smoothing it \
    over — where evidence is thin, mixed, or contested, the output should say so instead of picking \
    a confident-sounding number

`must_replace` — one entry per source that has to go. Name the source id and the concrete reason: \
dead link / unreachable, a vendor marketing the thing it's cited for, a phantom citation with no \
url or content behind it, or a credibility score too low to rely on. Be specific to that source; \
do not write one generic sentence and reuse it across entries.

`must_verify` — one entry per claim that needs a real source before anyone should trust it again. \
Name the claim id and state the assertion briefly, in your own words. This is a punch list for a \
future fact-checker, not a restatement of the whole report.

`open_questions` — things the Intent required an answer on that the original research never \
addressed at all. Not claims that were wrong — ground that was never covered. If a success \
criterion or deal-breaker points at territory with zero claims or sources touching it, that is an \
open question. If everything the Intent asked for was at least attempted, leave this empty rather \
than inventing something to fill it.

Ground every specific statement you make in the data you were given — a source id, a claim id, a \
reviewer's own words. Do not generalize past what's actually in front of you, and do not soften a \
finding that was clear-cut. This document exists so the next research pass doesn't repeat the same \
mistakes; vague or hedged output defeats the purpose.

Return only the structured fields. No other commentary."""


# --------------------------------------------------------------------------
# fallback — no LLM, used when the call above fails
# --------------------------------------------------------------------------


def _fallback_prompt(intent: Intent) -> str:
    """Built from Intent alone, in Python. Never as good as the LLM version, but never
    absent — the pipeline must not lose the hand-off just because one call failed."""
    criteria = " ".join(f"Require: {c}." for c in intent.success_criteria)
    deal_breakers = " ".join(f"Do not accept research that {d}." for d in intent.deal_breakers)
    recency = f" Only use sources that meet this recency requirement: {intent.recency_requirement}." \
        if intent.recency_requirement else ""
    return (
        f"Answer this question: {intent.restated_question} "
        f"{criteria} {deal_breakers}{recency} "
        "Use independent, primary sources and verify every claim against the actual source content "
        "before including it. State uncertainty plainly wherever the evidence is thin, mixed, or "
        "contested instead of picking a confident-sounding number."
    ).strip()


# --------------------------------------------------------------------------
# build_handoff() — orchestration
# --------------------------------------------------------------------------


async def build_handoff(
    report: VerificationReport,
    claims: list[Claim],
    intent: Intent,
    verdicts: list[ReviewVerdict],
) -> Handoff:
    """Turn a finished audit into a paste-ready research prompt plus receipts.

    Never raises: any failure — LLM error, malformed output, network issue — falls back
    to a plain prompt built in Python from Intent alone. The hand-off is the last step
    of the pipeline; it must not be the step that breaks it.
    """
    try:
        sources_text = _format_sources(_prioritized_sources(report.sources))
        claims_text = _format_claims(_prioritized_claims(claims))
        reviewers_text = _format_reviewer_findings(verdicts)
        user = (
            f"INTENT:\n{_format_intent(intent)}\n\n"
            f"SOURCES (worst first, capped at {_MAX_SOURCES}):\n{sources_text}\n\n"
            f"CLAIMS (unsupported/contradicted first, capped at {_MAX_CLAIMS}):\n{claims_text}\n\n"
            f"REVIEWER FINDINGS:\n{reviewers_text}\n\n"
            "Produce the hand-off now."
        )
        findings = await structured(
            model=MODEL_AGGREGATE,
            system=_SYSTEM_PROMPT,
            user=user,
            schema=_HandoffFindings,
        )
        prompt = findings.prompt.strip() or _fallback_prompt(intent)
        return Handoff(
            prompt=prompt,
            must_replace=findings.must_replace,
            must_verify=findings.must_verify,
            open_questions=findings.open_questions,
        )
    except Exception:
        return Handoff(
            prompt=_fallback_prompt(intent),
            must_replace=[],
            must_verify=[],
            open_questions=[],
        )
