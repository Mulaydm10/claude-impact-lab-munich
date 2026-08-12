# Trustifier — PRD

**Track:** Trust, but check (`verify`) · Claude Impact Lab, Munich
**One-liner:** A chat-based research assistant that shows its work — every claim in the report is
stamped with the trust level of its source, in the open Ampel system (green/orange/red), and you
can re-rate a source on the spot and watch the report update.

## 1. Problem

AI research tools hand back a finished-looking report. The reader can't tell, without re-reading
and re-checking every line, which claims rest on a solid source and which rest on a vendor blog or
a press release. Trustifier makes that visible at a glance, and makes it correctable: if you (or a
domain expert) know a source is better or worse than the system thinks, you fix it right there, and
the report reflects it immediately.

**Target user (this demo):** a general knowledge worker researching a topic who needs to defend
the result to someone else — the "sign off without re-reading everything" test from the brief.

## 2. User flow

1. **Ask** — user states a research topic in chat.
2. **Clarify** — Trustifier asks 1–2 scripted clarifying questions (quick-reply chips) to narrow
   angle/scope. Answers actually change which claims and sources get used — not decorative.
3. **Research** — a report renders: a sequence of claims, each carrying an inline trust stamp.
4. **See at a glance** — a **trust ledger rail** on the report's edge shows one mark per source in
   reading order, so the overall quality mix of the report is visible without reading it. A header
   **verdict stamp** shows an aggregate score (see §5, Verdict formula).
5. **Check a source** — click any stamp (inline or on the rail) to open a source drawer: publisher,
   date, the heuristic's score *and its reasons*, and current rating (heuristic or overridden).
6. **Re-rate** — user (acting as themself or "as a domain expert") sets a new band with an optional
   reason. The stamp, the rail mark, and the header verdict update immediately.
7. **Persistence proof** — refresh the page. The re-rating is still there. Ratings live on the
   source, globally, so future reports touching the same source inherit the correction — this is
   the "gets better over time from expert/user feedback" story.

## 3. Functional requirements

