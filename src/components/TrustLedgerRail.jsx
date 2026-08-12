import { useTrustStore } from '../store/TrustStoreContext.jsx';
import { getLedgerSources } from '../store/selectors.js';
import RailMark from './RailMark.jsx';

export default function TrustLedgerRail() {
  const { state, dispatch } = useTrustStore();
  const sources = getLedgerSources(state);

  return (
    <div className="ledger-rail" aria-label="Trust ledger">
      {sources.map(({ sourceId, band }) => (
        <RailMark key={sourceId} band={band} onClick={() => dispatch({ type: 'OPEN_DRAWER', sourceId })} />
      ))}
    </div>
  );
}
