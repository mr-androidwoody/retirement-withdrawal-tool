// Past retirements as a set: how many may run out, how bad or good each start was, and
// figures for a chosen subset. Pure functions, no I/O.

import { summarisePlan } from './metrics.js';

/**
 * How many past retirements may run out, from a share ("about 1 in 20" is 0.05) and the
 * number of retirements tested. Rounded to the nearest whole number.
 */
export function allowedFailures(share, count) {
  if (!Number.isFinite(share) || share <= 0) return 0;
  return Math.round(share * count);
}

/** The request with maxFailures worked out from riskShare, unless maxFailures is already set. */
export function withAllowedFailures(request, count) {
  if (Number.isInteger(request.maxFailures)) return request;
  return { ...request, maxFailures: allowedFailures(request.riskShare ?? 0, count) };
}

/**
 * Rank every start year by the real return (after inflation) of one mix over its first
 * `years` years, worst first. Early losses do most of the damage to a retirement, so this
 * ranks the starts that caused trouble. The ranking depends only on the markets and the mix,
 * never on a withdrawal plan, so the same worst and best periods apply to every option.
 *
 * mix: { equities, bonds, cash } shares that add up to 1 (cash earns the bill rate).
 * Returns [{ startYear, realReturn, rank }] with rank 1 the worst, in start-year order.
 * realReturn is the yearly average (geometric) over the years ranked.
 */
export function rankWindows(windows, mix, years = 10) {
  const eq = mix.equities ?? 0;
  const bd = mix.bonds ?? 0;
  const cs = mix.cash ?? Math.max(0, 1 - eq - bd);
  const scored = windows.map((w) => {
    const span = w.rows.slice(0, Math.min(years, w.rows.length));
    let growth = 1;
    for (const r of span) {
      const nominal = eq * r.equities + bd * r.bonds + cs * r.cash;
      growth *= (1 + nominal) / (1 + r.inflation);
    }
    return { startYear: w.startYear, realReturn: growth ** (1 / span.length) - 1 };
  });
  const order = [...scored].sort((a, b) => a.realReturn - b.realReturn || a.startYear - b.startYear);
  order.forEach((s, i) => { s.rank = i + 1; });
  return scored;
}

/** Start years of the worst or best `size` periods from a ranking. */
export function pickPeriods(ranking, which, size) {
  if (which === 'worst') return ranking.filter((r) => r.rank <= size).map((r) => r.startYear);
  if (which === 'best') return ranking.filter((r) => r.rank > ranking.length - size).map((r) => r.startYear);
  return ranking.map((r) => r.startYear);
}

/**
 * A plan's figures over some of the past retirements only. `result` is a plan result from
 * the search (it keeps one path per past retirement).
 */
export function subsetSummary(result, startYears, request) {
  const keep = new Set(startYears);
  const paths = result.paths.filter((p) => keep.has(p.startYear));
  if (!paths.length) return null;
  return summarisePlan(paths, request);
}
