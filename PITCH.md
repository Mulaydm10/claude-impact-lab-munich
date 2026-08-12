# Glassbox — 2 minute pitch

**The team:** Druuf — backend and the verification pipeline · Jenny — frontend and the gauntlet ·
Marco and Roman — the logic and the intent model.

**Setup before you start:** gauntlet page open and focused, backend not needed (Demo mode is a
replay). Press **D** to start the demo. It runs ~10s of cascade, then the 3D gauntlet, then the
source ledger at ~22s. Total ~30s of motion. The case picker offers only cases that were
actually run — pick the rigged one before you start talking.

**Keys:** `D` demo · `S` source ledger · `V` toggle · `H` hand-off panel.

**Timing target:** 1:55. The script below is ~280 spoken words. Lines marked `[CUT]` come out
first if you are running long.

## One speaker, four builders

One person narrates the whole thing — no handoffs, no laptop swaps. But every claim is the
team's, so the language stays **we** from the first word to the last, and the credit is spoken
out loud once, at 0:32, where it is concrete rather than ceremonial.

If the rest of the team is in the room, stand with them, not in front of them. In Q&A, pull the
person who built the part into the answer by name instead of answering over them.

---

## 0:00 — 0:15 · The spark

> Two weeks ago at the Conversations evening, someone said the thing everyone in the room
> recognised: **the output looks right, and checking it properly takes longer than making it
> did.**
>
> So you sign off. Or you redo the work yourself. Most people sign off.

## 0:15 — 0:32 · The thread we pulled

> Every verification tool we looked at rates the **sources**. That answers *is this evidence any
> good.* It does not answer *did the research report it honestly.*
>
> A perfect source proves nothing if the text quietly turned one company's result into
> "companies generally". Glassbox asks both questions, separately.

## 0:32 · **PRESS D** — keep talking over it

> Four of us built this today. Druuf the verification pipeline, Jenny what you are looking at
> now, Marco and I the logic underneath it — what the thing should actually ask you.
>
> This is a real run, replayed — a live one takes four to nine minutes, which is longer than
> this whole slot.
>
> It grills you about what you were actually trying to find out. It finds the sources three
> ways: the ones you supplied, the ones cited in the prose, and live from the web. It hands
> them back to you to approve or throw out — that is a human checkpoint, not a formality.
> Then it scores every source, and checks every single claim against what its source actually
> says.

*(pause as the verdict lands)*

> Six sources went in. It found **nine** — three of them phantom citations. Sentences citing
> something that does not exist. Verdict: **do not rely.**

## 1:05 — 1:38 · What we did next — the honest part

> Then we turned it on ourselves. Three briefs: one rigged, one careful and well-sourced, one
> real Claude output with live web search.
>
> All three came back **do not rely**. Our own tool could not tell them apart.
>
> The *reasoning* could — read it and it is right about each one. The score band could not. And
> because the tool shows its work, we could find why in ten minutes: our survey stage was taking
> "peer-reviewed preferred" and compounding it into "nothing else counts". Every later stage
> then failed research against a bar almost nothing clears.
>
> We fixed it during the lab — that, and a bug where a study cited in the prose *and* supplied
> as a link was counted twice, the second copy scored as a ghost. Same fixture, before and
> after: **20 to 59**, and the verdict band moved for the first time.

## 1:38 — 1:55 · The tape, and what's next

**Optional, ~8s — press `H` while saying this.** Strong if you have the time, first thing to cut
if you do not:

> And a verdict of *do not rely* is not much use on its own — so it hands you back a prompt to
> redo the research properly. Your question restated, your deal-breakers as prohibitions, and
> the sources not to lean on again.

> Honest about the tape: what you just saw is a replay, but the pipeline behind it is real and
> ran on every number in it. No retries — a failed fetch is recorded and we carry on.
> Sessions die on restart. [CUT] We know source excerpts get truncated too early, and we know a
> stated limitation still gets marked as an unsupported claim.
>
> What is designed and not built is the part that would settle it: rating the recommendation
> against what actually happened, months later. Everything today measures whether the research
> was **convincing**. Only that measures whether it was **right**.

---

## If the demo fails

Do not debug on stage. Say this and move to the findings page:

> The live run takes four to nine minutes, so let me show you what came out of it instead.

Then talk over `findings.html` — the three-run table is the whole story on one screen.

## Likely questions

You are answering for four people. Where the team is in the room, bring the builder in by name
— *"Druuf, you found that one"* — rather than answering over them. Where they are not, answer
and attribute.

**"Isn't a second Claude reviewing the first one just marking its own homework?"**
Partly, and we say so. The second reviewer is a different prompt, not a different vendor — it
is briefed to distrust the first one's leniency, and it caught it: it called the first pass
*"far too lenient"* and it was right. A genuinely independent model is a one-parameter change
we did not spend the time on.

**"How do you know your scores are right?"**
We do not, and that is the finding. We know the reasoning discriminates and the band does not,
because we tested it against a control case designed to pass. That is why the self-test is on
the site rather than buried.

**"What is it for, concretely?"**
Anyone who has to defend a report they did not write line by line. Analysts, consultants,
policy people. The user is the person who gets asked "are you sure?" in a meeting.

**"Why the 3D thing?"**
Because a claim surviving a gauntlet is legible in one second and a table of confidence scores
is not. The data underneath it is the actual API response.

## Numbers you may be asked for, with sources

| Claim | Where it comes from |
|---|---|
| 6 supplied → 9 found, 3 phantom | `examples/sample_run.txt`, rigged fixture |
| 0 supported · 3 partial · 5 unsupported · 5 model-introduced | same run |
| 20 → 59, `do_not_rely` → `check_flagged` | commit `e7d9845`, intermittent-fasting fixture |
| 37 with duplicates vs 56 without | commit `c8194c1`, same fixture |
| 5 supported claims, best source 88/100 | `examples/live_agent_run.txt` |
| Second reviewer: *"far too lenient"* | `examples/sample_run.txt` |
