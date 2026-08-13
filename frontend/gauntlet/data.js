// Glassbox Gauntlet — data loading + finding extraction.
// Reads a FullReport (POST /api/verify payload). Every field access is optional;
// a missing field drops the finding it would have produced, never the run.

export const FIXTURE_NOTE =
  'FIXTURE — reconstructed from the payload shapes and quoted strings in the ' +
  'Glassbox frontend brief (examples/sample_run.txt was not reachable). ' +
  'Drop a real /api/verify FullReport onto the page to replace it.';

export const FIXTURE = {
  session_id: 'a1b2c3d4e5f6',
  state: 'USER_EVALUATION',
  report: {
    intent: {
      restated_question:
        'For a 40-person software company in Bavaria, what does credible post-2022 evidence show about the productivity effect of a four-day week?',
      success_criteria: [
        'Cites specific studies with named organizations, sample sizes and dates',
        'Distinguishes single-company results from population-level findings'
      ],
      deal_breakers: [
        'Inflated or fabricated statistics',
        'Non-resolving placeholder URLs presented as evidence'
      ],
      domain: 'Software company operations / workforce strategy',
      recency_requirement: 'Must use evidence published in 2022 or later'
    },
    sources: [
      {
        id: 's1',
        url: 'https://autonomy.work/portfolio/uk4dwpilotresults/',
        title: 'UK Four Day Week Pilot Results',
        origin: 'supplied',
        raw_reference: 'https://autonomy.work/portfolio/uk4dwpilotresults/',
        fetched_ok: true,
        content_excerpt: 'Sixty-one organisations took part in the pilot [...]',
        fetch_error: null,
        category: 'primary',
        category_reasoning: 'Published by the organisation that ran the trial',
        credibility: {
          score: 52,
          confidence: 'high',
          reasons: ['Autonomy Institute is an advocacy organization for shorter working weeks'],
          red_flags: ['The report uses promotional language rather than neutral framing'],
          relevance_to_intent: 62
        }
      },
      {
        id: 's2',
        url: 'https://research.example.com/four-day-week-productivity-2024',
        title: null,
        origin: 'supplied',
        raw_reference: 'https://research.example.com/four-day-week-productivity-2024',
        fetched_ok: false,
        content_excerpt: null,
        fetch_error: 'ConnectError: Name or service not known',
        category: 'unreachable',
        category_reasoning: 'IANA-reserved .example domain; cannot resolve',
        credibility: {
          score: 3,
          confidence: 'high',
          reasons: ['No retrievable content; domain is reserved and cannot host a real study'],
          red_flags: ['Presented as a 2024 research citation but resolves to nothing'],
          relevance_to_intent: 0
        }
      },
      {
        id: 's3',
        url: 'https://www.reddit.com/r/cscareerquestions/comments/4dayweek/',
        title: 'Anyone here actually on a 4 day week?',
        origin: 'supplied',
        raw_reference: 'reddit thread on r/cscareerquestions',
        fetched_ok: true,
        content_excerpt: 'my company switched last year and honestly [...]',
        fetch_error: null,
        category: 'forum_ugc',
        category_reasoning: 'Anonymous user commentary, no methodology',
        credibility: {
          score: 11,
          confidence: 'high',
          reasons: ['Anonymous anecdote; no sample, no measurement, no date'],
          red_flags: ['Used in the research as if it were evidence of a general effect'],
          relevance_to_intent: 24
        }
      },
      {
        id: 's4',
        url: 'https://news.microsoft.com/ja-jp/2019/08/07/work-life-choice-challenge-2019/',
        title: 'Work Life Choice Challenge 2019 Summer',
        origin: 'supplied',
        raw_reference: 'According to a 2019 Microsoft Japan press release',
        fetched_ok: true,
        content_excerpt: 'Sales per employee rose 39.9% year on year [...]',
        fetch_error: null,
        category: 'press_release',
        category_reasoning: 'First-party corporate communication about its own trial',
        credibility: {
          score: 34,
          confidence: 'medium',
          reasons: ['First-party account of a one-month trial at a single subsidiary'],
          red_flags: ['Predates the stated 2022 recency requirement by three years'],
          relevance_to_intent: 31
        }
      },
      {
        id: 's5',
        url: 'https://www.nber.org/papers/w31331',
        title: 'Working Time Reduction and Firm Output',
        origin: 'fetched',
        raw_reference: 'https://www.nber.org/papers/w31331',
        fetched_ok: true,
        content_excerpt: 'We estimate output per hour rose 1.4% [...]',
        fetch_error: null,
        category: 'peer_reviewed',
        category_reasoning: 'NBER working paper with stated method and sample',
        credibility: {
          score: 81,
          confidence: 'high',
          reasons: ['Named authors, disclosed sample, replicable method'],
          red_flags: [],
          relevance_to_intent: 74
        }
      },
      {
        id: 's6',
        url: null,
        title: null,
        origin: 'extracted',
        raw_reference: 'a 2024 Stanford meta-analysis of 200 firms',
        fetched_ok: false,
        content_excerpt: null,
        fetch_error: 'No URL supplied; citation extracted from research prose',
        category: 'unknown',
        category_reasoning: 'Cited in the text with no locator of any kind',
        credibility: {
          score: 0,
          confidence: 'high',
          reasons: ['scoring failed: no content and no resolvable reference'],
          red_flags: ['Phantom citation — nothing in the input points at this study'],
          relevance_to_intent: 0
        }
      }
    ],
    overall_score: 0,
    verdict: 'do_not_rely',
    summary:
      'This research set out to answer whether a four-day week would hurt productivity at a small software firm. The source base fails catastrophically: two citations resolve to reserved domains, one exists only inside the prose, and the strongest real finding contradicts the headline number the text reports.',
    weakest_links: [
      's2 and s6 both use IANA-reserved .example domains or no locator at all, yet both are cited as quantitative evidence',
      'The headline "35% revenue rise" is not present in any retrieved source; the closest measured figure is 1.4% output per hour',
      'A forum thread is used interchangeably with a peer-reviewed working paper'
    ]
  },
  claims: [
    {
      id: 'c1',
      text: 'Moving to a four-day week is now well established as productivity-neutral or positive across company sizes.',
      source_ids: [],
      provenance: 'model',
      support: 'unsupported',
      reasoning: 'No retrieved source makes a cross-size or cross-sector claim; the strongest source measures a single national pilot.',
      confidence: 'high'
    },
    {
      id: 'c2',
      text: 'Participating firms reported a 35% revenue rise during the trial period.',
      source_ids: ['s1'],
      provenance: 'source',
      support: 'partial',
      reasoning: "s1 reports revenue changes for a subset of firms; the 35% figure does not appear in the excerpt and the measured output figure elsewhere is 1.4%.",
      confidence: 'medium'
    },
    {
      id: 'c3',
      text: 'Sixty-one UK organisations took part in the 2022 pilot and most retained the policy afterwards.',
      source_ids: ['s1'],
      provenance: 'source',
      support: 'partial',
      reasoning: 's1 confirms the participant count; retention figures are truncated out of the retrieved excerpt.',
      confidence: 'medium'
    },
    {
      id: 'c4',
      text: 'Several sources report that developer productivity increases by roughly 40% under compressed schedules.',
      source_ids: [],
      provenance: 'model',
      support: 'unsupported',
      reasoning: 'Neither candidate source has any available content — both are unreachable.',
      confidence: 'high'
    },
    {
      id: 'c5',
      text: 'A 2024 Stanford meta-analysis of 200 firms found no output penalty.',
      source_ids: ['s6'],
      provenance: 'model',
      support: 'unsupported',
      reasoning: 's6 is a phantom citation with no URL and no retrievable content; the study cannot be shown to exist.',
      confidence: 'high'
    },
    {
      id: 'c6',
      text: 'Engineering teams specifically see the largest gains of any function.',
      source_ids: [],
      provenance: 'model',
      support: 'unsupported',
      reasoning: 'No source breaks results down by function.',
      confidence: 'high'
    },
    {
      id: 'c7',
      text: 'Microsoft Japan measured a 39.9% rise in sales per employee during its trial.',
      source_ids: ['s4'],
      provenance: 'source',
      support: 'partial',
      reasoning: 's4 supports the figure, but it is a one-month single-subsidiary press release from 2019 and falls outside the stated recency requirement.',
      confidence: 'high'
    },
    {
      id: 'c8',
      text: 'The evidence base is strong enough for a 40-person firm to adopt the policy without a trial period.',
      source_ids: [],
      provenance: 'model',
      support: 'unsupported',
      reasoning: 'A recommendation the sources do not license; no source addresses adoption without trial.',
      confidence: 'high'
    }
  ],
  provenance_counts: { supported: 0, partial: 3, unsupported: 5, contradicted: 0, model_introduced: 5 },
  verdicts: [
    {
      reviewer: 'internal',
      unsupported_claims: ['c1', 'c4', 'c5'],
      uncertainty_flags: ["c2: The '35% revenue rise' claim is rated PARTIAL but the figure never appears verbatim"],
      cannot_verify: ["c3: s1's excerpt is truncated before the retention figure appears"],
      note: 'This claim set should not be signed off on without re-checking every quantitative figure.'
    },
    {
      reviewer: 'second_anchor',
      unsupported_claims: ['c1', 'c2', 'c4', 'c5', 'c6', 'c8'],
      uncertainty_flags: ['c7: recency requirement makes a 2019 press release inadmissible as current evidence'],
      cannot_verify: ['c2: no retrieved excerpt contains any revenue percentage'],
      note: 'The internal review was far too lenient.'
    }
  ],
  disagreements: [
    {
      claim_id: 'c2',
      reviewer_a: 'partial',
      reviewer_b: 'unsupported',
      note: 'reviewer A found this only partially supported by s1; reviewer B found no source support'
    },
    {
      claim_id: 'c8',
      reviewer_a: 'partial',
      reviewer_b: 'unsupported',
      note: 'reviewer A treated the recommendation as an inference from s1; reviewer B found it licensed by nothing'
    }
  ]
};

