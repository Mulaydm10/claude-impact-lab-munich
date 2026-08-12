# Architecture — Glassbox

**Track:** `verify` — Trust, but check.
**The test we design against:** *would you sign off on the result without re-reading every line?*

Merges the original verification pipeline with [CONCEPT.md](CONCEPT.md). Where the two
diverged, the resolution is recorded in §Resolved divergences.

## The idea in one line

Given a piece of research and the sources behind it, tell the user how much they should
trust it — and show the working at every step.

## Two questions, not one

The insight that shaped the build: **a credible source proves nothing if the research
misused it.**

Scoring sources answers *"is this evidence any good?"* It does not answer *"did the research
report it honestly?"* Overreach — generalising one company's result to "companies
generally", one year to "consistently" — is the most common real failure of LLM research,
and source scoring is blind to it.

So Glassbox runs both checks:

| | Question | Module |
|---|---|---|
| **Credibility** | Are the sources any good? | `scoring.py` |
| **Provenance** | Did the research use them honestly? | `claims.py` |

## The cascade

```mermaid
flowchart TD
    classDef human fill:#fef3c7,stroke:#b45309,stroke-width:2px,color:#451a03
    classDef agent fill:#dbeafe,stroke:#1d4ed8,stroke-width:1.5px,color:#172554
    classDef check fill:#ede9fe,stroke:#6d28d9,stroke-width:1.5px,color:#2e1065
    classDef out   fill:#dcfce7,stroke:#15803d,stroke-width:2px,color:#052e16
    classDef glass fill:#f1f5f9,stroke:#64748b,stroke-width:1px,color:#0f172a,stroke-dasharray: 4 3

    IN["📄 Research output<br/><i>+ the sources behind it</i>"]:::human

    IN --> SURVEY

    subgraph S1["1 · WHAT DID YOU ACTUALLY ASK?"]
        SURVEY["🎙️ Interviewer<br/><i>grills you, 1-3 rounds</i>"]:::agent
        INTENT["🎯 Intent<br/><i>real question · success criteria<br/>deal-breakers · recency</i>"]:::agent
        SURVEY --> INTENT
    end

    INTENT --> SCOUT

    subgraph S2["2 · WHERE DID IT COME FROM?"]
        SCOUT["🔍 Scout<br/><i>supplied · extracted · fetched live</i>"]:::agent
        CAT["🏷️ Categorise<br/><i>primary · peer-reviewed · vendor<br/>forum · unreachable</i>"]:::agent
        RATE["🙋 You approve or exclude<br/><b>human checkpoint</b>"]:::human
        SCOUT --> CAT --> RATE
    end

    RATE --> CRED
    RATE --> PROV

    subgraph S3["3 · TWO QUESTIONS, ASKED SEPARATELY"]
        CRED["⚖️ Credibility loop<br/><i>per source: score, relevance,<br/>reasons, red flags</i>"]:::check
        PROV["🔗 Provenance<br/><i>per claim: does the source<br/>actually say this?</i>"]:::check
    end

    CRED --> REV
    PROV --> REV

    subgraph S4["4 · SECOND OPINION"]
        REV["🧑‍⚖️ Internal reviewer"]:::check
        ANCHOR["🕵️ Second anchor<br/><i>different prompt, told to<br/>distrust the first</i>"]:::check
        DIS["⚡ Disagreements<br/><i>ranked by severity</i>"]:::check
        REV --> ANCHOR --> DIS
    end

    DIS --> OUT

    OUT["✅ Verdict<br/><b>sign off · check flagged · do not rely</b><br/><i>with the working shown</i>"]:::out

    LOG["🪟 Event log → SSE<br/><i>every transition streamed live;<br/>replays for late joiners</i>"]:::glass

    S1 -.-> LOG
    S2 -.-> LOG
    S3 -.-> LOG
    S4 -.-> LOG
```

Every transition is written to a per-session event log, which both drives the live UI and
serves as the audit trail after the fact.

## The state machine

```mermaid
stateDiagram-v2
    direction LR
    [*] --> INTAKE
    INTAKE --> INTENT_CONFIRM: questions answered
    INTENT_CONFIRM --> INTAKE: needs more digging
    INTENT_CONFIRM --> SOURCE_SCOUTING: intent settled
    SOURCE_SCOUTING --> SOURCE_RATING: sources categorised
    SOURCE_RATING --> VERIFYING: user approves / excludes
    VERIFYING --> REPORT_READY: scored + claims checked
    REPORT_READY --> REVIEW: second opinion
    REVIEW --> USER_EVALUATION: verdict
    USER_EVALUATION --> [*]

    note right of SOURCE_RATING
        Human checkpoint.
        Excluded sources are
        not used downstream.
    end note
```

## API surface

```mermaid
sequenceDiagram
    autonumber
    participant U as Frontend
    participant A as API
    participant C as Claude

    U->>A: POST /api/start
    A->>C: opening questions
    A-->>U: session_id + questions

    loop until intent settled
        U->>A: POST /api/answer
        A->>C: follow-ups? / build intent
        A-->>U: more questions, or the Intent
    end

    U->>A: POST /api/scout
    A->>A: fetch sources concurrently
    A->>C: categorise
    A-->>U: sources to rate

    U->>A: POST /api/rate-sources
    A-->>U: approved set

    U->>A: POST /api/verify
    par per source
        A->>C: credibility
    and per claim
        A->>C: provenance check ×2 stances
    end
    A->>C: two reviewers
    A-->>U: FullReport

    Note over U,A: GET /api/events/{id} streams the whole cascade live
```

