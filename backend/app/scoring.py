"""Credibility scorer loop + final aggregation.

Pipeline stage: sources (categorised) + Intent -> per-source CredibilityAssessment
-> VerificationReport. This is the module the whole project is judged on — the
question we code against is "would a human sign off on this without re-reading
every line?".

Scoring is an LLM call per source (kept cheap via the shared system-prompt cache
in llm.structured). The final numeric score is NOT delegated to the model — it is
computed deterministically in Python from the per-source assessments, so it is
inspectable and testable independent of any LLM call.
"""

from __future__ import annotations

import asyncio
from typing import Literal

from pydantic import BaseModel, Field

from app.llm import MODEL_AGGREGATE, MODEL_SCORE, structured
from app.schemas import (
    CredibilityAssessment,
    Intent,
    Source,
    SourceCategory,
    VerificationReport,
)

# --------------------------------------------------------------------------
# score_source
# --------------------------------------------------------------------------

# Long and STABLE on purpose: llm.structured() caches this as the system prompt
# prefix, so every call in the score_all loop reuses the cached prefix and only
# pays for the per-source user message. Never interpolate per-source data in here.
_SCORE_SYSTEM_PROMPT = """You are a credibility auditor for a research-verification tool. You are given ONE \
source that was cited in support of a piece of research, plus the Intent behind that research \
(what the user actually wanted to know). Your job is to produce a CredibilityAssessment for \
that single source. You will be called once per source — be consistent, be blunt, and never \
soften a judgement to be agreeable.

Score two DIFFERENT things, independently. Do not let one contaminate the other:

1. `score` (0-100): how much a careful reader should trust this source AS A SOURCE, in general —
   its authority, rigor, and independence. This is about the source itself, not about whether it
   happens to answer the question at hand.
2. `relevance_to_intent` (0-100): how directly this source's content addresses the Intent's
   `restated_question` and `success_criteria`. A rigorous, highly credible source that answers a
   DIFFERENT question is credible but IRRELEVANT — score it high on `score` and low on
   `relevance_to_intent`, and say so explicitly in `reasons`. Do not average the two concepts
   together in your head; a reader needs to be able to tell "wrong source" apart from "bad
   source".

Weigh `score` using this rubric, in order of importance:

A. SOURCE CATEGORY. The category field tells you the kind of source this is. Rank, roughly,
   from most to least trustworthy by default: peer_reviewed and primary (official statistics,
   filings, court records, raw datasets, government/standards bodies) sit at the top; reputable_media
   and industry_analyst are solid but secondary; encyclopaedia is a fine starting point but not a
   citation-grade source on its own; vendor_marketing and press_release are inherently
   self-interested and should be capped well below peer_reviewed/primary regardless of how
   polished they look; blog_opinion and forum_ugc carry no institutional accountability and should
   be scored low unless the specific author/context gives you a concrete reason to trust it; unknown
   and unreachable get no benefit of the doubt. Category is a strong prior, not a hard rule — a
   sloppy peer-reviewed paper can still score badly, and a forum post from the original author of a
   library can still score higher than the category floor if the content itself justifies it. When
   you deviate from the category's default expectation, say why in `reasons`.

B. DID IT ACTUALLY RESOLVE. If `fetched_ok` is false, this is a hard red flag: add it to
   `red_flags` verbatim (e.g. "link did not resolve" / include the fetch_error if given) and cap
   `score` at 25 — a dead link cannot be verified no matter how reputable the domain sounds. Do not
   go above that cap even if the title or URL looks authoritative. If there is no content_excerpt
   at all, say so and lower `confidence` accordingly.

C. INDEPENDENCE. Ask: is this source selling, or otherwise financially/reputationally invested in,
   the thing it is being cited to support? A vendor benchmarking its own product, a company's own
   press release about its own results, an affiliate/sponsored post — these are not neutral
   evidence even when the underlying facts might be true, and must be flagged in `red_flags`
   (e.g. "vendor's own benchmark of its own product") and reflected in a lower `score`. Independent
   replication, third-party analysis, or adversarial/regulatory scrutiny of a claim raises trust.

D. DATEDNESS. Compare whatever date signal you can find (explicit date, "last updated", content
   that implies recency, or its total absence) against `intent.recency_requirement`. If
   recency_requirement is set and the source is silent on its own date, or is clearly older than
   the requirement calls for, flag it ("no publication date anywhere on the page", "data from
   2019, requirement is post-2024") and lower `score` accordingly — undated is treated as a
   negative, not a neutral, when recency matters. If recency_requirement is None, datedness still
   matters for anything about a fast-moving topic, use judgement.

`confidence` describes how sure YOU are about the score you just gave — not how good the source
is. Use "low" when the excerpt is thin, missing, truncated mid-thought, or the category is
ambiguous; "high" only when you have enough concrete signal (clear masthead, dates, authorship,
methodology) to defend the score under cross-examination; "medium" otherwise.

`reasons` must be concrete and specific enough that a human could argue with a single one of them
in isolation — cite what you actually saw ("no author byline, no publication date, page is a
product landing page with a 'Buy now' CTA above the fold"). Never write vague filler like "seems
reliable" or "source appears credible" — that sentence is worthless and will be rejected by
review. Aim for 2-5 reasons. `red_flags` is for genuinely disqualifying issues only — leave it
empty if there are none, do not pad it.

Return only the structured CredibilityAssessment. No other commentary."""


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


