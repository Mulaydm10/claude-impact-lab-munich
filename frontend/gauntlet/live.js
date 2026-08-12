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
import { availableCases } from './cases.js';
import { mountHandoff, hasHandoff } from './handoff.js';

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

  // Hand-off: the last step — a sharpened prompt to redo the research properly.
  const handoff = mountHandoff(document.body);
  const hbtn = document.createElement('button');
  hbtn.id = 'handoff-btn';
  hbtn.type = 'button';
  hbtn.textContent = 'Hand-off ↗';
  hbtn.title = 'A prompt to re-run this research properly (H)';
  hbtn.addEventListener('click', () => { if (current) handoff.toggle(current); });
  document.getElementById('controls')?.appendChild(hbtn);
  addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
    if (!typing && (e.key === 'h' || e.key === 'H') && current) handoff.toggle(current);
  });

  const syncHandoffBtn = (doc) => {
    hbtn.style.opacity = hasHandoff(doc) ? '' : '.45';
  };
  syncHandoffBtn(current);

  return {
    ledger,
    handoff,
    setReport: (r) => { current = r; syncHandoffBtn(r); },
  };
}

// Presentation mode. A live run takes 4-9 minutes, which is longer than a whole
// pitch slot — so this replays the same cascade against the fixture in ~9s.
// Scripted deliberately: nothing here can fail on venue wifi.
const DEMO_SCRIPT = [
  [0, 'user', 'Research submitted — 6 sources', 'INTAKE'],
  [700, 'interviewer', 'Working out what you actually asked for', null],
  [1500, 'interviewer', '3 questions — what would make this wrong?', null],
  [2300, 'user', 'Answered · "unsourced claims are useless to me"', null],
  [3000, 'interviewer', 'Intent settled — deal-breaker: fabricated statistics', 'INTENT_CONFIRM'],
  [3800, 'scout', 'Looking for sources: supplied, cited in prose, live web', 'SOURCE_SCOUTING'],
  [4700, 'scout', '9 sources found, 4 reachable — 3 cited in prose only', null],
  [5400, 'scout', 'Categorised — your turn to approve or exclude', 'SOURCE_RATING'],
  [6100, 'user', 'All sources carried forward', null],
  [6700, 'scorer', 'Scoring 9 sources against your intent', 'VERIFYING'],
  [7500, 'scorer', 'Per-source credibility done', null],
  [8100, 'scorer', 'Checking every claim against what its source says', 'REPORT_READY'],
  [8800, 'reviewer', 'Second opinion — 2 verdicts, 2 disagreements', 'REVIEW'],
  [9500, 'system', 'Verdict: do_not_rely (0/100)', 'USER_EVALUATION'],
];

// Recorded runs, offered as buttons. Only cases with a real saved report appear —
// a case that has never been run is simply absent rather than shown with a
// placeholder number.
async function mountCasePicker({ gauntlet, ledger, panel, setReport }) {
  const cases = await availableCases();
  if (!cases.length) return null;

  const bar = document.createElement('div');
  bar.id = 'case-bar';
  const title = document.createElement('span');
  title.className = 'case-title';
  title.textContent = 'RECORDED RUNS';
  bar.appendChild(title);

  for (const c of cases) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'case-btn';
    b.dataset.verdict = c.verdict;
    b.title = c.blurb;

    const name = document.createElement('span');
    name.className = 'case-name';
    name.textContent = c.label;
    const score = document.createElement('span');
    score.className = 'case-score';
    score.textContent = `${c.score}`;
    b.append(name, score);

    b.addEventListener('click', () => {
      panel?.hide();
      const host = document.getElementById(HOST_ID);
      if (host) host.style.display = 'none';
      ledger?.hide();
      setReport?.(c.doc);
      gauntlet.load(c.doc, `RECORDED — ${c.label} · ${c.score}/100 · ${c.verdict}`);
      gauntlet.start();
      [...bar.querySelectorAll('.case-btn')].forEach((x) =>
        x.classList.toggle('on', x === b)
      );
    });
    bar.appendChild(b);
  }
  document.querySelector('.hud')?.appendChild(bar);
  return bar;
}

function playDemo({ tracker, status, panel, gauntlet, ledger }) {
  // panel.hide() leaves its scrim in place, which would sit over the whole demo.
  panel?.hide();
  const host = document.getElementById(HOST_ID);
  if (host) host.style.display = 'none';
  tracker.reset();
  const timers = DEMO_SCRIPT.map(([at, actor, message, state_to]) =>
    setTimeout(() => {
      tracker.handleEvent({
        seq: at,
        actor,
        message,
        state_to,
        payload: {},
        timestamp: new Date().toISOString(),
      });
      status.textContent = `${actor} — ${message}`;
    }, at)
  );
  timers.push(
    setTimeout(() => {
      status.textContent = '';
      gauntlet.load(FIXTURE, 'DEMO — replay of a recorded run');
      gauntlet.start();
    }, 10200)
  );
  // Let the gauntlet finish its own animation before the ledger slides in.
  timers.push(setTimeout(() => ledger?.show(FIXTURE), 22000));
  return () => timers.forEach(clearTimeout);
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

  // Presentation button — always available, backend or not.
  const demoBtn = document.createElement('button');
  demoBtn.id = 'demo-btn';
  demoBtn.type = 'button';
  demoBtn.textContent = '▶ Demo';
  demoBtn.title = 'Replay the full cascade in ~10s (D)';
  let stopDemo = null;
  const startDemo = async () => {
    stopDemo?.();
    const gauntlet = await waitForGauntlet();
    if (!gauntlet) return;
    stopDemo = playDemo({
      tracker,
      status,
      panel,
      gauntlet,
      ledger: ledgerCtl?.ledger,
    });
  };
  demoBtn.addEventListener('click', startDemo);
  document.getElementById('controls')?.appendChild(demoBtn);

  waitForGauntlet().then((g) => {
    if (g) {
      mountCasePicker({
        gauntlet: g,
        ledger: ledgerCtl?.ledger,
        panel,
        setReport: ledgerCtl?.setReport,
      });
    }
  });
  addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
    if (!typing && (e.key === 'd' || e.key === 'D')) startDemo();
  });

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
