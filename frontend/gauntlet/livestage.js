// livestage.js — translation layer between raw backend SSE events (GET /api/events/{id})
// and the stage rail. Pure logic + small DOM writes only: no network calls (api.js owns
// those) and no 3D (scene.js owns that). See FRONTEND_BRIEF.md §5 for the wire shape.
//
// Vanilla ES module, no dependencies, no build step. Every function here is defensive:
// a malformed event is ignored, never thrown.

/** Ordered rail stages, matching the labels already rendered by scene.js's #ticks build
 *  (see STAGE_DEFS in data.js) so a live tracker lines up with the fixture rail 1:1. */
export const STAGES = [
  { key: 'INTAKE', label: 'INTAKE' },
  { key: 'INTENT_CONFIRM', label: 'INTENT CONFIRM' },
  { key: 'SOURCE_SCOUTING', label: 'SOURCE SCOUTING' },
  { key: 'SOURCE_RATING', label: 'SOURCE RATING' },
  { key: 'VERIFYING', label: 'VERIFYING' },
  { key: 'REVIEW', label: 'REVIEW' }
];

// Canonical backend JobState order (all eight values from FRONTEND_BRIEF.md §5). Used only
// to decide "is this forward or backward" — REPORT_READY and USER_EVALUATION aren't on the
// rail but still need a rank so regressions against them are detected correctly.
const JOB_STATE_ORDER = [
  'INTAKE',
  'INTENT_CONFIRM',
  'SOURCE_SCOUTING',
  'SOURCE_RATING',
  'VERIFYING',
  'REPORT_READY',
  'REVIEW',
  'USER_EVALUATION'
];

// Every JobState maps onto the rail stage it should light up. REPORT_READY and
// USER_EVALUATION both fold onto REVIEW rather than being dropped.
const STAGE_FOR_STATE = {
  INTAKE: 'INTAKE',
  INTENT_CONFIRM: 'INTENT_CONFIRM',
  SOURCE_SCOUTING: 'SOURCE_SCOUTING',
  SOURCE_RATING: 'SOURCE_RATING',
  VERIFYING: 'VERIFYING',
  REPORT_READY: 'REVIEW',
  REVIEW: 'REVIEW',
  USER_EVALUATION: 'REVIEW'
};

const ACTOR_LABEL = {
  user: 'You',
  interviewer: 'Interviewer',
  scout: 'Scout',
  scorer: 'Scorer',
  reviewer: 'Reviewer',
  system: 'System'
};

const DONE = 'gb-stage-done';
const ACTIVE = 'gb-stage-active';
const PENDING = 'gb-stage-pending';
const STATE_CLASSES = [DONE, ACTIVE, PENDING];

const STYLE_ID = 'gb-livestage-style';
const STATUS_ID = 'gb-livestage-status';

function hasDocument() {
  return typeof document !== 'undefined' && document && typeof document.createElement === 'function';
}

