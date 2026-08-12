/**
 * Isolated on purpose (PRD §7): a future LLM-driven report generator is a
 * drop-in swap for this function's body, not a rewrite of its callers.
 */
export function generateReport(topic, answers) {
  const visibleClaims = topic.claims
    .filter((claim) => {
      if (!claim.visibleWhen) return true;
      return Object.entries(claim.visibleWhen).every(([questionId, optionId]) => answers[questionId] === optionId);
    })
    .slice()
    .sort((a, b) => a.order - b.order);

  return {
    id: `report-${topic.id}`,
    topicId: topic.id,
    answers,
    claims: visibleClaims,
  };
}
