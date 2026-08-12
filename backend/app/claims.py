"""Provenance: does the research actually use its sources honestly?

Pipeline stage: research_output + Intent -> list[Claim] (extraction), then
list[Claim] + list[Source] -> list[Claim] (per-claim checking against source content).

Scoring a source as credible only tells you the source is trustworthy in the
abstract. It says nothing about whether a given sentence in the report is
actually backed by that source's own words. This module closes that gap: every
claim ends up with a support verdict, a provenance tag, and reasoning a human
can argue with. The failure mode we exist to catch is over-claiming — a source
merely being about the same topic is never treated as support.
"""

from __future__ import annotations

import asyncio
import re
from typing import Literal

from pydantic import BaseModel, Field

from app.llm import MODEL_EXTRACT, MODEL_SCORE, structured
from app.schemas import Claim, ClaimSupport, Intent, Provenance, Source

# --------------------------------------------------------------------------
# extract_claims
# --------------------------------------------------------------------------

_RESEARCH_EXCERPT_CHARS = 8000
_MAX_CLAIMS = 12

_EXTRACT_SYSTEM = """You are extracting the checkable factual claims from a piece of research output, \
so each one can later be verified against sources. You are given the research text and the Intent \
behind it (what the user actually wanted to know, their success criteria, and their deal-breakers).

Pull out only claims that are:
- Factual and load-bearing: specific statistics, numbers, dates, causal statements ('X caused Y'), \
attributions ('according to Z', 'a 2023 study found'), named comparisons, or claims of consensus \
('most experts agree', 'the industry standard is').
- Checkable in principle against a source — something a human could look up and confirm or deny.

Skip:
- Hedges, opinions, and framing language ('it's worth noting', 'generally speaking', 'this could \
suggest').
- Filler, transitions, and claims too vague to check ('things are changing fast', 'this is an \
important area').
- Claims about what the report itself will do or already said.

Prioritize claims that matter most to the Intent: anything that bears directly on a \
`success_criteria` item, and especially anything that would make a `deal_breaker` true if it \
turned out to be false. Order your output with the highest-priority claims first. Return at most \
12 claims — if there are more checkable claims than that, drop the least consequential ones, not \
the first ones you found.

For each claim, also decide `named_or_implied_source`: true if the SENTENCE ITSELF names, quotes, \
or clearly attributes the claim to a specific source ('according to Gartner', 'the company's Q3 \
filing shows', 'per the 2024 census'); false if the claim is stated as an unattributed assertion \
with no named origin, even if it sounds authoritative. This is a rough, sentence-level judgement — \
it will be checked for real against actual sources later.

Write each claim's `text` as a self-contained sentence lifted from (or lightly tightened from) the \
research output — do not paraphrase away specific numbers or names.

Return only the structured list. No other commentary."""


class _ClaimDraft(BaseModel):
    text: str
    named_or_implied_source: bool = Field(
        description="true if the sentence itself names/quotes/attributes a specific source"
    )


class _ClaimBatch(BaseModel):
    claims: list[_ClaimDraft]


def _excerpt(research_output: str) -> str:
    if len(research_output) <= _RESEARCH_EXCERPT_CHARS:
        return research_output
    return research_output[:_RESEARCH_EXCERPT_CHARS] + "\n...[truncated]"


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


async def extract_claims(research_output: str, intent: Intent) -> list[Claim]:
    """Pull the checkable claims out of the research output, ranked by relevance to Intent."""
    user = (
        f"INTENT:\n{_format_intent(intent)}\n\n"
        f"RESEARCH OUTPUT:\n{_excerpt(research_output)}\n\n"
        "Extract the claims now."
    )
    batch = await structured(
        model=MODEL_EXTRACT,
        system=_EXTRACT_SYSTEM,
        user=user,
        schema=_ClaimBatch,
    )
    claims: list[Claim] = []
    for i, draft in enumerate(batch.claims[:_MAX_CLAIMS], start=1):
        provenance = Provenance.SOURCE if draft.named_or_implied_source else Provenance.MODEL
        claims.append(Claim(id=f"c{i}", text=draft.text, provenance=provenance))
    return claims


# --------------------------------------------------------------------------
# check_claim
# --------------------------------------------------------------------------