// ---------------------------------------------------------------------------

const arr = (v) => (Array.isArray(v) ? v : []);
const clip = (s, n = 96) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

export const SEVERITY = [
  { level: 0, label: 'clean', glyph: '○', color: '#8d9aa4' },
  { level: 1, label: 'minor', glyph: '─', color: '#a9b3a0' },
  { level: 2, label: 'moderate', glyph: '△', color: '#d4b473' },
  { level: 3, label: 'severe', glyph: '▣', color: '#d98f5a' },
  { level: 4, label: 'critical', glyph: '✕', color: '#d4695e' }
];

const STAGE_DEFS = [
  { key: 'INTAKE', label: 'INTAKE', blurb: 'research + sources submitted' },
  { key: 'INTENT_CONFIRM', label: 'INTENT CONFIRM', blurb: 'standards the run is judged against' },
  { key: 'SOURCE_SCOUTING', label: 'SOURCE SCOUTING', blurb: 'fetch + categorise every citation' },
  { key: 'SOURCE_RATING', label: 'SOURCE RATING', blurb: 'human approves or excludes' },
  { key: 'VERIFYING', label: 'VERIFYING', blurb: 'credibility + relevance, scored apart' },
  { key: 'REVIEW', label: 'REVIEW', blurb: 'two reviewers, deliberately misaligned' }
];

