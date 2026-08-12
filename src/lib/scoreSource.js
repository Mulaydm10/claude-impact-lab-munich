const TIER_DELTA = { 1: 20, 2: 5, 3: -8 };
const TIER_DETAIL = {
  1: 'Tier-1 domain (peer-reviewed / primary research body).',
  2: 'Tier-2 domain (established journalism / trade press).',
  3: 'Tier-3 domain (vendor, blog, marketing, or forum).',
};

const TYPE_DELTA = {
  primary: 15,
  secondary: 5,
  press_release: -12,
  marketing: -10,
  anecdotal: -18,
};
const TYPE_DETAIL = {
  primary: 'Primary data, not a secondary summary.',
  secondary: "Secondary summary of someone else's data.",
  press_release: 'A press release, written to promote its subject.',
  marketing: 'Marketing content, not independent reporting.',
  anecdotal: 'Anecdotal — no data or methodology cited.',
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Pure, explainable heuristic: base score 50, clamped to [0,100].
 * Every rule that fires appends a {rule, delta, detail} entry to reasons[],
 * which renders verbatim in the source drawer.
 */
export function scoreSource(source, topicContext) {
  let score = 50;
  const reasons = [];

  const tierDelta = TIER_DELTA[source.domainTier] ?? 0;
  score += tierDelta;
  reasons.push({ rule: 'domain_tier', delta: tierDelta, detail: TIER_DETAIL[source.domainTier] ?? 'Unclassified domain tier.' });

  const typeDelta = TYPE_DELTA[source.type] ?? 0;
  score += typeDelta;
  reasons.push({ rule: 'sourcing_type', delta: typeDelta, detail: TYPE_DETAIL[source.type] ?? 'Unclassified sourcing type.' });

  const asOf = new Date(topicContext.asOf).getTime();
  const published = new Date(source.publishedDate).getTime();
  const ageDays = (asOf - published) / MS_PER_DAY;
  const window = topicContext.freshnessWindowDays;
  let recencyDelta;
  let recencyDetail;
  if (ageDays <= window) {
    recencyDelta = 10;
    recencyDetail = "Published within the topic's freshness window.";
  } else if (ageDays <= window * 1.75) {
    recencyDelta = 0;
    recencyDetail = 'Borderline recency for this topic.';
  } else {
    recencyDelta = -12;
    recencyDetail = "Published outside the topic's freshness window.";
  }
  score += recencyDelta;
  reasons.push({ rule: 'recency', delta: recencyDelta, detail: recencyDetail });

  if (source.conflictOfInterest) {
    score -= 20;
    reasons.push({
      rule: 'conflict_of_interest',
      delta: -20,
      detail: `Funded by ${source.fundedBy}, which has a direct stake in the claim(s) it favors.`,
    });
  } else if (source.fundedBy) {
    reasons.push({
      rule: 'conflict_of_interest',
      delta: 0,
      detail: `Funded by ${source.fundedBy}, but has no stake in the claim(s) it's cited for here.`,
    });
  }

  if (source.corroboratedByCount >= 1) {
    score += 5;
    reasons.push({
      rule: 'corroboration',
      delta: 5,
      detail: `Corroborated by ${source.corroboratedByCount} independent source(s) in this report.`,
    });
  }

  score = Math.max(0, Math.min(100, score));
  const band = score >= 70 ? 'green' : score >= 40 ? 'orange' : 'red';

  return { score, band, reasons };
}