## Components

### `survey.py` — the interviewer
Interactive. Asks 3–4 sharp, research-specific questions, may follow up (capped at 3 rounds),
then produces an `Intent`: the real question restated, success criteria, deal-breakers,
domain, recency requirement. Everything downstream is judged against this — a rigorous source
answering a *different* question is credible but irrelevant, and the report has to be able to
say so.

### `sources.py` — the scout
Three acquisition routes, all live:
- **supplied** — handed over with the input
- **extracted** — pulled out of the research text itself (footnotes, attributions, bare URLs)
- **fetched** — retrieved live over HTTP, concurrent, capped at 8, failures never raise

Then categorised: peer-reviewed, primary, reputable media, analyst, vendor marketing, press
release, blog, forum, encyclopaedia, unknown, unreachable. Unambiguous domains are decided
**deterministically before** the model is consulted (arxiv/doi -> peer-reviewed,
`.gov`/europa.eu/destatis -> primary, reddit/HN -> forum) — cheaper and more defensible than
asking a model.

### `scoring.py` — the credibility loop
One assessment per source: score 0–100, confidence, concrete reasons, red flags, and
**relevance to intent scored separately from credibility**.

The aggregate is computed **in Python, not by the model**:

```
weight_i  = max(relevance_to_intent_i, 5)
base      = sum(score_i * weight_i) / sum(weight_i)
penalty   = share of sources unreachable or uncategorised
overall   = clamp(base - penalty * 40, 0, 100)
```

Weighting by relevance is the point: a weak source answering your actual question should hurt
far more than a weak source that is off-topic. Verified — the same weak source scores 27 when
relevant, 83 when not. Verdict thresholds: >=75 `sign_off`, >=45 `check_flagged`, else
`do_not_rely`.

### `claims.py` — provenance
Extracts up to ~12 load-bearing claims (statistics, causal statements, attributions), then
checks each against the actual fetched source content:

- `SUPPORTED` — a source states this
- `PARTIAL` — related but weaker or narrower than the claim
- `UNSUPPORTED` — nothing backs it
- `CONTRADICTED` — a source says the opposite

Claims the model introduced with nothing behind them are marked `MODEL` provenance rather
than passed off as fact.

Two checking stances share the module: `default`, and `adversarial` — which assumes the first
reader was too generous, refuses "merely discusses the topic" as support, and downgrades
SUPPORTED to PARTIAL wherever a claim generalises beyond its source's scope.

### `review.py` — the second opinion
An internal adversarial reviewer, plus a **second anchor** with a deliberately different
system prompt, framed as an outside auditor told to distrust the first reviewer's leniency.
The per-claim re-check runs under the `adversarial` stance, so the two passes are genuinely
different readings rather than two samples of one prompt.

Disagreements are computed deterministically and ranked by severity — supported-vs-
contradicted outranks supported-vs-partial. Degrades gracefully: if the second anchor fails,
you still get the internal verdict.

### `events.py` — the glass
Explicit state machine, per-session event log, SSE stream. `subscribe()` replays everything
logged so far before streaming live, so a browser connecting late still renders the whole
cascade. Multiple simultaneous subscribers supported.

## Stack

Python 3.14 · FastAPI · Anthropic SDK · httpx · pydantic v2 · `uv`.

Per-stage model env vars (`MODEL_SURVEY`, `MODEL_EXTRACT`, `MODEL_SCORE`, `MODEL_AGGREGATE`)
— the scorer runs once per source, so it is the one that adds up on a large bibliography.
System prompts are long and stable so prompt caching actually bites.

Frontend consumes the JSON API and the SSE stream. CORS is wide open.

## Resolved divergences from CONCEPT.md

| Concept proposed | Built | Why |
|---|---|---|
| Next.js monolith | **Python / FastAPI** | The backend already existed and worked; a stack switch mid-day would have cost everything |
| System *conducts* the research | System *audits* research you bring | Smaller, sharper, and closer to the actual track question |
| 11 states | 8 | States 9–11 are the delayed outcome loop — vision, not MVP |

**Deliberately not built** (CONCEPT.md §10 calls these vision): delayed outcome loop, trust
ledger, cross-job learning. These are the honest "what's next".

## What is real vs. stubbed

*Kept current for the pitch — the organisers ask for exactly this.*

**Real, verified offline:** the state machine; event log with replay and multi-subscriber SSE;
the scoring formula and its relevance weighting; provenance counting; disagreement severity
ranking; all three source-acquisition routes; full API wiring.

**Stubbed / simplified:** no retry or backoff on any call — a failure is recorded and the
pipeline continues; HTML-to-text stripping is crude, so nav and footer boilerplate stays in
excerpts; datedness relies on the model reading a date out of the excerpt rather than parsed
metadata; sessions are in memory and do not survive a restart.

## Running it

```bash
cd backend
cp .env.example .env      # add your ANTHROPIC_API_KEY
./run.sh                  # http://localhost:8000  (docs at /docs)

uv run python scripts/smoke.py   # end-to-end against examples/demo_case.json
```

`examples/demo_case.json` is deliberately rigged: a dead link, a vendor selling the thing it
is cited for, a reddit thread, and one genuine primary source — plus a research text that
claims "35% revenue rise" and "broad consensus" its own sources do not support.
