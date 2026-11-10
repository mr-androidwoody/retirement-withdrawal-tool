import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPlan, removePlan, findPlan, parsePlans, loadPlans, storePlans, cleanName, renamePlan, shortPot, defaultName, displayName, MAX_PLANS, PLANS_KEY } from '../ui/plans.js';
import { planParts } from '../ui/format.js';

const sample = (n) => ({
  name: `Plan ${n}`,
  inputs: { version: 1, fields: { pot: '500,000' } },
  plan: { strategy: 'constant-real', params: { rate: 0.045 }, mix: { equities: 0.6, bonds: 0.4, cash: 0 }, cashBuffer: { years: 2 } },
  summary: { pot: 500000 },
});

test('plans are added newest first, up to five, then refused with a plain message', () => {
  let list = [];
  for (let i = 1; i <= MAX_PLANS; i += 1) {
    const out = addPlan(list, sample(i), new Date(2026, 10, i), `id${i}`);
    assert.equal(out.error, undefined);
    list = out.list;
  }
  assert.equal(MAX_PLANS, 5);
  assert.deepEqual(list.map((p) => p.name), ['Plan 5', 'Plan 4', 'Plan 3', 'Plan 2', 'Plan 1']);
  const full = addPlan(list, sample(6));
  assert.match(full.error, /5 saved plans/);
  assert.equal(full.list, list);
});

test('a plan can be found and removed by id', () => {
  const { list } = addPlan([], sample(1), new Date(), 'a');
  const { list: two } = addPlan(list, sample(2), new Date(), 'b');
  assert.equal(findPlan(two, 'a').name, 'Plan 1');
  assert.equal(findPlan(two, 'zzz'), null);
  assert.deepEqual(removePlan(two, 'a').map((p) => p.id), ['b']);
});

test('names are tidied, capped and given a fallback', () => {
  assert.equal(cleanName('  Spend   more \n plan ', 'x'), 'Spend more plan');
  assert.equal(cleanName('   ', 'Fallback'), 'Fallback');
  assert.equal(cleanName('a'.repeat(120), 'x').length, 90);
});

test('stored plans survive a round trip, and bad data is dropped rather than breaking the page', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const { list } = addPlan([], sample(1), new Date(2026, 10, 9), 'a');
  assert.equal(storePlans(storage, list), true);
  assert.deepEqual(loadPlans(storage), list);
  assert.deepEqual(parsePlans('not json'), []);
  assert.deepEqual(parsePlans('{"a":1}'), []);
  assert.deepEqual(parsePlans(JSON.stringify([{ id: 'x', name: 'no plan' }, ...list])), list);
  store.set(PLANS_KEY, JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ ...list[0], id: `i${i}` }))));
  assert.equal(loadPlans(storage).length, 5);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
  assert.deepEqual(loadPlans(broken), []);
  assert.equal(storePlans(broken, list), false);
});

test('a plan can be renamed; a blank name keeps the old one', () => {
  const { list } = addPlan([], sample(1), new Date(), 'a');
  assert.equal(renamePlan(list, 'a', '  Main   plan ')[0].name, 'Main plan');
  assert.equal(renamePlan(list, 'a', '   ')[0].name, 'Plan 1');
  assert.equal(renamePlan(list, 'zzz', 'x')[0].name, 'Plan 1');
});

test('short pots and default names', () => {
  assert.equal(shortPot(1500000), '\u00a31.5m');
  assert.equal(shortPot(1000000), '\u00a31m');
  assert.equal(shortPot(1862578), '\u00a31.9m');
  assert.equal(shortPot(850000), '\u00a3850k');
  assert.equal(shortPot(NaN), '');
  assert.equal(defaultName(1500000, 'Floor and ceiling'), '\u00a31.5m, floor and ceiling');
});

test('names that repeat the option show only the rest; others are shown as typed', () => {
  const opt = 'Floor and ceiling, your cash spent first, your 70/20/10 mix';
  assert.equal(displayName(`\u00a31.5m - ${opt}`, opt, 'x'), '\u00a31.5m');
  assert.equal(displayName(opt, opt, '\u00a31.5m, floor and ceiling'), '\u00a31.5m, floor and ceiling');
  assert.equal(displayName('Main plan', opt, 'x'), 'Main plan');
});

test('an option splits into approach, cash rule and starting mix', () => {
  const mine = planParts({ strategy: 'floor-ceiling', params: { pinned: true }, mix: { equities: 0.75 }, cashBuffer: { amount: 100000 }, cashRule: 'spend-first', currentMix: { equities: 0.6, bonds: 0.3, cash: 0.1 } });
  assert.equal(mine.approach, 'Floor and ceiling');
  assert.equal(mine.pinned, true);
  assert.equal(mine.cash, 'cash spent first');
  assert.equal(mine.mixLabel, '60/30/10');
  const grid = { strategy: 'constant-real', params: { rate: 0.04 }, mix: { equities: 0.7 }, cashBuffer: { years: 2 } };
  assert.equal(planParts(grid).cash, '2-year cash buffer');
  assert.equal(planParts(grid).split, null);
  // No cash buffer: the split is the invested mix, known without the pot.
  assert.equal(planParts({ ...grid, cashBuffer: { years: 0 } }).mixLabel, '70/30/0');
  const withPot = planParts(grid, { pot: 500000, wanted: 25000, minimum: 20000, years: 30, otherIncome: [], incomeChange: null });
  assert.equal(withPot.mixLabel, '63/27/10');
});
