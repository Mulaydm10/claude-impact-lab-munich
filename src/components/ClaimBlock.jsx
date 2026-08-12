import CitationStamp from './CitationStamp.jsx';

export default function ClaimBlock({ claim }) {
  return (
    <div className="claim-block">
      <CitationStamp sourceId={claim.sourceId} />
      <p>{claim.text}</p>
    </div>
  );
}
