# Architecture

**Track:** `verify` — Trust, but check.
**The test we design against:** *would you sign off on the result without re-reading every line?*

## The idea in one line

Given a piece of research and the sources behind it, tell the user how much they should
trust it — and show the working.

## Pipeline

```
┌─────────────────────────────────────┐
│ INPUT                                 │
│   • output of a research task         │
│   • its sources                       │
└─────────────────┬─────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│ SURVEY  (interactive)                 │
│   grills the user about the original  │
│   prompt to recover intent            │
│   → what were you actually asking?     │
│   → what would make this wrong?        │
│   → extracts the important info        │
└─────────────────┬─────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│ VERIFICATION LAYER                    │
│                                       │
│  1. acquire sources, three ways:      │
│     • supplied with the input         │
│     • extracted from the research text │
│     • fetched live from the web        │
│                                       │
│  2. categorise each source            │
│                                       │
│  3. ┌─ CREDIBILITY SCORER LOOP ────┐   │
│     │  per source, assign a         │   │
│     │  credibility score with       │   │
│     │  reasons attached             │   │
│     └───────────────────────────┘   │
└─────────────────┬─────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│ CREDIBILITY SCORE                     │
│   final score across all sources      │
│   + the reasoning behind it           │
└─────────────────┬─────────────────┘
                  │
                  └────► SELF-LEARNING LOOP
                         feeds back into verification
```

## Components

### 1. Input
A research output (text) plus whatever sources came with it.

### 2. Survey — interactive
Before judging anything, recover what the user actually wanted. The model cannot tell whether
research is *good* without knowing what question it was meant to answer. The survey grills the
user about the original prompt and pulls out the information that matters for judging the
result.

Interactive by design — it asks, waits, and uses the answers.

### 3. Verification layer

**Source acquisition (all three routes):**
- sources supplied alongside the input
- sources extracted from the body of the research text
- sources fetched live from the web

**Categorisation:** what kind of source is this — primary, secondary, press release, forum
post, peer-reviewed, vendor marketing, unknown.

**Credibility scorer loop:** iterates over every source and assigns a credibility score,
with the reasons recorded alongside so a human can argue with it.

### 4. Credibility score
A final aggregate score across all sources, with the per-source breakdown and reasoning kept
visible. The number is never the whole answer — the reasoning is the product.

### 5. Self-learning loop
Feeds the scoring outcome back into the verification layer.

> **Honesty note for the pitch:** what is real vs. stubbed here gets written down before
> 15:15. The organisers explicitly ask for it — *"saying what's real and what's stubbed is
> the useful part, not a confession."*

## Open design question

We score **sources**. The track's test is about the **output**. A source can be impeccable
and the research can still misquote it, overstate it, or cite it for something it never said.

Candidate addition, if time allows: **claim → source linkage** — for each claim in the output,
check whether the cited source actually supports it. That gives two dimensions instead of one:
*are the sources good* **and** *were they used honestly*.

Not committed. Logged here so we decide deliberately rather than by accident.

## Build order

1. **Backend first** — pipeline as an HTTP API so any frontend can consume it.
2. Frontend — being decided.
