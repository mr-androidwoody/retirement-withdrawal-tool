import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../engine/simulate.js';
import { STRATEGIES, getStrategy } from '../engine/strategies.js';
import { market, request, plan, close } from './helpers.js';

const run = (p, m, req) => simulate(p, m, req, { rows: true });

test('all four strategies are registered and describe themselves', () => {
  assert.deepEqual(Object.keys(STRATEGIES).sort(),
    ['constant-real', 'fixed-percentage', 'floor-ceiling', 'guyton-klinger']);
  for (const s of Object.values(STRATEGIES)) {
    assert.equal(typeof s.describe({ rate: 0.04, floorPct: 0.9, ceilingPct: 1.5 }), 'string');
  }
  assert.throws(() => getStrategy('nope'), /Unknown strategy/);
});

// ---------- fixed percentage ----------

test('fixed percentage always takes the rate times the pot and never runs out', () => {
  const m = market(40, { equities: [...Array(40)].map((_, i) => (i % 3 === 0 ? -0.3 : 0.05)) });
  const r = run(plan('fixed-percentage', { rate: 0.06 }), m, request({ years: 40 }));
  r.rows.forEach((row) => {
    assert.ok(close(row.actualWithdrawal, 0.06 * (row.startInvested + row.startCash)));
  });
  assert.equal(r.depleted, false);
  assert.ok(r.endReal > 0);
});

// ---------- Guyton-Klinger ----------

test('GK year 1 is the starting rate times the pot', () => {
  const r = run(plan('guyton-klinger', { rate: 0.05 }), market(2), request({ years: 2 }));
  assert.ok(close(r.rows[0].actualWithdrawal, 5000));
});

test('GK raises by last year\'s inflation in an ordinary year', () => {
  const r = run(plan('guyton-klinger', { rate: 0.05 }), market(3, { equities: 0.05, inflation: 0.03 }), request({ years: 3 }));
  assert.ok(close(r.rows[1].actualWithdrawal, 5000 * 1.03));
  assert.deepEqual(r.rows[1].events, []);
});

test('GK caps the inflation rise at 6%', () => {
  const r = run(plan('guyton-klinger', { rate: 0.05 }), market(2, { equities: 0.1, inflation: 0.1 }), request({ years: 2 }));
  assert.ok(close(r.rows[1].actualWithdrawal, 5000 * 1.06));
  assert.ok(r.rows[1].events.includes('inflation-capped'));
});

test('GK skips the rise after a losing year when the rate is above the start, and cuts above the upper guardrail', () => {
  // Year 1: take 5,000 from 100,000, then lose 30% -> pot 66,500. Year 2 rate = 5,000 / 66,500 = 7.5%
  // which is above 5% x 1.2 = 6%, so: no inflation rise, then a 10% cut.
  const m = market(30, { equities: [-0.3, ...Array(29).fill(0)], inflation: 0.03 });
  const r = run(plan('guyton-klinger', { rate: 0.05 }), m, request());
  assert.deepEqual(r.rows[1].events, ['skip-inflation', 'cut']);
  assert.ok(close(r.rows[1].actualWithdrawal, 5000 * 0.9));
});

test('GK gives the rise after a losing year if the rate is still at or below the start (original rule)', () => {
  // A 20% gain, then a 1% loss: in year 3 the rate (about 2.7%) is still below the 3% start,
  // so inflation is added despite the losing year.
  const m = market(3, { equities: [0.2, -0.01, 0], inflation: 0.02 });
  const r = run(plan('guyton-klinger', { rate: 0.03 }), m, request({ years: 3 }));
  assert.ok(!r.rows[2].events.includes('skip-inflation'));
  assert.ok(close(r.rows[2].actualWithdrawal, 3000 * 1.02 * 1.02));
});

