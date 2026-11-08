// Plain-English names and recipes for plans, and number formatting.

import { getStrategy } from '../engine/strategies.js';
import { buildProfile } from '../engine/profile.js';

export const gbp = (x) => (x === null || x === undefined || !Number.isFinite(x)
  ? 'n/a' : `£${Math.round(x).toLocaleString('en-GB')}`);
export const pct = (x, dp = 0) => `${(x * 100).toFixed(dp)}%`;
export const rate = (x) => `${+(x * 100).toFixed(2)}%`;

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Parse a typed amount: "1,843,050", "£600000", " 22500 " -> number, or NaN. */
export function parseAmount(s) {
  const t = String(s ?? '').replace(/[£,\s]/g, '');
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