function f(severity, text, detail) {
  return { severity, text: clip(text), detail: clip(detail || '', 150) };
}

function intake(rep, doc) {
  const out = [];
  arr(rep.sources)
    .filter((s) => s && s.origin === 'supplied' && !s.url)
    .forEach((s) => out.push(f(1, `Prose citation, no link: "${clip(s.raw_reference, 52)}"`, s.category_reasoning)));
  const n = arr(rep.sources).length;
  const c = arr(doc.claims).length;
  if (!out.length) {
    out.push(f(0, `${n} source${n === 1 ? '' : 's'} accepted as submitted`,
      c ? `${c} claim${c === 1 ? '' : 's'} extracted for checking` : ''));
  }
  return out;
}

function intentConfirm(rep) {
  const it = rep.intent || {};
  const out = arr(it.deal_breakers).map((d) => f(0, `Deal-breaker declared: ${d}`, it.restated_question));
  if (it.recency_requirement) out.push(f(0, it.recency_requirement, 'recency requirement'));
  if (!out.length) out.push(f(0, 'No deal-breakers declared', it.restated_question));
  return out;
}

function scouting(rep) {
  const out = [];
  arr(rep.sources).forEach((s) => {
    if (!s) return;
    if (s.origin === 'extracted' && !s.url)
      out.push(f(4, `Phantom citation ${s.id}: "${clip(s.raw_reference, 46)}" resolves to nothing`, s.fetch_error));
    else if (s.fetched_ok === false)
      out.push(f(3, `${s.id} unreachable: ${clip(s.fetch_error, 46)}`, s.raw_reference));
    else if (s.category === 'forum_ugc' || s.category === 'vendor_marketing')
      out.push(f(2, `${s.id} categorised ${s.category.replace('_', ' ')}`, s.category_reasoning));
  });
  if (!out.length) out.push(f(0, 'Every citation resolved', 'no phantom or dead sources'));
  return out;
}