test('GK raises 10% below the lower guardrail', () => {
  // Pot doubles: year 2 rate is about 2.6%, below 5% x 0.8 = 4%.
  const m = market(3, { equities: [1.0, 0, 0] });
  const r = run(plan('guyton-klinger', { rate: 0.05 }), m, request({ years: 3 }));
  assert.ok(r.rows[1].events.includes('raise'));
  assert.ok(close(r.rows[1].actualWithdrawal, 5000 * 1.1));
});

test('GK makes no cut in the final 15 years', () => {
  // 20-year plan, crash in year 6: year 7 has 14 years left, so no cut.
  const eq = Array(20).fill(0); eq[5] = -0.5;
  const r = run(plan('guyton-klinger', { rate: 0.05 }), market(20, { equities: eq }), request({ years: 20 }));
  assert.ok(!r.rows[6].events.includes('cut'));
  assert.ok(r.rows[6].events.includes('skip-inflation'));
});

test('GK settings can be changed through params', () => {
  const m = market(30, { equities: [-0.3, ...Array(29).fill(0)] });
  const r = run(plan('guyton-klinger', { rate: 0.05, adjustment: 0.2 }), m, request());
  assert.ok(close(r.rows[1].actualWithdrawal, 5000 * 0.8));
});

// ---------- floor and ceiling ----------

test('floor and ceiling starts on exactly the income wanted', () => {
  const r = run(plan('floor-ceiling', { rate: 0.045, floorPct: 0.9, ceilingPct: 1.5 }), market(2), request({ years: 2, wanted: 4500 }));
  assert.ok(close(r.rows[0].actualWithdrawal, 4500));
});

test('floor and ceiling holds the floor after a fall', () => {
  const m = market(3, { equities: [-0.5, 0, 0] });
  const r = run(plan('floor-ceiling', { rate: 0.045, floorPct: 0.9, ceilingPct: 1.5 }), m, request({ years: 3, wanted: 4500, minimum: 3000 }));
  // 4.5% of about 47,750 is about 2,149, below the floor of 90% x 4,500 = 4,050.
  assert.ok(close(r.rows[1].actualWithdrawal, 4050));
  assert.ok(r.rows[1].events.includes('floor'));
});

test('the floor is never below the minimum', () => {
  const m = market(3, { equities: [-0.5, 0, 0] });
  const r = run(plan('floor-ceiling', { rate: 0.045, floorPct: 0.8, ceilingPct: 1.5 }), m, request({ years: 3, wanted: 4500, minimum: 4200 }));
  assert.ok(close(r.rows[1].actualWithdrawal, 4200));
});

test('floor and ceiling holds the ceiling after a boom', () => {
  const m = market(3, { equities: [2.0, 0, 0] });
  const r = run(plan('floor-ceiling', { rate: 0.045, floorPct: 0.9, ceilingPct: 1.5 }), m, request({ years: 3, wanted: 4500 }));
  assert.ok(close(r.rows[1].actualWithdrawal, 6750));
  assert.ok(r.rows[1].events.includes('ceiling'));
});

test('the floor holds only while the pot can pay it, then falls away', () => {
  const m = market(30, { equities: [-0.6, ...Array(29).fill(0)] });
  const r = run(plan('floor-ceiling', { rate: 0.045, floorPct: 1.0, ceilingPct: 1.5 }), m, request({ wanted: 4500, minimum: 4000 }));
  assert.equal(r.depleted, true);
  const short = r.rows[r.depletionYear - 1];
  assert.ok(short.actualWithdrawal < short.targetWithdrawal);
});

test('floor and ceiling works in total income, net of guaranteed income', () => {
  const m = market(3, { equities: [-0.5, 0, 0] });
  const req = request({ years: 3, wanted: 4500, minimum: 3000, otherIncome: [{ label: 'Pension', amount: 1000, fromYear: 1 }] });
  const r = run(plan('floor-ceiling', { rate: 0.045, floorPct: 0.9, ceilingPct: 1.5 }), m, req);
  assert.ok(close(r.rows[0].actualWithdrawal, 3500));
  assert.ok(close(r.rows[1].actualWithdrawal, 4050 - 1000));
});
