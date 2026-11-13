// Plain-English names and recipes for plans, and number formatting.

import { getStrategy } from '../engine/strategies.js';
import { buildProfile } from '../engine/profile.js';

export const gbp = (x) => (x === null || x === undefined || !Number.isFinite(x)
  ? 'n/a' : `\u00a3${Math.round(x).toLocaleString('en-GB')}`);
export const pct = (x, dp = 0) => `${(x * 100).toFixed(dp)}%`;
export const rate = (x) => `${+(x * 100).toFixed(2)}%`;

// Report formatting: rounded to what the history can support, with a true minus sign.
const MINUS = '\u2212';
const POUND = '\u00a3';
const finite = (x) => x !== null && x !== undefined && Number.isFinite(x);

/** Money to the nearest 100: "£82,900". */
export const money = (x) => {
  if (!finite(x)) return 'n/a';
  const r = Math.round(x / 100) * 100;
  return `${r < 0 ? MINUS : ''}${POUND}${Math.abs(r).toLocaleString('en-GB')}`;
};

/** Large sums: "£6.5m" from a million (dp places), "£948k" below that, pounds under £10,000. */
export const bigMoney = (x, dp = 1) => {
  if (!finite(x)) return 'n/a';
  const a = Math.abs(x);
  const sign = x < 0 ? MINUS : '';
  if (a >= 1e6) return `${sign}${POUND}${(a / 1e6).toFixed(dp)}m`;
  if (a >= 1e4) return `${sign}${POUND}${Math.round(a / 1000)}k`;
  return `${sign}${POUND}${Math.round(a).toLocaleString('en-GB')}`;
};

/** A difference: "+£30,000", "−£2,000", or "£0". */
export const signedMoney = (x) => {
  if (!finite(x)) return 'n/a';
  const r = Math.round(x / 100) * 100;
  if (r === 0) return `${POUND}0`;
  return `${r > 0 ? '+' : MINUS}${POUND}${Math.abs(r).toLocaleString('en-GB')}`;
};

/** A percentage with a true minus sign: "−20.0%". */
export const signedPct = (x, dp = 1) => {
  if (!finite(x)) return 'n/a';
  const s = (Math.abs(x) * 100).toFixed(dp);
  return `${x < 0 && Number(s) !== 0 ? MINUS : ''}${s}%`;
};

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Parse a typed amount: "1,843,050", "£600000", " 22500 " -> number, or NaN. */
export function parseAmount(s) {
  const t = String(s ?? '').replace(/[\u00a3,\s]/g, '');
  return t === '' ? NaN : Number(t);
}

export const formatAmount = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-GB') : '');

const mixText = (plan) => {
  const eq = Math.round(plan.mix.equities * 100);
  return eq === 100 ? 'all shares' : `${eq}/${100 - eq} shares and bonds`;
};

function bufferAmount(plan, request) {
  const profile = buildProfile(request);
  const planned = Math.max(0, profile.wanted[0] - profile.other[0]);
  const amount = Math.min(request.pot, plan.cashBuffer.amount ?? (plan.cashBuffer.years || 0) * planned);
  return { amount, planned };
}

/** What each strategy is called, any other name it goes by, and what it does in one sentence. */
export const STRATEGY_INFO = {
  'constant-real': {
    name: 'Inflation-adjusted',
    aka: 'the 4% rule',
    about: 'Take a set amount, raised with inflation every year.',
    tradeOff: 'Steady income, but bad early years can empty the pot.',
  },
  'fixed-percentage': {
    name: 'Fixed percentage',
    aka: '',
    about: 'Take the same share of the pot each year.',
    tradeOff: 'It never runs out, but income rises and falls with markets.',
  },
  'guyton-klinger': {
    name: 'Guyton-Klinger guardrails',
    aka: 'GK',
    about: 'Like inflation-adjusted, but cut income by 10% when withdrawals get too high, and raise it by 10% when they get too low.',
    tradeOff: 'Mostly steady, and usually allows a higher start.',
  },
  'floor-ceiling': {
    name: 'Floor and ceiling',
    aka: '',
    about: 'Take a share of the pot, but never below a floor or above a ceiling.',
    tradeOff: 'Follows markets within set limits.',
  },
};

