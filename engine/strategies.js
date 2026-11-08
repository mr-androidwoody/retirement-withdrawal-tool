// The four withdrawal strategies. Each decides only the year's withdrawal from the pot
// (in nominal pounds); the engine owns the money: capping, paying, growth, fees.
//
// withdraw(params, state, ctx) -> { amount, state, events }
//   state  whatever the strategy remembered from last year (null in year 1)
//   ctx    { t, years, pot, index, prevReturn, prevInflation, profile }
//          t        0-based year; pot = total pot at the start of the year, before withdrawal
//          index    inflation index at the start of the year (1 in year 1)
//          profile  real wanted / minimum / other income per year (see profile.js)
// describe(params) -> plain-English recipe for the results table
// incomeAware: true if the strategy already works in total income (pot + other income).
//   For the others, the engine takes any earnings that year off the withdrawal, so pay from
//   work replaces money from the pot rather than adding to it.

const GK_DEFAULTS = {
  guardrail: 0.2,
  adjustment: 0.1,
  inflationCap: 0.06,
  noCutFinalYears: 15,
  skipOnlyIfAboveStartRate: true,
};

const pct = (x) => `${+(x * 100).toFixed(2)}%`;

// Guaranteed income in nominal pounds for year t.
const otherNominal = (ctx, t = ctx.t) => ctx.profile.other[t] * ctx.index;

const constantReal = {
  id: 'constant-real',
  label: 'Constant real',
  summary: 'Same income every year, rising with inflation.',
  incomeAware: true,
  withdraw(params, state, ctx) {
    // Fixes total real income in year 1 (withdrawal + lasting guaranteed income), then keeps
    // it, following any later change to the wanted income. Other income in force in a year,
    // including earnings and pensions that start later, reduces what is taken from the pot.
    // Earnings are left out of the year-1 total, so a salary that stops is not replaced.
    const s = state || {
      totalReal1: params.rate * ctx.pot + ctx.profile.other[0] - (ctx.profile.earned?.[0] || 0),
      wanted1: ctx.profile.wanted[0],
    };
    const scale = s.wanted1 > 0 ? ctx.profile.wanted[ctx.t] / s.wanted1 : 1;
    const amount = Math.max(0, s.totalReal1 * scale * ctx.index - otherNominal(ctx));
    return { amount, state: s, events: [] };
  },
  describe: (p) => `takes ${pct(p.rate)} of the pot in year 1, then the same income each year, rising with inflation.`,
};

const fixedPercentage = {
  id: 'fixed-percentage',
  label: 'Fixed percentage',
  summary: 'The same share of the pot each year, so income moves with markets.',
  withdraw(params, state, ctx) {
    return { amount: params.rate * ctx.pot, state: {}, events: [] };
  },
  describe: (p) => `takes ${pct(p.rate)} of the pot each year, so income rises and falls with markets.`,
};

const guytonKlinger = {
  id: 'guyton-klinger',
  label: 'Guyton-Klinger guardrails',
  summary: 'Starts at a set rate, skips rises after bad years, cuts or raises when the rate drifts too far.',
  withdraw(params, state, ctx) {
    const rules = { ...GK_DEFAULTS, ...params };
    const r0 = params.rate;
    if (!state) {
      const amount = r0 * ctx.pot;
      return { amount, state: { last: amount }, events: [] };
    }
    const events = [];
    let amount = state.last;
    const rateNow = ctx.pot > 0 ? amount / ctx.pot : Infinity;

    // 1. Inflation rule: raise by last year's inflation (capped), unless last year's
    //    portfolio return was negative (and, under the original rule, the rate is above r0).
    const badYear = ctx.prevReturn !== null && ctx.prevReturn < 0;
    const skip = badYear && (!rules.skipOnlyIfAboveStartRate || rateNow > r0);
    if (skip) {
      events.push('skip-inflation');
    } else {
      const rise = Math.min(ctx.prevInflation ?? 0, rules.inflationCap);
      if ((ctx.prevInflation ?? 0) > rules.inflationCap) events.push('inflation-capped');
      amount *= 1 + rise;
    }

    // 2. Capital preservation and 3. prosperity guardrails.
    const rate = ctx.pot > 0 ? amount / ctx.pot : Infinity;
    const yearsLeft = ctx.years - ctx.t;
    if (rate > r0 * (1 + rules.guardrail)) {
      if (yearsLeft > rules.noCutFinalYears) {
        amount *= 1 - rules.adjustment;
        events.push('cut');
      }
    } else if (rate < r0 * (1 - rules.guardrail)) {
      amount *= 1 + rules.adjustment;
      events.push('raise');
    }
    return { amount, state: { last: amount }, events };
  },
  describe: (p) => `starts at ${pct(p.rate)} of the pot; cut by ${pct(p.adjustment ?? GK_DEFAULTS.adjustment)} if the rate rises ${pct(p.guardrail ?? GK_DEFAULTS.guardrail)} above the start, raised by the same if it falls ${pct(p.guardrail ?? GK_DEFAULTS.guardrail)} below; no rise after a losing year.`,
};

const floorCeiling = {
  id: 'floor-ceiling',
  label: 'Floor and ceiling',
  summary: 'A share of the pot each year, kept between a floor and a ceiling.',
  incomeAware: true,
  withdraw(params, state, ctx) {
    const other = otherNominal(ctx);
    const wanted = ctx.profile.wanted[ctx.t] * ctx.index;
    if (!state) {
      // Year 1: exactly the income wanted.
      return { amount: Math.max(0, wanted - other), state: {}, events: [] };
    }
    const floor = Math.max(params.floorPct * ctx.profile.wanted[ctx.t], ctx.profile.minimum[ctx.t]) * ctx.index;
    const ceiling = params.ceilingPct * ctx.profile.wanted[ctx.t] * ctx.index;
    const events = [];
    let total = params.rate * ctx.pot + other;
    if (total < floor) { total = floor; events.push('floor'); }
    if (total > ceiling) { total = ceiling; events.push('ceiling'); }
    return { amount: Math.max(0, total - other), state: {}, events };
  },
  describe: (p) => `starts on the income you want, then takes ${pct(p.rate)} of the pot each year, never less than ${pct(p.floorPct)} or more than ${pct(p.ceilingPct)} of it (rising with inflation).`,
};

export const STRATEGIES = Object.freeze({
  [constantReal.id]: constantReal,
  [fixedPercentage.id]: fixedPercentage,
  [guytonKlinger.id]: guytonKlinger,
  [floorCeiling.id]: floorCeiling,
});

export function getStrategy(id) {
  const s = STRATEGIES[id];
  if (!s) throw new Error(`Unknown strategy: ${id}`);
  return s;
}
