import { useTrustStore } from '../store/TrustStoreContext.jsx';
import { getVerdictPercent } from '../store/selectors.js';

export default function VerdictStamp() {
  const { state } = useTrustStore();
  const percent = getVerdictPercent(state);
  if (percent === null) return null;

  const band = percent >= 70 ? 'green' : percent >= 40 ? 'orange' : 'red';

  return (
    <div className={`verdict-stamp band-${band}`}>
      <span>Verdict</span>
      <b>{percent}%</b>
      <span>Verified</span>
    </div>
  );
}
