// Earned income: received until it stops, replacing withdrawals rather than adding to spending.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../engine/simulate.js';
import { buildProfile } from '../engine/profile.js';
import { market, request, plan, close } from './helpers.js';

const job = (amount, toYear) => ({ label: 'Earnings', amount, fromYear: 1, toYear, kind: 'earned' });

test('the profile counts earnings only up to their last year', () => {
  const p = buildProfile(request({ years: 5, otherIncome: [job(2000, 2), { label: 'Pension', amount: 500, fromYear: 4 }] }));
  assert.deepEqual(p.earned, [2000, 2000, 0, 0, 0]);
  assert.deepEqual(p.other, [2000, 2000, 0, 500, 500]);
});

test('constant real: earnings replace withdrawals while they last, then spending carries on', () => {
  // 4% of 100,000 = 4,000 a year to spend; 1,500 of earnings for the first 2 years.
  const req = request({ years: 5, otherIncome: [job(1500, 2)] });
  const r = simulate(plan('constant-real', { rate: 0.04 }), market(5), req, { rows: true });
  assert.ok(close(r.rows[0].actualWithdrawal, 2500));
  assert.ok(close(r.rows[1].actualWithdrawal, 2500));
  assert.ok(close(r.rows[2].actualWithdrawal, 4000));
  r.rows.forEach((row) => assert.ok(close(row.totalIncomeReal, 4000)));
});

test('constant real: a lasting pension in year 1 still counts towards the spending level', () => {
  const req = request({ years: 3, otherIncome: [{ label: 'Pension', amount: 1000, fromYear: 1 }] });
  const r = simulate(plan('constant-real', { rate: 0.04 }), market(3), req, { rows: true });
  assert.ok(close(r.rows[2].totalIncomeReal, 5000));
});

test('fixed percentage: earnings come off that year\'s withdrawal', () => {
  const req = request({ years: 3, otherIncome: [job(1000, 1)] });
  const r = simulate(plan('fixed-percentage', { rate: 0.04 }), market(3), req, { rows: true });
  assert.ok(close(r.rows[0].actualWithdrawal, 3000));
  assert.ok(close(r.rows[0].totalIncomeReal, 4000));
  assert.ok(close(r.rows[1].actualWithdrawal, 0.04 * r.rows[1].startInvested));
});

test('Guyton-Klinger: earnings reduce the withdrawal but not the strategy\'s own amount', () => {
  const req = request({ years: 3, otherIncome: [job(1000, 1)] });
  const r = simulate(plan('guyton-klinger', { rate: 0.05 }), market(3, { equities: 0.05, inflation: 0.02 }), req, { rows: true });
  assert.ok(close(r.rows[0].actualWithdrawal, 4000));
  assert.ok(close(r.rows[1].actualWithdrawal, 5000 * 1.02));
});

test('floor and ceiling: works in total income, so earnings count automatically', () => {
  const req = request({ years: 2, wanted: 4500, otherIncome: [job(2000, 1)] });
  const r = simulate(plan('floor-ceiling', { rate: 0.045, floorPct: 0.9, ceilingPct: 1.5 }), market(2), req, { rows: true });
  assert.ok(close(r.rows[0].actualWithdrawal, 2500));
  assert.ok(close(r.rows[0].totalIncomeReal, 4500));
});
