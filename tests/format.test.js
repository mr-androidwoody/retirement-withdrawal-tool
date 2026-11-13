import test from 'node:test';
import assert from 'node:assert/strict';
import { gbp, parseAmount, planName, recipe, escapeHtml, money, bigMoney, signedMoney, signedPct } from '../ui/format.js';

const req = { pot: 500000, years: 30, wanted: 22500, minimum: 18000, incomeChange: null, otherIncome: [] };

test('amounts are parsed from what people type', () => {
  assert.equal(parseAmount('1,843,050'), 1843050);
  assert.equal(parseAmount('£600000'), 600000);
  assert.ok(Number.isNaN(parseAmount('')));
  assert.equal(gbp(22500.4), '£22,500');
  assert.equal(gbp(null), 'n/a');
});

test('plan names and recipes read in plain English', () => {
  const plan = { strategy: 'floor-ceiling', params: { rate: 0.045, floorPct: 0.9, ceilingPct: 1.5 }, mix: { equities: 0.8 }, cashBuffer: { years: 5 } };
  assert.equal(planName(plan), 'Floor and ceiling, 5-year cash buffer, 80/20 shares and bonds');
  const r = recipe(plan, req);
  assert.match(r.income, /starts on £22,500, then each year takes 4.5% of the pot, never less than £20,250 or more than £33,750/);
  assert.match(r.cash, /starts at £112,500 \(5 years of withdrawals, 23% of the pot\)/);
  assert.equal(r.rest, '80% shares, 20% bonds.');
});

test('a current-mix plan is named by its full split and its cash is described', () => {
  const plan = { strategy: 'constant-real', params: { rate: 0.04 }, mix: { equities: 2 / 3 }, cashBuffer: { amount: 45000 },
    fromCurrent: true, currentMix: { equities: 0.6, bonds: 0.3, cash: 0.1 } };
  assert.equal(planName(plan), 'Inflation-adjusted, your cash spent first, your 60/30/10 mix');
  const r = recipe(plan, req);
  assert.match(r.cash, /\u00a345,000 \(9% of the pot\), spent first \(about 2.0 years/);
  assert.equal(r.rest, '67% shares, 33% bonds of the invested part, as in your current mix.');
});

test('all shares is described in words', () => {
  const plan = { strategy: 'constant-real', params: { rate: 0.04 }, mix: { equities: 1 }, cashBuffer: { years: 0 } };
  assert.equal(planName(plan), 'Inflation-adjusted, no cash buffer, all shares');
  assert.equal(recipe(plan, req).rest, 'all shares.');
});

test('text is escaped before it goes into the page', () => {
  assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});

test('report figures are rounded and use a true minus sign', () => {
  assert.equal(money(82937), '\u00a382,900');
  assert.equal(money(-1949), '\u2212\u00a31,900');
  assert.equal(bigMoney(6469361), '\u00a36.5m');
  assert.equal(bigMoney(1679165, 2), '\u00a31.68m');
  assert.equal(bigMoney(948120), '\u00a3948k');
  assert.equal(bigMoney(6636), '\u00a36,636');
  assert.equal(signedMoney(30000), '+\u00a330,000');
  assert.equal(signedMoney(-4500), '\u2212\u00a34,500');
  assert.equal(signedMoney(20), '\u00a30');
  assert.equal(signedPct(-0.2), '\u221220.0%');
  assert.equal(signedPct(-0.0001), '0.0%');
  assert.equal(signedPct(0.154), '15.4%');
});

test('constant real: earnings pay part of the income rather than adding to it', () => {
  const plan = { strategy: 'constant-real', params: { rate: 0.05 }, mix: { equities: 1 }, cashBuffer: { years: 0 } };
  const pot = 1843051;
  const earnings = { label: 'Earnings', amount: 15000, fromYear: 1, toYear: 5, kind: 'earned' };
  const pension = { label: 'Pension', amount: 10000, fromYear: 1 };
  const withEarnings = recipe(plan, { ...req, pot, otherIncome: [earnings] }).income;
  assert.match(withEarnings, /^\u00a392,153 a year \(5% of the pot\)/);
  assert.match(withEarnings, /Your earnings pay part of this while they last/);
  // A pension in force from the start does add to the total.
  const both = recipe(plan, { ...req, pot, otherIncome: [earnings, pension] }).income;
  assert.match(both, /^\u00a3102,153 a year including your other income/);
  assert.doesNotMatch(recipe(plan, { ...req, pot }).income, /earnings/);
});
