/**
 * Glassbox API client — the ONLY module that talks to the backend.
 * Pure network + data. No DOM access. Dependency-free ES module.
 *
 * Flow: start -> answer (loop) -> scout -> rate-sources -> verify -> report
 * See /home/mulaydm10/glassbox/FRONTEND_BRIEF.md for the full contract.
 */

/** Backend base URL. Override with setBase() to point at a tunnel/other host. */
export let BASE = 'http://localhost:8000';

/** Point this client at a different backend origin (e.g. a tunnel). */
export function setBase(url) {
  BASE = url.replace(/\/+$/, '');
}

/**
 * Error thrown for any non-2xx response or network failure.
 * .status  — HTTP status code, or 0 for a network-level failure (backend unreachable).
 * .detail  — parsed FastAPI `{"detail": ...}` body, or statusText as fallback.
 *
 * Error meanings that matter (see brief §6):
 *   404 on any /api/* call with a session_id  -> session was lost, restart the flow
 *   404 on /api/report/{id}                    -> verify hasn't been run yet
 *   409 on /api/scout or /api/verify            -> survey isn't finished, keep looping answer()
 *   409 on /api/verify                          -> every source was excluded, re-approve at least one
 */
export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

// Per-call timeout budgets (ms). verify tolerates 3-8 minutes.
const TIMEOUT_DEFAULT = 30_000;
const TIMEOUT_SCOUT = 180_000;
const TIMEOUT_VERIFY = 900_000;

async function request(path, { method = 'GET', body, timeout = TIMEOUT_DEFAULT } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    // Network failure, timeout, or CORS issue — the backend is probably not running.
    throw new ApiError(
      `Could not reach Glassbox backend at ${BASE}${path} — is it running? (${err.message})`,
      0,
      err.message
    );
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (data && data.detail !== undefined) detail = data.detail;
    } catch {
      // body wasn't JSON — keep statusText
    }
    throw new ApiError(`Glassbox API ${method} ${path} failed: ${res.status} ${JSON.stringify(detail)}`, res.status, detail);
  }

  return res.json();
}

/** GET /health. Resolves {status:'ok'}. Throws ApiError if the backend is unreachable. Fast (<1s). */
export async function health() {
  return request('/health');
}

/**
 * POST /api/start. Submit research + sources, get back a session and the first
 * round of survey questions. Fast (<1s).
 * @returns {Promise<{session_id: string, questions: Array}>}
 */
export async function start({ research_output, sources = [], original_prompt = null }) {
  return request('/api/start', {
    method: 'POST',
    body: { research_output, sources, original_prompt },
  });
}

/**
 * POST /api/answer. Answer a round of survey questions. Loops up to ~3 rounds
 * before `done` flips true and `intent` is populated. Fast (<1s).
 * @param {string} sessionId
 * @param {Array<{question_id: string, answer: string}>} answers
 * @returns {Promise<{session_id: string, done: boolean, questions: Array, intent: object|null}>}
 */
export async function answer(sessionId, answers) {
  return request('/api/answer', {
    method: 'POST',
    body: { session_id: sessionId, answers },
  });
}

/**
 * POST /api/scout. Fetches every supplied/extracted source and categorises them.
 * Takes 20-60s.
 * @returns {Promise<{session_id: string, state: string, sources: Array}>}
 */
export async function scout(sessionId) {
  return request('/api/scout', {
    method: 'POST',
    body: { session_id: sessionId },
    timeout: TIMEOUT_SCOUT,
  });
}

/**
 * POST /api/rate-sources. Human checkpoint: approve/exclude sources before verify.
 * Optional step — skipping treats everything as approved. Fast (<1s).
 * @param {string} sessionId
 * @param {Array<{source_id: string, approved: boolean, user_trust?: string, exclusion_reason?: string}>} ratings
 * @returns {Promise<{session_id: string, state: string, sources: Array}>}
 */
export async function rateSources(sessionId, ratings) {
  return request('/api/rate-sources', {
    method: 'POST',
    body: { session_id: sessionId, ratings },
  });
}