function rating(rep) {
  const out = [];
  arr(rep.sources).forEach((s) => {
    if (s && s.approved === false)
      out.push(f(2, `${s.id} excluded: ${clip(s.exclusion_reason, 44)}`, 'not used downstream'));
  });
  if (!out.length) out.push(f(0, 'No exclusions recorded — all sources carried forward', 'the human checkpoint was skipped'));
  return out;
}

function verifying(rep) {
  const out = [];
  arr(rep.sources).forEach((s) => {
    const c = s && s.credibility;
    if (!c) return;
    if (typeof c.score === 'number' && c.score < 30)
      out.push(f(3, `${s.id} credibility ${c.score}/100`, arr(c.reasons)[0]));
    arr(c.red_flags).forEach((r) => out.push(f(2, `${s.id}: ${r}`, `credibility ${c.score} · relevance ${c.relevance_to_intent}`)));
    if (typeof c.relevance_to_intent === 'number' && c.relevance_to_intent < 40 && c.score >= 30)
      out.push(f(2, `${s.id} relevance ${c.relevance_to_intent}/100 despite credibility ${c.score}`, s.category_reasoning));
  });
  if (!out.length) out.push(f(0, 'All sources cleared scoring', 'no red flags'));
  return out;
}

function review(rep, root) {
  const out = [];
  arr(root.claims).forEach((c) => {
    if (!c) return;
    if (c.provenance === 'model' && c.support === 'unsupported')
      out.push(f(4, `${c.id} invented by the model: "${clip(c.text, 58)}"`, c.reasoning));
    else if (c.support === 'contradicted')
      out.push(f(4, `${c.id} contradicted by its own sources`, c.reasoning));
    else if (c.support === 'unsupported') out.push(f(3, `${c.id} unsupported: "${clip(c.text, 54)}"`, c.reasoning));
  });
  arr(root.disagreements).forEach((d) =>
    out.push(f(3, `Reviewers split on ${d.claim_id}: ${d.reviewer_a} vs ${d.reviewer_b}`, d.note))
  );
  arr(root.verdicts).forEach((v) => {
    arr(v.cannot_verify).forEach((t) => out.push(f(2, `Cannot verify — ${t}`, `${v.reviewer} reviewer`)));
    arr(v.uncertainty_flags).forEach((t) => out.push(f(1, `Uncertain — ${t}`, `${v.reviewer} reviewer`)));
  });
  arr(root.claims).forEach((c) => {
    if (c && c.support === 'partial') out.push(f(2, `${c.id} only partially supported`, c.reasoning));
  });
  if (!out.length) out.push(f(0, 'Both reviewers signed off', 'no unsupported claims, no disagreement'));
  return out;
}

const BUILDERS = {
  INTAKE: intake,
  INTENT_CONFIRM: intentConfirm,
  SOURCE_SCOUTING: scouting,
  SOURCE_RATING: rating,
  VERIFYING: verifying,
  REVIEW: review
};

/** Turn a FullReport into an ordered gauntlet: one obstacle per pipeline stage. */
export function buildGauntlet(root) {
  const doc = root && typeof root === 'object' ? root : {};
  const rep = doc.report && typeof doc.report === 'object' ? doc.report : {};
  const stages = STAGE_DEFS.map((def) => {
    let findings = [];
    try {
      findings = BUILDERS[def.key](rep, doc) || [];
    } catch (err) {
      findings = [f(0, 'Stage data unavailable', String(err && err.message))];
    }
    findings.sort((a, b) => b.severity - a.severity);
    const worst = findings.reduce((m, x) => Math.max(m, x.severity), 0);
    const load = findings.reduce((s, x) => s + x.severity, 0);
    return { ...def, findings, worst, load, shown: findings.slice(0, 3), count: findings.filter((x) => x.severity > 0).length };
  });

  const score = typeof rep.overall_score === 'number' ? rep.overall_score : 0;
  return {
    stages,
    score,
    verdict: rep.verdict || 'unknown',
    summary: rep.summary || '',
    weakest: arr(rep.weakest_links),
    counts: doc.provenance_counts || {},
    intent: rep.intent || {},
    sessionId: doc.session_id || '—',
    sourceCount: arr(rep.sources).length,
    claimCount: arr(doc.claims).length
  };
}
