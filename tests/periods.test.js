import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDataset, makeWindows } from '../engine/dataset.js';
import { allowedFailures, withAllowedFailures, rankWindows, pickPeriods, subsetSummary } from '../engine/periods.js';
import { evaluatePlan } from '../engine/search.js';

const ds = validateDataset(JSON.parse(readFileSync(new URL('../data/jst-r6-global-gbp.json', import.meta.url))));
const config = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url)));

test('the risk share becomes a whole number of past retirements', () => {
  assert.equal(allowedFailures(0, 42), 0);
  assert.equal(allowedFailures(0.05, 42), 2); // 2.1
  assert.equal(allowedFailures(0.1, 42), 4); // 4.2
  assert.equal(allowedFailures(0.05, 37), 2); // 1.85
  assert.equal(allowedFailures(0.1, 47), 5); // 4.7
  assert.equal(allowedFailures(0.05, 22), 1);
  assert.equal(withAllowedFailures({ riskShare: 0.1 }, 42).maxFailures, 4);
  assert.equal(withAllowedFailures({ riskShare: 0.1, maxFailures: 1 }, 42).maxFailures, 1, 'an explicit count wins');
});

test('ranking uses the real return of the mix over the first years, worst first', () => {
  const rows = (rs) => rs.map((r, i) => ({ year: 2000 + i, equities: r, bonds: 0, cash: 0, inflation: 0 }));
  const windows = [
    { startYear: 1, rows: rows([0.1, 0.1, -0.5]) },
    { startYear: 2, rows: rows([-0.2, 0.0, 0.9]) },
    { startYear: 3, rows: rows([0.0, 0.0, 0.0]) },
  ];
  const r = rankWindows(windows, { equities: 1, bonds: 0, cash: 0 }, 2);
  assert.deepEqual(r.map((x) => x.rank), [3, 1, 2]);
  assert.ok(Math.abs(r[0].realReturn - 0.1) < 1e-12, 'only the first two years count');
  // Inflation is taken off: a 10% gain with 10% inflation is no real gain.
  const real = rankWindows([{ startYear: 9, rows: [{ year: 1, equities: 0.1, bonds: 0, cash: 0, inflation: 0.1 }] }], { equities: 1 }, 1);
  assert.ok(Math.abs(real[0].realReturn) < 1e-12);
  // Cash earns the bill rate for the share not in shares or bonds.
  const cash = rankWindows([{ startYear: 9, rows: [{ year: 1, equities: 0, bonds: 0, cash: 0.05, inflation: 0 }] }], { equities: 0.6, bonds: 0.3 }, 1);
  assert.ok(Math.abs(cash[0].realReturn - 0.005) < 1e-12);
});

test('the real data puts the early 1970s and late 1960s starts among the worst', () => {
  const windows = makeWindows(ds, 30, config.firstStartYear);
  const r = rankWindows(windows, { equities: 0.6, bonds: 0.3, cash: 0.1 }, 10);
  assert.equal(r.length, 42);
  assert.deepEqual([...new Set(r.map((x) => x.rank))].length, 42, 'every rank used once');
  const worst = pickPeriods(r, 'worst', 10);
  const best = pickPeriods(r, 'best', 10);
  assert.equal(worst.length, 10);
  assert.equal(best.length, 10);
  assert.ok(worst.some((y) => y >= 1965 && y <= 1974), `worst: ${worst}`);
  assert.ok(!worst.some((y) => best.includes(y)));
  assert.equal(pickPeriods(r, 'all', 10).length, 42);
});

test('a subset summary counts only the chosen past retirements', () => {
  const windows = makeWindows(ds, 30, config.firstStartYear);
  const request = { pot: 500000, years: 30, wanted: 30000, minimum: 25000, incomeChange: null, otherIncome: [], maxFailures: 2, annualFee: 0.0025 };
  const plan = { index: 0, strategy: 'constant-real', params: { rate: 0.06 }, mix: { equities: 0.6 }, cashBuffer: { years: 0 } };
  const all = evaluatePlan(plan, windows, request, config.thresholds);
  const years = [1965, 1966, 1972, 1973];
  const some = subsetSummary(all, years, request);
  assert.equal(some.windows, 4);
  const byHand = all.paths.filter((p) => years.includes(p.startYear)).filter((p) => p.depleted).length;
  assert.equal(some.failures, byHand);
  assert.equal(subsetSummary(all, [1800], request), null);
});
