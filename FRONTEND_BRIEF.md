# Frontend brief — Glassbox

Everything a frontend needs to build against the working backend. The backend is **done and
running**; nothing here is aspirational unless explicitly marked.

Repo: https://github.com/Mulaydm10/claude-impact-lab-munich
Backend base URL: `http://localhost:8000` · interactive docs at `/docs` · CORS is wide open.

---

## 1. What the product is

You paste in a piece of AI-generated research plus the sources behind it. Glassbox tells you
how much of it you can trust, and shows its working at every step.

It asks **two separate questions**, and keeping them separate is the whole idea:

| | Question | Where it shows up |
|---|---|---|
| **Credibility** | Are the sources any good? | a score + reasons per source |
| **Provenance** | Did the research *use* them honestly? | a support rating per claim |

A perfect source proves nothing if the text generalised one company's result into "companies
generally". Most tools only do the first column. **The UI should make the second column feel
like the point**, because it is.

The test the whole thing is designed against, taken from the hackathon brief:

> *Would you sign off on the result without re-reading every line?*

---

## 2. The flow

Six calls, in order. Each returns a `session_id` you carry forward.

```
1  POST /api/start          submit research + sources    -> session_id + questions
2  POST /api/answer         answer them (loops 1-3x)     -> more questions, or the Intent
3  POST /api/scout          find + categorise sources    -> sources to rate
4  POST /api/rate-sources   user approves / excludes     -> the approved set
5  POST /api/verify         the long one (minutes)       -> FullReport
6  GET  /api/report/{id}    fetch it again any time      -> FullReport

   GET  /api/events/{id}    SSE — live progress, subscribe at step 1
```

### ⚠️ The single most important implementation fact

**`POST /api/verify` takes 3–8 minutes.** It fetches every source over the network, scores
each one, extracts ~8–12 claims, checks each claim twice, then runs two reviewers.

Do **not** put a spinner on it and hope. Set your HTTP client timeout to **at least 600s**,
and drive the UI from the **SSE stream** instead. This is the thing that will break your
build if you ignore it.

---

## 3. Endpoints

### 1 · `POST /api/start`

```jsonc
// request
{
  "research_output": "Moving to a four-day week is now well established as...",
  "sources": ["https://autonomy.work/...", "According to a 2019 Microsoft Japan press release..."],
  "original_prompt": "Research whether switching to a 4-day week would hurt productivity."  // optional, may be null
}

// response
{
  "session_id": "a1b2c3d4e5f6",
  "questions": [
    {
      "id": "oq1",
      "question": "Two of the six supplied sources are non-resolving placeholder URLs: did the research actually retrieve content from them?",
      "why_it_matters": "If phantom sources were treated as real evidence, the stated confidence is fabricated rather than supported."
    }
  ]
}
```

`sources` accepts **bare URLs or prose citations** — both are handled. `why_it_matters` is
written to be shown to the user; it is what stops the grilling feeling arbitrary.

### 2 · `POST /api/answer`

```jsonc
// request
{ "session_id": "a1b2c3d4e5f6", "answers": [{ "question_id": "oq1", "answer": "No, I never checked them." }] }

// response — not finished, ask these too
{ "session_id": "...", "done": false, "questions": [ /* SurveyQuestion[] */ ], "intent": null }

// response — finished
{
  "session_id": "...",
  "done": true,
  "questions": [],
  "intent": {
    "restated_question": "For a 40-person software company in Bavaria, what does credible post-2022 evidence show about...",
    "success_criteria": ["Cites specific studies with named organizations, sample sizes and dates", "..."],
    "deal_breakers": ["Inflated or fabricated statistics", "Non-resolving placeholder URLs presented as evidence"],
    "domain": "Software company operations / workforce strategy",
    "recency_requirement": "Must use evidence published in 2022 or later"   // or null
  }
}
```

**Loop on `done === false`.** It asks up to 3 rounds. Show the `Intent` back to the user as a
confirmation step — it is genuinely interesting output, not plumbing.

### 3 · `POST /api/scout`

```jsonc
// request
{ "session_id": "a1b2c3d4e5f6" }

// response
{ "session_id": "...", "state": "SOURCE_RATING", "sources": [ /* Source[] */ ] }
```