/**
 * POST /api/verify. Scores sources, extracts claims, checks them twice, runs two
 * reviewers. TAKES 3-8 MINUTES. Drive UI progress from subscribeEvents(), not this promise.
 * @returns {Promise<object>} FullReport
 */
export async function verify(sessionId) {
  return request('/api/verify', {
    method: 'POST',
    body: { session_id: sessionId },
    timeout: TIMEOUT_VERIFY,
  });
}

/**
 * GET /api/report/{id}. Re-fetch a completed FullReport at any time. Fast (<1s).
 * Throws ApiError(404) if verify hasn't been run yet for this session.
 * @returns {Promise<object>} FullReport
 */
export async function getReport(sessionId) {
  return request(`/api/report/${encodeURIComponent(sessionId)}`);
}

// Every JobState the backend can set as the SSE `event:` field, plus "log" for
// non-transition entries. subscribeEvents listens on all of them since a plain
// onmessage handler only catches events with no explicit `event:` field.
const JOB_STATES = [
  'INTAKE',
  'INTENT_CONFIRM',
  'SOURCE_SCOUTING',
  'SOURCE_RATING',
  'VERIFYING',
  'REPORT_READY',
  'REVIEW',
  'USER_EVALUATION',
  'log',
];

/**
 * Subscribes to GET /api/events/{id} (SSE). Replays history then streams live;
 * call right after start(). onEvent receives the parsed JSON event object for
 * every state transition and log line. Long-lived — stays open until unsubscribed.
 * @param {string} sessionId
 * @param {(event: object) => void} onEvent
 * @returns {() => void} unsubscribe — idempotent, safe to call more than once.
 */
export function subscribeEvents(sessionId, onEvent) {
  const es = new EventSource(`${BASE}/api/events/${encodeURIComponent(sessionId)}`);

  const handle = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      // Malformed message — drop it, keep the stream alive.
    }
  };

  es.onmessage = handle;
  for (const state of JOB_STATES) {
    es.addEventListener(state, handle);
  }

  let closed = false;
  return function unsubscribe() {
    if (closed) return;
    closed = true;
    es.close();
  };
}

/**
 * Drives the full flow: start -> answer (looped) -> scout -> verify -> FullReport.
 * Subscribes to SSE for the duration and always unsubscribes on completion or error.
 * Skips the rate-sources checkpoint (everything scouted is treated as approved).
 *
 * @param {{research_output: string, sources?: string[], original_prompt?: string|null}} input
 * @param {object} [opts]
 * @param {(event: object) => void} [opts.onEvent] - forwarded every SSE event
 * @param {(questions: Array) => Promise<Array<{question_id: string, answer: string}>>} [opts.onQuestions]
 *   Called for each round of survey questions; must resolve with the answers. Required unless autoAnswer is set.
 * @param {(intent: object) => void} [opts.onIntent] - called once the survey is done
 * @param {(sources: Array) => void} [opts.onSources] - called after scout() returns
 * @param {string} [opts.autoAnswer] - if set, used as the answer to every question instead of calling onQuestions
 * @returns {Promise<object>} FullReport. May take 3-8 minutes to resolve (dominated by verify()).
 */
export async function runAll(input, { onEvent, onQuestions, onIntent, onSources, autoAnswer } = {}) {
  const { session_id, questions: firstQuestions } = await start(input);

  const unsubscribe = onEvent ? subscribeEvents(session_id, onEvent) : () => {};

  try {
    let questions = firstQuestions;
    let intent = null;
    let done = questions.length === 0;

    while (!done) {
      let roundAnswers;
      if (typeof autoAnswer === 'string') {
        roundAnswers = questions.map((q) => ({ question_id: q.id, answer: autoAnswer }));
      } else if (onQuestions) {
        roundAnswers = await onQuestions(questions);
      } else {
        throw new Error('runAll: onQuestions or autoAnswer is required to answer survey questions');
      }

      const res = await answer(session_id, roundAnswers);
      done = res.done;
      questions = res.questions;
      intent = res.intent;
    }

    if (onIntent && intent) onIntent(intent);

    const scoutRes = await scout(session_id);
    if (onSources) onSources(scoutRes.sources);

    return await verify(session_id);
  } finally {
    unsubscribe();
  }
}
