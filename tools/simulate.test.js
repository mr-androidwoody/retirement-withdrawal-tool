import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../engine/simulate.js';
import { market, request, plan, close } from './helpers.js';

// ---------- portfolio arithmetic ----------

test('flat 0% world, no fee: the pot falls by exactly the withdrawals', () => {
  const r = simulate(plan('constant-real', { rate: 0.02 }), market(30), request(), { rows: true });
  assert.ok(close(r.rows.at(-1).endTotalReal, 100000 - 30 * 2000));
  assert.equal(r.depleted, false);
});

test('a 10% world with nothing taken grows by exactly 1.1 a year', () => {
  const r = simulate(plan('fixed-percentage', { rate: 0 }), market(10, { equities: 0.1 }), request({ years: 10 }), { rows: true });
  assert.ok(close(r.endReal, 100000 * 1.1 ** 10));
});

test('the fee comes off the whole pot each year', () => {
  const r = simulate(plan('fixed-percentage', { rate: 0 }), market(10), request({ years: 10, annualFee: 0.01 }));
  assert.ok(close(r.endReal, 100000 * 0.99 ** 10));
});

test('the invested part earns the mix of equity and bond returns', () => {
  const r = simulate(plan('fixed-percentage', { rate: 0 }, { equities: 0.6 }),
    market(1, { equities: 0.1, bonds: 0.05 }), request({ years: 1 }));
  assert.ok(close(r.endReal, 100000 * (1 + 0.6 * 0.1 + 0.4 * 0.05)));
});

// ---------- inflation ----------

test('constant real income rises exactly with inflation and stays flat in real terms', () => {
  const r = simulate(plan('constant-real', { rate: 0.04 }), market(5, { equities: 0.1, inflation: 0.03 }),
    request({ years: 5 }), { rows: true });
  r.rows.forEach((row, t) => {
    assert.ok(close(row.actualWithdrawal, 4000 * 1.03 ** t));
    assert.ok(close(row.totalIncomeReal, 4000));
  });
});

test('real end value deflates by the inflation index', () => {
  const r = simulate(plan('fixed-percentage', { rate: 0 }), market(2, { inflation: 0.05 }), request({ years: 2 }));
  assert.ok(close(r.endReal, 100000 / 1.05 ** 2));
});

test('negative inflation is handled', () => {
  const r = simulate(plan('constant-real', { rate: 0.04 }), market(3, { inflation: -0.02 }),
    request({ years: 3 }), { rows: true });
  assert.ok(close(r.rows[2].actualWithdrawal, 4000 * 0.98 ** 2));
});

// ---------- depletion ----------

test('a pot exactly big enough lasts; one pound less runs out in the final year', () => {
  const p = plan('constant-real', { rate: 0.05 });
  const ok = simulate(p, market(20), request({ years: 20 }));
  assert.equal(ok.depleted, false);
  assert.ok(close(ok.endReal, 0));

  // Same 5,000 a year from a pot one pound short: rate set so year 1 is still 5,000.
  const short = simulate(plan('constant-real', { rate: 5000 / 99999 }), market(20), request({ pot: 99999, years: 20 }));
  assert.equal(short.depleted, true);
  assert.equal(short.depletionYear, 20);
});

test('depletion year is the first year the withdrawal cannot be paid in full', () => {
  const r = simulate(plan('constant-real', { rate: 0.04 }), market(30), request(), { rows: true });
  // 25 years of 4,000 empties 100,000; year 26 is short.
  assert.equal(r.depletionYear, 26);
  assert.equal(r.rows[25].actualWithdrawal, 0);
  assert.equal(r.rows[24].depleted, false);
  assert.equal(r.rows[25].depleted, true);
});

test('after running out, income is guaranteed income only', () => {
  const r = simulate(plan('constant-real', { rate: 0.1 }), market(15),
    request({ years: 15, otherIncome: [{ label: 'State Pension', amount: 1000, fromYear: 1 }] }), { rows: true });
  assert.equal(r.depleted, true);
  assert.ok(close(r.rows.at(-1).totalIncomeReal, 1000));
});

