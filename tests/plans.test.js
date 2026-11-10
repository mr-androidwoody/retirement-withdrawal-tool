import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPlan, removePlan, findPlan, parsePlans, loadPlans, storePlans, cleanName, MAX_PLANS, PLANS_KEY } from '../ui/plans.js';

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
