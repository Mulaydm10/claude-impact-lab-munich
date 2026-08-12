# Glassbox

**Would you sign off on this research without re-reading every line?**

Glassbox takes a piece of AI-generated research and the sources behind it, and tells you how
much of it you can actually trust — showing its working at every step.

Built at the **Claude Impact Lab, Munich** on 12 August 2026 · track: *Trust, but check*.

---

## Why

The room at the Claude Conversations evening said it plainly: *the output looks right, and
checking it properly takes longer than making it did.*

Most verification tools stop at rating the sources. That answers **"is this evidence any
good?"** — but not **"did the research report it honestly?"** A perfect source proves nothing
if the text generalised one company's result to "companies generally".

Glassbox asks both questions separately.

| | Question | How |
|---|---|---|
| **Credibility** | Are the sources any good? | Per-source score, weighted by relevance to what you actually asked |
| **Provenance** | Did the research use them honestly? | Every claim checked against the source's real content |

## What it does

1. **Grills you** about what you were actually trying to find out. A rigorous source
   answering the wrong question is credible but useless, and the report has to be able to
   say that.
2. **Finds the sources** three ways — supplied with the input, extracted from the research
   text itself, and fetched live from the web.
3. **Hands them back to you** to approve or exclude. Human checkpoint; excluded sources are
   not used downstream.
4. **Scores each source** — credibility and relevance separately, with concrete reasons and
   red flags attached.
5. **Checks every claim** against what its sources actually say: supported, partial,
   unsupported, or contradicted. Claims the model invented are marked as such.
6. **Gets a second opinion** from a reviewer told to distrust the first one's leniency, and
   surfaces exactly where they disagree.
7. **Streams the whole thing live** over SSE, so nothing happens in a black box.
8. **Hands you a way out.** A verdict of *do not rely* is not much use on its own, so the run
   ends with a paste-ready prompt to redo the research properly: the real question restated,
   your success criteria as requirements, your deal-breakers as prohibitions, the sources not
   to lean on again, and the claims that still need primary evidence.

See [ARCHITECTURE.md](ARCHITECTURE.md) for diagrams, and [CONCEPT.md](CONCEPT.md) for the
original design thinking.

## It works

Verbatim from a live run against [`examples/demo_case.json`](backend/examples/demo_case.json)
— a rigged four-day-week research summary. Full output in
[`examples/sample_run.txt`](examples/sample_run.txt).

The fixture supplied 6 sources. Glassbox **extracted 3 more phantom citations from the prose
itself** — assertions like *"several sources report… 40%"* that reference nothing at all.

```
[s1]  52  rel=62  primary       Autonomy — advocacy org that ran the trial it reports on
[s2]   3  rel= 0  unreachable   .example.com — "almost certainly a fabricated URL"
[s3]   8  rel=12  forum_ugc     Reddit — excerpt was literally just the word "Reddit"
[s4]  52  rel=10  primary       Destatis — "navigation page, no substantive data"
[s5]   3  rel= 5  unknown       Microsoft Japan 2019 — hits the stated deal-breaker
[s6]   0  rel= 0  unreachable   fabricated domain
[s7]  12  rel=55  primary       phantom — repeats "35%" with no URL
[s8]   2  rel=20  unknown       phantom — the 40% developer claim
[s9]   2  rel=15  unknown       phantom — the Bavaria claim

claims: 0 supported · 3 partial · 5 unsupported · 5 model-introduced
verdict: DO NOT RELY  (0/100)
```

The second reviewer disagreed with the first on two claims, and said so:

> *"The internal review was **far too lenient**. Of nine sources, only one was actually
> fetched with any content, and even that excerpt is truncated before the key findings."*

## What we learned by testing it against itself

A verifier that condemns everything is useless, so we built a **control case**
([`examples/control_case.json`](backend/examples/control_case.json)): carefully hedged
research on remote work and developer productivity, citing real arXiv and NBER papers,
stating its own limitations, inventing no statistics.

Both runs, same pipeline:

| | Rigged case | Control case |
|---|---|---|
| Score | **0 / 100** | **15 / 100** |
| Verdict | `do_not_rely` | `do_not_rely` |
| Why | fabricated `.example` URLs, phantom citations, a 35% figure that is really ~1.4% | real peer-reviewed sources that measure *collaboration*, not *output* |

