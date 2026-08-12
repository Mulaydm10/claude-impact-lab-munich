import { BANDS } from '../lib/bands.js';

export default function RailMark({ band, onClick }) {
  return (
    <button
      type="button"
      className={`rail-mark band-${band}`}
      onClick={onClick}
      title={BANDS[band].label}
      aria-label={`${BANDS[band].label} source — open details`}
    >
      <span className="shape" />
    </button>
  );
}
