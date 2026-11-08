// Small hand-made markets where the right answer can be worked out on paper.

/** A window of `years` with constant (or per-year array) returns and inflation. */
export function market(years, { equities = 0, bonds = 0, cash = 0, inflation = 0 } = {}) {
  const pick = (v, t) => (Array.isArray(v) ? v[t] : v);
  const rows = [];
  for (let t = 0; t < years; t += 1) {
    rows.push({
      year: 2000 + t,
      equities: pick(equities, t),
      bonds: pick(bonds, t),
      cash: pick(cash, t),
      inflation: pick(inflation, t),
    });
  }
  return { startYear: 2000, endYear: 2000 + years - 1, rows };
}

export function request(overrides = {}) {
  return {
    pot: 100000,
    years: 30,
    wanted: 4000,
    minimum: 3000,
    incomeChange: null,
    otherIncome: [],
    annualFee: 0,
    ...overrides,
  };
}

export function plan(strategy, params, { equities = 1, cashBuffer = { years: 0 } } = {}) {
  return { strategy, params, mix: { equities }, cashBuffer };
}

export const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
