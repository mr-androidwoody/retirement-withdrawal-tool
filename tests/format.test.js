import test from 'node:test';
import assert from 'node:assert/strict';
import { gbp, parseAmount, planName, recipe, escapeHtml } from '../ui/format.js';

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

test('all shares and a snapshot cash amount are described', () => {
  const plan = { strategy: 'constant-real', params: { rate: 0.04 }, mix: { equities: 1 }, cashBuffer: { amount: 45000 }, fromSnapshot: true };
  assert.equal(planName(plan), 'Constant real, your cash spent first, all shares');
  const r = recipe(plan, req);
  assert.match(r.cash, /£45,000 from your snapshot, spent first \(about 2.0 years/);
  assert.equal(r.rest, 'all shares, as in your snapshot.');
});

test('text is escaped before it goes into the page', () => {
  assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});
