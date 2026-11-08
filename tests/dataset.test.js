import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDataset, makeWindows } from '../engine/dataset.js';

const ds = JSON.parse(readFileSync(new URL('../data/jst-r6-global-gbp.json', import.meta.url)));
const config = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url)));

test('the shipped dataset is valid and runs 1950 to 2020', () => {
  validateDataset(ds);
  assert.equal(ds.years[0].year, 1950);
  assert.equal(ds.years.at(-1).year, 2020);
});

test('30-year retirements from 1950 give 42 windows, 1950 to 1991', () => {
  const w = makeWindows(ds, 30, config.firstStartYear);
  assert.equal(w.length, 42);
  assert.equal(w[0].startYear, 1950);
  assert.equal(w[0].endYear, 1979);
  assert.equal(w.at(-1).startYear, 1991);
  assert.equal(w.at(-1).endYear, 2020);
  assert.ok(w.every((x) => x.rows.length === 30));
});

test('35-year retirements give 37 windows; 25-year give 47; a later first start gives fewer', () => {
  assert.equal(makeWindows(ds, 35, config.firstStartYear).length, 37);
  assert.equal(makeWindows(ds, 25, config.firstStartYear).length, 47);
  assert.equal(makeWindows(ds, 30, 1970).length, 22);
});

test('a gap in the years is refused', () => {
  const bad = { years: [
    { year: 2000, equities: 0, bonds: 0, cash: 0, inflation: 0 },
    { year: 2002, equities: 0, bonds: 0, cash: 0, inflation: 0 },
  ] };
  assert.throws(() => validateDataset(bad), /not consecutive/);
});

test('a missing value is refused', () => {
  const bad = { years: [{ year: 2000, equities: 0, bonds: null, cash: 0, inflation: 0 }] };
  assert.throws(() => validateDataset(bad), /bonds is missing/);
});

test('UK figures in the dataset match the spreadsheet spot checks', () => {
  const y = Object.fromEntries(ds.years.map((r) => [r.year, r]));
  assert.equal(y[1974].ukEquities, -0.501952);
  assert.equal(y[1982].bonds, 0.535222);
  assert.equal(y[1980].cash, 0.1512);
});
