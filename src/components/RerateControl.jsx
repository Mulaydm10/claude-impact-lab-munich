import { useState } from 'react';
import { useTrustStore } from '../store/TrustStoreContext.jsx';
import { BANDS } from '../lib/bands.js';

const BAND_ORDER = ['green', 'orange', 'red'];

export default function RerateControl({ sourceId, currentBand }) {
  const { state, dispatch } = useTrustStore();
  const [band, setBand] = useState(currentBand);
  const [actor, setActor] = useState(state.lastActor || '');
  const [reason, setReason] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (!actor.trim()) return;
    dispatch({ type: 'RATE_SOURCE', sourceId, band, actor: actor.trim(), reason: reason.trim() });
    setReason('');
  }

  return (
    <form className="rerate-control" onSubmit={handleSubmit}>
      <div className="band-picker">
        {BAND_ORDER.map((b) => (
          <button
            type="button"
            key={b}
            className={`band-button band-${b}${band === b ? ' selected' : ''}`}
            onClick={() => setBand(b)}
          >
            <span className="shape" />
            {BANDS[b].label}
          </button>
        ))}
      </div>
      <label htmlFor="actor-input">Acting as</label>
      <input
        id="actor-input"
        type="text"
        value={actor}
        onChange={(e) => setActor(e.target.value)}
        placeholder="e.g. Domain expert — J. Kraus"
        required
      />
      <label htmlFor="reason-input">Reason (optional)</label>
      <textarea
        id="reason-input"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why does this rating need to change?"
      />
      <button type="submit">Save rating</button>
    </form>
  );
}
