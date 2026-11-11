// Build the grid of plans, run each against every past retirement, and pick the rows to show.

import { makeWindows } from './dataset.js';
import { simulate } from './simulate.js';
import { summarisePlan } from './metrics.js';
import { STRATEGIES } from './strategies.js';
import { buildProfile } from './profile.js';
import { withAllowedFailures } from './periods.js';

/**
 * The starting rate that pays exactly the income wanted in year 1: wanted income less any
 * lasting income already in force (pensions; earnings are left out because they stop),
 * as a share of the pot. Null when the pot or the need is zero.
 */
export function pinnedRate(request) {
  if (!request || !(request.pot > 0)) return null;
  const p = buildProfile(request);
  const lasting = p.other[0] - (p.earned?.[0] || 0);
  const rate = Math.max(0, p.wanted[0] - lasting) / request.pot;
  return rate > 0 && Number.isFinite(rate) ? rate : null;
}

/**
 * Every strategy setting, as { strategy, params }. With a request, each strategy is also
 * tried at the rate that pays exactly the income wanted (params.pinned = true), so there is
 * always an option at the user's own figure.
 */
export function strategySettings(config, request = null) {
  const gk = config.guytonKlinger || {};
  const pin = pinnedRate(request);
  const out = [];
  for (const s of config.grid.strategies) {
    const rates = [...s.rates];
    if (pin !== null && !rates.some((x) => Math.abs(x - pin) < 1e-4)) rates.push(pin);
    for (const rate of rates) {
      const pinned = pin !== null && Math.abs(rate - pin) < 1e-4;
      if (s.strategy === 'floor-ceiling') {
        for (const floorPct of s.floorPct) {
          for (const ceilingPct of s.ceilingPct) out.push({ strategy: s.strategy, params: { rate, floorPct, ceilingPct, ...(pinned ? { pinned } : {}) } });
        }
      } else if (s.strategy === 'guyton-klinger') {
        out.push({ strategy: s.strategy, params: { rate, ...gk, ...(pinned ? { pinned } : {}) } });
      } else {
        out.push({ strategy: s.strategy, params: { rate, ...(pinned ? { pinned } : {}) } });
      }
    }
  }
  return out;
}

/** The full grid: strategy settings x share mixes x cash buffers, in a fixed order. */
export function buildGrid(config, request = null) {
  const plans = [];
  for (const setting of strategySettings(config, request)) {
    for (const equities of config.grid.mixes) {
      for (const years of config.grid.cashBufferYears) {
        plans.push({ ...setting, mix: { equities }, cashBuffer: { years } });
      }
    }
  }
  return plans.map((p, gridIndex) => ({ ...p, gridIndex }));
}

export const CASH_RULES = ['spend-first', 'flexible'];

/**
 * The user's current mix as a plan shape. mix = { equities, bonds, cash } as fractions of the
 * pot (they should add to 1). Cash becomes a cash amount; equities and bonds become the mix of
 * the invested part.
 */
export function currentFromMix(pot, mix) {
  const invested = mix.equities + mix.bonds;
  return {
    pot,
    mix,
    cashBuffer: pot * mix.cash,
    equitiesShare: invested > 0 ? mix.equities / invested : 0,
  };
}

/**
 * Plans for the current mix: its own split and cash amount, with every strategy setting,
 * for one cash rule ('spend-first' or 'flexible').
 */
export function currentPlans(config, current, firstIndex, cashRule = 'spend-first', request = null) {
  return strategySettings(config, request).map((setting, i) => ({
    ...setting,
    mix: { equities: current.equitiesShare },
    cashBuffer: { amount: current.cashBuffer },
    cashRule,
    ...(cashRule === 'flexible' ? { reserve: { ...config.cashReserve } } : {}),
    gridIndex: firstIndex + i,
    fromCurrent: true,
    currentMix: current.mix,
  }));
}

/** Run one plan against every window and summarise it. */
export function evaluatePlan(plan, windows, request, thresholds) {
  const paths = windows.map((w) => simulate(plan, w, request, { thresholds }));
  const summary = summarisePlan(paths, request);
  return { plan, ...summary, status: statusOf(summary, request), paths };
}

