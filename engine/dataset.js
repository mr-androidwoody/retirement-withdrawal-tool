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
