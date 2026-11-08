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
    name: 'Constant real',
    aka: 'the "4% rule" approach',
    about: 'Take a set amount in the first year, then raise it with inflation every year, whatever the markets do.',
    tradeOff: 'Steady, predictable income. The pot takes all the market risk, so a run of bad early years can empty it.',
  },
  'fixed-percentage': {
    name: 'Fixed percentage',
    aka: '',
    about: 'Take the same percentage of whatever the pot is worth each year, so income rises and falls with the markets.',
    tradeOff: 'It can never run out, but income swings with the markets, including deep cuts after a fall.',
  },
  'guyton-klinger': {
    name: 'Guyton-Klinger guardrails',
    aka: 'GK',
    about: 'Start like constant real, but skip the inflation rise after a losing year, and cut or raise income by 10% when the withdrawal rate drifts 20% from where it started.',
    tradeOff: 'Income stays mostly steady, with occasional 10% cuts or rises. That flexibility usually allows a higher starting amount than constant real.',
  },
  'floor-ceiling': {
    name: 'Floor and ceiling',
    aka: '',
    about: 'Take a percentage of the pot each year, but never less than a floor or more than a ceiling, both rising with inflation.',
    tradeOff: 'Income follows the markets within set limits. The floor protects your spending, but it keeps drawing at that level through bad years.',
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
    buffer = plan.cashRule === 'flexible' ? 'your cash kept as a 1 to 3 year reserve' : 'your cash spent first';
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

/** The three recipe lines shown under each option: income, cash, the rest. */
export function recipe(plan, request) {
  const profile = buildProfile(request);
  const p = plan.params;
  const wanted1 = profile.wanted[0];
  const other1 = profile.other[0];
  let income;
  switch (plan.strategy) {
    case 'constant-real': {
      const total = p.rate * request.pot + other1;
      income = `${gbp(total)} a year${other1 ? ' including your other income' : ''} (${rate(p.rate)} of the pot), rising with inflation every year.`;
      if (request.incomeChange) {
        const at = request.age ? `age ${request.age + request.incomeChange.fromYear - 1}` : `year ${request.incomeChange.fromYear}`;
        income += ` Changes in step with your income from ${at}.`;
      }
      break;
    }
    case 'fixed-percentage':
      income = `takes ${rate(p.rate)} of the pot each year, starting at ${gbp(p.rate * request.pot)}, so income rises and falls with markets.`;
      break;
    case 'guyton-klinger':
      income = `starts at ${gbp(p.rate * request.pot)} (${rate(p.rate)} of the pot) and rises with inflation, except after a losing year. Cut by ${pct(p.adjustment ?? 0.1)} if the withdrawal rate climbs ${pct(p.guardrail ?? 0.2)} above the start, raised by ${pct(p.adjustment ?? 0.1)} if it falls ${pct(p.guardrail ?? 0.2)} below.`;
      break;
    case 'floor-ceiling': {
      const floor = Math.max(p.floorPct * wanted1, profile.minimum[0]);
      const ceiling = p.ceilingPct * wanted1;
      income = `starts on ${gbp(wanted1)}, then each year takes ${rate(p.rate)} of the pot, never less than ${gbp(floor)} or more than ${gbp(ceiling)} (rising with inflation).`;
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
    cash = `${gbp(amount)} (${pct(amount / request.pot)} of the pot)${yrs ? ` (about ${yrs.toFixed(1)} years of withdrawals)` : ''}, kept between ${r.floorYears ?? 1} and ${r.maxYears ?? 3} years of withdrawals, aiming for ${r.targetYears ?? 2}. Cash above ${r.maxYears ?? 3} years is invested over ${r.phaseInYears ?? 5} years. Top-ups from investments pause while they are more than ${pct(r.downturnDrop ?? 0.1)} below their high.`;
  } else if (plan.cashBuffer.amount !== undefined) {
    const yrs = planned > 0 ? amount / planned : 0;
    cash = `${gbp(amount)} (${pct(amount / request.pot)} of the pot), spent first${yrs ? ` (about ${yrs.toFixed(1)} years of withdrawals)` : ''}.`;
  } else {
    cash = `starts at ${gbp(amount)} (${plan.cashBuffer.years} years of withdrawals, ${pct(amount / request.pot)} of the pot), spent first.`;
  }
  const eq = Math.round(plan.mix.equities * 100);
  const split = eq === 100 ? 'all shares' : `${eq}% shares, ${100 - eq}% bonds`;
  const rest = plan.fromCurrent ? `${split} of the invested part, as in your current mix.` : `${split}.`;
  return { income, cash, rest };
}

/** How a plan's holdings differ from the user's mix, e.g. "90/10 shares and bonds, no cash". */
export function holdingsText(plan) {
  const eq = Math.round(plan.mix.equities * 100);
  const split = eq === 100 ? 'all shares' : `${eq}/${100 - eq} shares and bonds`;
  if (plan.cashBuffer.amount !== undefined) return `${split}, with your cash`;
  return plan.cashBuffer.years ? `${plan.cashBuffer.years} years of withdrawals in cash, the rest ${split}` : `${split}, no cash`;
}
