export const BANDS = {
  green: { label: 'Verified', symbolId: 'stamp-check' },
  orange: { label: 'Caution', symbolId: 'stamp-caution' },
  red: { label: 'Flagged', symbolId: 'stamp-flag' },
};

const ROT_CLASSES = ['rot-a', 'rot-b', 'rot-c'];

/** Deterministic per-source rotation so stamps read as hand-stamped, not uniform. */
export function rotClassForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % ROT_CLASSES.length;
  }
  return ROT_CLASSES[hash];
}
