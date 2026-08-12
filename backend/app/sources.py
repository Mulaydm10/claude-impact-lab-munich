"""Source acquisition and categorisation.

Three ways a source enters the pipeline (SUPPLIED / EXTRACTED / FETCHED), then a
single batched LLM call assigns each one a category. Verification and scoring
happen elsewhere.
"""

from __future__ import annotations

import asyncio
import json
import re
from difflib import SequenceMatcher
from html.parser import HTMLParser
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel

from .llm import MODEL_EXTRACT, structured
from .schemas import Intent, Source, SourceCategory, SourceOrigin

URL_RE = re.compile(r"https?://[^\s<>\"')\]]+")

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

_FETCH_CONCURRENCY = 8
_FETCH_TIMEOUT = 10
_EXCERPT_CHARS = 4000
_TITLE_MATCH_THRESHOLD = 0.85


# --------------------------------------------------------------------------
# LLM-facing schemas (local to this module, mapped onto Source afterwards)
# --------------------------------------------------------------------------


class _ExtractedRef(BaseModel):
    raw_reference: str
    url: str | None = None
    title: str | None = None


class _ExtractionResult(BaseModel):
    references: list[_ExtractedRef]


class _CategoryDecision(BaseModel):
    id: str
    category: str
    reasoning: str


class _CategorisationResult(BaseModel):
    decisions: list[_CategoryDecision]


# --------------------------------------------------------------------------
# URL / title normalisation helpers
# --------------------------------------------------------------------------


def _normalise_url(url: str) -> str:
    """Strip scheme, www, trailing slash and query so near-duplicates collapse."""
    parsed = urlsplit(url)
    netloc = parsed.netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    path = parsed.path.rstrip("/")
    return f"{netloc}{path}".lower()


def _is_close_match(text: str, candidates: list[str]) -> bool:
    t = text.lower()
    return any(SequenceMatcher(None, t, c).ratio() >= _TITLE_MATCH_THRESHOLD for c in candidates)


# --------------------------------------------------------------------------
# Route 1: SUPPLIED
# --------------------------------------------------------------------------


def _parse_supplied(supplied: list[str]) -> list[Source]:
    sources: list[Source] = []
    for raw in supplied:
        raw = raw.strip()
        if not raw:
            continue
        match = URL_RE.search(raw)
        sources.append(
            Source(
                id="",  # ids assigned once the final list order is known
                url=match.group(0) if match else None,
                origin=SourceOrigin.SUPPLIED,
                raw_reference=raw,
            )
        )
    return sources


# --------------------------------------------------------------------------
# Route 2: EXTRACTED
# --------------------------------------------------------------------------

_EXTRACT_SYSTEM = """You read research writing and pull out every external reference it \
relies on: footnotes, "according to X" attributions, named reports/studies, and bare or \
inline URLs. For each one, return the exact text that signals the reference (raw_reference), \
the URL if one is present, and a short title/name if you can infer one (e.g. the outlet or \
report name) even without a URL. Skip vague references with nothing to attach (e.g. "some \
experts say"). Do not invent URLs that are not in the text."""


async def _extract_sources(
    research_output: str,
    supplied_sources: list[Source],
    intent: Intent | None,
) -> list[Source]:
    if not research_output.strip():
        return []

    intent_line = f"\nWhat the user actually wants to know: {intent.restated_question}" if intent else ""
    user = f"Research output to scan:{intent_line}\n\n{research_output}"

    try:
        result = await structured(
            model=MODEL_EXTRACT,
            system=_EXTRACT_SYSTEM,
            user=user,
            schema=_ExtractionResult,
        )
    except Exception:
        return []  # extraction is best-effort; never block the pipeline on it

    supplied_norm_urls = {_normalise_url(s.url) for s in supplied_sources if s.url}
    supplied_titles = [s.raw_reference.lower() for s in supplied_sources]

    out: list[Source] = []
    seen_norm_urls: set[str] = set()
    for ref in result.references:
        if not ref.raw_reference.strip():
            continue
        norm = _normalise_url(ref.url) if ref.url else None
        if norm and (norm in supplied_norm_urls or norm in seen_norm_urls):
            continue
        if not norm and ref.title and _is_close_match(ref.title, supplied_titles):
            continue
        if norm:
            seen_norm_urls.add(norm)
        out.append(
            Source(
                id="",
                url=ref.url,
                title=ref.title,
                origin=SourceOrigin.EXTRACTED,
                raw_reference=ref.raw_reference,
            )
        )
    return out


# --------------------------------------------------------------------------
# Route 3: FETCHED (live fetch of every source that has a URL)
# --------------------------------------------------------------------------


class _TextExtractor(HTMLParser):
    """Crude HTML -> text stripper. No bs4: just track tag depth and grab <title>."""

    _SKIP_TAGS = {"script", "style", "noscript"}

    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []
        self._skip_depth = 0
        self._in_title = False
        self.title: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._SKIP_TAGS:
            self._skip_depth += 1
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title and self.title is None:
            stripped = data.strip()
            if stripped:
                self.title = stripped
        if self._skip_depth == 0:
            stripped = data.strip()
            if stripped:
                self._chunks.append(stripped)

    def text(self) -> str:
        return " ".join(self._chunks)


