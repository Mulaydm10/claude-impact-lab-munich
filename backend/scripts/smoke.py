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
FIXTURE = pathlib.Path(__file__).parent.parent / "examples" / "demo_case.json"

# Plausible answers so the auto run produces a realistic Intent.
CANNED = (
    "We're deciding this quarter and it affects all 40 staff, so getting it wrong is "
    "expensive. I need evidence from comparable European knowledge-work firms, not "
    "press coverage. Anything before 2022 or self-reported by a vendor is useless to me."
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--interactive", action="store_true")
    args = ap.parse_args()

    case = json.loads(FIXTURE.read_text())
    client = httpx.Client(base_url=BASE, timeout=180)

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
            reply = input("> ").strip() if args.interactive else CANNED
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

    print("\nverifying — acquiring, categorising and scoring sources...")
    report = client.post("/api/verify", json={"session_id": session_id})
    report.raise_for_status()
    data = report.json()

    print("\n=== SOURCES ===")
    for s in data["sources"]:
        cred = s.get("credibility") or {}
        print(
            f"  [{s['id']}] {cred.get('score', '--'):>3}  "
            f"rel={cred.get('relevance_to_intent', '--'):>3}  "
            f"{s['category']:<18} {s['origin']:<10} {(s.get('url') or s['raw_reference'])[:60]}"
        )
        for flag in cred.get("red_flags", []):
            print(f"          !! {flag}")

    print("\n=== VERDICT ===")
    print(f"  overall: {data['overall_score']}   verdict: {data['verdict']}")
    print(f"\n  {data['summary']}")
    print("\n  weakest links:")
    for w in data["weakest_links"]:
        print(f"   - {w}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
