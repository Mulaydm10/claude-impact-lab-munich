"""Shared contract for the verification pipeline.

Every module codes against these types. Do not change a field without telling the
rest of the team — this file is the integration boundary.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------------


class SourceOrigin(str, Enum):
    """How we got hold of this source."""

    SUPPLIED = "supplied"      # handed to us with the input
    EXTRACTED = "extracted"    # pulled out of the research text
    FETCHED = "fetched"        # found live on the web


class SourceCategory(str, Enum):
    """What kind of thing this source is."""

    PEER_REVIEWED = "peer_reviewed"
    PRIMARY = "primary"                # official stats, filings, court records, raw data
    REPUTABLE_MEDIA = "reputable_media"
    INDUSTRY_ANALYST = "industry_analyst"
    VENDOR_MARKETING = "vendor_marketing"
    PRESS_RELEASE = "press_release"
    BLOG_OPINION = "blog_opinion"
    FORUM_UGC = "forum_ugc"            # reddit, stackoverflow, comments
    ENCYCLOPAEDIA = "encyclopaedia"    # wikipedia and friends
    UNKNOWN = "unknown"
    UNREACHABLE = "unreachable"        # url did not resolve


class Source(BaseModel):
    """A single source, as it moves through the pipeline."""

    id: str = Field(description="stable id, e.g. 's1'")
    url: str | None = None
    title: str | None = None
    origin: SourceOrigin
    raw_reference: str = Field(
        description="how the source appeared in the input, verbatim"
    )

    # filled in by the fetcher
    fetched_ok: bool = False
    content_excerpt: str | None = Field(
        default=None, description="first few thousand chars of fetched content"
    )
    fetch_error: str | None = None

    # filled in by the categoriser
    category: SourceCategory = SourceCategory.UNKNOWN
    category_reasoning: str | None = None

    # filled in by the credibility scorer loop
    credibility: CredibilityAssessment | None = None


class CredibilityAssessment(BaseModel):
    """Per-source credibility, with the reasoning kept attached.

    The number is never the product. The reasons are.
    """

    score: int = Field(ge=0, le=100, description="0 = worthless, 100 = gold standard")
    confidence: Literal["low", "medium", "high"] = Field(
        description="how sure we are about this score itself"
    )
    reasons: list[str] = Field(
        description="short, concrete justifications a human can argue with"
    )
    red_flags: list[str] = Field(
        default_factory=list,
        description="anything disqualifying: dead link, undated, vendor selling the thing, etc.",
    )
    relevance_to_intent: int = Field(
        ge=0,
        le=100,
        description="how relevant this source is to what the user actually asked for",
    )


# --------------------------------------------------------------------------
# Survey (interactive)
# --------------------------------------------------------------------------


class SurveyQuestion(BaseModel):
    id: str
    question: str
    why_it_matters: str = Field(
        description="shown to the user so the grilling doesn't feel arbitrary"
    )


class SurveyAnswer(BaseModel):
    question_id: str
    answer: str


class Intent(BaseModel):
    """What the user was actually trying to find out. Drives everything downstream."""

    restated_question: str = Field(description="the real question, in one sentence")
    success_criteria: list[str] = Field(
        description="what a trustworthy answer would have to contain"
    )
    deal_breakers: list[str] = Field(
        description="what would make this research wrong or useless"
    )
    domain: str = Field(description="the user's line of work / field")
    recency_requirement: str | None = Field(
        default=None, description="e.g. 'must be post-2024' — None if not time-sensitive"
    )


# --------------------------------------------------------------------------
# Final result
# --------------------------------------------------------------------------


class VerificationReport(BaseModel):
    intent: Intent
    sources: list[Source]

    overall_score: int = Field(ge=0, le=100)
    verdict: Literal["sign_off", "check_flagged", "do_not_rely"]
    summary: str = Field(description="one paragraph a human reads before deciding")
    weakest_links: list[str] = Field(
        description="the specific things that dragged the score down"
    )


# --------------------------------------------------------------------------
# API request / response
# --------------------------------------------------------------------------


class StartRequest(BaseModel):
    research_output: str = Field(min_length=1)
    sources: list[str] = Field(
        default_factory=list, description="urls or citations supplied by the user"
    )
    original_prompt: str | None = Field(
        default=None, description="the prompt that produced the research, if known"
    )


class StartResponse(BaseModel):
    session_id: str
    questions: list[SurveyQuestion]


class AnswerRequest(BaseModel):
    session_id: str
    answers: list[SurveyAnswer]


class AnswerResponse(BaseModel):
    session_id: str
    done: bool
    questions: list[SurveyQuestion] = Field(default_factory=list)
    intent: Intent | None = None


class VerifyRequest(BaseModel):
    session_id: str


# pydantic needs this because Source references CredibilityAssessment before it exists
Source.model_rebuild()


# --------------------------------------------------------------------------
# Glassbox additions — state machine, provenance, review
# (from CONCEPT.md: every step visible, provenance before assertion,
#  human-in-the-loop checkpoints, a second opinion built in)
# --------------------------------------------------------------------------


class JobState(str, Enum):
    """Explicit state machine. A job is always in exactly one state."""

    INTAKE = "INTAKE"
    INTENT_CONFIRM = "INTENT_CONFIRM"
    SOURCE_SCOUTING = "SOURCE_SCOUTING"
    SOURCE_RATING = "SOURCE_RATING"
    VERIFYING = "VERIFYING"
    REPORT_READY = "REPORT_READY"
    REVIEW = "REVIEW"
    USER_EVALUATION = "USER_EVALUATION"


class EventLogEntry(BaseModel):
    """Feeds the live cascade UI and doubles as the audit trail."""

    seq: int
    state_from: JobState | None = None
    state_to: JobState | None = None
    actor: Literal["user", "interviewer", "scout", "scorer", "reviewer", "system"]
    message: str
    payload: dict[str, Any] = Field(default_factory=dict)
    timestamp: str


class Provenance(str, Enum):
    SOURCE = "source"    # traceable to an approved source
    MODEL = "model"      # the model introduced this on its own
    USER = "user"        # came from the user's own answers


class ClaimSupport(str, Enum):
    SUPPORTED = "supported"          # the cited source says this
    PARTIAL = "partial"              # source is related but weaker than the claim
    UNSUPPORTED = "unsupported"      # no source backs this
    CONTRADICTED = "contradicted"    # a source says the opposite


class Claim(BaseModel):
    """One checkable assertion lifted out of the research output."""

    id: str
    text: str
    source_ids: list[str] = Field(default_factory=list)
    provenance: Provenance = Provenance.MODEL
    support: ClaimSupport = ClaimSupport.UNSUPPORTED
    reasoning: str | None = None
    confidence: Literal["low", "medium", "high"] = "medium"


class Disagreement(BaseModel):
    """Where the two reviewers do not agree. This is the interesting part."""

    claim_id: str
    reviewer_a: ClaimSupport
    reviewer_b: ClaimSupport
    note: str


class ReviewVerdict(BaseModel):
    reviewer: Literal["internal", "second_anchor"]
    unsupported_claims: list[str] = Field(default_factory=list)
    uncertainty_flags: list[str] = Field(default_factory=list)
    cannot_verify: list[str] = Field(
        default_factory=list, description="what the reviewer explicitly could not check"
    )
    note: str = ""


class SourceRating(BaseModel):
    """Human-in-the-loop checkpoint: the user vets sources before we lean on them."""

    source_id: str
    approved: bool = True
    user_trust: Literal["low", "medium", "high"] | None = None
    exclusion_reason: str | None = None


class RateSourcesRequest(BaseModel):
    session_id: str
    ratings: list[SourceRating]


class FullReport(BaseModel):
    """What the frontend renders: the credibility view plus the provenance view."""

    session_id: str
    state: JobState
    report: VerificationReport
    claims: list[Claim] = Field(default_factory=list)
    provenance_counts: dict[str, int] = Field(default_factory=dict)
    verdicts: list[ReviewVerdict] = Field(default_factory=list)
    disagreements: list[Disagreement] = Field(default_factory=list)


class ScoutResponse(BaseModel):
    """Sources found, handed to the user to rate before we lean on them."""

    session_id: str
    state: JobState
    sources: list[Source]


class ScoutRequest(BaseModel):
    session_id: str
