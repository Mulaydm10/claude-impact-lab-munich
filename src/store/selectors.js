import { getTopic, getSourceById } from '../data/index.js';

export function getCurrentTopic(state) {
  return state.topicId ? getTopic(state.topicId) : null;
}

/** Latest override for a source, else its heuristic band. Never merges the two. */
export function getEffectiveRating(state, sourceId) {
  const source = getSourceById(sourceId);
  if (!source) return null;
  const overridesForSource = state.overrides.filter((o) => o.sourceId === sourceId);
  if (overridesForSource.length === 0) {
    return { band: source.heuristic.band, isOverride: false };
  }
  const latest = overridesForSource.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
  return { band: latest.band, isOverride: true, override: latest };
}

export function getOverrideHistory(state, sourceId) {
  return state.overrides
    .filter((o) => o.sourceId === sourceId)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function getVisibleClaims(state) {
  return state.report ? state.report.claims : [];
}

/** % of visible claims whose source's effective rating is not red. Fixed formula, per PRD §3. */
export function getVerdictPercent(state) {
  const claims = getVisibleClaims(state);
  if (claims.length === 0) return null;
  const nonRed = claims.filter((c) => getEffectiveRating(state, c.sourceId).band !== 'red').length;
  return Math.round((nonRed / claims.length) * 1000) / 10;
}

/**
 * One entry per unique source in reading order — a different denominator than
 * getVerdictPercent (claims vs. unique sources) by design; see PRD §7.
 */
export function getLedgerSources(state) {
  const claims = getVisibleClaims(state);
  const seen = new Set();
  const ids = [];
  for (const claim of claims) {
    if (!seen.has(claim.sourceId)) {
      seen.add(claim.sourceId);
      ids.push(claim.sourceId);
    }
  }
  return ids.map((sourceId) => ({ sourceId, ...getEffectiveRating(state, sourceId) }));
}
