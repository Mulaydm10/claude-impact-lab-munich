# Reconciliation — where the two designs landed, and what is still open

**Status as of commit `1369e08`. Open items in section 3; everything above it is settled.**

The repo held two designs for the same track: `CONCEPT.md` (produce research through a visible
cascade, user gates each step) and `ARCHITECTURE.md` + `backend/` (receive finished research,
judge the credibility of its sources).

They have largely converged in code. This document records what merged, what did not, and the
four things still genuinely undecided — including one where the code claims something it does
not yet do, which matters for the pitch.

---

## 1. What merged

`1369e08` folded most of the concept into the backend. Concretely, in `schemas.py`:

| From `CONCEPT.md` | Now in code |
|---|---|
| Explicit state machine | `JobState` — eight states, INTAKE → USER_EVALUATION |
| `EventLog` for audit + live view | `EventLogEntry` + `events.py` + `GET /api/events/{id}` (SSE) |
| Provenance per claim | `Claim.provenance` — `source` / `model` / `user` |
| Claims traced to sources | `Claim.source_ids` + `ClaimSupport` — supported / partial / unsupported / contradicted |
| Human gate on sources | `POST /api/rate-sources`, `SourceRating` with approve / trust / exclusion reason |
| Second opinion + disagreement view | `ReviewVerdict`, `Disagreement`, `review.full_review()` |
| Reviewer marks what it cannot check | `ReviewVerdict.cannot_verify` |

And in the other direction, the concept picked up things it did not have: a real source
taxonomy (`SourceCategory`, eleven values including `UNREACHABLE`), scoring that carries
`reasons` / `red_flags` / `relevance_to_intent` rather than a bare number, `Intent.deal_breakers`
as an explicit falsification question, and a verdict enum that speaks the track's language
(`sign_off` / `check_flagged` / `do_not_rely`).

The earlier worry — that one design would blind the other to fabricated claims — is handled.
`ClaimSupport.UNSUPPORTED` and `Provenance.MODEL` mean research can now score badly for
inventing things, not just for citing weak sources. `FullReport` carries both axes: the
aggregate credibility score *and* the per-claim provenance breakdown.

**The contract is `backend/app/schemas.py`.** Its docstring says so. Propose changes as a diff
to that file rather than as prose in a document.

## 2. What the code settled by existing

Not by decision — by being written. Reversing these now costs real time.

- **Stack is Python / FastAPI.** `CONCEPT.md`'s Next.js monolith recommendation is dead. The
  frontend is still open; CORS is `allow_origins=["*"]` precisely for that.
- **Input is "receive", not "produce".** `StartRequest.research_output` is required,
  `min_length=1`. The concept's front half — user brings a question, the system researches it —
  has no entry point. The state machine starts at INTAKE with *"Research submitted for
  checking"*.
- **Sessions are in memory.** A restart loses everything. Stated outright in `main.py` as a
  deliberate one-day trade.

## 3. Still open

### 3.1 The second anchor says it is provider-independent. It is not.

`review.py` line 138, the system prompt: *"You are a provider-independent second-opinion
reviewer — an external anchor…"*. The call underneath it uses `MODEL_AGGREGATE` through
`app.llm.structured()`, and `llm.py` is unchanged from the first commit: `import anthropic`,
one `AsyncAnthropic` client, no provider parameter anywhere.

So the second anchor is **prompt-independent, not provider-independent**. It is the same model
with a more sceptical system prompt. That is a legitimate technique and it will produce real
disagreements — but it is not an external anchor, and `CONCEPT.md`'s anti-lock-in convention
asked for one.

This needs a decision, and it is the one item on this list that is not merely a feature choice:

- **(a)** Make it true. Add a `provider` argument to `llm.structured()` and put one non-Anthropic
  model behind it. Small — one signature, one branch, one SDK — and much cheaper now than after
  more modules call the current signature.
- **(b)** Make the claim match the code. Rename to `sceptical_reviewer`, fix the prompt, and say
  in the pitch that the second opinion is a second prompt rather than a second vendor.

What is not an option is shipping (b)'s code with (a)'s wording. The organisers ask explicitly
for what is real versus stubbed, on a track about not over-trusting model output. A tool that
overstates its own independence loses the room the moment someone opens the file.

### 3.2 `USER_EVALUATION` is a state with no door

It is in the `JobState` enum. There is no endpoint that reaches it — `main.py` exposes start,
answer, scout, rate-sources, verify, events, report, and nothing else. `CONCEPT.md` section 6
level 1 is the rubric rating that would fill it.

Either wire a `POST /api/evaluate` that takes the rubric scores, or drop the state from the enum
so the cascade UI does not render a step that can never light up.

### 3.3 The delayed reality check does not exist

`CONCEPT.md` sections 6 and 10 scope this deliberately: states 9–11 are shown from a prepared
dataset rather than built, because nobody waits three months during a hackathon. Nothing of it
is in the repo — no due date, no outcome record.

This is the concept's strongest idea and its least demo-able one. Recommendation: a static
prepared example in the frontend plus one slide's worth of narrative, clearly labelled as
not-built. Cheap, and it is what makes the pitch's closing line land.

### 3.4 Nobody owns the frontend

Both documents leave it open, and `1369e08` added none. Meanwhile the organisers' first pitch
criterion is *show the thing*, and the backend now emits an SSE cascade, per-claim provenance
and a disagreement list that nothing renders.

This is now the highest-value unclaimed work in the repo, and the two screens worth building
first are the provenance view and the disagreement view — everything else is a list.

### 3.5 Confirm the model IDs

`llm.py` pins four stages to `claude-opus-4-6` via env vars. Worth thirty seconds to confirm
that is the intended model, particularly for `MODEL_SCORE` — the scorer runs once per source,
so it is the call that adds up.

## 4. Working rules

1. **`backend/app/schemas.py` is the contract.** Adding a type is cheap. Changing an existing
   field needs a heads-up first.
2. **Additive work needs no meeting.** The frontend and the evaluation endpoint touch nothing
   that exists.
3. **One owner per module**, named in the pitch notes: survey · sources · scoring · claims ·
   review · frontend.
4. **Both documents stay.** Neither gets deleted; what the group decides goes into `README.md`'s
   `## Project` section, which is still `TODO` and is due before 15:15.
5. **Write down what is stubbed as you stub it** — see 3.1 for why. Reconstructing it at 15:00
   is how the honest half of the pitch gets vague.
