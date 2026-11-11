// Comparing two saved plans: which figure is better on a row, and the difference in words.
// Pure functions, no DOM.

/**
 * Which side is better: 'a', 'b' or null when they are the same (or not comparable).
 * better: 'high' or 'low'. `tolerance` treats small gaps (e.g. under £100) as the same.
 */
export function betterSide(a, b, better, tolerance = 0) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !better) return null;
  if (Math.abs(a - b) <= tolerance) return null;
  const aWins = better === 'high' ? a > b : a < b;
  return aWins ? 'a' : 'b';
}

const money = (x) => `£${Math.round(x).toLocaleString('en-GB')}`;
const big = (x) => (x >= 1e6 ? `£${+(x / 1e6).toFixed(1)}m` : money(Math.round(x / 1000) * 1000));

/**
 * The difference between two figures in plain words, naming the plan it favours by label.
 * kind: 'money' (a year), 'big' (a pot), 'count', 'points' (percentage points from fractions),
 * 'years'. Returns 'Same' when within tolerance.
 */
export function diffText(a, b, kind, { labels = ['A', 'B'], tolerance = 0 } = {}) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '';
  const gap = Math.abs(a - b);
  if (gap <= tolerance) return 'Same';
  const higher = a > b ? labels[0] : labels[1];
  const lower = a > b ? labels[1] : labels[0];
  switch (kind) {
    case 'money': return `${money(Math.round(gap / 100) * 100)} more a year in ${higher}`;
    case 'big': return `${big(gap)} more in ${higher}`;
    case 'count': return `${gap} fewer in ${lower}`;
    case 'points': return `${Math.round(gap * 100)} points smaller in ${lower}`;
    case 'years': return `${gap} year${gap === 1 ? '' : 's'} longer in ${higher}`;
    default: return '';
  }
}