test('nearly ran out: less than one year of the first withdrawal left at the end', () => {
  // 24 years of 4,000 from 99,000 leaves 3,000: less than one year's withdrawal.
  const near = simulate(plan('constant-real', { rate: 4000 / 99000 }), market(24), request({ years: 24, pot: 99000 }));
  assert.equal(near.depleted, false);
  assert.equal(near.nearlyDepleted, true);
  const fine = simulate(plan('constant-real', { rate: 0.04 }), market(20), request({ years: 20 }));
  assert.equal(fine.nearlyDepleted, false);
});

// ---------- cash buffer ----------

test('no buffer means the whole pot is invested', () => {
  const r = simulate(plan('fixed-percentage', { rate: 0 }), market(1), request({ years: 1 }), { rows: true });
  assert.equal(r.rows[0].startCash, 0);
  assert.equal(r.rows[0].startInvested, 100000);
});

test('flat returns: a 5-year buffer pays everything for 5 years, leaving investments untouched', () => {
  const p = plan('constant-real', { rate: 0.04 }, { cashBuffer: { years: 5 } });
  const r = simulate(p, market(10), request({ years: 10 }), { rows: true });
  assert.equal(r.rows[0].startCash, 20000);
  for (let t = 0; t < 5; t += 1) {
    assert.ok(close(r.rows[t].cashUsed, 4000));
    assert.ok(close(r.rows[t].endInvested, 80000));
  }
  assert.ok(close(r.rows[4].endCash, 0));
  assert.ok(close(r.rows[5].endInvested, 76000));
});

test('cash earns the bill rate and investments are untouched until the cash is gone', () => {
  const p = plan('fixed-percentage', { rate: 0 }, { cashBuffer: { amount: 10000 } });
  const r = simulate(p, market(1, { cash: 0.05, equities: 0.1 }), request({ years: 1 }), { rows: true });
  assert.ok(close(r.rows[0].endCash, 10500));
  assert.ok(close(r.rows[0].endInvested, 99000));
});

test('a buffer given as an amount is capped at the pot', () => {
  const p = plan('fixed-percentage', { rate: 0 }, { cashBuffer: { amount: 1e9 } });
  const r = simulate(p, market(1), request({ years: 1 }), { rows: true });
  assert.equal(r.rows[0].startCash, 100000);
  assert.equal(r.rows[0].startInvested, 0);
});

// ---------- income profile ----------

test('constant real follows a later change to the income wanted', () => {
  const req = request({ years: 6, wanted: 4000, incomeChange: { fromYear: 4, wanted: 3000, minimum: 2500 } });
  const r = simulate(plan('constant-real', { rate: 0.04 }), market(6), req, { rows: true });
  assert.ok(close(r.rows[2].totalIncomeReal, 4000));
  assert.ok(close(r.rows[3].totalIncomeReal, 3000));
  assert.equal(r.rows[3].wantedReal, 3000);
  assert.equal(r.rows[3].minimumReal, 2500);
});

test('guaranteed income that starts later reduces what constant real takes from the pot', () => {
  const req = request({ years: 5, otherIncome: [{ label: 'State Pension', amount: 1500, fromYear: 3 }] });
  const r = simulate(plan('constant-real', { rate: 0.04 }), market(5), req, { rows: true });
  assert.ok(close(r.rows[1].actualWithdrawal, 4000));
  assert.ok(close(r.rows[2].actualWithdrawal, 2500));
  assert.ok(close(r.rows[2].totalIncomeReal, 4000));
});

test('below wanted and below minimum are flagged per year', () => {
  const r = simulate(plan('fixed-percentage', { rate: 0.03 }), market(1), request({ years: 1 }), { rows: true });
  assert.equal(r.rows[0].belowWanted, true);
  assert.equal(r.rows[0].belowMinimum, false);
  assert.equal(r.yearsBelowWanted, 1);
});

// ---------- determinism ----------

test('the same inputs give identical results', () => {
  const m = market(30, { equities: [...Array(30)].map((_, i) => ((i * 37) % 11 - 4) / 20), inflation: 0.025 });
  const p = plan('guyton-klinger', { rate: 0.05 }, { equities: 0.7, cashBuffer: { years: 2 } });
  const a = JSON.stringify(simulate(p, m, request(), { rows: true }));
  const b = JSON.stringify(simulate(p, m, request(), { rows: true }));
  assert.equal(a, b);
});