// Inject one small, additive stylesheet for the three semantic classes. Never touches any
// existing selector in the page, so this cannot restyle anything already there.
function injectStyle() {
  if (!hasDocument() || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent =
    '.gb-stage-pending{color:var(--dim,#8d9aa4)}' +
    '.gb-stage-active{color:var(--paper,#e8e4dc)}' +
    '.gb-stage-active .g{color:#c8a86b}' +
    '.gb-stage-done{color:var(--paper,#e8e4dc)}' +
    '.gb-stage-done .g{color:#7a8f7f}' +
    '#' + STATUS_ID + '{font-family:var(--mono,monospace);font-size:10px;letter-spacing:.08em;' +
    'color:var(--dim,#8d9aa4);margin-top:8px;max-width:280px;line-height:1.4;text-transform:none}';
  if (document.head) document.head.appendChild(style);
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v, fallback) {
  return typeof v === 'string' && v.length ? v : fallback === undefined ? '' : fallback;
}

// Reuse existing rail children if the caller already built STAGES.length of them (this is
// what scene.js's load() does for #ticks: one <div class="tick"><span class="g">·</span>
// <span class="l">LABEL</span></div> per stage). Otherwise build a matching fallback
// structure so the tracker still renders something sensible on its own.
function buildRailNodes(railEl) {
  if (!railEl || !hasDocument()) return [];
  const existing = Array.prototype.filter.call(railEl.children || [], (c) => c && c.nodeType === 1);
  if (existing.length >= STAGES.length) {
    return STAGES.map((_, i) => existing[i]);
  }
  railEl.innerHTML = '';
  return STAGES.map((s) => {
    const node = document.createElement('div');
    node.className = 'tick';
    const g = document.createElement('span');
    g.className = 'g';
    g.textContent = '·';
    const l = document.createElement('span');
    l.className = 'l';
    l.textContent = s.label;
    node.appendChild(g);
    node.appendChild(l);
    railEl.appendChild(node);
    return node;
  });
}

function buildStatusNode(railEl) {
  if (!hasDocument()) return null;
  let node = document.getElementById(STATUS_ID);
  if (node) return node;
  node = document.createElement('div');
  node.id = STATUS_ID;
  if (railEl && railEl.parentNode) {
    railEl.parentNode.insertBefore(node, railEl.nextSibling);
  } else if (railEl && typeof railEl.appendChild === 'function') {
    railEl.appendChild(node);
  } else if (document.body) {
    document.body.appendChild(node);
  }
  return node;
}

function applyNodeState(node, cls) {
  if (!node || !node.classList) return;
  STATE_CLASSES.forEach((c) => node.classList.remove(c));
  node.classList.add(cls);
  const g = typeof node.querySelector === 'function' ? node.querySelector('.g') : null;
  if (cls === PENDING) {
    node.classList.remove('hit');
    if (g) g.textContent = '·';
    if (node.style && node.style.removeProperty) node.style.removeProperty('--c');
  } else {
    // Reuse the rail's existing "hit" styling (.tick.hit sets color:var(--paper) and
    // .tick.hit .g sets color:var(--c)) so active/done states inherit the look already
    // defined for the fixture rail, rather than introducing a competing style.
    node.classList.add('hit');
    if (g) g.textContent = cls === ACTIVE ? '»' : '✓';
    if (node.style && node.style.setProperty) {
      node.style.setProperty('--c', cls === ACTIVE ? '#c8a86b' : '#7a8f7f');
    }
  }
}

/** Turn one raw SSE event into a short human sentence. Never throws, never dumps JSON. */
export function describe(evt) {
  if (!isPlainObject(evt)) return '';
  const actor = ACTOR_LABEL[evt.actor] || 'System';
  const message = str(evt.message);
  const payload = isPlainObject(evt.payload) ? evt.payload : {};
  const keys = Object.keys(payload);

  let detail = '';
  if (keys.length) {
    const allNumeric = keys.every((k) => typeof payload[k] === 'number');
    if (allNumeric && evt.actor === 'scorer') {
      // scorer payload: {source_id: score}
      const vals = keys.map((k) => payload[k]);
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      detail = keys.length + ' source' + (keys.length === 1 ? '' : 's') + ' scored, avg ' + avg;
    } else if (typeof payload.sources_found === 'number' || typeof payload.reachable === 'number') {
      const parts = [];
      if (typeof payload.sources_found === 'number') parts.push(payload.sources_found + ' sources found');
      if (typeof payload.reachable === 'number') parts.push(payload.reachable + ' reachable');
      detail = parts.join(', ');
    } else if (isPlainObject(payload.provenance_counts)) {
      const pc = payload.provenance_counts;
      detail = Object.keys(pc)
        .filter((k) => typeof pc[k] === 'number')
        .map((k) => k + ' ' + pc[k])
        .join(', ');
    } else if (['supported', 'partial', 'unsupported', 'contradicted', 'model_introduced'].some((k) => typeof payload[k] === 'number')) {
      detail = ['supported', 'partial', 'unsupported', 'contradicted', 'model_introduced']
        .filter((k) => typeof payload[k] === 'number')
        .map((k) => k + ' ' + payload[k])
        .join(', ');
    } else if (typeof payload.count === 'number') {
      detail = payload.count + ' item' + (payload.count === 1 ? '' : 's');
    }
  }

  if (message && detail) return actor + ' — ' + message + ' — ' + detail;
  if (message) return actor + ' — ' + message;
  if (detail) return actor + ' — ' + detail;
  return actor + ' — update';
}

/** Lightweight MM:SS ticker. Writes into `el`; safe to construct with a null/undefined el. */
export function createElapsed(el) {
  let startedAt = null;
  let timer = null;

  function paint() {
    if (!el || startedAt == null) return;
    const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    if ('textContent' in el) el.textContent = m + ':' + s;
  }

  return {
    start() {
      startedAt = Date.now();
      paint();
      if (typeof globalThis.setInterval === 'function') {
        if (timer != null) globalThis.clearInterval(timer);
        timer = globalThis.setInterval(paint, 1000);
      }
    },
    stop() {
      if (timer != null && typeof globalThis.clearInterval === 'function') {
        globalThis.clearInterval(timer);
      }
      timer = null;
    }
  };
}

/** Build a stage-rail tracker bound to `railEl` (or no DOM at all — pass null). */
export function createStageTracker(railEl) {
  injectStyle();

  let nodes = buildRailNodes(railEl);
  let statusEl = buildStatusNode(railEl);

  const log = [];
  let current = null; // furthest-forward raw JobState string seen so far

  function rankOf(stateName) {
    return JOB_STATE_ORDER.indexOf(stateName);
  }

  function render() {
    const stageKey = current != null ? STAGE_FOR_STATE[current] : undefined;
    const activeIdx = stageKey ? STAGES.findIndex((s) => s.key === stageKey) : -1;
    nodes.forEach((node, i) => {
      let cls;
      if (activeIdx === -1) cls = PENDING;
      else if (i < activeIdx) cls = DONE;
      else if (i === activeIdx) cls = ACTIVE;
      else cls = PENDING;
      applyNodeState(node, cls);
    });
  }

  function setStatusText(text) {
    if (statusEl && 'textContent' in statusEl) statusEl.textContent = text;
  }

  function advanceTo(stateName, force) {
    if (typeof stateName !== 'string' || rankOf(stateName) === -1) return;
    if (!force && current != null) {
      const curRank = rankOf(current);
      if (curRank !== -1 && rankOf(stateName) < curRank) return; // never move backwards
    }
    current = stateName;
    render();
  }

  function handleEvent(evt) {
    try {
      if (!isPlainObject(evt)) return;
      log.push(evt);
      if (typeof evt.state_to === 'string' && evt.state_to) {
        advanceTo(evt.state_to, false);
      }
      const text = describe(evt);
      if (text) setStatusText(text);
    } catch (_err) {
      // A malformed event must never throw — swallow and move on.
    }
  }

  function reset() {
    current = null;
    log.length = 0;
    render();
    setStatusText('');
  }

  function destroy() {
    nodes = [];
    statusEl = null;
  }

  render();

  return {
    handleEvent,
    setStage(stateName) {
      advanceTo(stateName, true);
    },
    reset,
    get current() {
      return current;
    },
    get log() {
      return log.slice();
    },
    destroy
  };
}
