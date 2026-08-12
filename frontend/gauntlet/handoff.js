// handoff.js — research hand-off panel for the Glassbox gauntlet.
// Vanilla ES module. No dependencies, no build step. Never innerHTML on backend text.

const STYLE_ID = 'gb-handoff-style';

const SECTIONS = [
  { key: 'must_replace',    title: 'Replace these sources' },
  { key: 'must_verify',     title: 'These claims need a real source' },
  { key: 'open_questions',  title: 'Still unanswered' },
];

/**
 * True only if the report carries a non-empty handoff prompt.
 * @param {object} report
 * @returns {boolean}
 */
export function hasHandoff(report) {
  const h = report && report.handoff;
  if (!h) return false;
  return typeof h.prompt === 'string' && h.prompt.trim().length > 0;
}

function injectStyleOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.gb-handoff-overlay{
  position:fixed; top:0; right:0; bottom:0; width:min(460px,92vw);
  background:rgba(11,13,16,.96); border-left:1px solid var(--line,#242a31);
  color:var(--paper,#e8e4dc); font-family:var(--sans,"Helvetica Neue",Helvetica,Arial,sans-serif);
  z-index:50; display:flex; flex-direction:column;
  transform:translateX(100%); opacity:0; transition:transform .25s ease, opacity .25s ease;
  pointer-events:none;
}
.gb-handoff-overlay.gb-handoff-open{ transform:translateX(0); opacity:1; pointer-events:auto; }
.gb-handoff-head{
  display:flex; align-items:flex-start; justify-content:space-between; gap:10px;
  padding:18px 18px 12px; border-bottom:1px solid var(--line,#242a31); flex:0 0 auto;
}
.gb-handoff-title{
  font-family:var(--mono,ui-monospace,monospace); font-size:12px; letter-spacing:.22em;
  text-transform:uppercase; color:var(--paper,#e8e4dc); margin:0 0 6px;
}
.gb-handoff-sub{
  font-size:11.5px; line-height:1.4; color:var(--dim,#8d9aa4); max-width:340px;
}
.gb-handoff-close{
  font-family:var(--mono,ui-monospace,monospace); font-size:11px; letter-spacing:.12em;
  text-transform:uppercase; color:var(--paper,#e8e4dc); background:transparent;
  border:1px solid var(--line,#242a31); padding:7px 11px; cursor:pointer; flex:0 0 auto;
  transition:border-color .2s,background .2s;
}
.gb-handoff-close:hover{ border-color:#4c5661; background:rgba(255,255,255,.04); }
.gb-handoff-close:focus-visible,
.gb-handoff-copybtn:focus-visible,
.gb-handoff-summary:focus-visible{
  outline:2px solid #c8a86b; outline-offset:2px;
}
.gb-handoff-body{ overflow-y:auto; flex:1 1 auto; padding:18px; }
.gb-handoff-empty{
  padding:6px 0; font-family:var(--mono,ui-monospace,monospace); font-size:11px;
  color:var(--dim,#8d9aa4); letter-spacing:.06em;
}
.gb-handoff-copybar{ display:flex; margin:0 0 10px; }
.gb-handoff-copybtn{
  font-family:var(--mono,ui-monospace,monospace); font-size:11.5px; letter-spacing:.12em;
  text-transform:uppercase; color:var(--ink,#0b0d10); background:#c8a86b;
  border:1px solid #c8a86b; padding:10px 16px; cursor:pointer; width:100%;
  transition:background .2s,border-color .2s,color .2s;
}
.gb-handoff-copybtn:hover{ background:#e0c58a; border-color:#e0c58a; }
.gb-handoff-copybtn.gb-handoff-copied{
  background:transparent; color:#7f9c6d; border-color:#7f9c6d;
}
.gb-handoff-copybtn.gb-handoff-manual{
  background:transparent; color:#c8a86b; border-color:#c8a86b;
}
.gb-handoff-promptwrap{
  border:1px solid var(--line,#242a31); background:rgba(255,255,255,.02);
  margin:0 0 18px;
}
.gb-handoff-prompt{
  font-family:var(--mono,ui-monospace,monospace); font-size:12.5px; line-height:1.55;
  color:var(--paper,#e8e4dc); white-space:pre-wrap; word-break:break-word;
  margin:0; padding:14px; max-height:52vh; overflow-y:auto;
}
.gb-handoff-section{
  border:1px solid var(--line,#242a31); margin:0 0 10px;
}
.gb-handoff-summary{
  font-family:var(--mono,ui-monospace,monospace); font-size:10.5px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--paper,#e8e4dc); padding:10px 12px; cursor:pointer;
  list-style:none; display:flex; align-items:center; gap:8px;
}
.gb-handoff-summary::-webkit-details-marker{ display:none; }
.gb-handoff-summary::before{ content:'▸'; color:var(--dim,#8d9aa4); font-size:9px; }
.gb-handoff-section[open] > .gb-handoff-summary::before{ content:'▾'; }
.gb-handoff-summary:hover{ background:rgba(255,255,255,.03); }
.gb-handoff-count{ color:var(--dim,#8d9aa4); font-weight:400; }
.gb-handoff-list{ margin:0; padding:4px 14px 12px 30px; font-size:11.5px; line-height:1.5; color:var(--paper,#e8e4dc); }
.gb-handoff-list li{ margin:0 0 6px; }
.gb-handoff-list li:last-child{ margin-bottom:0; }
`;
  document.head.appendChild(style);
}

function selectElementText(el) {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_err) {
    // best-effort only
  }
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (_err) {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

function buildCopyBar(promptText, promptEl) {
  const bar = document.createElement('div');
  bar.className = 'gb-handoff-copybar';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gb-handoff-copybtn';
  btn.textContent = 'Copy prompt';
  bar.appendChild(btn);

  let resetTimer = null;

  function flash(label, cls) {
    if (resetTimer) clearTimeout(resetTimer);
    btn.textContent = label;
    btn.classList.remove('gb-handoff-copied', 'gb-handoff-manual');
    if (cls) btn.classList.add(cls);
    resetTimer = setTimeout(() => {
      btn.textContent = 'Copy prompt';
      btn.classList.remove('gb-handoff-copied', 'gb-handoff-manual');
    }, 1600);
  }

  btn.addEventListener('click', () => {
    const text = promptText();

    const onOk = () => flash('Copied ✓', 'gb-handoff-copied');
    const onFail = () => {
      if (legacyCopy(text)) {
        flash('Copied ✓', 'gb-handoff-copied');
        return;
      }
      // both mechanisms failed — select the prompt so the user can copy manually
      selectElementText(promptEl);
      flash('Selected — press Ctrl/Cmd+C', 'gb-handoff-manual');
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(onOk, onFail);
    } else {
      onFail();
    }
  });

  return bar;
}

function buildSection(title, items) {
  if (!items || !items.length) return null;

  const details = document.createElement('details');
  details.className = 'gb-handoff-section';

  const summary = document.createElement('summary');
  summary.className = 'gb-handoff-summary';
  summary.textContent = `${title} `;
  const count = document.createElement('span');
  count.className = 'gb-handoff-count';
  count.textContent = `(${items.length})`;
  summary.appendChild(count);
  details.appendChild(summary);

  const ul = document.createElement('ul');
  ul.className = 'gb-handoff-list';
  items.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = String(text);
    ul.appendChild(li);
  });
  details.appendChild(ul);

  return details;
}

/**
 * Mount the hand-off overlay into hostEl.
 * @param {HTMLElement} hostEl
 * @returns {{show:Function, hide:Function, toggle:Function, destroy:Function, isOpen:boolean}}
 */
export function mountHandoff(hostEl) {
  injectStyleOnce();

  const overlay = document.createElement('div');
  overlay.className = 'gb-handoff-overlay';
  overlay.setAttribute('role', 'complementary');
  overlay.setAttribute('aria-label', 'Research hand-off');

  const head = document.createElement('div');
  head.className = 'gb-handoff-head';

  const headText = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'gb-handoff-title';
  title.textContent = 'Hand-off';
  headText.appendChild(title);

  const sub = document.createElement('div');
  sub.className = 'gb-handoff-sub';
  sub.textContent = 'Paste this into a fresh research agent to redo the work properly.';
  headText.appendChild(sub);

  head.appendChild(headText);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gb-handoff-close';
  closeBtn.textContent = 'Close ✕';
  head.appendChild(closeBtn);

  overlay.appendChild(head);

  const body = document.createElement('div');
  body.className = 'gb-handoff-body';
  overlay.appendChild(body);

  (hostEl || document.body).appendChild(overlay);

  let open = false;

  function render(report) {
    body.textContent = '';

    if (!hasHandoff(report)) {
      const empty = document.createElement('div');
      empty.className = 'gb-handoff-empty';
      empty.textContent = 'A hand-off prompt was not generated for this run.';
      body.appendChild(empty);
      return;
    }

    const handoff = report.handoff;
    const promptText = String(handoff.prompt).trim();

    const promptWrap = document.createElement('div');
    promptWrap.className = 'gb-handoff-promptwrap';
    const promptEl = document.createElement('pre');
    promptEl.className = 'gb-handoff-prompt';
    promptEl.textContent = promptText;
    promptWrap.appendChild(promptEl);

    const copyBar = buildCopyBar(() => promptText, promptEl);

    body.appendChild(copyBar);
    body.appendChild(promptWrap);

    SECTIONS.forEach(({ key, title: sectionTitle }) => {
      const section = buildSection(sectionTitle, handoff[key]);
      if (section) body.appendChild(section);
    });
  }

  function show(report) {
    render(report);
    overlay.classList.add('gb-handoff-open');
    open = true;
  }

  function hide() {
    overlay.classList.remove('gb-handoff-open');
    open = false;
  }

  function toggle(report) {
    if (open) {
      hide();
    } else {
      show(report);
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && open) {
      hide();
    }
  }

  closeBtn.addEventListener('click', hide);
  document.addEventListener('keydown', onKeydown);

  function destroy() {
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
  }

  return {
    show,
    hide,
    toggle,
    destroy,
    get isOpen() { return open; },
  };
}
