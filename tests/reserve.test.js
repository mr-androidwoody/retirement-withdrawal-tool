// The flexible cash reserve: kept between 1 and 3 years of withdrawals, aiming for 2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../engine/simulate.js';
import { market, request, close } from './helpers.js';

const RESERVE = { floorYears: 1, targetYears: 2, maxYears: 3, phaseInYears: 5, downturnDrop: 0.1 };
// Withdraw 4,000 a year (4% of 100,000); "one year" of reserve = 4,000.
const flexPlan = (cash, extra = {}) => ({
  strategy: 'constant-real', params: { rate: 0.04 }, mix: { equities: 1 },
  cashBuffer: { amount: cash }, cashRule: 'flexible', reserve: { ...RESERVE, ...extra },
});
const run = (plan, m, req = request({ years: m.rows.length })) => simulate(plan, m, req, { rows: true });

test('cash above 3 years is invested in equal parts over 5 years', () => {
  // 32,000 cash = 8 years; excess over 3 years = 20,000, so 4,000 a year goes in.
  const r = run(flexPlan(32000), market(10));
  for (let t = 0; t < 5; t += 1) assert.ok(r.rows[t].events.includes('invest-excess'), `year ${t + 1}`);
  // Year 1: 32,000 - 4,000 spent - 4,000 invested = 24,000 cash.
  assert.ok(close(r.rows[0].endCash, 24000));
  assert.ok(close(r.rows[0].endInvested, 68000 + 4000));
});

test('below the floor the reserve is rebuilt to the 2-year target when not in a downturn', () => {
  // Start with 4,000 cash (1 year): it pays year 1, leaving 0, so it is rebuilt to 8,000.
  const r = run(flexPlan(4000), market(3, { equities: 0.05 }));
  assert.ok(r.rows[0].events.includes('reserve-topup'));
  assert.ok(close(r.rows[0].endCash, 8000));
});

test('in a downturn the reserve is rebuilt only to the 1-year floor', () => {
  const r = run(flexPlan(4000), market(3, { equities: [-0.3, 0, 0] }));
  assert.ok(r.rows[0].events.includes('reserve-topup'));
  assert.ok(close(r.rows[0].endCash, 4000));
});

test('between floor and target there is no top-up during a downturn', () => {
  // 10,000 cash: after paying 4,000, 6,000 = 1.5 years, inside 1 to 2, and investments fell 30%.
  const r = run(flexPlan(10000), market(3, { equities: [-0.3, 0, 0] }));
  assert.ok(!r.rows[0].events.includes('reserve-topup'));
  assert.ok(close(r.rows[0].endCash, 6000));
});

test('between floor and target it is topped up to 2 years in normal markets', () => {
  const r = run(flexPlan(10000), market(3, { equities: 0.05 }));
  assert.ok(close(r.rows[0].endCash, 8000));
});

test('after the phase-in, anything above 3 years is invested at the year end', () => {
  const r = run(flexPlan(20000), market(8, { cash: 0.5 }));
  const late = r.rows[6];
  assert.ok(late.endCash <= 3 * 4000 * late.inflationIndex + 1e-6);
});

test('the reserve is measured net of other income, so a pension shrinks it', () => {
  // From year 3 a 3,000 pension covers most of the 4,000: one year of reserve becomes 1,000.
  const req = request({ years: 8, otherIncome: [{ label: 'Pension', amount: 3000, fromYear: 3 }] });
  const r = run(flexPlan(12000), market(8, { equities: 0.05 }), req);
  assert.ok(r.rows[6].endCash <= 3 * 1000 + 1e-6);
});

test('spend-first is unchanged: cash is never topped up', () => {
  const plan = { ...flexPlan(4000), cashRule: 'spend-first' };
  const r = run(plan, market(3, { equities: 0.05 }));
  assert.equal(r.rows[0].endCash, 0);
  assert.ok(!r.rows.some((x) => x.events.includes('reserve-topup')));
});
