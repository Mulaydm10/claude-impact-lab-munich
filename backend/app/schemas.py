"""Shared contract for the verification pipeline.

Every module codes against these types. Do not change a field without telling the
rest of the team — this file is the integration boundary.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

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
