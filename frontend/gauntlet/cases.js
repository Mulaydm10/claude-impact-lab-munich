// Recorded runs, for the demo picker.
//
// Each entry points at a real FullReport saved by scripts/smoke.py --case <name>.
// Nothing here is invented: `score` and `verdict` are what that run actually
// produced, and the JSON is the payload the gauntlet renders. If a report file
// is missing the case is skipped rather than faked.

export const CASES = [
  {
    id: 'demo_case',
    label: 'Rigged',
    blurb: 'Hand-built to fail: fabricated .example domains, phantom citations, a "35%" figure that is really ~1.4%.',
    report: '../../backend/examples/demo_case_report.json',
  },
  {
    id: 'intermittent_fasting_case',
    label: 'Fasting',
    blurb: 'Genuine agent output. Real RCTs and meta-analyses, correctly tiered, honestly hedged. The case that should pass.',
    report: '../../backend/examples/intermittent_fasting_case_report.json',
  },
  {
    id: 'ai_coding_productivity_case',
    label: 'AI coding',
    blurb: 'Real Claude output with web search. Faithful to its sources — but half of them are unverifiable.',
    report: '../../backend/examples/ai_coding_productivity_case_report.json',
  },
  {
    id: 'control_case',
    label: 'Control',
    blurb: 'Careful, hedged research on remote work citing real arXiv and NBER papers.',
    report: '../../backend/examples/control_case_report.json',
  },
];

/** Fetch a case's recorded report. Returns null if it has not been run yet. */
export async function loadCase(entry) {
  try {
    const res = await fetch(entry.report, { cache: 'no-store' });
    if (!res.ok) return null;
    const doc = await res.json();
    if (!doc?.report?.sources) return null;
    return doc;
  } catch {
    return null;
  }
}

/** Which cases actually have a recorded run on disk. */
export async function availableCases() {
  const found = [];
  for (const c of CASES) {
    const doc = await loadCase(c);
    if (doc) {
      found.push({
        ...c,
        doc,
        score: doc.report.overall_score,
        verdict: doc.report.verdict,
      });
    }
  }
  return found;
}