export function statusOf(s, request) {
  if (s.fallingShort <= request.maxFailures) return 'meets-both';
  if (s.failingMinimum <= request.maxFailures) return 'meets-minimum';
  return 'does-not-meet';
}

// ---------- ordering ----------

const byIndex = (a, b) => a.plan.gridIndex - b.plan.gridIndex;
const worst = (r) => (r.worstIncome ?? -Infinity);
const STATUS_RANK = { 'meets-both': 0, 'meets-minimum': 1, 'does-not-meet': 2 };

// Incomes within a pound count as equal, so ties fall through to the next rule.
const more = (x, y) => (Math.abs(x - y) < 1 ? 0 : y - x);

export const ORDER = {
  recommended: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]
    || more(a.typicalIncome, b.typicalIncome) || a.ranOutOrNearly - b.ranOutOrNearly
    || more(worst(a), worst(b)) || more(a.medianEnd, b.medianEnd) || byIndex(a, b),
  safest: (a, b) => a.ranOutOrNearly - b.ranOutOrNearly || more(worst(a), worst(b))
    || more(a.typicalIncome, b.typicalIncome) || more(a.medianEnd, b.medianEnd) || byIndex(a, b),
  highestIncome: (a, b) => more(a.typicalIncome, b.typicalIncome) || a.ranOutOrNearly - b.ranOutOrNearly
    || more(worst(a), worst(b)) || more(a.medianEnd, b.medianEnd) || byIndex(a, b),
  mostLeft: (a, b) => more(a.medianEnd, b.medianEnd) || a.ranOutOrNearly - b.ranOutOrNearly
    || more(worst(a), worst(b)) || byIndex(a, b),
  closest: (a, b) => a.failingMinimum - b.failingMinimum || more(a.typicalIncome, b.typicalIncome) || byIndex(a, b),
};


export const ROWS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'safest', label: 'Safest income' },
  { id: 'highestIncome', label: 'Highest typical income' },
  { id: 'mostLeft', label: 'Most left behind' },
];

const best = (list, order) => (list.length ? [...list].sort(ORDER[order])[0] : null);

/**
 * Plans that pay what you asked for, so "most left behind" cannot win by simply paying less:
 * plans that never cut income below the income wanted, else plans whose typical income
 * reaches it in every stage (each stage against its own wanted income), else the whole list.
 * `list` holds plans that already meet the needs.
 */
function paysWhatYouAsked(list) {
  const neverCut = list.filter((r) => r.status === 'meets-both');
  if (neverCut.length) return neverCut;
  const paysEnough = list.filter((r) => r.typicalByStage.every((st) => st.typical >= st.wanted - 1));
  return paysEnough.length ? paysEnough : list;
}

/**
 * The recommended plan from a list of plans that meet the needs, by what matters more if
 * there is room to spare (request.priority): 'spend' (the default) picks the highest typical
 * spending; 'pass-on' picks the plan that pays what you asked for and typically leaves most.
 */
export function recommendFrom(list, request) {
  if (request.priority === 'pass-on') return best(paysWhatYouAsked(list), 'mostLeft');
  return best(list, 'recommended');
}

const pounds = (x) => `\u00a3${Math.round(x).toLocaleString('en-GB')}`;

/** Why a plan is not among the options: one plain line. */
export function reasonNotShown(r, request) {
  const max = request.maxFailures;
  if (r.failures > max) return `ran out in ${r.failures} of ${r.windows} past retirements`;
  const income = r.failingIncome ?? r.failingMinimum;
  if (income > max) return `fell below your minimum in ${income} of ${r.windows}`;
  if (request.leaveAtLeast > 0 && r.leftShort > max) return `left less than ${pounds(request.leaveAtLeast)} in ${r.leftShort} of ${r.windows}`;
  if (r.failingMinimum > max) return `fell below your minimum or left less than ${pounds(request.leaveAtLeast)} in ${r.failingMinimum} of ${r.windows}`;
  return 'was beaten by the options above';
}

/**
 * The whole search. Returns everything the results page needs.
 * input: { dataset, config, request, current?, keepMix? }
 *   current  from currentFromMix: adds the "your mix as it is now" rows
 *   keepMix  true: every option uses the current mix; only approach, rate and cash rule vary
 */
