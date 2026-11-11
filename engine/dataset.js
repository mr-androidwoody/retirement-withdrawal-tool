// Historical dataset: validation and rolling windows. Pure functions, no I/O.

const SERIES = ['equities', 'bonds', 'cash', 'inflation'];

/**
 * Check a dataset object and return it. Throws with a plain message if anything is wrong.
 * Years must be consecutive and every series must be a finite number.
 */
export function validateDataset(ds) {
  if (!ds || !Array.isArray(ds.years) || ds.years.length === 0) {
    throw new Error('Dataset has no years.');
  }
  ds.years.forEach((row, i) => {
    if (!Number.isInteger(row.year)) throw new Error(`Row ${i} has no year.`);
    if (i > 0 && row.year !== ds.years[i - 1].year + 1) {
      throw new Error(`Dataset years are not consecutive at ${row.year}.`);
    }
    for (const key of SERIES) {
      if (!Number.isFinite(row[key])) throw new Error(`${row.year}: ${key} is missing.`);
    }
  });
  return ds;
}

/**
 * Every window of `length` consecutive years whose first year is on or after firstStartYear.
 * Each window: { startYear, endYear, rows: [{ year, equities, bonds, cash, inflation }] }.
 */
export function makeWindows(ds, length, firstStartYear) {
  if (!Number.isInteger(length) || length < 1) throw new Error('Retirement length must be a whole number of years.');
  const rows = ds.years.map(({ year, equities, bonds, cash, inflation }) => ({ year, equities, bonds, cash, inflation }));
  const windows = [];
  for (let i = 0; i + length <= rows.length; i += 1) {
    if (rows[i].year < firstStartYear) continue;
    const slice = rows.slice(i, i + length);
    windows.push({ startYear: slice[0].year, endYear: slice[slice.length - 1].year, rows: slice });
  }
  return windows;
}

/**
 * Check a retirement length against the allowed range ({ min, max } from config.json).
 * Returns null when it is fine, or a plain message saying what to enter.
 */
export function lengthError(years, range) {
  const { min, max } = range;
  if (!Number.isInteger(years) || years < min || years > max) {
    return `Plan for a whole number of years from ${min} to ${max}.`;
  }
  return null;
}

/**
 * Check that a plan ends by the oldest age the tool plans for (range.maxEndAge in config.json).
 * The plan's last year is at age + years - 1. Returns null when it is fine, or a plain message.
 */
export function endAgeError(age, years, range) {
  const { min, maxEndAge } = range;
  if (!Number.isInteger(maxEndAge) || !Number.isInteger(age) || !Number.isInteger(years)) return null;
  const lastAge = age + years - 1;
  if (lastAge <= maxEndAge) return null;
  const most = maxEndAge - age + 1;
  if (most < min) return `From age ${age}, even a ${min}-year plan would run past age ${maxEndAge}, the oldest age this tool plans to.`;
  return `A ${years}-year plan from age ${age} would run to age ${lastAge}. Plans end by age ${maxEndAge}, so choose ${most} years or fewer.`;
}
