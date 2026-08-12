import { useEffect, useRef, useState } from 'react';
import { useTrustStore } from '../store/TrustStoreContext.jsx';
import { getEffectiveRating } from '../store/selectors.js';
import { BANDS, rotClassForId } from '../lib/bands.js';

export default function CitationStamp({ sourceId }) {
  const { state, dispatch } = useTrustStore();
  const rating = getEffectiveRating(state, sourceId);
  const band = rating?.band ?? 'orange';
  const rotClass = rotClassForId(sourceId);

  const [displayed, setDisplayed] = useState(band);
  const [exiting, setExiting] = useState(null);
  const prevBand = useRef(band);

  useEffect(() => {
    if (prevBand.current !== band) {
      setExiting(prevBand.current);
      setDisplayed(band);
      prevBand.current = band;
      const t = setTimeout(() => setExiting(null), 300);
      return () => clearTimeout(t);
    }
  }, [band]);

  return (
    <button
      type="button"
      className="stamp-slot"
      onClick={() => dispatch({ type: 'OPEN_DRAWER', sourceId })}
      aria-label={`Source rated ${BANDS[band].label.toLowerCase()} — open details`}
      style={{ background: 'none', border: 'none', padding: 0 }}
    >
      {exiting && (
        <svg className={`stamp band-${exiting} ${rotClass} exit`}>
          <use href={`#${BANDS[exiting].symbolId}`} />
        </svg>
      )}
      <svg key={displayed} className={`stamp band-${displayed} ${rotClass} enter`}>
        <use href={`#${BANDS[displayed].symbolId}`} />
      </svg>
    </button>
  );
}