export function runSearch({ dataset, config, request: input, current = null, keepMix = false }) {
  const windows = makeWindows(dataset, input.years, config.firstStartYear);
  if (windows.length === 0) throw new Error('No past retirements of that length in the data.');
  // "About 1 in 20" becomes a count for this number of past retirements.
  const request = withAllowedFailures(input, windows.length);
  const thresholds = config.thresholds;
  const perRule = strategySettings(config, request).length;
  const onlyMine = Boolean(keepMix && current);
  const grid = onlyMine
    ? CASH_RULES.flatMap((rule, k) => currentPlans(config, current, k * perRule, rule, request))
    : buildGrid(config, request);
  const results = grid.map((p) => evaluatePlan(p, windows, request, thresholds));
  const eligible = results.filter((r) => r.status !== 'does-not-meet');

  // The four rows; a plan winning several is shown once with all its labels.
  const rows = [];
  if (eligible.length) {
    // Most left behind must not win by simply paying less (see paysWhatYouAsked).
    const leftPool = paysWhatYouAsked(eligible);
    for (const row of ROWS) {
      const winner = row.id === 'recommended' ? recommendFrom(eligible, request)
        : best(row.id === 'mostLeft' ? leftPool : eligible, row.id);
      const existing = rows.find((x) => x.result === winner);
      if (existing) existing.labels.push(row.label);
      else rows.push({ result: winner, labels: [row.label] });
    }
  }

  // Best plan of each strategy not already shown. When nothing meets the needs, these are
  // the nearest misses instead (see `closest` below).
  const shown = new Set(rows.map((x) => x.result.plan.strategy));
  let others = Object.values(STRATEGIES)
    .filter((s) => !shown.has(s.id))
    .map((s) => {
      const family = results.filter((r) => r.plan.strategy === s.id);
      const pool = family.filter((r) => r.status !== 'does-not-meet');
      const pick = pool.length ? recommendFrom(pool, request) : best(family, 'closest');
      return { strategy: s.id, result: pick, reason: reasonNotShown(pick, request) };
    });

  // Your mix as it is now: one row per cash rule (not needed when every option is your mix).
  const currentRows = [];
  if (current && !onlyMine) {
    CASH_RULES.forEach((rule, k) => {
      const own = currentPlans(config, current, grid.length + k * perRule, rule, request).map((p) => evaluatePlan(p, windows, request, thresholds));
      const pool = own.filter((r) => r.status !== 'does-not-meet');
      currentRows.push({ cashRule: rule, result: pool.length ? recommendFrom(pool, request) : best(own, 'closest'), meetsNeeds: pool.length > 0 });
    });
  }

  // Nothing eligible: the nearest miss of each approach, closest first. One per approach, so
  // the list never repeats a plan (variants of one approach often come out the same when a
  // floor holds the income), and the "other approaches" list is not needed as well.
  let closest = [];
  if (!eligible.length) {
    closest = others.map((o) => o.result).sort(ORDER.closest);
    others = [];
  }

  return {
    datasetId: dataset.id,
    datasetVersion: dataset.version,
    windows: windows.map((w) => ({ startYear: w.startYear, endYear: w.endYear })),
    maxFailures: request.maxFailures,
    plansTried: grid.length + (current && !onlyMine ? CASH_RULES.length * perRule : 0),
    keepMix: onlyMine,
    eligibleCount: eligible.length,
    rows,
    others,
    currentRows,
    closest,
    results,
  };
}

/**
 * What-if: the same plan with a different cash buffer (years) or share mix.
 * Returns [{ value, result }] in order.
 */
export function whatIf({ dataset, config, request: input, plan, dimension, values }) {
  const windows = makeWindows(dataset, input.years, config.firstStartYear);
  const request = withAllowedFailures(input, windows.length);
  return values.map((value) => {
    const variant = dimension === 'cashBuffer'
      ? { ...plan, cashBuffer: { years: value } }
      : { ...plan, mix: { equities: value } };
    return { value, result: evaluatePlan(variant, windows, request, config.thresholds) };
  });
}
