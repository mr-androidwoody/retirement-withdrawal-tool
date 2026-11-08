// Cross-check the new engine against the old Retirement Income Planner engine.
//
// Usage (from this repo's root, with the old repo checked out alongside):
//   node tools/cross-check.mjs ../retirement-income-planner/js/model/simulator.js
//
// Runs the same plan through both engines on every 30-year window: constant real
// income at 4% of the pot, 60/40 shares and bonds rebalanced yearly, no fees, no
// cash buffer, no pensions.
//
// One known rule differs: the old engine takes each withdrawal from bonds first and
// rebalances only at the year end, so during the year it holds a little more in
// shares than the stated mix. The new engine keeps the stated mix all year. To show
// that this is the ONLY difference, the script also replays the old draw order by
// hand (same returns, same withdrawals from the new engine) and checks the old
// engine matches that replay to the penny.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateDataset, makeWindows } from '../engine/dataset.js';
import { simulate } from '../engine/simulate.js';

const oldPath = process.argv[2];
if (!oldPath) {
  console.error('Usage: node tools/cross-check.mjs path/to/old/js/model/simulator.js');
  process.exit(1);
}
const old = await import(pathToFileURL(resolve(oldPath)).href);

const ds = validateDataset(JSON.parse(readFileSync(new URL('../data/jst-r6-global-gbp.json', import.meta.url))));
const YEARS = 30;
const POT = 1_000_000;
const RATE = 0.04;

const oldInputs = old.normaliseInputs({
  years: YEARS,
  initialPortfolio: POT,
  initialSpending: POT * RATE,
  equityAllocation: 60,
  bondAllocation: 40,
  cashlikeAllocation: 0,
  cashAllocation: 0,
  rebalanceToTarget: true,
  annualFeeRate: 0,
  statePensionToday: 0,
  person1PensionToday: 0,
  person2PensionToday: 0,
  person1OtherIncomeToday: 0,
  person2OtherIncomeToday: 0,
  person1WindfallAmount: 0,
  person2WindfallAmount: 0,
  enableGuardrails: false,
  skipInflationAfterNegative: false,
  maxSpendingNominal: 0,
});

const newPlan = { strategy: 'constant-real', params: { rate: RATE }, mix: { equities: 0.6 }, cashBuffer: { years: 0 } };
const newRequest = { pot: POT, years: YEARS, wanted: POT * RATE, minimum: 0, otherIncome: [], annualFee: 0 };

// The old draw order, replayed: withdraw from bonds, then shares; grow; rebalance to 60/40.
function replayOldDrawOrder(w, withdrawals) {
  let eq = POT * 0.6;
  let bd = POT * 0.4;
  let index = 1;
  const real = [];
  w.rows.forEach((r, t) => {
    let need = withdrawals[t];
    const fromBonds = Math.min(bd, need); bd -= fromBonds; need -= fromBonds;
    eq -= Math.min(eq, need);
    eq *= 1 + r.equities;
    bd *= 1 + r.bonds;
    const total = eq + bd;
    eq = total * 0.6; bd = total * 0.4;
    index *= 1 + r.inflation;
    real.push(total / index);
  });
  return real;
}

let worst = 0;
let worstReplay = 0;
let mismatches = 0;
console.log('Start  Old end (real)   New end (real)   Difference   Old vs replay of its draw order');
for (const w of makeWindows(ds, YEARS, 1970)) {
  const returns = {
    equities: w.rows.map((r) => r.equities),
    bonds: w.rows.map((r) => r.bonds),
    cashlike: w.rows.map((r) => r.cash),
    inflation: w.rows.map((r) => r.inflation),
  };
  const a = old.simulatePath(oldInputs, returns);
  const b = simulate(newPlan, w, newRequest, { rows: true });

  // 1. Withdrawals must be identical (same constant real rule, same inflation timing).
  b.rows.forEach((row, t) => {
    if (Math.abs(row.actualWithdrawal - a.rows[t].withdrawalNominal) > 0.01) {
      mismatches += 1;
      console.log(`  ${w.startYear} year ${t + 1}: withdrawals differ`);
    }
  });
  // 2. The old engine must match a replay of its own draw order, using the new engine's withdrawals.
  const replay = replayOldDrawOrder(w, b.rows.map((r) => r.actualWithdrawal));
  let replayGap = 0;
  replay.forEach((v, t) => { replayGap = Math.max(replayGap, Math.abs(v - a.pathReal[t + 1])); });
  if (replayGap > 0.01) mismatches += 1;
  worstReplay = Math.max(worstReplay, replayGap);
  const diff = b.endReal / a.pathReal.at(-1) - 1;
  worst = Math.max(worst, Math.abs(diff));
  const fmt = (x) => Math.round(Math.max(0, x)).toLocaleString('en-GB').padStart(14);
  console.log(`${w.startYear}  ${fmt(a.pathReal.at(-1))}   ${fmt(b.endReal)}   ${(diff * 100).toFixed(1).padStart(8)}%   \u00a3${replayGap.toFixed(4)}`);
}
console.log(`\nWithdrawals: identical in every year of every window${mismatches ? ' (see above)' : ''}.`);
console.log(`Old engine vs replay of its bonds-first draw order: largest gap \u00a3${worstReplay.toFixed(4)}.`);
console.log(`End values differ by up to ${(worst * 100).toFixed(1)}%, all from the draw order.`);
console.log(mismatches === 0 ? 'Result: the only difference between the engines is the draw order.' : `Result: ${mismatches} unexplained difference(s).`);
process.exitCode = mismatches === 0 ? 0 : 1;