Takes **20–60s** — it fetches every URL. Note it usually returns **more sources than the user
supplied**: it also extracts citations from the research prose itself, including phantom ones
that point at nothing. Those come back with `origin: "extracted"` and no URL, and they are
often the most damning items in the whole report. **Make them visually distinct.**

### 4 · `POST /api/rate-sources`

```jsonc
// request
{
  "session_id": "a1b2c3d4e5f6",
  "ratings": [
    { "source_id": "s3", "approved": false, "exclusion_reason": "Reddit thread, not evidence" },
    { "source_id": "s1", "approved": true,  "user_trust": "high" }
  ]
}
// response: same shape as /api/scout, containing only the approved ones
```

The human checkpoint. Excluded sources are **not used downstream** — not scored, not used to
check claims. This step is optional; skip it and everything is treated as approved.

### 5 · `POST /api/verify` → the payload

```jsonc
{ "session_id": "a1b2c3d4e5f6" }
```

Returns a `FullReport`:

```jsonc
{
  "session_id": "a1b2c3d4e5f6",
  "state": "USER_EVALUATION",

  "report": {
    "intent": { /* Intent, as above */ },
    "sources": [ /* Source[] with .credibility filled in */ ],
    "overall_score": 0,
    "verdict": "do_not_rely",              // "sign_off" | "check_flagged" | "do_not_rely"
    "summary": "This research set out to answer... The source base fails catastrophically...",
    "weakest_links": ["s2 and s6 both use IANA-reserved .example domains...", "..."]
  },

  "claims": [ /* Claim[] */ ],
  "provenance_counts": { "supported": 0, "partial": 3, "unsupported": 5, "contradicted": 0, "model_introduced": 5 },
  "verdicts": [ /* ReviewVerdict[] — usually 2 */ ],
  "disagreements": [ /* Disagreement[] */ ]
}
```

---

## 4. Data shapes

### `Source`

```jsonc
{
  "id": "s1",                          // stable, referenced by claims
  "url": "https://autonomy.work/...",  // null for prose citations with no link
  "title": "UK Four Day Week Pilot Results",
  "origin": "supplied",                // supplied | extracted | fetched
  "raw_reference": "https://autonomy.work/...",   // exactly how it appeared in the input

  "fetched_ok": true,
  "content_excerpt": "...",            // up to 12k chars, may contain a literal "[...]" marker
  "fetch_error": null,                 // e.g. "ConnectError: Name or service not known"

  "category": "primary",
  "category_reasoning": "Published by the organisation that ran the trial",

  "credibility": {                     // null until /api/verify has run
    "score": 52,                       // 0-100
    "confidence": "high",              // low | medium | high — confidence in the SCORE itself
    "reasons": ["Autonomy Institute is an advocacy organization for shorter working weeks..."],
    "red_flags": ["The report uses promotional language rather than neutral framing"],
    "relevance_to_intent": 62          // 0-100, SEPARATE from credibility
  }
}
```

**`category`** — one of:
`peer_reviewed` · `primary` · `reputable_media` · `industry_analyst` · `vendor_marketing` ·
`press_release` · `blog_opinion` · `forum_ugc` · `encyclopaedia` · `unknown` · `unreachable`

**`score` vs `relevance_to_intent` are deliberately independent.** A rigorous paper answering
a different question scores high on credibility and low on relevance. Showing them as one
number destroys the most useful thing the backend produces — please show both.

### `Claim`

```jsonc
{
  "id": "c4",
  "text": "Several sources report that developer productivity increases by roughly 40%...",
  "source_ids": [],                    // which sources actually back it — often empty
  "provenance": "model",               // source | model | user
  "support": "unsupported",            // supported | partial | unsupported | contradicted
  "reasoning": "Neither candidate source has any available content — both are unreachable.",
  "confidence": "high"
}
```

`provenance: "model"` with `support: "unsupported"` = **the model made this up.** That pairing
is the headline finding and deserves the loudest treatment in the UI.

### `ReviewVerdict` and `Disagreement`

```jsonc
{
  "reviewer": "internal",              // "internal" | "second_anchor"
  "unsupported_claims": ["c1", "c2", "c4"],
  "uncertainty_flags": ["c2: The '35% revenue rise' claim is rated PARTIAL but..."],
  "cannot_verify": ["c1: s1's excerpt is truncated before the 92% figure appears"],
  "note": "This claim set should not be signed off on..."
}

{
  "claim_id": "c2",
  "reviewer_a": "partial",
  "reviewer_b": "unsupported",
  "note": "reviewer A found this only partially supported by s1; reviewer B found no source support"
}
```

