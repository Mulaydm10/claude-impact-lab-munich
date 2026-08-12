"""Adversarial review + disagreement detection.

Pipeline stage: claims (already checked once against sources) -> ReviewVerdict(s) +
Disagreement list. This is the "second opinion is built in" part of the concept doc:
one reviewer (`internal`) audits the first pass with suspicion, an optional second
reviewer (`second_anchor`) is deliberately independent and more sceptical, and
`find_disagreements` is a plain, deterministic diff between the two — no LLM, because
the disagreement view has to be something a human can trust without re-checking it.

Being explicit about what a reviewer could NOT check (`cannot_verify`) is treated as
the point of the exercise, not a gap to paper over.
"""

from __future__ import annotations

import asyncio
from typing import Literal

from pydantic import BaseModel, Field

from app.claims import check_all
from app.llm import MODEL_AGGREGATE, structured
from app.schemas import Claim, ClaimSupport, Disagreement, Intent, ReviewVerdict, Source

# --------------------------------------------------------------------------
# formatting helpers
# --------------------------------------------------------------------------


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
        cred = s.credibility
        cred_str = (
            f"score={cred.score} confidence={cred.confidence} relevance={cred.relevance_to_intent}"
            if cred
            else "not scored"
        )
        red_flags = "; ".join(cred.red_flags) if cred and cred.red_flags else "(none)"
        lines.append(
            f"id: {s.id} | title: {s.title or '(none)'} | url: {s.url or '(none)'}\n"
            f"  origin: {s.origin.value} | category: {s.category.value} | fetched_ok: {s.fetched_ok}\n"
            f"  credibility: {cred_str} | red_flags: {red_flags}\n"
            f"  has_content: {'yes' if s.content_excerpt else 'no'} | fetch_error: {s.fetch_error or '(none)'}"
        )
    return "\n".join(lines)


def _format_claims(claims: list[Claim]) -> str:
    if not claims:
        return "(no claims)"
    lines = []
    for c in claims:
        lines.append(
            f"id: {c.id} | support: {c.support.value} | confidence: {c.confidence} | "
            f"provenance: {c.provenance.value}\n"
            f"  text: {c.text}\n"
            f"  source_ids: {', '.join(c.source_ids) or '(none cited)'}\n"
            f"  reasoning: {c.reasoning or '(none given)'}"
        )
    return "\n\n".join(lines)


# --------------------------------------------------------------------------
# review() — the adversarial pass
# --------------------------------------------------------------------------

# Deliberately in-house: the pipeline's own first line of defense. Rigorous, but it
# still shares an origin with the claims it's checking, which is exactly why the
# second_anchor prompt below exists and is written to NOT trust this one's leniency.
_INTERNAL_SYSTEM_PROMPT = """You are the internal reviewer in a research-verification pipeline. Claims have already been \
checked once against their cited sources — each Claim you see already carries a `support` \
verdict (SUPPORTED / PARTIAL / UNSUPPORTED / CONTRADICTED), `reasoning`, and `confidence` from \
that first pass. Your job is NOT to redo that check. It is to audit it: read the first pass with \
suspicion and ask where it was too generous.

For every claim, ask three questions in order:

1. SOURCE WEAKNESS. Does this claim's `support` verdict rest on a source that is itself weak — \
   low credibility score, a red flag on record, an origin of 'extracted' that was never \
   independently fetched, `fetched_ok: false`, or a category like vendor_marketing / \
   press_release / blog_opinion / forum_ugc? A claim can be technically SUPPORTED by a source's \
   text and still not deserve to be relied on if that source itself shouldn't be trusted. If so, \
   add the claim id to `unsupported_claims` even though the first pass marked it SUPPORTED or \
   PARTIAL, and explain the specific source problem in `uncertainty_flags` (name the claim id AND \
   the source id).

2. OVERREACH. Does the claim say more than its source actually supports — a broader population, \
   a stronger causal claim, a more recent timeframe, a number presented as precise when the source \
   was a range or an estimate? This is the single most common way research quietly becomes wrong: \
   the underlying fact is true but the claim built on top of it is not. Flag any claim where the \
   `text` reaches further than the cited source's content justifies, in `uncertainty_flags`, \
   naming the claim id.

3. WHAT YOU CANNOT CHECK. Be explicit and honest about your own limits. If a claim cites a source \
   with no `content_excerpt` (unfetched, paywalled, `fetched_ok: false`, dead link), you cannot \
   independently verify whether that source really says what the claim states — say so in \
   `cannot_verify`, naming the claim id or source id. Do not silently treat "the first pass said \
   SUPPORTED" as proof; if you have no way to check it yourself, say you have no way to check it. \
   This honesty is the point of the review, not a weakness in it.

`unsupported_claims`: ids of claims that should NOT be relied on as-is — because of source \
weakness, overreach, or outright lack of support. Populate this even for claims the first pass \
already marked UNSUPPORTED or CONTRADICTED (don't just repeat the input, but don't omit them \
either — a reader consulting `unsupported_claims` alone should get the full list).

`uncertainty_flags`: specific, concrete concerns. Every entry must name a claim id or a source id \
— never write something ungrounded like "some claims seem shaky". One flag per concrete issue; do \
not merge several problems into one vague sentence.

`cannot_verify`: things this pass genuinely could not check, and why (no content, dead link, \
paywall, source contradicts itself and you cannot resolve which version is current). If nothing \
was genuinely unverifiable, leave it empty rather than padding it.

`note`: two or three sentences of overall judgement — would you sign off on this claim set as-is? \
What is the one thing a human should look at first?

Return only the structured findings. No other commentary."""

