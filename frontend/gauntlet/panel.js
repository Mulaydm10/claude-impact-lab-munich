// panel.js — Glassbox Gauntlet input panel.
// Vanilla ES module, no dependencies. Owns the 2D DOM overlay that collects
// research + sources + survey answers + source ratings from a human, and
// hands them back to whatever orchestrates the live run. Never touches the
// 3D scene, never calls the network.

const STYLE_ID = 'gb-panel-style';

function injectStyleOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.gb-panel-root{
  --gb-ink: var(--ink, #0b0d10);
  --gb-paper: var(--paper, #e8e4dc);
  --gb-dim: var(--dim, #8d9aa4);
  --gb-line: var(--line, #242a31);
  --gb-mono: var(--mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace);
  --gb-sans: var(--sans, "Helvetica Neue", Helvetica, Arial, sans-serif);
  --gb-gold: #c8a86b;
  --gb-gold-hi: #e0c58a;
  --gb-bad: #d4695e;
  --gb-warn: #d98f5a;
  --gb-ok: #a9b3a0;
  position:absolute; inset:0; display:none; align-items:center; justify-content:center;
  font-family:var(--gb-sans); color:var(--gb-paper); pointer-events:auto; z-index:6;
}
.gb-panel-root.gb-panel-visible{ display:flex; }
.gb-panel-scrim{ position:absolute; inset:0; background:rgba(6,7,9,.72); }
.gb-panel-card{
  position:relative; width:min(680px,92vw); max-height:min(88vh,860px);
  display:flex; flex-direction:column; background:rgba(10,12,15,.96);
  border:1px solid var(--gb-line); box-shadow:0 24px 80px rgba(0,0,0,.5);
}
.gb-panel-head{ padding:18px 24px 14px; border-bottom:1px solid var(--gb-line); flex:0 0 auto; }
.gb-panel-eyebrow{ display:block; font-family:var(--gb-mono); font-size:10px; letter-spacing:.24em;
  text-transform:uppercase; color:var(--gb-gold); margin-bottom:6px; }
.gb-panel-title{ margin:0; font-family:var(--gb-sans); font-weight:700; font-size:19px; letter-spacing:.01em; }
.gb-panel-sub{ margin:6px 0 0; font-size:12px; line-height:1.5; color:var(--gb-dim); }
.gb-panel-body{ padding:18px 24px; overflow-y:auto; flex:1 1 auto; display:flex; flex-direction:column; gap:16px; }
.gb-panel-foot{ padding:14px 24px; border-top:1px solid var(--gb-line); display:flex; justify-content:flex-end;
  gap:10px; flex:0 0 auto; align-items:center; }
.gb-panel-foot-note{ margin-right:auto; font-family:var(--gb-mono); font-size:10px; color:var(--gb-dim); letter-spacing:.06em; }

.gb-panel-field{ display:flex; flex-direction:column; gap:6px; }
.gb-panel-label{ font-family:var(--gb-mono); font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--gb-dim); }
.gb-panel-hint{ font-size:11px; color:var(--gb-dim); line-height:1.4; }

.gb-panel-root textarea,
.gb-panel-root input[type="text"]{
  font-family:var(--gb-sans); font-size:13px; line-height:1.5; color:var(--gb-paper);
  background:rgba(255,255,255,.03); border:1px solid var(--gb-line); padding:10px 12px;
  resize:vertical; width:100%;
}
.gb-panel-root textarea::placeholder,
.gb-panel-root input::placeholder{ color:#5f6a73; }
.gb-panel-root textarea:focus-visible,
.gb-panel-root input:focus-visible,
.gb-panel-root button:focus-visible,
.gb-panel-root label:focus-within{
  outline:2px solid var(--gb-gold); outline-offset:2px;
}
.gb-panel-root textarea.gb-panel-ta-lg{ min-height:140px; }
.gb-panel-root textarea.gb-panel-ta-md{ min-height:78px; }

.gb-panel-root button{
  font-family:var(--gb-mono); font-size:11px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--gb-paper); background:transparent; border:1px solid var(--gb-line); padding:9px 16px;
  cursor:pointer; transition:border-color .2s, background .2s, opacity .2s;
}
.gb-panel-root button:hover:not(:disabled){ border-color:#4c5661; background:rgba(255,255,255,.04); }
.gb-panel-root button:disabled{ opacity:.35; cursor:not-allowed; }
.gb-panel-root button.gb-panel-primary{ border-color:var(--gb-gold); color:var(--gb-gold); }
.gb-panel-root button.gb-panel-primary:hover:not(:disabled){ background:rgba(200,168,107,.1); color:var(--gb-gold-hi); border-color:var(--gb-gold-hi); }
.gb-panel-root button.gb-panel-ghost{ border-color:transparent; color:var(--gb-dim); padding:9px 6px; }
.gb-panel-root button.gb-panel-ghost:hover:not(:disabled){ color:var(--gb-paper); background:transparent; }

.gb-panel-round{ font-family:var(--gb-mono); font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:var(--gb-gold); }

.gb-panel-q{ border:1px solid var(--gb-line); padding:14px 16px; display:flex; flex-direction:column; gap:8px; }
.gb-panel-q-text{ font-size:14px; font-weight:600; line-height:1.4; }
.gb-panel-q-why{ font-size:11.5px; line-height:1.5; color:var(--gb-dim); border-left:2px solid var(--gb-gold); padding-left:10px; }

.gb-panel-kv{ display:grid; grid-template-columns:150px 1fr; gap:4px 12px; font-size:12px; }
.gb-panel-kv dt{ font-family:var(--gb-mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--gb-dim); align-self:start; padding-top:2px; }
.gb-panel-kv dd{ margin:0; line-height:1.5; }
.gb-panel-kv ul{ margin:0; padding-left:16px; }
.gb-panel-kv li{ margin:2px 0; }

.gb-panel-src{ border:1px solid var(--gb-line); padding:11px 14px; display:flex; gap:12px; align-items:flex-start; }
.gb-panel-src.gb-panel-src-phantom{ border-color:var(--gb-bad); background:rgba(212,105,94,.06); }
.gb-panel-src-main{ flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:4px; }
.gb-panel-src-id{ font-family:var(--gb-mono); font-size:10px; color:var(--gb-dim); letter-spacing:.08em; }
.gb-panel-src-title{ font-size:13px; font-weight:600; word-break:break-word; }
.gb-panel-src-badges{ display:flex; gap:8px; flex-wrap:wrap; margin-top:2px; }
.gb-panel-badge{ font-family:var(--gb-mono); font-size:9.5px; letter-spacing:.08em; text-transform:uppercase;
  color:var(--gb-dim); border:1px solid var(--gb-line); padding:2px 6px; }
.gb-panel-badge.gb-panel-badge-phantom{ color:var(--gb-bad); border-color:var(--gb-bad); }
.gb-panel-src-phantom-note{ font-size:11px; color:var(--gb-bad); display:flex; gap:6px; align-items:baseline; }
.gb-panel-src-right{ flex:0 0 auto; display:flex; flex-direction:column; align-items:flex-end; gap:6px; min-width:150px; }
.gb-panel-toggle{ display:flex; gap:6px; }
.gb-panel-toggle button{ padding:6px 10px; font-size:10px; }
.gb-panel-toggle button.gb-panel-active-approve{ border-color:var(--gb-ok); color:var(--gb-ok); }
.gb-panel-toggle button.gb-panel-active-exclude{ border-color:var(--gb-bad); color:var(--gb-bad); }
.gb-panel-src-reason{ width:100%; }
.gb-panel-src-reason input{ font-size:11px; padding:6px 8px; }

.gb-panel-progress{ display:flex; flex-direction:column; gap:14px; align-items:center; text-align:center; padding:12px 0 4px; }
.gb-panel-spinner{ width:34px; height:34px; border-radius:50%; border:2px solid var(--gb-line);
  border-top-color:var(--gb-gold); animation:gb-panel-spin 1s linear infinite; }
@keyframes gb-panel-spin{ to{ transform:rotate(360deg); } }
.gb-panel-elapsed{ font-family:var(--gb-mono); font-size:22px; letter-spacing:.06em; }
.gb-panel-progress-msg{ font-size:13px; color:var(--gb-paper); max-width:440px; line-height:1.5; }
.gb-panel-progress-note{ font-size:11px; color:var(--gb-dim); max-width:440px; line-height:1.5; }

.gb-panel-error{ display:flex; flex-direction:column; gap:10px; }
.gb-panel-error-msg{ font-size:13px; line-height:1.5; color:var(--gb-paper); white-space:pre-wrap; word-break:break-word; }
.gb-panel-error-meta{ font-family:var(--gb-mono); font-size:10px; color:var(--gb-bad); letter-spacing:.08em; }
`;
  document.head.appendChild(style);
}

/** Split a textarea's raw value into cleaned, non-blank lines. */
function linesFrom(raw) {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function el(tag, opts) {
  const node = document.createElement(tag);
  if (!opts) return node;
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  return node;
}

export function mountPanel(hostEl, handlers) {
  injectStyleOnce();
  handlers = handlers || {};

  const root = el('div', { className: 'gb-panel-root' });
  const scrim = el('div', { className: 'gb-panel-scrim' });
  const card = el('div', { className: 'gb-panel-card' });
  root.appendChild(scrim);
  root.appendChild(card);
  hostEl.appendChild(root);

  let questionRound = 0;
  let progressTimerId = null;

  function clearCard() {
    while (card.firstChild) card.removeChild(card.firstChild);
  }

  function stopProgressTimer() {
    if (progressTimerId != null) {
      clearInterval(progressTimerId);
      progressTimerId = null;
    }
  }

  function frame(eyebrow, title, sub) {
    clearCard();
    stopProgressTimer();
    const head = el('div', { className: 'gb-panel-head' });
    head.appendChild(el('span', { className: 'gb-panel-eyebrow', text: eyebrow }));
    head.appendChild(el('h2', { className: 'gb-panel-title', text: title }));
    if (sub) head.appendChild(el('p', { className: 'gb-panel-sub', text: sub }));
    const body = el('div', { className: 'gb-panel-body' });
    const foot = el('div', { className: 'gb-panel-foot' });
    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(foot);
    root.classList.add('gb-panel-visible');
    return { head, body, foot };
  }

  function show() {
    root.classList.add('gb-panel-visible');
  }

  function hide() {
    root.classList.remove('gb-panel-visible');
    stopProgressTimer();
  }

  function destroy() {
    stopProgressTimer();
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  // ---------------------------------------------------------------- intake

  function showIntake() {
    const { body, foot } = frame(
      'Step 1 · Intake',
      'Bring the research',
      'Paste the AI-generated research and the sources behind it. Bare URLs or prose citations both work.'
    );

    const researchField = el('div', { className: 'gb-panel-field' });
    researchField.appendChild(el('label', { className: 'gb-panel-label', attrs: { for: 'gb-panel-research' }, text: 'Research output' }));
    const researchTa = el('textarea', {
      className: 'gb-panel-ta-lg',
      attrs: { id: 'gb-panel-research', placeholder: 'Paste the research text to be verified…' },
    });
    researchField.appendChild(researchTa);

    const sourcesField = el('div', { className: 'gb-panel-field' });
    sourcesField.appendChild(el('label', { className: 'gb-panel-label', attrs: { for: 'gb-panel-sources' }, text: 'Sources — one per line' }));
    const sourcesTa = el('textarea', {
      className: 'gb-panel-ta-md',
      attrs: { id: 'gb-panel-sources', placeholder: 'https://example.com/report\nAccording to a 2019 press release…' },
    });
    sourcesField.appendChild(sourcesTa);
    sourcesField.appendChild(el('p', { className: 'gb-panel-hint', text: 'Bare URLs and prose citations are both accepted — the backend handles either.' }));

    const promptField = el('div', { className: 'gb-panel-field' });
    promptField.appendChild(el('label', { className: 'gb-panel-label', attrs: { for: 'gb-panel-prompt' }, text: 'Original prompt (optional)' }));
    const promptInput = el('input', {
      attrs: { id: 'gb-panel-prompt', type: 'text', placeholder: 'What was the research supposed to answer?' },
    });
    promptField.appendChild(promptInput);

    body.appendChild(researchField);
    body.appendChild(sourcesField);
    body.appendChild(promptField);

    const loadExampleBtn = el('button', { className: 'gb-panel-ghost', text: 'Load example' });
    const submitBtn = el('button', { className: 'gb-panel-primary', text: 'Start verification' });
    submitBtn.disabled = true;

    function refreshEnabled() {
      const hasResearch = researchTa.value.trim().length > 0;
      const hasSources = linesFrom(sourcesTa.value).length > 0;
      submitBtn.disabled = !(hasResearch && hasSources);
    }
    researchTa.addEventListener('input', refreshEnabled);
    sourcesTa.addEventListener('input', refreshEnabled);

    function submit() {
      if (submitBtn.disabled) return;
      const payload = {
        research_output: researchTa.value.trim(),
        sources: linesFrom(sourcesTa.value),
        original_prompt: promptInput.value.trim() || null,
      };
      if (typeof handlers.onSubmit === 'function') handlers.onSubmit(payload);
    }

    loadExampleBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('../../backend/examples/demo_case.json');
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data.research_output === 'string') researchTa.value = data.research_output;
        if (Array.isArray(data.sources)) sourcesTa.value = data.sources.join('\n');
        if (typeof data.original_prompt === 'string') promptInput.value = data.original_prompt;
        refreshEnabled();
      } catch {
        // 404 or network hiccup — fail silently, this is a convenience only.
      }
    });

    submitBtn.addEventListener('click', submit);
    card.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
    });

    foot.appendChild(el('span', { className: 'gb-panel-foot-note', text: 'Ctrl/Cmd + Enter to submit' }));
    foot.appendChild(loadExampleBtn);
    foot.appendChild(submitBtn);

    researchTa.focus();
    show();
  }

  // ------------------------------------------------------------- questions

  function showQuestions(questions) {
    questionRound += 1;
    const { body, foot } = frame(
      'Step 2 · Survey',
      'A few questions first',
      'The backend asks up to three short rounds before it commits to what it thinks you actually want.'
    );

    const roundLine = el('div', { className: 'gb-panel-round', text: `Round ${questionRound} of up to 3` });
    body.appendChild(roundLine);

    const answerInputs = [];
    (questions || []).forEach((q, i) => {
      const qEl = el('div', { className: 'gb-panel-q' });
      qEl.appendChild(el('div', { className: 'gb-panel-q-text', text: q.question }));
      if (q.why_it_matters) {
        qEl.appendChild(el('div', { className: 'gb-panel-q-why', text: q.why_it_matters }));
      }
      const ta = el('textarea', {
        className: 'gb-panel-ta-md',
        attrs: { placeholder: 'Your answer…', 'aria-label': q.question || `Question ${i + 1}` },
      });
      qEl.appendChild(ta);
      body.appendChild(qEl);
      answerInputs.push({ question_id: q.id, ta });
    });

    return new Promise((resolve) => {
      function submit() {
        const answers = answerInputs.map(({ question_id, ta }) => ({
          question_id,
          answer: ta.value.trim(),
        }));
        resolve(answers);
      }
      const submitBtn = el('button', { className: 'gb-panel-primary', text: 'Submit answers' });
      submitBtn.addEventListener('click', submit);
      card.addEventListener('keydown', function handler(e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          submit();
          card.removeEventListener('keydown', handler);
        }
      });
      foot.appendChild(el('span', { className: 'gb-panel-foot-note', text: 'Ctrl/Cmd + Enter to submit' }));
      foot.appendChild(submitBtn);
      show();
      if (answerInputs[0]) answerInputs[0].ta.focus();
    });
  }

  // ---------------------------------------------------------------- intent

  function showIntent(intent) {
    const { body, foot } = frame(
      'Step 3 · Intent',
      'Here is what it understood',
      'A confirmation of the question Glassbox believes it is actually being asked.'
    );

    const dl = el('dl', { className: 'gb-panel-kv' });
    function row(labelText, valueNode) {
      dl.appendChild(el('dt', { text: labelText }));
      const dd = el('dd');
      dd.appendChild(valueNode);
      dl.appendChild(dd);
    }
    function textNode(t) {
      return el('span', { text: t });
    }
    function listNode(items) {
      const ul = el('ul');
      (items || []).forEach((it) => ul.appendChild(el('li', { text: it })));
      return ul;
    }

    if (intent && intent.restated_question) row('Restated question', textNode(intent.restated_question));
    if (intent && intent.domain) row('Domain', textNode(intent.domain));
    if (intent && intent.recency_requirement) row('Recency requirement', textNode(intent.recency_requirement));
    if (intent && intent.success_criteria && intent.success_criteria.length) row('Success criteria', listNode(intent.success_criteria));
    if (intent && intent.deal_breakers && intent.deal_breakers.length) row('Deal breakers', listNode(intent.deal_breakers));

    body.appendChild(dl);

    return new Promise((resolve) => {
      const continueBtn = el('button', { className: 'gb-panel-primary', text: 'Continue → source scouting' });
      continueBtn.addEventListener('click', () => resolve());
      foot.appendChild(continueBtn);
      show();
      continueBtn.focus();
    });
  }

  // --------------------------------------------------------------- sources

  function sourceLabel(s) {
    return s.title || s.url || s.raw_reference || s.id;
  }

  function isPhantom(s) {
    return s.origin === 'extracted' && !s.url;
  }

  function showSources(sources) {
    const { body, foot } = frame(
      'Step 4 · Sources',
      'Approve or exclude',
      'Excluded sources are not scored and not used to check any claim. Extracted citations with no URL are flagged — they often point at nothing.'
    );

    const rows = [];
    (sources || []).forEach((s) => {
      const phantom = isPhantom(s);
      const rowEl = el('div', { className: 'gb-panel-src' + (phantom ? ' gb-panel-src-phantom' : '') });
      const main = el('div', { className: 'gb-panel-src-main' });
      main.appendChild(el('div', { className: 'gb-panel-src-id', text: s.id }));
      main.appendChild(el('div', { className: 'gb-panel-src-title', text: sourceLabel(s) }));
      const badges = el('div', { className: 'gb-panel-src-badges' });
      if (s.category) badges.appendChild(el('span', { className: 'gb-panel-badge', text: s.category.replace(/_/g, ' ') }));
      badges.appendChild(el('span', {
        className: 'gb-panel-badge' + (phantom ? ' gb-panel-badge-phantom' : ''),
        text: s.origin || 'unknown',
      }));
      main.appendChild(badges);
      if (phantom) {
        main.appendChild(el('div', { className: 'gb-panel-src-phantom-note', text: '⚠ extracted from prose, no resolvable link' }));
      }

      const right = el('div', { className: 'gb-panel-src-right' });
      const toggle = el('div', { className: 'gb-panel-toggle' });
      const approveBtn = el('button', { text: 'Approve' });
      const excludeBtn = el('button', { text: 'Exclude' });
      const reasonWrap = el('div', { className: 'gb-panel-src-reason' });
      const reasonInput = el('input', { attrs: { type: 'text', placeholder: 'Exclusion reason (optional)' } });
      reasonWrap.appendChild(reasonInput);
      reasonWrap.style.display = 'none';

      let approved = true;
      function paint() {
        approveBtn.classList.toggle('gb-panel-active-approve', approved);
        excludeBtn.classList.toggle('gb-panel-active-exclude', !approved);
        reasonWrap.style.display = approved ? 'none' : 'block';
      }
      approveBtn.addEventListener('click', () => { approved = true; paint(); });
      excludeBtn.addEventListener('click', () => { approved = false; paint(); });
      paint();

      toggle.appendChild(approveBtn);
      toggle.appendChild(excludeBtn);
      right.appendChild(toggle);
      right.appendChild(reasonWrap);

      rowEl.appendChild(main);
      rowEl.appendChild(right);
      body.appendChild(rowEl);

      rows.push({ id: s.id, getApproved: () => approved, reasonInput });
    });

    return new Promise((resolve) => {
      function submit() {
        const ratings = rows.map((r) => {
          const approved = r.getApproved();
          const out = { source_id: r.id, approved };
          const reason = r.reasonInput.value.trim();
          if (!approved && reason) out.exclusion_reason = reason;
          return out;
        });
        resolve(ratings);
      }
      const submitBtn = el('button', { className: 'gb-panel-primary', text: 'Confirm sources' });
      submitBtn.addEventListener('click', submit);
      foot.appendChild(el('span', { className: 'gb-panel-foot-note', text: `${rows.length} source${rows.length === 1 ? '' : 's'}` }));
      foot.appendChild(submitBtn);
      show();
    });
  }

  // -------------------------------------------------------------- progress

  function showProgress(message) {
    const { body } = frame('Step 5 · Verifying', 'Checking the work', null);

    const wrap = el('div', { className: 'gb-panel-progress' });
    wrap.appendChild(el('div', { className: 'gb-panel-spinner' }));
    const elapsedEl = el('div', { className: 'gb-panel-elapsed', text: '0:00' });
    wrap.appendChild(elapsedEl);
    const msgEl = el('div', { className: 'gb-panel-progress-msg', text: message || 'Working…' });
    wrap.appendChild(msgEl);
    wrap.appendChild(el('div', {
      className: 'gb-panel-progress-note',
      text: 'This step genuinely takes 3–8 minutes: every source is fetched over the network, scored, ~8–12 claims are extracted, each is checked twice, then two reviewers run. It is not stuck.',
    }));
    body.appendChild(wrap);

    const startedAt = Date.now();
    stopProgressTimer();
    progressTimerId = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      elapsedEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }, 1000);

    show();

    // Return a lightweight handle so a caller can update the message without
    // rebuilding the whole view, without changing the documented API shape.
    return {
      setMessage(next) { msgEl.textContent = next; },
    };
  }

  // ----------------------------------------------------------------- error

  function showError(err) {
    const { body } = frame('Error', 'Something went wrong', null);
    const wrap = el('div', { className: 'gb-panel-error' });
    const message = (err && err.message) || String(err);
    wrap.appendChild(el('div', { className: 'gb-panel-error-msg', text: message }));
    if (err && typeof err.status === 'number') {
      wrap.appendChild(el('div', { className: 'gb-panel-error-meta', text: `HTTP ${err.status}` }));
    }
    if (err && err.detail && typeof err.detail === 'string') {
      wrap.appendChild(el('div', { className: 'gb-panel-error-meta', text: err.detail }));
    }
    body.appendChild(wrap);
    show();
  }

  return {
    showIntake,
    showQuestions,
    showIntent,
    showSources,
    showProgress,
    showError,
    hide,
    destroy,
  };
}
