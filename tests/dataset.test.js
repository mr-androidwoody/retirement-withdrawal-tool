import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDataset, makeWindows, lengthError, endAgeError } from '../engine/dataset.js';

const ds = JSON.parse(readFileSync(new URL('../data/jst-r6-global-gbp.json', import.meta.url)));
const config = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url)));

test('the shipped dataset is valid and runs 1950 to 2025', () => {
  validateDataset(ds);
  assert.equal(ds.years[0].year, 1950);
  assert.equal(ds.years.at(-1).year, 2025);
});

test('30-year retirements from 1950 give 47 windows, 1950 to 1996', () => {
  const w = makeWindows(ds, 30, config.firstStartYear);
  assert.equal(w.length, 47);
  assert.equal(w[0].startYear, 1950);
  assert.equal(w[0].endYear, 1979);
  assert.equal(w.at(-1).startYear, 1996);
  assert.equal(w.at(-1).endYear, 2025);
  assert.ok(w.every((x) => x.rows.length === 30));
});

test('35-year retirements give 42 windows; 25-year give 52; a later first start gives fewer', () => {
  assert.equal(makeWindows(ds, 35, config.firstStartYear).length, 42);
  assert.equal(makeWindows(ds, 25, config.firstStartYear).length, 52);
  assert.equal(makeWindows(ds, 30, 1970).length, 27);
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

test('the length range runs 20 to 45 years, and every preset is inside it', () => {
  const r = config.retirementLength;
  assert.equal(r.min, 20);
  assert.equal(r.max, 45);
  for (const y of r.presets) assert.equal(lengthError(y, r), null);
  for (const p of config.presets) assert.equal(lengthError(p.values.years, r), null);
  assert.equal(lengthError(config.defaults.years, r), null);
});

test('the shortest and longest lengths give 57 and 32 past retirements', () => {
  const short = makeWindows(ds, 20, config.firstStartYear);
  const long = makeWindows(ds, 45, config.firstStartYear);
  assert.equal(short.length, 57);
  assert.equal(short.at(-1).startYear, 2006);
  assert.equal(long.length, 32);
  assert.equal(long.at(-1).startYear, 1981);
});

test('a length outside the range, or not a whole number, is refused with a plain message', () => {
  const r = config.retirementLength;
  for (const bad of [19, 46, 0, 30.5, NaN]) assert.match(lengthError(bad, r), /from 20 to 45/);
  assert.equal(lengthError(20, r), null);
  assert.equal(lengthError(45, r), null);
});

test('a plan must end by age 110', () => {
  const r = config.retirementLength;
  assert.equal(r.maxEndAge, 110);
  assert.equal(endAgeError(60, 45, r), null);   // ends at 104
  assert.equal(endAgeError(81, 30, r), null);   // ends at 110 exactly
  assert.equal(endAgeError(82, 30, r), 'A 30-year plan from age 82 would run to age 111. Plans end by age 110, so choose 29 years or fewer.');
  assert.equal(endAgeError(91, 20, r), null);   // the shortest plan still fits
  assert.equal(endAgeError(92, 20, r), 'From age 92, even a 20-year plan would run past age 110, the oldest age this tool plans to.');
  assert.equal(endAgeError(92, 20, { min: 20 }), null); // no limit set
});