# Deliberately adversarial toward the FIRST reviewer, not just the claims. The whole
# value of this pass is that it does not share the internal reviewer's incentive to
# find its own pipeline's output adequate — so the prompt names that incentive
# directly and instructs the model to work against it.
_SECOND_ANCHOR_SYSTEM_PROMPT = """You are a provider-independent second-opinion reviewer — an external anchor brought in \
specifically because the pipeline's own internal reviewer might be too lenient with itself. \
Assume, going in, that the internal reviewer waved some things through that it shouldn't have: it \
was produced by the same system that produced the claims, checked its own sources, and has every \
structural incentive to find its own work adequate. You do not share that incentive. You are \
effectively being paid to disagree when disagreement is warranted — a review that rubber-stamps \
everything has failed at the one job it was brought in to do.

Go through every claim and actively hunt for the specific failure modes a first-pass reviewer \
plausibly rationalises past:

- A claim marked SUPPORTED where the source is thin, secondary, or itself just repeating a claim \
  from somewhere else rather than being the original evidence — "supported" can mean "supported by \
  another unverified claim", which is not support.
- A claim resting on a single source when the subject matter (a number, a causal claim, a \
  superlative like "first" / "largest" / "only") would normally need corroboration before a \
  careful reader accepts it.
- Confident language in the claim's `text` on a topic where the underlying source hedges, dates \
  itself, or was written for a different purpose than the one it's now being used to support.
- Anywhere the source set as a whole is thin, one-sided, or missing an obvious category of \
  evidence for the kind of question in Intent (e.g. no primary or peer-reviewed source at all for \
  a claim that would need one).

Do not defer to the fact that a claim already carries `support: SUPPORTED` and `confidence: high` \
from the earlier pass — treat that as a claim to interrogate, not a fact to accept. Where you \
genuinely disagree with the earlier verdict, say so plainly and specifically in \
`uncertainty_flags`, naming the claim id and stating what you think is wrong with the earlier \
call. Disagreement is the useful output here, not a failure mode — a reviewer who always agrees \
with the first pass provides no additional information.

At the same time, do not manufacture doubt for its own sake: a genuinely well-evidenced claim \
resting on a strong, independent, fetched source should be left alone. Scepticism aimed equally at \
everything is indistinguishable from scepticism aimed at nothing.

`unsupported_claims`: ids of claims you would NOT sign off on, including ones the internal \
reviewer likely would have passed.

`uncertainty_flags`: specific, named concerns — a claim id or source id is required in every \
entry. Where your view differs from what the claim's own `support` / `confidence` fields imply, \
make that difference explicit rather than just restating your own conclusion.

`cannot_verify`: be honest and specific about what you, independently, had no way to check — you \
are working from the same source excerpts as everyone else, so name any source with no fetched \
content, a dead link, or content too thin to actually judge. Do not claim more certainty than the \
evidence in front of you supports.

`note`: two or three sentences — your overall independent judgement, stated plainly, including \
whether you think the internal review was too lenient and on what.

Return only the structured findings. No other commentary."""


class _ReviewFindings(BaseModel):
    """Internal-only schema for the LLM half of review(). `reviewer` is set in Python
    from the function argument, never left for the model to guess."""

    unsupported_claims: list[str] = Field(default_factory=list)
    uncertainty_flags: list[str] = Field(default_factory=list)
    cannot_verify: list[str] = Field(default_factory=list)
    note: str = ""


async def review(
    claims: list[Claim],
    sources: list[Source],
    intent: Intent,
    reviewer: Literal["internal", "second_anchor"] = "internal",
) -> ReviewVerdict:
    """One adversarial pass over already-checked claims. One LLM call."""
    system = _INTERNAL_SYSTEM_PROMPT if reviewer == "internal" else _SECOND_ANCHOR_SYSTEM_PROMPT
    user = (
        f"INTENT:\n{_format_intent(intent)}\n\n"
        f"SOURCES:\n{_format_sources(sources)}\n\n"
        f"CLAIMS (already checked once by an earlier pass):\n{_format_claims(claims)}\n\n"
        "Produce your review now."
    )
    findings = await structured(
        model=MODEL_AGGREGATE,
        system=system,
        user=user,
        schema=_ReviewFindings,
    )
    return ReviewVerdict(
        reviewer=reviewer,
        unsupported_claims=findings.unsupported_claims,
        uncertainty_flags=findings.uncertainty_flags,
        cannot_verify=findings.cannot_verify,
        note=findings.note,
    )