/** The strategy tag shown on each option: "Guyton-Klinger guardrails (GK)". */
export function strategyTag(plan) {
  const s = STRATEGY_INFO[plan.strategy];
  if (!s) return getStrategy(plan.strategy).label;
  return s.aka ? `${s.name} (${s.aka})` : s.name;
}

/** Short name: "Floor and ceiling, 5-year cash buffer, 80/20 shares and bonds". */
export function planName(plan) {
  const s = getStrategy(plan.strategy);
  const label = plan.params?.pinned ? `${s.label} at the income you want` : s.label;
  let buffer;
  if (plan.cashBuffer.amount !== undefined) {
    buffer = plan.cashRule === 'flexible' ? 'your cash kept as a 1 to 3 year buffer' : 'your cash spent first';
  }
  else if (plan.cashBuffer.years) buffer = `${plan.cashBuffer.years}-year cash buffer`;
  else buffer = 'no cash buffer';
  if (plan.currentMix) {
    const m = plan.currentMix;
    const r = (x) => Math.round(x * 100);
    return `${label}, ${buffer}, your ${r(m.equities)}/${r(m.bonds)}/${r(m.cash)} mix`;
  }
  return `${label}, ${buffer}, ${mixText(plan)}`;
}

/**
 * An option split into the parts shown in the saved-plans table: the approach, the cash rule,
 * and the starting split of the pot (shares, bonds, cash as fractions) where it is known.
 * Pass the request to work out a cash buffer in pounds; without it, a buffer plan's split
 * covers only the invested part.
 */
export function planParts(plan, request = null) {
  const s = getStrategy(plan.strategy);
  const pinned = Boolean(plan.params?.pinned);
  let cash;
  if (plan.cashBuffer.amount !== undefined) cash = plan.cashRule === 'flexible' ? '1 to 3 year cash buffer' : 'cash spent first';
  else if (plan.cashBuffer.years) cash = `${plan.cashBuffer.years}-year cash buffer`;
  else cash = 'no cash buffer';
  let split = null;
  if (plan.currentMix) split = { ...plan.currentMix };
  else if (plan.cashBuffer.amount === undefined && !plan.cashBuffer.years) split = { equities: plan.mix.equities, bonds: 1 - plan.mix.equities, cash: 0 };
  else if (request && request.pot > 0) {
    const c = bufferAmount(plan, request).amount / request.pot;
    split = { equities: (1 - c) * plan.mix.equities, bonds: (1 - c) * (1 - plan.mix.equities), cash: c };
  }
  const r = (x) => Math.round(x * 100);
  const mixLabel = split ? `${r(split.equities)}/${r(split.bonds)}/${r(split.cash)}` : mixText(plan);
  return { approach: s.label, pinned, cash, split, mixLabel, invested: { equities: plan.mix.equities, bonds: 1 - plan.mix.equities, cash: 0 } };
}

/**
 * The three recipe lines shown under each option: income, cash, the rest. Short by default;
 * `full` adds the finer rules of a kept cash buffer, for the option detail.
 */
