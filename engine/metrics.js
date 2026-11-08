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
 * Growth of one pound in the plan's investments, year end by year end, ignoring withdrawals
 * (the value line a statement would show). Starts at 1.
 */
export function investmentIndex(rows) {
  const out = [1];
  for (const r of rows) out.push(out[out.length - 1] * (1 + (r.portfolioReturn ?? 0)));
  return out;
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
    maxDrawdown: maxDrawdown(investmentIndex(rows)),
    firstWithdrawalReal,
  };
}

/**
 * One plan across all windows. A window "fails" if it runs out or income ever falls below
 * the minimum; it "falls short" if it runs out or income ever falls below the income wanted.
 * Worst year is taken over the windows that did not run out (running out is counted
 * separately), and is null if every window ran out.
 */
export function summarisePlan(paths, request) {
  const survivors = paths.filter((p) => !p.depleted);
  const ends = paths.map((p) => p.endReal);
  return {
    windows: paths.length,
    failures: paths.filter((p) => p.depleted).length,
    ranOutOrNearly: paths.filter((p) => p.depleted || p.nearlyDepleted).length,
    nearFailures: paths.filter((p) => p.nearlyDepleted).length,
    cutCount: paths.filter((p) => p.yearsBelowWanted > 0).length,
    belowMinimumCount: paths.filter((p) => p.yearsBelowMinimum > 0).length,
    failingMinimum: paths.filter((p) => p.depleted || p.yearsBelowMinimum > 0).length,
    fallingShort: paths.filter((p) => p.depleted || p.yearsBelowWanted > 0).length,
    typicalIncome: median(paths.map((p) => p.medianIncomeReal)),
    worstIncome: survivors.length ? Math.min(...survivors.map((p) => p.minIncomeReal)) : null,
    worstIncomeAll: Math.min(...paths.map((p) => p.minIncomeReal)),
    medianEnd: median(ends),
    meanEnd: ends.reduce((a, b) => a + b, 0) / ends.length,
    worstEnd: Math.min(...ends),
    worstDrawdown: Math.max(...paths.map((p) => p.maxDrawdown)),
    medianVolatility: median(paths.map((p) => p.incomeVolatility)),
    firstYearWithdrawal: paths[0].firstWithdrawalReal,
    startingRate: request.pot > 0 ? paths[0].firstWithdrawalReal / request.pot : 0,
  };
}
