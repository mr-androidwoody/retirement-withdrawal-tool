import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGrid, strategySettings, runSearch, whatIf, statusOf, currentFromMix } from '../engine/search.js';

const dataset = JSON.parse(readFileSync(new URL('../data/jst-r6-global-gbp.json', import.meta.url)));
const config = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url)));
const preset = (id) => ({ ...config.defaults, ...config.presets.find((p) => p.id === id).values });

const typical = runSearch({ dataset, config, request: preset('typical') });

test('the grid has 22 strategy settings and 440 plans, each with its own index', () => {
  assert.equal(strategySettings(config).length, 22);
  const grid = buildGrid(config);
  assert.equal(grid.length, 440);
  assert.deepEqual(grid.map((p) => p.gridIndex), [...Array(440).keys()]);
});

test('status: meets both, meets minimum, or does not meet', () => {
  const req = { maxFailures: 1 };
  assert.equal(statusOf({ fallingShort: 1, failingMinimum: 1 }, req), 'meets-both');
  assert.equal(statusOf({ fallingShort: 3, failingMinimum: 1 }, req), 'meets-minimum');
  assert.equal(statusOf({ fallingShort: 3, failingMinimum: 2 }, req), 'does-not-meet');
});

test('only eligible plans appear as options', () => {
  assert.ok(typical.rows.length > 0);
  for (const row of typical.rows) assert.notEqual(row.result.status, 'does-not-meet');
});

test('every row label appears exactly once', () => {
  const labels = typical.rows.flatMap((r) => r.labels);
  assert.deepEqual([...labels].sort(), ['Highest typical income', 'Most left behind', 'Recommended', 'Safest income']);
});

test('most left behind never cuts income when a plan that never cuts exists', () => {
  for (const id of ['typical', 'change']) {
    const r = id === 'typical' ? typical : runSearch({ dataset, config, request: preset(id) });
    const row = r.rows.find((x) => x.labels.includes('Most left behind'));
    assert.equal(row.result.status, 'meets-both', id);
  }
});

test('every strategy appears either as an option or in the comparison', () => {
  const shown = new Set([...typical.rows.map((r) => r.result.plan.strategy), ...typical.others.map((o) => o.strategy)]);
  assert.equal(shown.size, 4);
});

test('asking for too much gives no options and one nearest miss per approach, closest first', () => {
  const r = runSearch({ dataset, config, request: preset('too-much') });
  assert.equal(r.rows.length, 0);
  assert.equal(r.closest.length, 4);
  assert.equal(new Set(r.closest.map((c) => c.plan.strategy)).size, 4);
  for (let i = 1; i < r.closest.length; i += 1) assert.ok(r.closest[i - 1].failingMinimum <= r.closest[i].failingMinimum);
  // The nearest misses replace the "other approaches" list, so nothing shows twice.
  assert.equal(r.others.length, 0);
});

test('the current mix adds "your mix as it is now" rows, one per cash rule', () => {
  const current = currentFromMix(1000000, { equities: 0.6, bonds: 0.3, cash: 0.1 });
  assert.equal(current.cashBuffer, 100000);
  assert.ok(Math.abs(current.equitiesShare - 2 / 3) < 1e-12);
  const request = { ...config.defaults, pot: 1000000, wanted: 40000, minimum: 32000 };
  const r = runSearch({ dataset, config, request, current });
  assert.equal(r.plansTried, 440 + 2 * 22);
  assert.deepEqual(r.currentRows.map((x) => x.cashRule), ['spend-first', 'flexible']);
  for (const row of r.currentRows) {
    const plan = row.result.plan;
    assert.equal(plan.cashBuffer.amount, 100000);
    assert.ok(Math.abs(plan.mix.equities - 2 / 3) < 1e-12);
    assert.equal(plan.fromCurrent, true);
    assert.deepEqual(plan.currentMix, { equities: 0.6, bonds: 0.3, cash: 0.1 });
    assert.equal(plan.cashRule, row.cashRule);
  }
  assert.deepEqual(r.currentRows[1].result.plan.reserve, config.cashReserve);
});

test('an all-cash mix does not break the invested share', () => {
  assert.equal(currentFromMix(100, { equities: 0, bonds: 0, cash: 1 }).equitiesShare, 0);
});

test('what-if varies only the chosen dimension', () => {
  const plan = typical.rows[0].result.plan;
  const out = whatIf({ dataset, config, request: preset('typical'), plan, dimension: 'cashBuffer', values: [0, 1, 2, 3] });
  assert.deepEqual(out.map((x) => x.value), [0, 1, 2, 3]);
  for (const x of out) {
    assert.equal(x.result.plan.strategy, plan.strategy);
    assert.equal(x.result.plan.mix.equities, plan.mix.equities);
  }
});

test('the search is deterministic', () => {
  const again = runSearch({ dataset, config, request: preset('typical') });
  const pick = (r) => JSON.stringify(r.rows.map((x) => [x.labels, x.result.plan, x.result.typicalIncome, x.result.medianEnd]));
  assert.equal(pick(again), pick(typical));
});

test('each strategy is also tried at the rate that pays exactly the income wanted', () => {
  const request = { ...config.defaults, pot: 1843050, wanted: 60000, minimum: 50000 };
  const pin = 60000 / 1843050;
  const settings = strategySettings(config, request);
  assert.equal(settings.length, 22 + 5); // one extra rate for each strategy; floor and ceiling has two floors
  const pinned = settings.filter((s) => s.params.pinned);
  assert.equal(pinned.length, 5);
  for (const s of pinned) assert.ok(Math.abs(s.params.rate - pin) < 1e-12);
  // A wanted income that is already a preset rate adds nothing.
  assert.equal(strategySettings(config, { ...request, pot: 500000, wanted: 22500 }).length, 22);
});

test('the pinned rate leaves out earnings but counts lasting pensions in year 1', () => {
  const base = { ...config.defaults, pot: 1000000, wanted: 50000, minimum: 40000 };
  const withJob = { ...base, otherIncome: [{ amount: 20000, fromYear: 1, toYear: 3, kind: 'earned' }] };
  const withPension = { ...base, otherIncome: [{ amount: 10000, fromYear: 1 }] };
  assert.equal(strategySettings(config, withJob).find((s) => s.params.pinned).params.rate, 0.05);
  assert.equal(strategySettings(config, withPension).find((s) => s.params.pinned).params.rate, 0.04);
});

test('keep my mix: every option uses the current mix, and there is no separate box', () => {
  const current = currentFromMix(1843050, { equities: 0.6, bonds: 0.3, cash: 0.1 });
  const request = { ...config.defaults, pot: 1843050, wanted: 60000, minimum: 50000 };
  const r = runSearch({ dataset, config, request, current, keepMix: true });
  assert.equal(r.keepMix, true);
  assert.equal(r.plansTried, 2 * 27);
  assert.equal(r.currentRows.length, 0);
  for (const row of r.rows) {
    assert.equal(row.result.plan.fromCurrent, true);
    assert.equal(row.result.plan.cashBuffer.amount, current.cashBuffer);
  }
});