export function recipe(plan, request, { full = false } = {}) {
  const profile = buildProfile(request);
  const p = plan.params;
  const wanted1 = profile.wanted[0];
  const other1 = profile.other[0];
  let income;
  switch (plan.strategy) {
    case 'constant-real': {
      // Same rule as the engine: earnings replace part of the withdrawal while they last, so
      // only lasting income (pensions and the like) adds to the year-1 total.
      const earned1 = profile.earned[0] || 0;
      const lasting1 = other1 - earned1;
      const total = p.rate * request.pot + lasting1;
      income = `${gbp(total)} a year${lasting1 ? ' including your other income' : ''} (${rate(p.rate)} of the pot), rising with inflation.`;
      if (earned1) income += ' Earnings cover part of it while they last.';
      if (request.incomeChange) {
        const at = request.age ? `age ${request.age + request.incomeChange.fromYear - 1}` : `year ${request.incomeChange.fromYear}`;
        income += ` Changes with your income from ${at}.`;
      }
      break;
    }
    case 'fixed-percentage':
      income = `${rate(p.rate)} of the pot each year, starting at ${gbp(p.rate * request.pot)}. Rises and falls with markets.`;
      break;
    case 'guyton-klinger':
      income = `${gbp(p.rate * request.pot)} a year (${rate(p.rate)} of the pot), rising with inflation except after a losing year. Cut ${pct(p.adjustment ?? 0.1)} if withdrawals get too high, raised ${pct(p.adjustment ?? 0.1)} if too low.`;
      break;
    case 'floor-ceiling': {
      const floor = Math.max(p.floorPct * wanted1, profile.minimum[0]);
      const ceiling = p.ceilingPct * wanted1;
      income = `${rate(p.rate)} of the pot each year, starting at ${gbp(wanted1)}, never below ${gbp(floor)} or above ${gbp(ceiling)} (rising with inflation).`;
      break;
    }
    default:
      income = getStrategy(plan.strategy).describe(p);
  }

  const { amount, planned } = bufferAmount(plan, request);
  let cash;
  if (amount <= 0) cash = 'none.';
  else if (plan.cashBuffer.amount !== undefined && plan.cashRule === 'flexible') {
    const r = plan.reserve || {};
    const yrs = planned > 0 ? amount / planned : 0;
    cash = `${gbp(amount)} (${pct(amount / request.pot)} of the pot${yrs ? `, about ${yrs.toFixed(1)} years of withdrawals` : ''}), kept at ${r.floorYears ?? 1} to ${r.maxYears ?? 3} years and topped up from investments.`;
    if (full) cash += ` It aims for ${r.targetYears ?? 2} years; cash above ${r.maxYears ?? 3} years is invested over ${r.phaseInYears ?? 5} years, and top-ups pause while investments are more than ${pct(r.downturnDrop ?? 0.1)} below their high.`;
  } else if (plan.cashBuffer.amount !== undefined) {
    const yrs = planned > 0 ? amount / planned : 0;
    cash = `${gbp(amount)} (${pct(amount / request.pot)} of the pot${yrs ? `, about ${yrs.toFixed(1)} years of withdrawals` : ''}), spent first.`;
  } else {
    cash = `${gbp(amount)} (${pct(amount / request.pot)} of the pot, ${plan.cashBuffer.years} year${plan.cashBuffer.years === 1 ? '' : 's'} of withdrawals), spent first.`;
  }
  const eq = Math.round(plan.mix.equities * 100);
  const split = eq === 100 ? 'all shares' : `${eq}% shares, ${100 - eq}% bonds`;
  const rest = plan.fromCurrent ? `${split}, as in your mix.` : `${split}.`;
  return { income, cash, rest };
}

/** How a plan's holdings differ from the user's mix, e.g. "90/10 shares and bonds, no cash". */
export function holdingsText(plan) {
  const eq = Math.round(plan.mix.equities * 100);
  const split = eq === 100 ? 'all shares' : `${eq}/${100 - eq} shares and bonds`;
  if (plan.cashBuffer.amount !== undefined) return `${split}, with your cash`;
  return plan.cashBuffer.years ? `${plan.cashBuffer.years} years of withdrawals in cash, the rest ${split}` : `${split}, no cash`;
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd". */
export function ordinal(n) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${suffix}`;
}

/**
 * Where a start year sits for the user's mix, counted from the nearer end:
 * rank 1 of 47 -> "Worst start of 47", 3 -> "3rd worst start of 47", 46 -> "2nd best start of 47".
 */
export function startPlace(rank, total) {
  const fromBest = total - rank + 1;
  if (rank === 1) return `Worst start of ${total}`;
  if (fromBest === 1) return `Best start of ${total}`;
  return rank <= fromBest ? `${ordinal(rank)} worst start of ${total}` : `${ordinal(fromBest)} best start of ${total}`;
}
