/**
 * Shared UI helpers for the OOTP-style rating heatmap.
 * Ratings are on a 1-80 scale; cells get a tinted background + colored text
 * so dense tables read like a scouting grid at a glance.
 */

export function ratingColor(value: number): string {
  if (value >= 70) return 'var(--r-elite)';
  if (value >= 62) return 'var(--r-great)';
  if (value >= 54) return 'var(--r-good)';
  if (value >= 44) return 'var(--r-avg)';
  if (value >= 34) return 'var(--r-below)';
  return 'var(--r-poor)';
}

/** Raw hex equivalents (for places that can't resolve CSS vars, e.g. tinting). */
const HEX: [number, string][] = [
  [70, '#34d399'],
  [62, '#6ee7a8'],
  [54, '#a3e635'],
  [44, '#fbbf24'],
  [34, '#fb923c'],
  [0, '#f87171'],
];

export function ratingHex(value: number): string {
  for (const [threshold, hex] of HEX) {
    if (value >= threshold) return hex;
  }
  return '#f87171';
}

/** Inline style for a heatmap rating cell: tinted bg + colored bold text. */
export function ratingCell(value: number): React.CSSProperties {
  const hex = ratingHex(value);
  return {
    color: hex,
    background: `${hex}1f`, // ~12% alpha tint
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'center',
  };
}

export function ratingLabel(value: number): string {
  if (value >= 70) return 'Elite';
  if (value >= 62) return 'Great';
  if (value >= 54) return 'Good';
  if (value >= 44) return 'Average';
  if (value >= 34) return 'Fringe';
  return 'Poor';
}
