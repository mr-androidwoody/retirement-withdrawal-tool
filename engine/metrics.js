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
 * The largest fall with where it happened: { fall, peak, trough } where peak and trough are
 * positions in the series (0 = start). fall is 0, with peak = trough = 0, if it never fell.
 */
export function worstFall(series) {
  let peakAt = 0;
  let best = { fall: 0, peak: 0, trough: 0 };
  series.forEach((v, i) => {
    if (v > series[peakAt]) peakAt = i;
    const fall = series[peakAt] > 0 ? 1 - v / series[peakAt] : 0;
    if (fall > best.fall) best = { fall, peak: peakAt, trough: i };
  });
  return best;
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
 * Stretches of years with the same wanted and minimum income, so a step-down the user entered
 * (say, less from age 75) is measured against its own targets: [{ from, to, wanted, minimum }],
 * with from and to as row positions (to inclusive).
 */
export function stagesOf(rows) {
  const stages = [];
  rows.forEach((r, t) => {
    const last = stages[stages.length - 1];
    if (last && last.wanted === r.wantedReal && last.minimum === r.minimumReal) last.to = t;
    else stages.push({ from: t, to: t, wanted: r.wantedReal, minimum: r.minimumReal });
  });
  return stages;
}

/**
 * The lowest year of income, and where: { income, at, minimum }. When several years tie
 * (within £1), the one closest to the minimum for its year (by more than £1), else the first.
 */
export function lowestYear(rows) {
  if (!rows.length) return { income: 0, at: 0, minimum: 0 };
  const lowest = Math.min(...rows.map((r) => r.totalIncomeReal));
  let at = -1;
  rows.forEach((r, t) => {
    if (r.totalIncomeReal > lowest + 1) return;
    if (at < 0 || r.totalIncomeReal - (r.minimumReal ?? 0) < rows[at].totalIncomeReal - (rows[at].minimumReal ?? 0) - 1) at = t;
  });
  return { income: rows[at].totalIncomeReal, at, minimum: rows[at].minimumReal };
}

/**
 * rows: the year rows from simulate().
 * Nearly ran out = less than `nearlyRanOutYears` of the planned first-year withdrawal left
 * at the end, in real terms, without having run out.
 */
export function summarisePath(rows, { startPot, depletionYear, firstWithdrawalReal, nearlyRanOutYears = 1 }) {
  const incomes = rows.map((r) => r.totalIncomeReal);
  // Year-to-year change in income relative to the income planned for each year, so a
  // step-down the user entered is not counted as a change.
  const relative = rows.map((r) => r.totalIncomeReal / (r.wantedReal > 0 ? r.wantedReal : 1));
  const changes = [];
  for (let i = 1; i < relative.length; i += 1) {
    if (relative[i - 1] > 0) changes.push(relative[i] / relative[i - 1] - 1);
  }
  const endReal = rows.length ? rows[rows.length - 1].endTotalReal : startPot;
  const depleted = depletionYear !== null;
  const low = lowestYear(rows);
  const stages = stagesOf(rows).map((st) => ({ ...st, median: median(incomes.slice(st.from, st.to + 1)) }));
  return {
    depleted,
    depletionYear,
    nearlyDepleted: !depleted && firstWithdrawalReal > 0 && endReal < nearlyRanOutYears * firstWithdrawalReal,
    minIncomeReal: Math.min(...incomes),
    medianIncomeReal: median(incomes),
    lowestAt: low.at,
    lowestMinimum: low.minimum,
    stages,
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
  // The worst year over survivors, and the minimum that applied in that year (ties: the
  // one closest to its minimum by more than £1, else the earliest), so a step-down is
  // compared with the right minimum.
  const lowest = survivors.length ? Math.min(...survivors.map((p) => p.minIncomeReal)) : 0;
  const gapOf = (p) => p.minIncomeReal - (p.lowestMinimum ?? 0);
  let worstPath = null;
  for (const p of survivors.filter((x) => x.minIncomeReal <= lowest + 1)) {
    if (!worstPath || gapOf(p) < gapOf(worstPath) - 1
      || (gapOf(p) <= gapOf(worstPath) + 1 && p.lowestAt < worstPath.lowestAt)) worstPath = p;
  }
  // Typical spending in each stage: the median across past retirements of each one's
  // median in that stage. Every path has the same stages (they come from the request).
  const typicalByStage = (paths[0].stages || []).map((st, i) => ({
    from: st.from, to: st.to, wanted: st.wanted, minimum: st.minimum,
    typical: median(paths.map((p) => p.stages[i].median)),
  }));
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
    typicalByStage,
    worstIncome: survivors.length ? Math.min(...survivors.map((p) => p.minIncomeReal)) : null,
    worstIncomeAt: worstPath ? worstPath.lowestAt : null,
    worstIncomeMinimum: worstPath ? worstPath.lowestMinimum : null,
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