Two reviewers run with **deliberately different prompts** — the second is told to distrust the
first's leniency. Disagreements are pre-sorted, most severe first. Real quote from a live run:

> *"The internal review was far too lenient."*

`cannot_verify` is a feature, not an apology: the system saying out loud what it could not
check. Give it real estate.

---

## 5. SSE — the live cascade

```js
const es = new EventSource(`http://localhost:8000/api/events/${sessionId}`);
es.onmessage = (e) => render(JSON.parse(e.data));
```

Subscribe **right after `/api/start`**. It replays everything already logged before streaming
live, so connecting late loses nothing. Multiple subscribers are fine.

```jsonc
{
  "seq": 7,
  "state_from": "SOURCE_RATING",
  "state_to": "VERIFYING",             // null on non-transition events
  "actor": "scorer",                   // user | interviewer | scout | scorer | reviewer | system
  "message": "Scoring 6 approved sources",
  "payload": { "s1": 52, "s2": 3 },    // shape varies by event, always an object
  "timestamp": "2026-08-12T12:41:03.221Z"
}
```

The SSE `event:` field is the `state_to` value, or `"log"` when there is no transition — so
you can listen per-state if that is easier. Comment lines (`: ping`) arrive every 15s; the
browser's `EventSource` ignores them automatically.

**States:** `INTAKE` → `INTENT_CONFIRM` → `SOURCE_SCOUTING` → `SOURCE_RATING` → `VERIFYING` →
`REPORT_READY` → `REVIEW` → `USER_EVALUATION`

This stream is what makes the 3–8 minute wait bearable. Use it as the primary progress UI.

---

## 6. Errors

| Code | When | Do |
|---|---|---|
| `404` | unknown `session_id` | session was lost — restart the flow |
| `409` | `/api/scout` or `/api/verify` before survey finished | keep looping `/api/answer` |
| `409` | every source excluded | make the user re-approve at least one |
| `404` | `/api/report/{id}` before verify | show "not run yet" |

Individual failures inside the pipeline **never** surface as errors. A dead source comes back
as `fetched_ok: false` with a `fetch_error`; a failed score comes back as `score: 0` with
`reasons: ["scoring failed: ..."]`. Render those states rather than treating them as bugs.

---

## 7. Real data to build against

Two complete unedited runs are committed — use them as fixtures, no backend needed:

- [`examples/sample_run.txt`](examples/sample_run.txt) — rigged research. **0/100, `do_not_rely`.**
  Fabricated `.example` URLs, phantom citations, a "35%" figure that is really ~1.4%.
- [`examples/control_run.txt`](examples/control_run.txt) — careful research, real arXiv/NBER
  sources. **15/100, `do_not_rely`.**

Design for both. Note the honest finding: **the reasoning discriminates between them but the
verdict band does not** — the intent stage compounds the user's stated standards into
absolutes, so Glassbox currently reads stricter than an expert human. If your UI leans
entirely on the verdict word, both runs look identical. Lean on the claim-level detail.

---

## 8. Design notes

**What deserves the most weight, in order:**

1. Claims marked `provenance: "model"` + `support: "unsupported"` — the model invented it
2. Sources with `origin: "extracted"` and no URL — phantom citations pulled from the prose
3. Disagreements between the two reviewers — where a human should actually look
4. `cannot_verify` — the honest limits of the check
5. The overall verdict — least informative thing on the page, despite being the headline

**Accessibility:** if you use a traffic-light system, code every band by **shape as well as
colour**. Red/green deficiency is the most common form, and "assess quality at a glance" is
the entire value proposition.

**Prior art in the repo:** `PRD.md` and `PRD.html` on the `frontend-design` branch describe a
three-column layout — chat, report, trust-ledger rail — with stamped provenance marks. Worth
reading; the branch is unmerged and behind `main`.

---

## 9. What is NOT built

Do not design around these:

- **No re-rating after the report.** Ratings happen *before* verification. Changing a rating
  afterwards and watching the score update would need a new endpoint (~20 min of backend).
- **No persistence.** Sessions are in memory; a server restart loses everything. Refresh-proof
  storage is not there.
- **The system does not do research.** It audits research you bring. There is no
  "type a topic and it investigates" mode.
- **No auth, no users, no multi-tenancy.**
