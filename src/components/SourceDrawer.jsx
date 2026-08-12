import { useTrustStore } from '../store/TrustStoreContext.jsx';
import { getEffectiveRating, getOverrideHistory } from '../store/selectors.js';
import { getSourceById } from '../data/index.js';
import { BANDS } from '../lib/bands.js';
import RerateControl from './RerateControl.jsx';

function formatDelta(delta) {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

export default function SourceDrawer() {
  const { state, dispatch } = useTrustStore();
  const { open, sourceId } = state.drawer;
  if (!open || !sourceId) return null;

  const source = getSourceById(sourceId);
  if (!source) return null;

  const effective = getEffectiveRating(state, sourceId);
  const history = getOverrideHistory(state, sourceId);

  function close() {
    dispatch({ type: 'CLOSE_DRAWER' });
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <div className="source-drawer" role="dialog" aria-label={`Source details: ${source.title}`}>
        <button className="close-btn" onClick={close} aria-label="Close">×</button>
        <h3>{source.title}</h3>
        <div className="meta-line">
          {source.publisher} · {source.domain} · {source.publishedDate}
        </div>

        <h4>Current rating</h4>
        <p className={`band-${effective.band}`} style={{ fontWeight: 600 }}>
          {BANDS[effective.band].label}
          {' — '}
          {effective.isOverride
            ? `overridden by ${effective.override.actor}`
            : `heuristic score ${source.heuristic.score}`}
        </p>

        <h4>Why the heuristic scored this {source.heuristic.score}</h4>
        <ul className="reason-list">
          {source.heuristic.reasons.map((r) => (
            <li key={r.rule}>
              <span>{r.detail}</span>
              <span className={`delta ${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : 'zero'}`}>
                {formatDelta(r.delta)}
              </span>
            </li>
          ))}
        </ul>

        {history.length > 0 && (
          <>
            <h4>Override history</h4>
            <ul className="history-list">
              {history.map((h) => (
                <li key={h.id} className={`history-item band-${h.band}`}>
                  <span className="band-label">{h.band}</span> by {h.actor}
                  {h.reason ? ` — "${h.reason}"` : ''}
                  <span className="ts">{new Date(h.timestamp).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <h4>Re-rate this source</h4>
        <RerateControl sourceId={sourceId} currentBand={effective.band} />
      </div>
    </>
  );
}
