// Live mode — wires the input panel and the backend to the 3D gauntlet.
//
// scene.js already exposes window.__gauntlet = { load(doc, note), start(), ... },
// so once we have a real FullReport the visualisation needs nothing special: we
// hand it the same shape it already renders from the fixture.
//
// Flow: intake -> survey (1-3 rounds) -> scout -> rate sources -> verify -> run.

import * as api from './api.js';
import { mountPanel } from './panel.js';
import { createStageTracker, createElapsed, describe } from './livestage.js';
import { mountLedger } from './ledger.js';
import { FIXTURE } from './data.js';

const HOST_ID = 'live-panel';
const READY_TIMEOUT_MS = 4000;

function hostElement() {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    document.body.appendChild(host);
  }
  return host;
}

// scene.js is a module too, so it may not have run yet when we do.
function waitForGauntlet(timeout = READY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (window.__gauntlet?.load) return resolve(window.__gauntlet);
      if (Date.now() - started > timeout) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function statusLine() {
  let el = document.getElementById('live-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'live-status';
    document.querySelector('.hud')?.appendChild(el);
  }
  return el;
}

// The scene keeps only its processed form of the report, so wrap load() to keep
// hold of the raw FullReport — the ledger needs the original source objects.
// Works for every path into the scene: fixture, file drop, and a live run.
function trackReports(onReport) {
  const g = window.__gauntlet;
  if (!g || g.__ledgerWrapped) return;
  const original = g.load;
  g.load = function wrapped(doc, label) {
    try {
      onReport(doc);
    } catch {
      /* never let the ledger break the scene */
    }
    return original.call(this, doc, label);
  };
  g.__ledgerWrapped = true;
}

async function initLedger() {
  const gauntlet = await waitForGauntlet();
  if (!gauntlet) return null;

  const ledger = mountLedger(document.body);
  let current = null;

  trackReports((doc) => {
    current = doc;
  });
  // The fixture is already loaded by the time we wrap, so seed from it.
  // scene.js loads the fixture at module end, before we could wrap load().
  current = current ?? FIXTURE;

  const btn = document.createElement('button');
  btn.id = 'sources-btn';
  btn.type = 'button';
  btn.textContent = 'Sources ▤';
  btn.title = 'Which sources were actually any good? (S)';
  btn.addEventListener('click', () => {
    if (current) ledger.toggle(current);
  });
  document.getElementById('controls')?.appendChild(btn);

  addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
    if (!typing && (e.key === 'v' || e.key === 'V') && current) ledger.toggle(current);
  });

  return { ledger, setReport: (r) => { current = r; } };
}

export async function initLive() {
  const host = hostElement();
  const status = statusLine();
  const ledgerCtl = await initLedger();
  const tracker = createStageTracker(document.getElementById('ticks'));
  const elapsed = createElapsed(status);

  let panel;

  const run = async (input) => {
    let unsubscribe = () => {};
    try {
      tracker.reset();
      panel.showProgress('Opening a session…');

      const { session_id, questions } = await api.start(input);

      unsubscribe = api.subscribeEvents(session_id, (evt) => {
        tracker.handleEvent(evt);
        const line = describe(evt);
        if (line) status.textContent = line;
      });

      // Survey — loops until the backend stops asking.
      let pending = questions;
      let intent = null;
      while (pending && pending.length) {
        const answers = await panel.showQuestions(pending);
        panel.showProgress('Thinking about your answers…');
        const res = await api.answer(session_id, answers);
        pending = res.done ? null : res.questions;
        intent = res.intent ?? intent;
      }
      if (intent) panel.showIntent(intent);

      // Scout, then the human checkpoint.
      panel.showProgress('Finding and fetching sources — this takes up to a minute.');
      const scouted = await api.scout(session_id);
      const ratings = await panel.showSources(scouted.sources);
      if (ratings?.length) await api.rateSources(session_id, ratings);

      // The long one.
      panel.showProgress(
        'Scoring every source, then checking every claim against what its source actually says. ' +
          'This genuinely takes 3-8 minutes — the stage rail above is live.'
      );
      elapsed.start();
      const report = await api.verify(session_id);
      elapsed.stop();

      const gauntlet = await waitForGauntlet();
      if (!gauntlet) throw new Error('3D scene did not initialise — reload the page.');

      panel.hide();
      status.textContent = '';
      gauntlet.load(report, `LIVE — session ${session_id}`);
      gauntlet.start();
    } catch (err) {
      elapsed.stop();
      panel.showError(err);
      // eslint-disable-next-line no-console
      console.error('[glassbox] live run failed', err);
    } finally {
      unsubscribe();
    }
  };

  panel = mountPanel(host, { onSubmit: run });

  // Only offer live mode if the backend is actually there; otherwise the fixture
  // still works and the page is useful without a server.
  try {
    await api.health();
    panel.showIntake();
  } catch {
    status.textContent =
      'Backend not reachable at ' + api.BASE + ' — showing the fixture. Start it with ./run.sh, or drop a FullReport JSON.';
    panel.hide();
  }

  return { run, panel, tracker };
}

if (!window.__glassboxLiveInit) {
  window.__glassboxLiveInit = true;
  initLive().catch((err) => console.error('[glassbox] live init failed', err));
}