def _format_source(source: Source) -> str:
    excerpt = source.content_excerpt
    if excerpt and len(excerpt) > 4000:
        excerpt = excerpt[:4000] + "... [truncated]"
    return (
        f"id: {source.id}\n"
        f"url: {source.url or '(none)'}\n"
        f"title: {source.title or '(none)'}\n"
        f"origin: {source.origin.value}\n"
        f"raw_reference (as it appeared in the input): {source.raw_reference}\n"
        f"category: {source.category.value}\n"
        f"category_reasoning: {source.category_reasoning or '(none given)'}\n"
        f"fetched_ok: {source.fetched_ok}\n"
        f"fetch_error: {source.fetch_error or '(none)'}\n"
        f"content_excerpt:\n{excerpt or '(no content available)'}"
    )


async def score_source(source: Source, intent: Intent) -> CredibilityAssessment:
    """Score one source against the intent. One LLM call."""
    user_message = (
        f"INTENT:\n{_format_intent(intent)}\n\n"
        f"SOURCE:\n{_format_source(source)}\n\n"
        "Assess this source now."
    )
    return await structured(
        model=MODEL_SCORE,
        system=_SCORE_SYSTEM_PROMPT,
        user=user_message,
        schema=CredibilityAssessment,
    )


# --------------------------------------------------------------------------
# score_all — the credibility scorer loop
# --------------------------------------------------------------------------

_CONCURRENCY = 5


async def score_all(sources: list[Source], intent: Intent) -> list[Source]:
    """Score every source concurrently and attach the result to `source.credibility`.

    A single source's scoring failure never fails the batch — it gets a
    worst-case fallback assessment instead, so the rest of the report still lands.
    """
    semaphore = asyncio.Semaphore(_CONCURRENCY)

    async def _bounded(source: Source) -> CredibilityAssessment:
        async with semaphore:
            return await score_source(source, intent)

    results = await asyncio.gather(
        *(_bounded(s) for s in sources), return_exceptions=True
    )

    for source, result in zip(sources, results):
        if isinstance(result, BaseException):
            source.credibility = CredibilityAssessment(
                score=0,
                confidence="low",
                reasons=[f"scoring failed: {result}"],
                red_flags=["not assessed"],
                relevance_to_intent=0,
            )
        else:
            source.credibility = result

    return sources


# --------------------------------------------------------------------------
# compute_overall_score — the deterministic aggregation formula
# --------------------------------------------------------------------------

# Sources with no useful relevance signal still get some weight in the average
# (a completely irrelevant source shouldn't be silently erased from the record —
# it should just barely move the needle instead of dragging it hard either way).
_MIN_RELEVANCE_WEIGHT = 5.0

# Ceiling on how much the "share of the source set that is unreachable or
# uncategorised" penalty can subtract from the relevance-weighted average.
_PROBLEM_SHARE_MAX_PENALTY = 40.0

# A source the scorer itself is unsure about shouldn't swing the average as hard as
# one it's confident in — otherwise a low-confidence, high-relevance guess (e.g. a
# citation the model couldn't actually verify) drags the score down harder than a
# well-verified source pulls it up.
_CONFIDENCE_WEIGHT_MULTIPLIER = {"high": 1.0, "medium": 0.7, "low": 0.4}


def compute_overall_score(sources: list[Source]) -> int:
    """Deterministic 0-100 score for the whole source set.

    Formula: a relevance-weighted average of per-source credibility scores, minus
    a penalty proportional to the share of sources that are unreachable or never
    got categorised.

    Weighting by relevance_to_intent (rather than a flat average) is the whole
    point: a highly-relevant-but-weak source should drag the score down harder
    than an irrelevant-and-weak one, because the reader is actually relying on
    the relevant ones to answer their question. Each weight is floored at
    _MIN_RELEVANCE_WEIGHT so a source scored 0 relevance still counts a little
    rather than vanishing from the average entirely.

    The problem-share penalty exists because a weighted average alone can't see
    "half our source set didn't even load" — a report built on mostly-dead links
    should score badly even if the two links that did resolve looked great.
    """
    if not sources:
        return 0

    scored = [s for s in sources if s.credibility is not None]
    if not scored:
        return 0

    weighted_sum = 0.0
    total_weight = 0.0
    for s in scored:
        c = s.credibility
        assert c is not None  # narrowed above
        weight = max(float(c.relevance_to_intent), _MIN_RELEVANCE_WEIGHT)
        weight *= _CONFIDENCE_WEIGHT_MULTIPLIER.get(c.confidence, 0.7)
        weighted_sum += c.score * weight
        total_weight += weight

    base = weighted_sum / total_weight if total_weight else 0.0

    # fetched_ok only means something for a source that had a URL to fetch — a
    # prose citation with no URL was never attempted, so it shouldn't be scored as
    # a broken link. It can still be penalised on its own merits (low score, low
    # confidence, or a genuine UNKNOWN/UNREACHABLE category).
    problem_count = sum(
        1
        for s in sources
        if (s.url is not None and not s.fetched_ok)
        or s.category in (SourceCategory.UNKNOWN, SourceCategory.UNREACHABLE)
    )
    problem_share = problem_count / len(sources)
    penalty = problem_share * _PROBLEM_SHARE_MAX_PENALTY

    final = base - penalty
    return int(round(max(0.0, min(100.0, final))))


