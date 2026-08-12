import { useTrustStore } from '../store/TrustStoreContext.jsx';
import { getVisibleClaims } from '../store/selectors.js';
import ClaimBlock from './ClaimBlock.jsx';
import VerdictStamp from './VerdictStamp.jsx';

export default function ReportView() {
  const { state } = useTrustStore();
  const claims = getVisibleClaims(state);

  if (!state.report) {
    return (
      <div className="report-view">
        <p style={{ color: 'var(--ink-60)' }}>Pick a topic in the chat to generate a report.</p>
      </div>
    );
  }

  return (
    <div className="report-view">
      <VerdictStamp />
      <div className="band-legend">
        <span className="item">
          <svg className="stamp band-green"><use href="#stamp-check" /></svg> Verified (green)
        </span>
        <span className="item">
          <svg className="stamp band-orange"><use href="#stamp-caution" /></svg> Caution (orange)
        </span>
        <span className="item">
          <svg className="stamp band-red"><use href="#stamp-flag" /></svg> Flagged (red)
        </span>
      </div>
      {claims.map((claim) => (
        <ClaimBlock key={claim.id} claim={claim} />
      ))}
    </div>
  );
}
