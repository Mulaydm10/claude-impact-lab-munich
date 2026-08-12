import { scoreSource } from '../lib/scoreSource.js';
import { remoteWorkJuniors } from './topics/remoteWorkJuniors.js';

const rawTopics = [remoteWorkJuniors];

function buildTopic(topic) {
  const topicContext = { freshnessWindowDays: topic.freshnessWindowDays, asOf: topic.asOf };
  const sources = topic.sources.map((source) => ({
    ...source,
    heuristic: scoreSource(source, topicContext),
  }));
  return { ...topic, sources };
}

export const topics = rawTopics.map(buildTopic);

const topicsById = new Map();
const sourcesById = new Map();
for (const topic of topics) {
  topicsById.set(topic.id, topic);
  for (const source of topic.sources) {
    sourcesById.set(source.id, source);
  }
}

export function getTopic(topicId) {
  return topicsById.get(topicId) || null;
}

export function getSourceById(sourceId) {
  return sourcesById.get(sourceId) || null;
}
