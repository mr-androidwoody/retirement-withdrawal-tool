// Your current mix, typed as pound amounts or as percentages. Pure functions, no DOM.

/**
 * Shares, bonds and cash as fractions from three typed values.
 * unit 'gbp': amounts in pounds, any total (the split is what counts; `total` is returned so
 * the page can compare it with the pot). unit 'pct': percentages that must add up to 100.
 * Returns { equities, bonds, cash, total } or { error } with a plain message.
 */
export function mixFromValues(values, unit) {
  const v = values.map((x) => (Number.isFinite(x) ? x : 0));
  if (values.some((x) => Number.isFinite(x) && x < 0)) {
    return { error: unit === 'gbp' ? 'Amounts must be zero or more.' : 'Mix percentages must be zero or more.' };
  }
  const total = v[0] + v[1] + v[2];
  if (unit === 'gbp') {
    if (total <= 0) return { error: 'Enter how much you hold in shares, bonds and cash.' };
    return { equities: v[0] / total, bonds: v[1] / total, cash: v[2] / total, total };
  }
  if (Math.abs(total - 100) > 0.5) return { error: `Your mix adds up to ${+total.toFixed(1)}%, not 100%.` };
  return { equities: v[0] / 100, bonds: v[1] / 100, cash: v[2] / 100, total };
}

/** Whole percentages that add up to 100 (largest remainders), for showing a split. */
export function wholePercents(mix) {
  const raw = [mix.equities, mix.bonds, mix.cash].map((x) => x * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; out[i] += 1; left -= 1; }
  return out;
}

/**
 * The same split in the other unit, for when the £ / % switch is flipped.
 * To 'pct': whole percentages. To 'gbp': the percentages applied to the pot, rounded to £1.
 * Returns null if the values do not make a usable mix (then the boxes are left as they are).
 */
export function convertValues(values, from, to, pot) {
  if (from === to) return values;
  const mix = mixFromValues(values, from);
  if (mix.error) return null;
  if (to === 'pct') return wholePercents(mix);
  if (!(pot > 0)) return null;
  return [mix.equities, mix.bonds, mix.cash].map((f) => Math.round(f * pot));
}