- Trust bands are exactly three: **green / orange / red** (the Ampel system named in the brief).
  Every band is coded by **color AND shape** (not color alone — red/green is the most common color
  vision deficiency, and "assess quality at a glance" is the product's entire value proposition),
  plus a text label surfaced in the drawer and on hover.
- Every claim in a report links to exactly one source; every source has exactly one *effective*
  rating at a time (latest override, else the heuristic).
- Heuristic scoring is rule-based and **explainable** — every score comes with a list of reasons,
  shown verbatim in the source drawer. Not a black box.
- Re-rating is an **append-only history**, not an overwrite — the drawer can show "heuristic said
  orange because X; overridden to green by [actor] because Y."
- Re-ratings **persist server-side** and survive a page refresh.
- Verdict formula (fixed, so the demo payoff is predictable): **% of claims whose source's
  effective rating is not red.** Recomputed live whenever any source's rating changes.

## 4. Design direction (frontend-design skill)

The brief already specifies the signal system — green/orange/red, Ampel-style. The design work is
in *how that mark is drawn* and *how the report is laid out*, not in replacing the three-band idea.

**Signature element — the provenance stamp.** Each band renders as a hand-stamped ink mark (not a
flat dot/circle): a slightly rotated, imperfect-edged stamp, each band with its own shape as well as
its own ink color (e.g. check / triangle / cross) so the signal survives without color. Re-rating a
source plays one deliberate motion: the old stamp fades, the new one lands — the single animation
moment in the whole app.

**Layout — manuscript + ledger.** Three columns: narrow chat (left) → wide report/document view
(center) → a slim trust ledger rail (right edge) that mirrors the report's source marks in miniature.

```
┌────────────────────────────────────────────────────────────┬────┐
│ TRUSTIFIER                         "EU battery policy 2026" │▐▐▐▐│
├────────────────────┬─────────────────────────────────────────┤▐▐▐▐│
│ CHAT                │   [STAMP: 72% VERIFIED]                  │▐▐▐▐│
│ > topic             │                                           │▐▐▐▐│
│ > clarifying Q1      │   Claim text about X.        [✓ green]   │▐▐▐▐│
│ > clarifying Q2      │   Claim text with a stat.    [▲ orange]  │▐▐▐▐│
│                      │   Claim text, contested.     [✕ red]     │▐▐▐▐│
│ [type a message...]  │   ...                                    │▐▐▐▐│
└────────────────────┴─────────────────────────────────────────┴────┘
                                                    click a stamp/rail mark →
                                                    source drawer + re-rate control
```

**Palette** (named, not defaults):
| Role | Hex | Use |
|---|---|---|
| Paper | `#EDEBE2` | app/report background |
| Ink | `#1B1B18` | body text |
| Verified (green) | `#2F6D4F` | green stamp ink |
| Caution (orange) | `#B5762A` | orange stamp ink |
| Flag (red) | `#A63B32` | red stamp ink |
| Highlight | `#FC5217` | interactive/UI accent — kept **out** of the trust bands so stamp colors stay pure signal, never decoration |

**Type:** Fraunces (display — headlines, the big verdict stamp, used sparingly) · IBM Plex Sans
(body — report + chat text) · IBM Plex Mono (utility — source metadata, dates, citation ids).

## 5. What's real vs. stubbed (for the pitch — say this out loud)

**Real:**
- Rule-based heuristic scorer (actual code, explainable reasons), running over a hand-authored demo
  dataset (2–3 topics, sources spanning all three bands, at least one conflict-of-interest example).
- Clarifying-question answers genuinely filter/order which claims appear.
- Re-rating flow, live propagation to stamp/rail/verdict, and server-side persistence (survives refresh).

**Stubbed (and why that's fine per the brief's "be honest about the tape"):**
- No live web research / no live LLM call generating the report — content is hand-authored per
  topic and branch. Clarifying questions are scripted per topic, not open-ended LLM dialogue.
- No real auth — a free-text/dropdown "acting as" field stands in for multiple experts/users.
- Storage is a JSON file, not a database — satisfies "actually persisted," SQLite is an optional
  upgrade only if it installs cleanly with time to spare.

## 6. Contract (so two people can build in parallel)

**Data shapes:**
- `Source { id, title, domain, domainTier, publisher, type, publishedDate, fundedBy?, url, heuristic: { score, band, reasons[] } }`
- `RatingOverride { id, sourceId, band, actor, reason?, timestamp }` — append-only; effective rating = latest override for that source, else `heuristic.band`.
- `Claim { id, reportId, order, text, kind, sourceId }`
- `Report { id, topicId, answers, claimIds[], createdAt }`
- `Topic { id, title, clarifyingQuestions: [{ id, prompt, options? }] }`

**Endpoints:**
- `GET /api/topics`
- `POST /api/reports { topicId, answers }` → `{ report, sources }` (sources include resolved effective rating)
- `GET /api/sources/:id/ratings`
- `POST /api/sources/:id/ratings { band, actor, reason }`

**Heuristic rules (pure function `scoreSource(source, topicContext)`):** domain tier (base delta),
recency vs. topic's freshness window, primary vs. secondary sourcing, conflict of interest
(funded-by matches the claim it favors), optional corroboration bonus. Each rule emits `{rule, delta, detail}`.

**Ownership split:**
- **Person A (frontend/UX):** Vite+React shell, chat panel + scripted clarify flow, report view +
  stamps, ledger rail, source drawer + re-rate control, restamp animation, visual design per §4.
- **Person B (backend/data):** Express (or similar) + JSON-file store, the four endpoints, the
  heuristic scorer, hand-authoring the demo topics/sources/claims content, answer-driven claim filtering.
- **First 20 minutes, together:** lock the data shapes and endpoint signatures above, stub a
  `demo.json` in that shape, wire the Vite dev-server proxy to the backend — so both people can then
  work in true isolation.

## 7. Open questions / risks

- Ledger rail currently shows one mark per unique source regardless of citation count — fine as a
  base behavior; mark-height-by-citation-count is an easy later refinement, not required.
- "Aggregate feedback across experts" is demonstrated via the override history list + free-text
  actor field, not real accounts — don't oversell this in the pitch.
- If a live LLM call for report generation is attempted as a stretch goal, put it behind a
  `generateReport(topic, answers)` function boundary so it's a drop-in swap and abandonable without
  touching the rest of the app.

## 8. Submission

Submit via the `claude-impact-lab` MCP server or `claudebuildnight.com/register`, **before 15:15**,
with the 4-digit event code shown on the room screens.

## What's next

- Wire a real LLM-driven clarifying-question loop and report draft generation behind the
  `generateReport` boundary, once the mocked flow is proven.
- Move storage from a JSON file to a proper DB if the team continues past the hackathon.
- Explore letting the heuristic incorporate real signals (domain reputation APIs, citation graphs)
  instead of hand-authored tiers.
