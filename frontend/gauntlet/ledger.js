// ledger.js — Ampel (traffic-light) source ledger for the Glassbox gauntlet.
// Vanilla ES module. No dependencies, no build step. Never innerHTML on backend text.

const BAND_ORDER = { red: 0, orange: 1, green: 2 };

const BAND_META = {
  green:  { label: 'Verified', symbol: '✓' },
  orange: { label: 'Caution',  symbol: '△' },
  red:    { label: 'Flagged',  symbol: '✕' },
};

/**
 * Decide the Ampel band for a single source.
 * @param {object} source
 * @returns {{band:'green'|'orange'|'red', label:string, symbol:string, reason:string}}
 */
export function bandFor(source) {
  const s = source || {};
  const cred = s.credibility;

  // 1. unreachable / no credibility at all -> red
  if (s.fetched_ok === false || s.category === 'unreachable' || !cred) {
    let reason = 'Could not be verified — no credibility assessment is available for this source.';
    if (s.fetch_error) {
      reason = `Fetch failed: ${s.fetch_error}`;
    } else if (s.fetched_ok === false) {
      reason = 'This source could not be fetched.';
    } else if (s.category === 'unreachable') {
      reason = 'This source is marked unreachable.';
    }
    return { band: 'red', label: BAND_META.red.label, symbol: BAND_META.red.symbol, reason };
  }

  const score = typeof cred.score === 'number' ? cred.score : 0;
  const relevance = typeof cred.relevance_to_intent === 'number' ? cred.relevance_to_intent : null;

  // 2. score < 40 -> red
  if (score < 40) {
    return {
      band: 'red',
      label: BAND_META.red.label,
      symbol: BAND_META.red.symbol,
      reason: `Credibility score is only ${score}/100 — well below the threshold for reliable evidence.`,
    };
  }

  // 3. score < 70 -> orange
  if (score < 70) {
    return {
      band: 'orange',
      label: BAND_META.orange.label,
      symbol: BAND_META.orange.symbol,
      reason: `Credibility score of ${score}/100 is middling — treat with caution.`,
    };
  }

  // 4. otherwise green, unless relevance override
  if (relevance !== null && relevance < 40) {
    return {
      band: 'orange',
      label: BAND_META.orange.label,
      symbol: BAND_META.orange.symbol,
      reason: 'credible, but not about what you asked',
    };
  }

  return {
    band: 'green',
    label: BAND_META.green.label,
    symbol: BAND_META.green.symbol,
    reason: `Strong credibility score (${score}/100) with good relevance to the research intent.`,
  };
}

const STYLE_ID = 'gb-ledger-style';

function injectStyleOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.gb-ledger-overlay{
  position:fixed; top:0; right:0; bottom:0; width:min(460px,92vw);
  background:rgba(11,13,16,.96); border-left:1px solid var(--line,#242a31);
  color:var(--paper,#e8e4dc); font-family:var(--sans,"Helvetica Neue",Helvetica,Arial,sans-serif);
  z-index:50; display:flex; flex-direction:column;
  transform:translateX(100%); opacity:0; transition:transform .25s ease, opacity .25s ease;
  pointer-events:none;
}
.gb-ledger-overlay.gb-ledger-open{ transform:translateX(0); opacity:1; pointer-events:auto; }
.gb-ledger-head{
  display:flex; align-items:flex-start; justify-content:space-between; gap:10px;
  padding:18px 18px 12px; border-bottom:1px solid var(--line,#242a31); flex:0 0 auto;
}
.gb-ledger-title{
  font-family:var(--mono,ui-monospace,monospace); font-size:12px; letter-spacing:.22em;
  text-transform:uppercase; color:var(--paper,#e8e4dc); margin:0 0 6px;
}
.gb-ledger-counts{
  font-family:var(--mono,ui-monospace,monospace); font-size:11px; letter-spacing:.06em;
  color:var(--dim,#8d9aa4);
}
.gb-ledger-close{
  font-family:var(--mono,ui-monospace,monospace); font-size:11px; letter-spacing:.12em;
  text-transform:uppercase; color:var(--paper,#e8e4dc); background:transparent;
  border:1px solid var(--line,#242a31); padding:7px 11px; cursor:pointer; flex:0 0 auto;
  transition:border-color .2s,background .2s;
}
.gb-ledger-close:hover{ border-color:#4c5661; background:rgba(255,255,255,.04); }
.gb-ledger-close:focus-visible,
.gb-ledger-row-toggle:focus-visible{
  outline:2px solid #c8a86b; outline-offset:2px;
}
.gb-ledger-body{ overflow-y:auto; flex:1 1 auto; padding:8px 0; }
.gb-ledger-empty{
  padding:24px 18px; font-family:var(--mono,ui-monospace,monospace); font-size:11px;
  color:var(--dim,#8d9aa4); letter-spacing:.06em;
}
.gb-ledger-row{
  border-bottom:1px solid var(--line,#242a31);
}
.gb-ledger-row-toggle{
  display:flex; width:100%; text-align:left; gap:10px; align-items:flex-start;
  background:transparent; border:0; color:inherit; font:inherit; cursor:pointer;
  padding:12px 18px; box-sizing:border-box;
}
.gb-ledger-row-toggle:hover{ background:rgba(255,255,255,.03); }
.gb-ledger-symbol{
  font-family:var(--mono,ui-monospace,monospace); font-size:15px; line-height:1.3;
  flex:0 0 20px; text-align:center;
}
.gb-ledger-symbol.gb-ledger-green{ color:#5fa87a; }
.gb-ledger-symbol.gb-ledger-orange{ color:#c8a86b; }
.gb-ledger-symbol.gb-ledger-red{ color:#c8342c; }
.gb-ledger-main{ min-width:0; flex:1 1 auto; display:flex; flex-direction:column; gap:4px; }
.gb-ledger-idline{
  display:flex; align-items:baseline; gap:8px; font-family:var(--mono,ui-monospace,monospace);
  font-size:10px; letter-spacing:.08em; color:var(--dim,#8d9aa4);
}
.gb-ledger-name{
  font-size:12.5px; font-weight:600; color:var(--paper,#e8e4dc); line-height:1.35;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.gb-ledger-tags{ display:flex; flex-wrap:wrap; gap:6px; }
.gb-ledger-tag{
  font-family:var(--mono,ui-monospace,monospace); font-size:9px; letter-spacing:.08em;
  text-transform:uppercase; color:var(--dim,#8d9aa4); border:1px solid var(--line,#242a31);
  padding:2px 6px;
}
.gb-ledger-tag.gb-ledger-phantom{ color:#c8342c; border-color:#5a2622; }
.gb-ledger-scoreline{
  font-family:var(--mono,ui-monospace,monospace); font-size:10.5px; letter-spacing:.06em;
  color:var(--dim,#8d9aa4);
}
.gb-ledger-reason{ font-size:11.5px; line-height:1.4; color:var(--paper,#e8e4dc); }
.gb-ledger-detail{
  padding:0 18px 14px 48px; display:none; flex-direction:column; gap:10px;
}
.gb-ledger-detail.gb-ledger-detail-open{ display:flex; }
.gb-ledger-detail h4{
  margin:0 0 4px; font-family:var(--mono,ui-monospace,monospace); font-size:10px;
  letter-spacing:.14em; text-transform:uppercase; color:var(--dim,#8d9aa4);
}
.gb-ledger-detail ul{ margin:0; padding-left:16px; font-size:11.5px; line-height:1.5; color:var(--paper,#e8e4dc); }
.gb-ledger-detail li{ margin:0 0 3px; }
.gb-ledger-detail .gb-ledger-none{ font-size:11px; color:var(--dim,#8d9aa4); font-style:normal; }
`;
  document.head.appendChild(style);
}

function truncate(text, max) {
  if (!text) return '';
  const t = String(text);
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t;
}

function sourceDisplayName(s) {
  return s.title || s.url || s.raw_reference || '(untitled source)';
}

function sortSources(sources) {
  return sources
    .map((s) => ({ source: s, band: bandFor(s) }))
    .sort((a, b) => {
      const bandDiff = BAND_ORDER[a.band.band] - BAND_ORDER[b.band.band];
      if (bandDiff !== 0) return bandDiff;
      const scoreA = a.source && a.source.credibility && typeof a.source.credibility.score === 'number'
        ? a.source.credibility.score : -1;
      const scoreB = b.source && b.source.credibility && typeof b.source.credibility.score === 'number'
        ? b.source.credibility.score : -1;
      return scoreA - scoreB;
    });
}

function buildRow(entry) {
  const { source, band } = entry;
  const s = source || {};

  const row = document.createElement('div');
  row.className = 'gb-ledger-row';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'gb-ledger-row-toggle';
  toggle.setAttribute('aria-expanded', 'false');

  const symbol = document.createElement('span');
  symbol.className = `gb-ledger-symbol gb-ledger-${band.band}`;
  symbol.textContent = band.symbol;
  toggle.appendChild(symbol);

  const main = document.createElement('div');
  main.className = 'gb-ledger-main';

  const idline = document.createElement('div');
  idline.className = 'gb-ledger-idline';
  const idSpan = document.createElement('span');
  idSpan.textContent = s.id || '(no id)';
  idline.appendChild(idSpan);
  main.appendChild(idline);

  const name = document.createElement('div');
  name.className = 'gb-ledger-name';
  const fullText = sourceDisplayName(s);
  name.textContent = truncate(fullText, 70);
  name.title = String(fullText);
  main.appendChild(name);

  const tags = document.createElement('div');
  tags.className = 'gb-ledger-tags';
  if (s.category) {
    const catTag = document.createElement('span');
    catTag.className = 'gb-ledger-tag';
    catTag.textContent = String(s.category);
    tags.appendChild(catTag);
  }
  if (s.origin) {
    const originTag = document.createElement('span');
    originTag.className = 'gb-ledger-tag';
    originTag.textContent = String(s.origin);
    tags.appendChild(originTag);
  }
  const isPhantom = s.origin === 'extracted' && !s.url;
  if (isPhantom) {
    const phantomTag = document.createElement('span');
    phantomTag.className = 'gb-ledger-tag gb-ledger-phantom';
    phantomTag.textContent = 'phantom — extracted from prose, no link';
    tags.appendChild(phantomTag);
  }
  if (tags.childNodes.length) main.appendChild(tags);

  const cred = s.credibility;
  const scoreline = document.createElement('div');
  scoreline.className = 'gb-ledger-scoreline';
  const scoreVal = cred && typeof cred.score === 'number' ? cred.score : '—';
  const relVal = cred && typeof cred.relevance_to_intent === 'number' ? cred.relevance_to_intent : '—';
  scoreline.textContent = `${scoreVal}/100 · rel ${relVal}`;
  main.appendChild(scoreline);

  const reason = document.createElement('div');
  reason.className = 'gb-ledger-reason';
  reason.textContent = band.reason;
  main.appendChild(reason);

  toggle.appendChild(main);
  row.appendChild(toggle);

  const detail = document.createElement('div');
  detail.className = 'gb-ledger-detail';

  const reasonsHeading = document.createElement('h4');
  reasonsHeading.textContent = 'Reasons';
  detail.appendChild(reasonsHeading);
  detail.appendChild(buildList(cred && cred.reasons));

  const flagsHeading = document.createElement('h4');
  flagsHeading.textContent = 'Red flags';
  detail.appendChild(flagsHeading);
  detail.appendChild(buildList(cred && cred.red_flags));

  row.appendChild(detail);

  toggle.addEventListener('click', () => {
    const isOpen = detail.classList.toggle('gb-ledger-detail-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  return row;
}

function buildList(items) {
  if (!items || !items.length) {
    const p = document.createElement('div');
    p.className = 'gb-ledger-none';
    p.textContent = 'None reported.';
    return p;
  }
  const ul = document.createElement('ul');
  items.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = String(text);
    ul.appendChild(li);
  });
  return ul;
}

/**
 * Mount the ledger overlay into hostEl.
 * @param {HTMLElement} hostEl
 * @returns {{show:Function, hide:Function, toggle:Function, destroy:Function, isOpen:boolean}}
 */
export function mountLedger(hostEl) {
  injectStyleOnce();

  const overlay = document.createElement('div');
  overlay.className = 'gb-ledger-overlay';
  overlay.setAttribute('role', 'complementary');
  overlay.setAttribute('aria-label', 'Source ledger');

  const head = document.createElement('div');
  head.className = 'gb-ledger-head';

  const headText = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'gb-ledger-title';
  title.textContent = 'Source Ledger';
  headText.appendChild(title);

  const counts = document.createElement('div');
  counts.className = 'gb-ledger-counts';
  counts.textContent = '';
  headText.appendChild(counts);

  head.appendChild(headText);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'gb-ledger-close';
  closeBtn.textContent = 'Close ✕';
  head.appendChild(closeBtn);

  overlay.appendChild(head);

  const body = document.createElement('div');
  body.className = 'gb-ledger-body';
  overlay.appendChild(body);

  (hostEl || document.body).appendChild(overlay);

  let open = false;

  function render(report) {
    body.textContent = '';
    counts.textContent = '';

    const sources = report && report.report && Array.isArray(report.report.sources)
      ? report.report.sources : [];

    if (!sources.length) {
      const empty = document.createElement('div');
      empty.className = 'gb-ledger-empty';
      empty.textContent = 'No sources in this report.';
      body.appendChild(empty);
      return;
    }

    const sorted = sortSources(sources);
    const tally = { red: 0, orange: 0, green: 0 };
    sorted.forEach((entry) => { tally[entry.band.band]++; });
    counts.textContent = `${tally.red} flagged · ${tally.orange} caution · ${tally.green} verified`;

    sorted.forEach((entry) => {
      body.appendChild(buildRow(entry));
    });
  }

  function show(report) {
    render(report);
    overlay.classList.add('gb-ledger-open');
    open = true;
  }

  function hide() {
    overlay.classList.remove('gb-ledger-open');
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