def _verdict_for(
    overall_score: int, sources: list[Source]
) -> Literal["sign_off", "check_flagged", "do_not_rely"]:
    if not sources:
        return "do_not_rely"
    if overall_score >= 75:
        return "sign_off"
    if overall_score >= 45:
        return "check_flagged"
    return "do_not_rely"


# --------------------------------------------------------------------------
# aggregate — final report, one LLM call for the human-facing narrative
# --------------------------------------------------------------------------

_AGGREGATE_SYSTEM_PROMPT = """You are writing the executive summary of a source-credibility audit. You are \
given the Intent behind a piece of research and the full list of per-source credibility \
assessments that have already been computed (scores, confidence, reasons, red flags, relevance). \
A numeric overall_score and verdict have ALREADY been decided by a separate deterministic \
process — you are not choosing them and must not contradict them; treat them as given facts to \
explain, not conclusions to relitigate.

Produce exactly two things:

1. `summary`: ONE paragraph, written for a busy human who is about to decide whether to trust this \
research and is not going to re-read every source themselves. It should say, in plain language: \
what the research was trying to establish, how well the sources actually back it up, and the one \
or two things that most determine whether they should trust it. Be direct about weaknesses — this \
summary is worthless if it just says everything looks fine. If overall_score is low, say plainly \
that it should not be relied on and why.

2. `weakest_links`: a list of the SPECIFIC things that dragged the score down — name actual source \
ids/titles/urls and the actual problem ("s3 (vendor blog) is the only source for the core claim \
and is not independent", "s1 never resolved", "s5 is peer-reviewed but answers a narrower question \
than what was asked"). Never write a generic entry like "some sources were weak" — every entry \
must be traceable to a specific source or a specific gap in the source set. If there genuinely are \
no meaningful weaknesses, return a short list saying so explicitly rather than inventing filler.

Return only the structured object. No other commentary."""


class _AggregateNarrative(BaseModel):
    """Internal-only schema for the LLM half of aggregate(). Not part of the pipeline contract."""

    summary: str = Field(description="one paragraph a human reads before deciding")
    weakest_links: list[str] = Field(
        description="specific things that dragged the score down, naming sources"
    )


def _format_assessment(source: Source) -> str:
    c = source.credibility
    if c is None:
        return f"id: {source.id} — NOT ASSESSED"
    reasons = "; ".join(c.reasons) or "(none given)"
    red_flags = "; ".join(c.red_flags) or "(none)"
    return (
        f"id: {source.id} | title: {source.title or '(none)'} | url: {source.url or '(none)'}\n"
        f"  category: {source.category.value} | fetched_ok: {source.fetched_ok}\n"
        f"  score: {c.score} | confidence: {c.confidence} | relevance_to_intent: {c.relevance_to_intent}\n"
        f"  reasons: {reasons}\n"
        f"  red_flags: {red_flags}"
    )


async def aggregate(sources: list[Source], intent: Intent) -> VerificationReport:
    """Combine per-source assessments into the final VerificationReport.

    overall_score/verdict are computed deterministically; summary/weakest_links
    come from one LLM call over the already-computed assessments.
    """
    overall_score = compute_overall_score(sources)
    verdict = _verdict_for(overall_score, sources)

    if not sources:
        return VerificationReport(
            intent=intent,
            sources=sources,
            overall_score=0,
            verdict="do_not_rely",
            summary="No sources were provided or survived to be assessed, so there is nothing to verify this research against. Do not rely on it.",
            weakest_links=["no sources available"],
        )

    assessments_block = "\n".join(_format_source(s) + "\n" + _format_assessment(s) for s in sources)
    user_message = (
        f"INTENT:\n{_format_intent(intent)}\n\n"
        f"COMPUTED overall_score: {overall_score}\n"
        f"COMPUTED verdict: {verdict}\n\n"
        f"PER-SOURCE ASSESSMENTS:\n{assessments_block}\n\n"
        "Write the summary and weakest_links now."
    )
    narrative = await structured(
        model=MODEL_AGGREGATE,
        system=_AGGREGATE_SYSTEM_PROMPT,
        user=user_message,
        schema=_AggregateNarrative,
    )

    return VerificationReport(
        intent=intent,
        sources=sources,
        overall_score=overall_score,
        verdict=verdict,
        summary=narrative.summary,
        weakest_links=narrative.weakest_links,
    )
