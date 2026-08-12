# Claude Impact Lab — Munich

**12 August 2026 · Make, 1st floor, Celonis building, Theresienstraße 6, München**

## Track: Trust, but check (`verify`)

> Build something that makes a model's output checkable in your own line of work — a reviewer
> that flags what it isn't sure about, a trail back to the source, a second model arguing with
> the first.
>
> **The test: would you sign off on the result without re-reading every line?**

## Where this came from

Two weeks before the Lab, a room in Munich talked through one question: *what does AI mean for
my job?* Four threads came back — time given back showing up as pressure on everyone, judgment
becoming the scarce resource once execution gets cheap, trusting and then checking what the
model hands back, and who gets left behind as access becomes its own kind of gap.

This project picks up the third thread.

## The day

| Time | |
|---|---|
| 10:00–12:30 | Build, part one |
| 12:30–13:15 | Lunch |
| 13:15–15:15 | Build, part two |
| **15:15** | **Pitches — every group presents** |
| 16:25 | Prizes |

**~4.5 hours of build time.** Scope for two.

## What makes a good pitch (from the organisers)

1. **Show the thing** — a rough working prototype tells the room more than a polished description of one.
2. **Name the thread you pulled** — which theme, and who the thing is for.
3. **Be honest about the tape** — saying what's real and what's stubbed is the useful part, not a confession.
4. **End with what's next** — would you keep going, and what would you need?

No leaderboard, no ranked score. Prizes are several categories, announced on the day.

## Submission

Via the event MCP server (`claude-impact-lab`) or at `claudebuildnight.com/register`.
Deadline: **before pitches at 15:15**. Requires a 4-digit event code shown on the screens in the room.

---

## Project

- **Group name:** _(fill in)_
- **What it does:** Trustifier — a chat research assistant that stamps every claim in its report
  with the trust level (Ampel: green/orange/red) of its source, lets you re-rate a source on the
  spot, and updates the report live. Full spec in [`PRD.md`](./PRD.md).
- **Domain / line of work:** General research — any knowledge worker who has to defend a report.
- **What's real vs. stubbed:** Rule-based source scoring and persisted re-ratings are real; report
  content and clarifying questions are hand-authored/scripted, not a live LLM research call. See
  `PRD.md` §5 for the full breakdown.
- **What's next:** See `PRD.md` §"What's next".

## Setup

_TODO_
