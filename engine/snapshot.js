// Reads a Portfolio Snapshot pasted from Woody's tracking tool. Strict: exact labels only.
// Dash and pound characters are matched by Unicode escape (\u2014 em dash, \u2013 en dash,
// \u00a3 pound sign), so no literal dash characters appear in this source.

const MONEY = '\\u00a3\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)';
const LINES = {
  net: new RegExp(`^\\s*Net Portfolio Value:\\s*${MONEY}`, 'gm'),
  gross: new RegExp(`^\\s*Total Portfolio \\(gross\\):\\s*${MONEY}`, 'gm'),
  equity: new RegExp(`^\\s*Equity:\\s*${MONEY}`, 'gm'),
  bonds: new RegExp(`^\\s*Bonds:\\s*${MONEY}`, 'gm'),
  cash: new RegExp(`^\\s*Cash and money market:\\s*${MONEY}`, 'gm'),
};
const LABELS = {
  net: 'Net Portfolio Value',
  gross: 'Total Portfolio (gross)',
  equity: 'Equity',
  bonds: 'Bonds',
  cash: 'Cash and money market',
};
const DATE = /^\s*Portfolio Snapshot\s*[\u2014\u2013-]\s*(.+?)\s*$/m;
const TOLERANCE = 5;

const toNumber = (s) => Number(s.replace(/,/g, ''));

/**
 * Returns { ok: true, date, net, gross, equity, bonds, cash, deductions, cashBuffer,
 *           invested, equitiesShare } or { ok: false, error }.
 * Deductions (gross minus net: unpaid tax and the like) come out of cash, since that is
 * where they would be paid from.
 */
export function parseSnapshot(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Nothing was pasted.' };
  const v = {};
  for (const [key, re] of Object.entries(LINES)) {
    const found = [...text.matchAll(re)];
    if (found.length === 0) return { ok: false, error: `Could not find the "${LABELS[key]}" line.` };
    if (found.length > 1) return { ok: false, error: `The "${LABELS[key]}" line appears more than once.` };
    v[key] = toNumber(found[0][1]);
  }
  const date = text.match(DATE)?.[1] ?? null;
  const sum = v.equity + v.bonds + v.cash;
  if (Math.abs(sum - v.gross) > TOLERANCE) {
    return { ok: false, error: `Equity, bonds and cash add up to \u00a3${sum.toLocaleString('en-GB')}, not the gross total of \u00a3${v.gross.toLocaleString('en-GB')}.` };
  }
  if (v.net > v.gross) return { ok: false, error: 'The net value is more than the gross total.' };
  const deductions = v.gross - v.net;
  if (deductions > v.cash) return { ok: false, error: 'The deductions are more than the cash available to pay them.' };
  const invested = v.equity + v.bonds;
  if (invested <= 0) return { ok: false, error: 'There are no equities or bonds in the snapshot.' };
  return {
    ok: true,
    date,
    ...v,
    deductions,
    cashBuffer: v.cash - deductions,
    invested,
    equitiesShare: v.equity / invested,
  };
}
