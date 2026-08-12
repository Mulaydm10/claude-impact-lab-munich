import ChatPanel from './ChatPanel.jsx';
import ReportView from './ReportView.jsx';
import TrustLedgerRail from './TrustLedgerRail.jsx';
import SourceDrawer from './SourceDrawer.jsx';
import { useTrustStore } from '../store/TrustStoreContext.jsx';
import { getCurrentTopic } from '../store/selectors.js';
import logoMark from '../assets/logo-mark.png';

function StampDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <filter id="rough" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="5.5" />
        </filter>
        <symbol id="stamp-check" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="2.6" />
          <path d="M12 20.5l5.5 5.5L29 14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="stamp-caution" viewBox="0 0 40 40">
          <path d="M20 6 L35.5 32.5 L4.5 32.5 Z" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
          <line x1="20" y1="16" x2="20" y2="24" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="20" cy="27.7" r="1.5" fill="currentColor" />
        </symbol>
        <symbol id="stamp-flag" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="2.6" />
          <line x1="14" y1="14" x2="26" y2="26" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          <line x1="26" y1="14" x2="14" y2="26" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </symbol>
      </defs>
    </svg>
  );
}

export default function AppShell() {
  const { state } = useTrustStore();
  const topic = getCurrentTopic(state);

  return (
    <div className="app-shell">
      <StampDefs />
      <div className="topbar">
        <div className="wordmark">
          <img src={logoMark} alt="" className="logo-mark" />
          <span>
            Trustifier
            <small>Trust, but check</small>
          </span>
        </div>
        {topic && <span className="topic-title">{topic.title}</span>}
      </div>
      <div className="app-body">
        <ChatPanel />
        <ReportView />
        <TrustLedgerRail />
      </div>
      <SourceDrawer />
    </div>
  );
}