# --------------------------------------------------------------------------
# second_opinion() — independent re-check for a second ClaimSupport per claim
# --------------------------------------------------------------------------


async def second_opinion(claims: list[Claim], sources: list[Source]) -> list[Claim]:
    """Independently re-check every claim to get a second ClaimSupport verdict.

    Simplification, noted honestly: `claims.check_claim` takes no stance/system
    parameter, so there is no clean way from here to give this pass a genuinely
    different prompt the way `review(reviewer="second_anchor")` gets one. This calls
    `claims.check_all` straight — a fresh, independent LLM sample against the same
    sources (which still catches non-determinism and real divergence) but not an
    adversarially different reviewer. The `review()` second-anchor pass is where the
    real prompt-level independence lives; this is a second *sampling*, not a second
    *stance*. `claims.check_all` is expected to already be concurrent and
    never-fail per-claim (mirrors the score_all pattern elsewhere in this codebase);
    the try/except here is a second safety net so a total failure of that call still
    degrades to "no diff found" rather than raising.
    """
    try:
        return await check_all(claims, sources)
    except Exception:
        return list(claims)


# --------------------------------------------------------------------------
# find_disagreements() — deterministic diff, no LLM
# --------------------------------------------------------------------------

# Ordinal scale of "how much the evidence backs the claim", used only to rank
# disagreements by severity. Distance on this scale is what makes
# SUPPORTED-vs-CONTRADICTED outrank SUPPORTED-vs-PARTIAL.
_SUPPORT_RANK: dict[ClaimSupport, int] = {
    ClaimSupport.CONTRADICTED: 0,
    ClaimSupport.UNSUPPORTED: 1,
    ClaimSupport.PARTIAL: 2,
    ClaimSupport.SUPPORTED: 3,
}


def _describe_support(support: ClaimSupport, source_ids: list[str]) -> str:
    ids = ", ".join(source_ids) if source_ids else "no cited sources"
    if support == ClaimSupport.SUPPORTED:
        return f"found this supported by {ids}"
    if support == ClaimSupport.PARTIAL:
        return f"found this only partially supported by {ids}"
    if support == ClaimSupport.UNSUPPORTED:
        return "found no source support for this"
    return f"found this contradicted by {ids}"


def find_disagreements(a: list[Claim], b: list[Claim]) -> list[Disagreement]:
    """Join two claim lists by id, emit a Disagreement wherever `support` differs.

    Deterministic, no LLM — this is the one piece of the review a human should be
    able to trust without re-checking it. Most severe gaps (biggest jump on the
    SUPPORTED..CONTRADICTED scale) come first.
    """
    b_by_id = {c.id: c for c in b}
    ranked: list[tuple[int, Disagreement]] = []

    for claim_a in a:
        claim_b = b_by_id.get(claim_a.id)
        if claim_b is None or claim_b.support == claim_a.support:
            continue
        severity = abs(_SUPPORT_RANK[claim_a.support] - _SUPPORT_RANK[claim_b.support])
        note = (
            f"reviewer A {_describe_support(claim_a.support, claim_a.source_ids)}; "
            f"reviewer B {_describe_support(claim_b.support, claim_b.source_ids)}"
        )
        ranked.append(
            (
                severity,
                Disagreement(
                    claim_id=claim_a.id,
                    reviewer_a=claim_a.support,
                    reviewer_b=claim_b.support,
                    note=note,
                ),
            )
        )

    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return [disagreement for _, disagreement in ranked]


# --------------------------------------------------------------------------
# full_review() — orchestration
# --------------------------------------------------------------------------


async def full_review(
    claims: list[Claim],
    sources: list[Source],
    intent: Intent,
    enable_second_anchor: bool = True,
) -> tuple[list[ReviewVerdict], list[Disagreement]]:
    """Internal review always runs. If `enable_second_anchor`, the second-anchor
    review and the independent second opinion also run, concurrently with the
    internal review (all three are independent of each other). Degrades gracefully:
    any piece of the second-anchor work that fails is simply dropped rather than
    raised, so a broken external anchor never takes down the internal verdict.
    """
    if not enable_second_anchor:
        return [await review(claims, sources, intent, reviewer="internal")], []

    internal_result, anchor_result, second_claims_result = await asyncio.gather(
        review(claims, sources, intent, reviewer="internal"),
        review(claims, sources, intent, reviewer="second_anchor"),
        second_opinion(claims, sources),
        return_exceptions=True,
    )

    # Internal review is the one mandatory piece — no fallback is specified for it,
    # so a genuine failure here is surfaced rather than silently swallowed.
    if isinstance(internal_result, BaseException):
        raise internal_result

    verdicts: list[ReviewVerdict] = [internal_result]
    disagreements: list[Disagreement] = []

    if not isinstance(anchor_result, BaseException):
        verdicts.append(anchor_result)

    if not isinstance(second_claims_result, BaseException):
        disagreements = find_disagreements(claims, second_claims_result)

    return verdicts, disagreements