**The reasoning discriminated. The verdict band did not.** And the critique of the control
case is, on inspection, correct — the arXiv paper genuinely measures collaboration patterns
rather than productivity, the NBER figure is projected from self-reported survey data, and
the one RCT studied call-centre workers in 2010–2012. A careful human reviewer would say the
same thing.

The root cause was two bugs upstream of the scoring, both found by reading our own runs:

- **The survey compounded stated standards into absolutes.** Told "peer-reviewed preferred,
  limitations stated plainly", it produced an `Intent` demanding evidence through 2023 with
  effect sizes for developers specifically — a bar almost no real research clears. Everything
  downstream then failed that bar.
- **Phantom duplicate sources.** A study cited in the prose *and* supplied as a URL was counted
  twice — once as the fetched source, once as an unverifiable ghost scoring 8–22 with high
  relevance, dragging the weighted average down hard.

Both are fixed. Extraction now drops a reference that shares a PMC/PubMed/DOI/arXiv identifier
with a supplied source, scoring weights each source by the scorer's own confidence, and a prose
citation with no URL is no longer penalised as a broken link.

**Measured on the fasting fixture: 20 → 59, verdict `do_not_rely` → `check_flagged`** — the
first time the headline band moved rather than only the reasoning underneath it. Nine real
sources, zero phantom duplicates, zero unsupported claims.

Glassbox still reads **stricter than an expert human**. That is the safer direction to be wrong
in, and it is no longer wrong by so much that everything lands in the same band.

Full outputs, unedited: [`examples/sample_run.txt`](examples/sample_run.txt) and
[`examples/control_run.txt`](examples/control_run.txt).

## Run it

```bash
cd backend
cp .env.example .env          # add your ANTHROPIC_API_KEY
./run.sh                      # http://localhost:8000 — docs at /docs

# in another terminal
uv run python scripts/smoke.py              # end-to-end, auto-answers the survey
uv run python scripts/smoke.py --interactive  # answer the grilling yourself
```

## API

| Method | Path | |
|---|---|---|
| `POST` | `/api/start` | Submit research + sources, get the first questions |
| `POST` | `/api/answer` | Answer; loops until the intent is settled |
| `POST` | `/api/scout` | Find and categorise sources |
| `POST` | `/api/rate-sources` | Approve or exclude — human checkpoint |
| `POST` | `/api/verify` | Score sources, check claims, review |
| `GET` | `/api/events/{id}` | SSE live cascade — replays, then streams |
| `GET` | `/api/report/{id}` | The finished report |

Python 3.14 · FastAPI · Anthropic SDK · httpx · pydantic v2 · `uv`.
Per-stage model env vars (`MODEL_SURVEY`, `MODEL_EXTRACT`, `MODEL_SCORE`, `MODEL_AGGREGATE`)
— the scorer runs once per source, so it is the one that adds up.

## What's real, what's taped together

*One day is one day.*

**Real, and exercised live:** the full cascade end to end; interactive survey with follow-up
rounds; all three source-acquisition routes; per-source credibility with relevance weighting;
claim-by-claim provenance; two reviewers with genuinely different prompts; disagreement
detection; state machine with SSE replay and multiple subscribers.

**Known limitation, found by our own run:** source excerpts are capped, and on one real
source the cap fell *before* the key findings — so three claims were scored `partial` for the
wrong reason. Under-crediting a good source is the error type that matters most here. The fix
is to select the relevant slice of a page rather than the first N characters.

**Stubbed:** no retry or backoff — a failed call is recorded and the pipeline continues; crude
HTML-to-text, so nav and footer boilerplate stays in excerpts; datedness is read out of the
excerpt rather than parsed metadata; sessions are in memory and do not survive a restart.

**Not built** (design is in `CONCEPT.md` §10): the delayed outcome loop — rating the
recommendation against reality months later — plus the trust ledger and cross-job learning.
That is the part that would answer *"should I have been allowed to sign off?"* against ground
truth rather than plausibility.

## Team

Built in one day at the Claude Impact Lab, Munich.

| | |
|---|---|
| **Druuf** | Backend and the verification pipeline — survey, source acquisition, scoring, claim checking, review |
| **Jenny** | Frontend — the gauntlet, the Ampel source ledger, the architecture and findings pages |
| **Marco** and **Roman** | The logic and the intent model — what the system asks you, and what it does with the answer |
