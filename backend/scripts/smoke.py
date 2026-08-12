"""End-to-end smoke run against a live server.

    ./run.sh                      # in one terminal
    uv run python scripts/smoke.py    # in another

Auto-answers the survey so the whole pipeline can be exercised without a human.
Pass --interactive to answer the questions yourself.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import httpx

BASE = "http://localhost:8000"
EXAMPLES = pathlib.Path(__file__).parent.parent / "examples"

# Plausible answers so the auto run produces a realistic Intent.
GENERIC = (
    "I need to defend this result to other people, so accuracy matters more than a clean "
    "story. Anything unsourced or self-reported by an interested party is useless to me."
)
CANNED = {
    "demo_case": (
        "We're deciding this quarter and it affects all 40 staff, so getting it wrong is "
        "expensive. I need evidence from comparable European knowledge-work firms, not "
        "press coverage. Anything before 2022 or self-reported by a vendor is useless to me."
    ),
    "control_case": (
        "I'm briefing leadership and I would rather say 'we don't know' than overstate. "
        "Peer-reviewed or primary evidence preferred; I want limitations stated plainly, "
        "and I do not want call-centre results presented as if they were about engineers."
    ),
    "intermittent_fasting_case": (
        "I need to decide whether to fund this as a wellness benefit, and I'd rather be told "
        "'no real advantage' than get a story that sounds good. What matters to me is whether a "
        "study actually matched calories between groups — if it didn't, the result doesn't "
        "answer my question. Peer-reviewed trials and meta-analyses preferred; a media summary "
        "of a study is fine as a pointer but shouldn't carry the weight of the underlying paper."
    ),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--interactive", action="store_true")
    ap.add_argument("--case", default="demo_case", help="fixture name in examples/, without .json")
    args = ap.parse_args()

    case = json.loads((EXAMPLES / f"{args.case}.json").read_text())
    print(f"=== FIXTURE: {args.case} ===")
    client = httpx.Client(base_url=BASE, timeout=600)

    try:
        client.get("/health").raise_for_status()
    except Exception:
        print(f"server not up at {BASE} — start it with ./run.sh", file=sys.stderr)
        return 1

    started = client.post(
        "/api/start",
        json={
            "research_output": case["research_output"],
            "sources": case["sources"],
            "original_prompt": case["original_prompt"],
        },
    )
    started.raise_for_status()
    session_id = started.json()["session_id"]
    questions = started.json()["questions"]

    while True:
        print(f"\n--- survey round ({len(questions)} questions) ---")
        answers = []
        for q in questions:
            print(f"\nQ: {q['question']}")
            print(f"   why: {q['why_it_matters']}")
            reply = input("> ").strip() if args.interactive else CANNED.get(args.case, GENERIC)
            if not args.interactive:
                print(f"> {reply[:80]}...")
            answers.append({"question_id": q["id"], "answer": reply})

        res = client.post(
            "/api/answer", json={"session_id": session_id, "answers": answers}
        )
        res.raise_for_status()
        body = res.json()
        if body["done"]:
            print("\n=== INTENT ===")
            print(json.dumps(body["intent"], indent=2))
            break
        questions = body["questions"]

    print("\nverifying — acquiring, categorising, scoring, checking claims...")
    res = client.post("/api/verify", json={"session_id": session_id})
    res.raise_for_status()
    full = res.json()
    data = full["report"]

    # Persist the raw FullReport so the frontend can replay this run exactly.
    out = EXAMPLES / f"{args.case}_report.json"
    out.write_text(json.dumps(full, indent=2))
    print(f"\n[saved] {out}  (session {session_id})")

    print("\n=== SOURCES ===")
    for s in data["sources"]:
        cred = s.get("credibility") or {}
        print(
            f"  [{s['id']}] {cred.get('score', '--'):>3}  "
            f"rel={cred.get('relevance_to_intent', '--'):>3}  "
            f"{s['category']:<18} {s['origin']:<10} {(s.get('url') or s['raw_reference'])[:58]}"
        )
        for flag in cred.get("red_flags", []):
            print(f"          !! {flag}")

    print("\n=== CLAIMS (provenance) ===")
    print(f"  {full['provenance_counts']}")
    mark = {
        "supported": "OK ",
        "partial": "~  ",
        "unsupported": "?? ",
        "contradicted": "XX ",
    }
    for c in full["claims"]:
        print(
            f"\n  {mark.get(c['support'], '   ')}[{c['id']}] {c['support']:<13} "
            f"provenance={c['provenance']:<7} sources={c['source_ids'] or '—'}"
        )
        print(f"      {c['text'][:150]}")
        if c.get("reasoning"):
            print(f"      -> {c['reasoning'][:170]}")

    if full["disagreements"]:
        print("\n=== DISAGREEMENTS (reviewer A vs B) ===")
        for d in full["disagreements"]:
            print(f"  [{d['claim_id']}] {d['reviewer_a']} vs {d['reviewer_b']}")
            print(f"      {d['note'][:160]}")

    for v in full["verdicts"]:
        print(f"\n=== REVIEW: {v['reviewer']} ===")
        if v["unsupported_claims"]:
            print(f"  do not rely on: {v['unsupported_claims']}")
        for f in v["uncertainty_flags"][:4]:
            print(f"  ! {f[:150]}")
        for f in v["cannot_verify"][:3]:
            print(f"  ? could not check: {f[:140]}")
        if v.get("note"):
            print(f"  {v['note'][:300]}")

    print("\n=== VERDICT ===")
    print(f"  overall: {data['overall_score']}   verdict: {data['verdict']}")
    print(f"\n  {data['summary']}")
    print("\n  weakest links:")
    for w in data["weakest_links"]:
        print(f"   - {w}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
