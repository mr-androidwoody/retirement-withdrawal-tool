import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshot } from '../engine/snapshot.js';

// The 08 Nov 2026 snapshot, as pasted. Dashes and pound signs are written as escapes.
const D = '\u2014';
const P = '\u00a3';
const SNAPSHOT = `Portfolio Snapshot ${D} 08 Nov 2026

Net Portfolio Value: ${P}1,843,050
  Anna's notional holding ${D} -${P}4,460
  Unpaid tax ${D} -${P}25,958

Total Portfolio (gross): ${P}1,873,468 (Woody ${P}1,510,882 \u00b7 Heidi ${P}362,585)
Total Wealth (incl. house): ${P}2,667,746

Cash ${D} ${P}33,585
  Woody: Cash (RBS) ${D} ${P}1,273

ISAs ${D} ${P}459,747
  Woody: FTSE Developed World ex-UK (Vanguard) ${D} ${P}308,225

Equity: ${P}1,135,462 (60.6% of portfolio)
Non-equity: ${P}738,006 (39.4% of portfolio)
  Bonds: ${P}249,741 (33.8% of non-equity, 13.3% of portfolio)
    UK bonds: ${P}74,090 (29.7% of bonds) - gilts ${P}53,278, UK corporate ${P}20,812
  Cash and money market: ${P}488,265 (66.2% of non-equity)
`;

test('reads the 08 Nov 2026 snapshot', () => {
  const s = parseSnapshot(SNAPSHOT);
  assert.equal(s.ok, true, s.error);
  assert.equal(s.date, '08 Nov 2026');
  assert.equal(s.net, 1843050);
  assert.equal(s.gross, 1873468);
  assert.equal(s.equity, 1135462);
  assert.equal(s.bonds, 249741);
  assert.equal(s.cash, 488265);
  assert.equal(s.deductions, 30418);
  assert.equal(s.cashBuffer, 457847);
  assert.equal(s.invested, 1385203);
  assert.equal(s.invested + s.cashBuffer, s.net);
  assert.ok(Math.abs(s.equitiesShare - 0.8197) < 0.0001);
});

test('"UK bonds" and "Non-equity" lines are not mistaken for Bonds and Equity', () => {
  const s = parseSnapshot(SNAPSHOT);
  assert.equal(s.bonds, 249741);
  assert.equal(s.equity, 1135462);
});

test('a missing line is named', () => {
  const s = parseSnapshot(SNAPSHOT.replace(/^\s*Bonds:.*$/m, ''));
  assert.equal(s.ok, false);
  assert.match(s.error, /"Bonds"/);
});

test('totals that do not add up are refused', () => {
  const s = parseSnapshot(SNAPSHOT.replace(`Equity: ${P}1,135,462`, `Equity: ${P}1,035,462`));
  assert.equal(s.ok, false);
  assert.match(s.error, /add up/);
});

test('a hyphen in place of the dash is accepted for the date', () => {
  const s = parseSnapshot(SNAPSHOT.replace(`Snapshot ${D}`, 'Snapshot -'));
  assert.equal(s.date, '08 Nov 2026');
});

test('empty text is refused', () => {
  assert.equal(parseSnapshot('  ').ok, false);
});
