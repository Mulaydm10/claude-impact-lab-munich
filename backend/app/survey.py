"""The "grill me" stage: interactive survey that turns raw research into an Intent.

Before we judge sources, we need to know what the user actually wanted. This module
asks sharp, specific questions about the submitted research, takes answers, and
synthesises an `Intent` that the verification stage judges relevance against.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.llm import MODEL_SURVEY, structured
from app.schemas import Intent, SurveyAnswer, SurveyQuestion

# Keep prompts cheap: we only need enough of the research to ask sharp questions,
# not the whole document.
_EXCERPT_CHARS = 6000

_PERSONA = (
    "You are a sharp, sceptical colleague reviewing someone else's research before "
    "it gets relied on. You are not hostile, but you are not generous either. You "
    "ask the question the person was hoping nobody would ask. You are terse and "
    "concrete — no throat-clearing, no flattery, no generic questions that could "
    "apply to any research on any topic. Every question you ask must be answerable "
    "in a single sentence and must be provably grounded in the specific research "
    "text you were given: reference an actual claim, number, source, or gap in it."
)


def _excerpt(research_output: str) -> str:
    if len(research_output) <= _EXCERPT_CHARS:
        return research_output
    return research_output[:_EXCERPT_CHARS] + "\n...[truncated]"


def _format_supplied_sources(supplied_sources: list[str]) -> str:
    if not supplied_sources:
        return "(none supplied)"
    return "\n".join(f"- {s}" for s in supplied_sources)


def _format_qa(asked: list[SurveyQuestion], answers: list[SurveyAnswer]) -> str:
    by_id = answers_by_id(answers)
    lines = []
    for q in asked:
        answer = by_id.get(q.id, "(unanswered)")
        lines.append(f"Q: {q.question}\nA: {answer}")
    return "\n\n".join(lines) if lines else "(no questions asked yet)"


def answers_by_id(answers: list[SurveyAnswer]) -> dict[str, str]:
    return {a.question_id: a.answer for a in answers}


# --------------------------------------------------------------------------
# LLM output shapes (internal — we assign stable ids ourselves)
# --------------------------------------------------------------------------


class _QuestionDraft(BaseModel):
    question: str
    why_it_matters: str


class _QuestionBatch(BaseModel):
    questions: list[_QuestionDraft]


def _to_survey_questions(batch: _QuestionBatch, prefix: str, limit: int) -> list[SurveyQuestion]:
    return [
        SurveyQuestion(id=f"{prefix}{i}", question=d.question, why_it_matters=d.why_it_matters)
        for i, d in enumerate(batch.questions[:limit], start=1)
    ]


# --------------------------------------------------------------------------
# Opening questions
# --------------------------------------------------------------------------

_OPENING_SYSTEM = (
    _PERSONA
    + "\n\n"
    "You are opening the interrogation of a piece of research, before anyone has "
    "checked a single source. Your job is to surface what would actually make this "
    "research right or wrong for the person who produced it — not to ask about "
    "research methodology in the abstract.\n\n"
    "Generate 3 to 4 opening questions. Good probes (adapt to the actual content, "
    "do not ask these verbatim):\n"
    "- What decision or action is riding on this research?\n"
    "- Which specific claim in here would hurt most if it turned out to be false?\n"
    "- What would count as 'recent enough' for this to still be true?\n"
    "- Is there a claim here that contradicts what you expected to find?\n"
    "- What's missing that you'd have expected to see covered?\n\n"
    "Every question must reference something concrete from the research text or "
    "the supplied sources — a specific number, claim, name, or gap. Never ask a "
    "question that would be identical for a different topic. Populate "
    "why_it_matters with the concrete downstream consequence of the answer — what "
    "it will change about how we judge the sources, in one sentence."
)


async def opening_questions(
    research_output: str,
    supplied_sources: list[str],
    original_prompt: str | None,
) -> list[SurveyQuestion]:
    user = (
        f"Original prompt that produced this research: {original_prompt or '(not given)'}\n\n"
        f"Supplied sources:\n{_format_supplied_sources(supplied_sources)}\n\n"
        f"Research output:\n{_excerpt(research_output)}"
    )
    batch = await structured(
        model=MODEL_SURVEY,
        system=_OPENING_SYSTEM,
        user=user,
        schema=_QuestionBatch,
    )
    return _to_survey_questions(batch, prefix="oq", limit=4)


# --------------------------------------------------------------------------
# Follow-up questions
# --------------------------------------------------------------------------

_FOLLOWUP_SYSTEM = (
    _PERSONA
    + "\n\n"
    "You already asked opening questions and got answers. Decide whether anything "
    "important is still missing or too vague to act on. Vague means: hedged, "
    "generic, or not specific enough to check a source against later (e.g. "
    "'recent' without a date, 'reliable sources' without saying what would make "
    "one unreliable here, 'it matters' without saying to whom or why).\n\n"
    "If the answers already give a clear success criterion, a clear deal-breaker, "
    "and a clear sense of what's at stake, return an EMPTY question list — do not "
    "pad for the sake of asking more. Only ask a follow-up if skipping it would "
    "leave the intent genuinely ambiguous. Return at most 3 questions, fewer if "
    "fewer are needed. Each must dig into a specific gap in a specific prior "
    "answer, not repeat an opening question in different words."
)


async def followup_questions(
    research_output: str,
    asked: list[SurveyQuestion],
    answers: list[SurveyAnswer],
) -> list[SurveyQuestion]:
    user = (
        f"Research output:\n{_excerpt(research_output)}\n\n"
        f"Questions asked so far and answers given:\n{_format_qa(asked, answers)}"
    )
    batch = await structured(
        model=MODEL_SURVEY,
        system=_FOLLOWUP_SYSTEM,
        user=user,
        schema=_QuestionBatch,
    )
    return _to_survey_questions(batch, prefix=f"fq{len(asked)}.", limit=3)


# --------------------------------------------------------------------------
# Intent synthesis
# --------------------------------------------------------------------------

_INTENT_SYSTEM = (
    _PERSONA
    + "\n\n"
    "The interrogation is over. Synthesise everything into a single Intent that "
    "downstream verification will use to judge whether sources are actually "
    "relevant and trustworthy — not just plausible-sounding.\n\n"
    "restated_question: one sentence, in the user's own framing, not generic "
    "boilerplate. It should read like you understood exactly what they're trying "
    "to find out.\n\n"
    "success_criteria: concrete, checkable conditions a trustworthy answer would "
    "have to satisfy. Someone should be able to look at a source and a claim and "
    "say yes/no this criterion is met. Never write platitudes like 'accurate and "
    "unbiased information' — write things like 'gives a specific number, not a "
    "range, for X' or 'covers the period after the 2024 policy change'.\n\n"
    "deal_breakers: concrete conditions that would make this research wrong or "
    "useless for its purpose — tied to what the user said matters to them, not "
    "generic red flags. Only include one if the user's own answer text actually "
    "states or clearly implies it as a hard requirement. If the user gave a vague, "
    "generic, or non-responsive answer — including to one of your own follow-up "
    "questions — that is missing information, not a violated criterion: leave it "
    "out rather than converting your own unanswered question into a requirement. "
    "Never turn a methodological critique you raised into a deal-breaker just "
    "because the user didn't rebut it.\n\n"
    "domain: the user's line of work or field, inferred from the research and "
    "answers, in a few words.\n\n"
    "recency_requirement: only set this if the research is genuinely time-"
    "sensitive (the user said so, or the topic is one where facts go stale — "
    "pricing, headcount, regulation, live incidents, versions). State it "
    "concretely, e.g. 'must reflect changes after Q1 2025'. Otherwise leave it "
    "null — do not invent a recency requirement nobody asked for."
)


async def build_intent(
    research_output: str,
    original_prompt: str | None,
    asked: list[SurveyQuestion],
    answers: list[SurveyAnswer],
) -> Intent:
    user = (
        f"Original prompt that produced this research: {original_prompt or '(not given)'}\n\n"
        f"Research output:\n{_excerpt(research_output)}\n\n"
        f"Interrogation transcript:\n{_format_qa(asked, answers)}"
    )
    return await structured(
        model=MODEL_SURVEY,
        system=_INTENT_SYSTEM,
        user=user,
        schema=Intent,
    )
