import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixFromValues, wholePercents, convertValues } from '../ui/mix.js';

test('pound amounts give the split, whatever they add up to', () => {
  const m = mixFromValues([650000, 220000, 130000], 'gbp');
  assert.equal(m.total, 1000000);
  assert.ok(Math.abs(m.equities - 0.65) < 1e-12 && Math.abs(m.bonds - 0.22) < 1e-12 && Math.abs(m.cash - 0.13) < 1e-12);
  const off = mixFromValues([650000, 220000, 140000], 'gbp');
  assert.equal(off.total, 1010000);
  assert.ok(Math.abs(off.equities + off.bonds + off.cash - 1) < 1e-12);
  // A blank box counts as nothing held.
  assert.equal(mixFromValues([500000, NaN, NaN], 'gbp').equities, 1);
});

test('bad pound amounts are refused with a plain message', () => {
  assert.match(mixFromValues([0, 0, 0], 'gbp').error, /Enter how much/);
  assert.match(mixFromValues([NaN, NaN, NaN], 'gbp').error, /Enter how much/);
  assert.match(mixFromValues([100, -5, 0], 'gbp').error, /zero or more/);
});

test('percentages must add up to 100, as before', () => {
  assert.equal(mixFromValues([60, 30, 10], 'pct').bonds, 0.3);
  assert.match(mixFromValues([60, 30, 20], 'pct').error, /adds up to 110%/);
  assert.match(mixFromValues([60, -30, 70], 'pct').error, /zero or more/);
});

test('whole percentages always add up to 100', () => {
  assert.deepEqual(wholePercents({ equities: 650 / 1010, bonds: 220 / 1010, cash: 140 / 1010 }), [64, 22, 14]);
  assert.deepEqual(wholePercents({ equities: 1 / 3, bonds: 1 / 3, cash: 1 / 3 }), [34, 33, 33]);
  assert.deepEqual(wholePercents({ equities: 1, bonds: 0, cash: 0 }), [100, 0, 0]);
});

test('flipping between pounds and percentages keeps the split', () => {
  assert.deepEqual(convertValues([650000, 220000, 130000], 'gbp', 'pct', 1000000), [65, 22, 13]);
  assert.deepEqual(convertValues([60, 30, 10], 'pct', 'gbp', 1843051), [1105831, 552915, 184305]);
  assert.equal(convertValues([60, 30, 20], 'pct', 'gbp', 1000000), null);
  assert.equal(convertValues([60, 30, 10], 'pct', 'gbp', NaN), null);
  const same = [1, 2, 3];
  assert.equal(convertValues(same, 'gbp', 'gbp', 1), same);
});