def _html_to_text(raw_html: str) -> tuple[str, str | None]:
    parser = _TextExtractor()
    try:
        parser.feed(raw_html)
    except Exception:
        # malformed markup - fall back to whatever was collected before it broke
        pass
    return parser.text(), parser.title


async def _fetch_one(client: httpx.AsyncClient, sem: asyncio.Semaphore, source: Source) -> None:
    assert source.url is not None
    async with sem:
        try:
            resp = await client.get(
                source.url,
                headers={"User-Agent": _USER_AGENT},
                follow_redirects=True,
                timeout=_FETCH_TIMEOUT,
            )
            resp.raise_for_status()
            body, title = _html_to_text(resp.text)
            source.fetched_ok = True
            source.content_excerpt = body[:_EXCERPT_CHARS]
            if title and not source.title:
                source.title = title
        except Exception as exc:
            # a dead/blocked/slow source is a normal outcome, not a pipeline failure
            source.fetched_ok = False
            source.fetch_error = f"{type(exc).__name__}: {exc}"[:500]


async def _fetch_sources(sources: list[Source]) -> None:
    targets = [s for s in sources if s.url]
    if not targets:
        return
    sem = asyncio.Semaphore(_FETCH_CONCURRENCY)
    async with httpx.AsyncClient() as client:
        await asyncio.gather(
            *(_fetch_one(client, sem, s) for s in targets),
            return_exceptions=True,
        )


# --------------------------------------------------------------------------
# Public: acquisition
# --------------------------------------------------------------------------


async def acquire_sources(
    research_output: str,
    supplied: list[str],
    intent: Intent | None = None,
) -> list[Source]:
    supplied_sources = _parse_supplied(supplied)
    extracted_sources = await _extract_sources(research_output, supplied_sources, intent)

    all_sources = supplied_sources + extracted_sources
    for i, source in enumerate(all_sources, start=1):
        source.id = f"s{i}"

    await _fetch_sources(all_sources)
    return all_sources


# --------------------------------------------------------------------------
# Public: categorisation
# --------------------------------------------------------------------------

_DOMAIN_HINTS: list[tuple[tuple[str, ...], SourceCategory]] = [
    (("arxiv.org", "pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "doi.org"), SourceCategory.PEER_REVIEWED),
    (("wikipedia.org",), SourceCategory.ENCYCLOPAEDIA),
    (("reddit.com", "news.ycombinator.com", "stackoverflow.com"), SourceCategory.FORUM_UGC),
]


def _domain_hint(url: str) -> SourceCategory | None:
    netloc = urlsplit(url).netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    for domains, category in _DOMAIN_HINTS:
        if netloc.endswith(domains):
            return category
    if netloc.endswith(".gov") or netloc.endswith(".europa.eu") or netloc.endswith("destatis.de"):
        return SourceCategory.PRIMARY
    return None


_CATEGORISE_SYSTEM = """You classify sources for a credibility-verification pipeline. \
For each source given (id, url, title, a short excerpt of its fetched content), pick the \
single best-fitting category from the provided list and give one short sentence of \
reasoning. Some ids may already be decided by deterministic rules - do not return those, \
and do not second-guess them. Base your decision on the domain, the title, and the excerpt \
together; if the excerpt is missing or empty, judge from url/title alone. If nothing fits \
confidently, use "unknown"."""


async def categorise_sources(sources: list[Source]) -> list[Source]:
    if not sources:
        return sources

    decisions: dict[str, tuple[SourceCategory, str]] = {}

    for source in sources:
        if source.url and not source.fetched_ok:
            decisions[source.id] = (SourceCategory.UNREACHABLE, "URL did not resolve when fetched.")
            continue
        if source.url:
            hint = _domain_hint(source.url)
            if hint is not None:
                decisions[source.id] = (hint, f"Domain match: {urlsplit(source.url).netloc}.")

    remaining = [s for s in sources if s.id not in decisions]

    if remaining:
        already_note = ""
        if decisions:
            already = "; ".join(f"{sid}={cat.value}" for sid, (cat, _) in decisions.items())
            already_note = f"\nAlready decided by deterministic rules, do not reclassify: {already}"

        payload = [
            {
                "id": s.id,
                "url": s.url,
                "title": s.title,
                "excerpt": (s.content_excerpt or "")[:500],
            }
            for s in remaining
        ]
        user = (
            f"Valid categories: {', '.join(c.value for c in SourceCategory)}\n"
            f"{already_note}\n\n"
            f"Sources to classify (JSON): {json.dumps(payload)}"
        )

        try:
            result = await structured(
                model=MODEL_EXTRACT,
                system=_CATEGORISE_SYSTEM,
                user=user,
                schema=_CategorisationResult,
            )
        except Exception:
            result = _CategorisationResult(decisions=[])

        for decision in result.decisions:
            try:
                category = SourceCategory(decision.category)
            except ValueError:
                category = SourceCategory.UNKNOWN
            decisions[decision.id] = (category, decision.reasoning)

    for source in sources:
        category, reasoning = decisions.get(
            source.id, (SourceCategory.UNKNOWN, "No classification produced.")
        )
        source.category = category
        source.category_reasoning = reasoning

    return sources