_EXCERPT_CHARS = 2500
_SHORT_SOURCE_LIST = 6

_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "have", "has", "was",
    "were", "are", "its", "their", "them", "they", "about", "into", "over",
    "under", "than", "then", "also", "such", "been", "being", "not", "but",
    "which", "when", "where", "who", "what", "how", "why", "will", "would",
    "could", "should", "can", "may", "might", "did", "does", "doing", "much",
    "more", "most", "some", "many", "each", "other", "only", "just", "very",
    "even", "still", "after", "before", "during", "between", "among", "across",
}

_CHECK_SYSTEM = """You are a strict fact-checker auditing whether sources actually back up a single \
claim pulled from a research report. You are given ONE claim and a set of candidate sources (each \
with title, url, category, fetched_ok, and a content excerpt). Your only job is to judge, from the \
excerpt text ITSELF — not the title, not the url, not what a source like this would typically say \
— whether the claim is actually stated, restated, or logically entailed in the source content.

You are the safeguard against a very specific failure mode: research that cites a source next to a \
claim, when the source doesn't actually say that. A source merely being about the same general \
topic is NOT support. Someone should be able to open the source at the excerpt you cite and see \
exactly what you saw.

Decide the claim's overall status:

- SUPPORTED: at least one source's own content excerpt states the claim, or something that \
directly and specifically entails it (same fact, same scope, same magnitude — not just the same \
topic). Cite that source in source_ids.
- PARTIAL: a source is genuinely related but narrower, older, less certain, or differently scoped \
than the claim as written — e.g. the claim generalizes a single-company or single-study result \
into a broader trend ('companies are switching to X' when the source only shows one company did), \
or the source supports a softer/weaker version of the claim. Cite the source(s) that partially back \
it in source_ids.
- UNSUPPORTED: no candidate source's content excerpt says anything that bears on the claim. This \
includes: no candidate sources were given at all, every excerpt is missing/empty, or the excerpts \
exist but are simply silent on this claim. source_ids should be empty.
- CONTRADICTED: a source's own content excerpt states something that conflicts with the claim (a \
different number, an opposite conclusion, a fact that rules it out). Cite the contradicting \
source(s) in source_ids.

Be STRICT and default skeptical. Over-claiming is exactly the failure this exists to catch — when \
genuinely unsure whether an excerpt supports the claim or just sounds adjacent, prefer PARTIAL or \
UNSUPPORTED over SUPPORTED. Do not let source category, title, or url substitute for the content \
excerpt: a fetched_ok=false source, or one with an empty content_excerpt, cannot be the basis for \
SUPPORTED no matter how authoritative it looks — at best it can support PARTIAL with low \
confidence, and you must say so explicitly in `reasoning`. If every candidate source has no usable \
excerpt, the claim cannot be SUPPORTED; return UNSUPPORTED or PARTIAL (low confidence) and say \
plainly that no source content was available to check against.

provenance: SOURCE if the claim ends up SUPPORTED or PARTIAL by at least one fetched source with \
real content; MODEL if support is UNSUPPORTED or CONTRADICTED, or if the only 'supporting' sources \
never actually resolved or had content — i.e. nothing genuine backs this claim, so it reads as \
something the model asserted on its own.

reasoning: one or two concrete sentences a human could argue with — name the specific source id and \
quote or closely paraphrase the specific detail that decided your verdict ('s3's excerpt says X \
grew 12% in Q3 2024, which matches the claim exactly' / 's2 discusses the same company but never \
mentions the figure the claim cites' / 'no candidate source excerpt was available, so this cannot \
be checked'). Never write vague filler like 'source seems related'.

confidence: low when the deciding excerpt is thin, truncated, ambiguous, or missing entirely; high \
only when the excerpt states the claim plainly and unambiguously; medium otherwise.

source_ids must only contain ids of sources you were actually given below, and only ones that \
genuinely inform your verdict — do not cite a source just because it was in the candidate list.

Return only the structured verdict. No other commentary."""


class _ClaimVerdict(BaseModel):
    source_ids: list[str] = Field(default_factory=list)
    support: ClaimSupport
    provenance: Provenance
    reasoning: str
    confidence: Literal["low", "medium", "high"]


