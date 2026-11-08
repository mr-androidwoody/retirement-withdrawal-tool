import test from 'node:test';
import assert from 'node:assert/strict';
import { median, stdev, maxDrawdown, worstFall, summarisePath, summarisePlan } from '../engine/metrics.js';
import { close } from './helpers.js';

test('median of odd and even lists', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
});

test('population standard deviation', () => {
  assert.ok(close(stdev([2, 4, 4, 4, 5, 5, 7, 9]), 2));
});

test('max drawdown is the largest fall from a high point', () => {
  assert.ok(close(maxDrawdown([100, 120, 90, 130, 65, 140]), 0.5));
  assert.equal(maxDrawdown([100, 110, 120]), 0);
});

test('a path summary counts years and reads the end value', () => {
  const rows = [
    { totalIncomeReal: 100, belowWanted: false, belowMinimum: false, endTotalReal: 900, portfolioReturn: 0.2 },
    { totalIncomeReal: 80, belowWanted: true, belowMinimum: false, endTotalReal: 700, portfolioReturn: -0.5 },
    { totalIncomeReal: 60, belowWanted: true, belowMinimum: true, endTotalReal: 50, portfolioReturn: 0.1 },
  ];
  const s = summarisePath(rows, { startPot: 1000, depletionYear: null, firstWithdrawalReal: 100 });
  assert.equal(s.minIncomeReal, 60);
  assert.equal(s.medianIncomeReal, 80);
  assert.equal(s.yearsBelowWanted, 2);
  assert.equal(s.yearsBelowMinimum, 1);
  assert.equal(s.endReal, 50);
  assert.equal(s.nearlyDepleted, true);
  // Investments: 1 -> 1.2 -> 0.6 -> 0.66, so the biggest fall is 50%, whatever was withdrawn.
  assert.ok(close(s.maxDrawdown, 0.5));
  assert.ok(close(s.incomeVolatility, stdev([-0.2, -0.25])));
});

test('a plan summary counts failures, shortfalls and takes worst year over survivors', () => {
  const path = (o) => ({ depleted: false, nearlyDepleted: false, yearsBelowWanted: 0, yearsBelowMinimum: 0,
    medianIncomeReal: 100, minIncomeReal: 90, endReal: 1000, maxDrawdown: 0.2, incomeVolatility: 0.01,
    firstWithdrawalReal: 40, ...o });
  const s = summarisePlan([
    path({}),
    path({ yearsBelowWanted: 3, minIncomeReal: 70 }),
    path({ yearsBelowWanted: 5, yearsBelowMinimum: 1, minIncomeReal: 50 }),
    path({ depleted: true, minIncomeReal: 0, endReal: 0, maxDrawdown: 1 }),
    path({ nearlyDepleted: true, endReal: 10 }),
  ], { pot: 1000 });
  assert.equal(s.windows, 5);
  assert.equal(s.failures, 1);
  assert.equal(s.ranOutOrNearly, 2);
  assert.equal(s.cutCount, 2);
  assert.equal(s.failingMinimum, 2);
  assert.equal(s.fallingShort, 3);
  assert.equal(s.worstIncome, 50);
  assert.equal(s.worstIncomeAll, 0);
  assert.equal(s.medianEnd, 1000);
  assert.equal(s.startingRate, 0.04);
});

test('the worst fall says where it started and ended, and matches maxDrawdown', () => {
  const s = [1, 1.2, 0.9, 1.1, 0.6, 1.5, 1.4];
  const w = worstFall(s);
  assert.equal(w.peak, 1);
  assert.equal(w.trough, 4);
  close(w.fall, 0.5);
  close(w.fall, maxDrawdown(s));
  assert.deepEqual(worstFall([1, 1.1, 1.2]), { fall: 0, peak: 0, trough: 0 });
});
