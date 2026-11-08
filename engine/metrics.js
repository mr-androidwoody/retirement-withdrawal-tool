// Measures of one path (one plan in one window). Plan-level measures come in phase 3.

export function median(values) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function stdev(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

/** Largest peak-to-trough fall, as a fraction, in a series of values (first value = start). */
export function maxDrawdown(series) {
  let peak = -Infinity;
  let worst = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.max(worst, 1 - v / peak);
  }
  return worst;
}

/**
 * rows: the year rows from simulate().
 * Nearly ran out = less than `nearlyRanOutYears` of the planned first-year withdrawal left
 * at the end, in real terms, without having run out.
 */
export function summarisePath(rows, { startPot, depletionYear, firstWithdrawalReal, nearlyRanOutYears = 1 }) {
  const incomes = rows.map((r) => r.totalIncomeReal);
  const changes = [];
  for (let i = 1; i < incomes.length; i += 1) {
    if (incomes[i - 1] > 0) changes.push(incomes[i] / incomes[i - 1] - 1);
  }
  const endReal = rows.length ? rows[rows.length - 1].endTotalReal : startPot;
  const depleted = depletionYear !== null;
  return {
    depleted,
    depletionYear,
    nearlyDepleted: !depleted && firstWithdrawalReal > 0 && endReal < nearlyRanOutYears * firstWithdrawalReal,
    minIncomeReal: Math.min(...incomes),
    medianIncomeReal: median(incomes),
    yearsBelowWanted: rows.filter((r) => r.belowWanted).length,
    yearsBelowMinimum: rows.filter((r) => r.belowMinimum).length,
    incomeVolatility: stdev(changes),
    endReal,
    maxDrawdown: maxDrawdown([startPot, ...rows.map((r) => r.endTotalReal)]),
    firstWithdrawalReal,
  };
}
