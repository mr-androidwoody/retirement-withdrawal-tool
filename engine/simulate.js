// One plan through one historical window, a year at a time. Pure and deterministic.

import { getStrategy } from './strategies.js';
import { buildProfile } from './profile.js';
import { summarisePath } from './metrics.js';

/**
 * plan    { strategy, params, mix: { equities }, cashBuffer: { years } | { amount } }
 * window  { startYear, rows: [{ year, equities, bonds, cash, inflation }] }
 * request { pot, years, wanted, minimum, incomeChange, otherIncome, annualFee }
 * options { rows: true } to include the year rows; { thresholds } from config
 *
 * Order each year: income paid at the start (cash first, then investments), then the
 * money left grows for the year, then the fee is taken and the investments are
 * rebalanced to the mix. Real figures are in money of the retirement's first year.
 */
export function simulate(plan, window, request, options = {}) {
  const n = request.years;
  if (window.rows.length < n) throw new Error('Window is shorter than the retirement.');
  const strategy = getStrategy(plan.strategy);
  const profile = buildProfile(request);
  const fee = request.annualFee || 0;
  const eq = plan.mix.equities;
  const tolerance = options.thresholds?.incomeTolerance ?? 1;

  // Cash buffer: a number of years of the planned first-year withdrawal, or an amount.
  const plannedFirst = Math.max(0, profile.wanted[0] - profile.other[0]);
  let cash = plan.cashBuffer?.amount ?? (plan.cashBuffer?.years || 0) * plannedFirst;
  cash = Math.min(Math.max(0, cash), request.pot);
  let invested = request.pot - cash;

  let index = 1;
  let state = null;
  let prevReturn = null;
  let prevInflation = null;
  let depletionYear = null;
  let firstWithdrawalReal = null;
  const rows = [];

  for (let t = 0; t < n; t += 1) {
    const market = window.rows[t];
    const startInvested = invested;
    const startCash = cash;
    const potStart = invested + cash;
    const other = profile.other[t] * index;

    const decision = strategy.withdraw(plan.params, state, {
      t, years: n, pot: potStart, index, prevReturn, prevInflation, profile,
    });
    const target = Math.max(0, decision.amount);
    const actual = Math.min(target, potStart);
    if (t === 0) firstWithdrawalReal = target;
    if (actual < target - 1e-6 && depletionYear === null) depletionYear = t + 1;

    const cashUsed = Math.min(cash, actual);
    cash -= cashUsed;
    invested = Math.max(0, invested - (actual - cashUsed));

    const afterWithdrawal = invested + cash;
    const investedReturn = eq * market.equities + (1 - eq) * market.bonds;
    invested *= (1 + investedReturn) * (1 - fee);
    cash *= (1 + market.cash) * (1 - fee);
    const potEnd = invested + cash;
    const portfolioReturn = afterWithdrawal > 0 ? potEnd / afterWithdrawal - 1 : 0;
    const nextIndex = index * (1 + market.inflation);
    const incomeReal = (actual + other) / index;

    rows.push({
      yearIndex: t + 1,
      calendarYear: market.year,
      inflationIndex: index,
      startInvested,
      startCash,
      returnEquities: market.equities,
      returnBonds: market.bonds,
      returnCash: market.cash,
      portfolioReturn,
      inflation: market.inflation,
      guaranteedIncome: other,
      targetWithdrawal: target,
      actualWithdrawal: actual,
      cashUsed,
      totalIncomeReal: incomeReal,
      wantedReal: profile.wanted[t],
      minimumReal: profile.minimum[t],
      belowWanted: incomeReal < profile.wanted[t] - tolerance,
      belowMinimum: incomeReal < profile.minimum[t] - tolerance,
      endInvested: invested,
      endCash: cash,
      endTotalReal: potEnd / nextIndex,
      depleted: depletionYear !== null,
      events: decision.events,
    });

    state = decision.state;
    prevReturn = portfolioReturn;
    prevInflation = market.inflation;
    index = nextIndex;
  }

  const summary = summarisePath(rows, {
    startPot: request.pot,
    depletionYear,
    firstWithdrawalReal,
    nearlyRanOutYears: options.thresholds?.nearlyRanOutYears ?? 1,
  });
  summary.startYear = window.startYear;
  return options.rows ? { ...summary, rows } : summary;
}