def _significant_words(text: str) -> set[str]:
    words = re.findall(r"[a-zA-Z0-9]+", text.lower())
    return {w for w in words if len(w) > 3 and w not in _STOPWORDS}


def _relevant_sources(claim_text: str, sources: list[Source]) -> list[Source]:
    """Cheap prefilter so we don't dump every source into every claim's prompt."""
    if len(sources) <= _SHORT_SOURCE_LIST:
        return sources
    claim_words = _significant_words(claim_text)
    if not claim_words:
        return sources
    matched = []
    for s in sources:
        haystack = " ".join(filter(None, [s.title, s.url]))
        if claim_words & _significant_words(haystack):
            matched.append(s)
    return matched


def _format_source(s: Source) -> str:
    excerpt = s.content_excerpt
    if excerpt and len(excerpt) > _EXCERPT_CHARS:
        excerpt = excerpt[:_EXCERPT_CHARS] + "... [truncated]"
    return (
        f"id: {s.id}\n"
        f"title: {s.title or '(none)'}\n"
        f"url: {s.url or '(none)'}\n"
        f"category: {s.category.value}\n"
        f"fetched_ok: {s.fetched_ok}\n"
        f"content_excerpt:\n{excerpt or '(no content available)'}"
    )


async def check_claim(claim: Claim, sources: list[Source]) -> Claim:
    """Check one claim against candidate sources. Returns a NEW Claim, never mutates."""
    candidates = _relevant_sources(claim.text, sources)

    if not candidates:
        # Nothing plausibly relevant was even offered — no LLM call can change that.
        return claim.model_copy(
            update={
                "source_ids": [],
                "support": ClaimSupport.UNSUPPORTED,
                "provenance": Provenance.MODEL,
                "reasoning": "No sources were available or plausibly relevant to check this claim against.",
                "confidence": "low",
            }
        )

    sources_block = "\n\n".join(_format_source(s) for s in candidates)
    user = f"CLAIM:\n{claim.text}\n\nCANDIDATE SOURCES:\n{sources_block}\n\nCheck this claim now."
    verdict = await structured(
        model=MODEL_SCORE,
        system=_CHECK_SYSTEM,
        user=user,
        schema=_ClaimVerdict,
    )

    valid_ids = {s.id for s in candidates}
    source_ids = [sid for sid in verdict.source_ids if sid in valid_ids]

    return claim.model_copy(
        update={
            "source_ids": source_ids,
            "support": verdict.support,
            "provenance": verdict.provenance,
            "reasoning": verdict.reasoning,
            "confidence": verdict.confidence,
        }
    )


# --------------------------------------------------------------------------
# check_all
# --------------------------------------------------------------------------

_CONCURRENCY = 5


async def check_all(claims: list[Claim], sources: list[Source]) -> list[Claim]:
    """Check every claim concurrently. A single claim's failure never fails the batch."""
    semaphore = asyncio.Semaphore(_CONCURRENCY)

    async def _bounded(claim: Claim) -> Claim:
        async with semaphore:
            return await check_claim(claim, sources)

    results = await asyncio.gather(*(_bounded(c) for c in claims), return_exceptions=True)

    checked: list[Claim] = []
    for claim, result in zip(claims, results):
        if isinstance(result, BaseException):
            checked.append(
                claim.model_copy(
                    update={
                        "support": ClaimSupport.UNSUPPORTED,
                        "confidence": "low",
                        "reasoning": f"check failed: {result}",
                    }
                )
            )
        else:
            checked.append(result)
    return checked


# --------------------------------------------------------------------------
# provenance_summary — deterministic, no LLM
# --------------------------------------------------------------------------


def provenance_summary(claims: list[Claim]) -> dict[str, int]:
    """Plain counts over the checked claims. Used to headline the report."""
    counts = {
        "supported": 0,
        "partial": 0,
        "unsupported": 0,
        "contradicted": 0,
        "model_introduced": 0,
    }
    support_key = {
        ClaimSupport.SUPPORTED: "supported",
        ClaimSupport.PARTIAL: "partial",
        ClaimSupport.UNSUPPORTED: "unsupported",
        ClaimSupport.CONTRADICTED: "contradicted",
    }
    for c in claims:
        counts[support_key[c.support]] += 1
        if c.provenance == Provenance.MODEL:
            counts["model_introduced"] += 1
    return counts
