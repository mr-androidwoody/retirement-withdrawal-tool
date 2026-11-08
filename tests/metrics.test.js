import test from 'node:test';
import assert from 'node:assert/strict';
import { median, stdev, maxDrawdown, summarisePath } from '../engine/metrics.js';
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
    { totalIncomeReal: 100, belowWanted: false, belowMinimum: false, endTotalReal: 900 },
    { totalIncomeReal: 80, belowWanted: true, belowMinimum: false, endTotalReal: 700 },
    { totalIncomeReal: 60, belowWanted: true, belowMinimum: true, endTotalReal: 50 },
  ];
  const s = summarisePath(rows, { startPot: 1000, depletionYear: null, firstWithdrawalReal: 100 });
  assert.equal(s.minIncomeReal, 60);
  assert.equal(s.medianIncomeReal, 80);
  assert.equal(s.yearsBelowWanted, 2);
  assert.equal(s.yearsBelowMinimum, 1);
  assert.equal(s.endReal, 50);
  assert.equal(s.nearlyDepleted, true);
  assert.ok(close(s.maxDrawdown, 0.95));
  assert.ok(close(s.incomeVolatility, stdev([-0.2, -0.25])));
});
