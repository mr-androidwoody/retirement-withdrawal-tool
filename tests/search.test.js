import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGrid, strategySettings, runSearch, whatIf, statusOf } from '../engine/search.js';
import { parseSnapshot } from '../engine/snapshot.js';

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

test('asking for too much gives no options and three distinct closest plans', () => {
  const r = runSearch({ dataset, config, request: preset('too-much') });
  assert.equal(r.rows.length, 0);
  assert.equal(r.closest.length, 3);
  const keys = r.closest.map((c) => `${c.plan.strategy}:${JSON.stringify(c.plan.params)}`);
  assert.equal(new Set(keys).size, 3);
});

test('a pasted snapshot adds "your portfolio as it is now" with its own mix and cash', () => {
  const P = '£';
  const snap = parseSnapshot([
    `Portfolio Snapshot - 08 Nov 2026`,
    `Net Portfolio Value: ${P}1,843,050`,
    `Total Portfolio (gross): ${P}1,873,468`,
    `Equity: ${P}1,135,462 (60.6% of portfolio)`,
    `  Bonds: ${P}249,741 (13.3% of portfolio)`,
    `  Cash and money market: ${P}488,265`,
  ].join('\n'));
  assert.equal(snap.ok, true);
  const request = { ...config.defaults, pot: snap.net, wanted: 70000, minimum: 55000 };
  const r = runSearch({ dataset, config, request, snapshot: snap });
  assert.equal(r.plansTried, 440 + 2 * 22);
  assert.deepEqual(r.snapshotRows.map((x) => x.cashRule), ['spend-first', 'flexible']);
  for (const row of r.snapshotRows) {
    const plan = row.result.plan;
    assert.equal(plan.cashBuffer.amount, 457847);
    assert.ok(Math.abs(plan.mix.equities - 0.8197) < 0.0001);
    assert.equal(plan.fromSnapshot, true);
    assert.equal(plan.cashRule, row.cashRule);
  }
  assert.deepEqual(r.snapshotRows[1].result.plan.reserve, config.cashReserve);
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
