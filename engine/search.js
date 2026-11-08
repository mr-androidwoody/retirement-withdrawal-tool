// Build the grid of plans, run each against every past retirement, and pick the rows to show.

import { makeWindows } from './dataset.js';
import { simulate } from './simulate.js';
import { summarisePlan } from './metrics.js';
import { STRATEGIES } from './strategies.js';

/** Every strategy setting in the config, as { strategy, params }. */
export function strategySettings(config) {
  const gk = config.guytonKlinger || {};
  const out = [];
  for (const s of config.grid.strategies) {
    for (const rate of s.rates) {
      if (s.strategy === 'floor-ceiling') {
        for (const floorPct of s.floorPct) {
          for (const ceilingPct of s.ceilingPct) out.push({ strategy: s.strategy, params: { rate, floorPct, ceilingPct } });
        }
      } else if (s.strategy === 'guyton-klinger') {
        out.push({ strategy: s.strategy, params: { rate, ...gk } });
      } else {
        out.push({ strategy: s.strategy, params: { rate } });
      }
    }
  }
  return out;
}

/** The full grid: strategy settings x share mixes x cash buffers, in a fixed order. */
export function buildGrid(config) {
  const plans = [];
  for (const setting of strategySettings(config)) {
    for (const equities of config.grid.mixes) {
      for (const years of config.grid.cashBufferYears) {
        plans.push({ ...setting, mix: { equities }, cashBuffer: { years } });
      }
    }
  }
  return plans.map((p, gridIndex) => ({ ...p, gridIndex }));
}

export const SNAPSHOT_RULES = ['spend-first', 'flexible'];

/**
 * Plans for the pasted snapshot: its own mix and cash amount, with every strategy setting,
 * for one cash rule ('spend-first' or 'flexible').
 */
export function snapshotPlans(config, snapshot, firstIndex, cashRule = 'spend-first') {
  return strategySettings(config).map((setting, i) => ({
    ...setting,
    mix: { equities: snapshot.equitiesShare },
    cashBuffer: { amount: snapshot.cashBuffer },
    cashRule,
    ...(cashRule === 'flexible' ? { reserve: { ...config.cashReserve } } : {}),
    gridIndex: firstIndex + i,
    fromSnapshot: true,
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

// Same strategy and settings, ignoring mix and cash buffer.
const settingKey = (r) => `${r.plan.strategy}:${JSON.stringify(r.plan.params)}`;

export const ROWS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'safest', label: 'Safest income' },
  { id: 'highestIncome', label: 'Highest typical income' },
  { id: 'mostLeft', label: 'Most left behind' },
];

const best = (list, order) => (list.length ? [...list].sort(ORDER[order])[0] : null);

/** Why a plan is not among the options: one plain line. */
export function reasonNotShown(r, request) {
  if (r.failures > request.maxFailures) return `ran out in ${r.failures} of ${r.windows} past retirements`;
  if (r.failingMinimum > request.maxFailures) return `fell below your minimum in ${r.failingMinimum} of ${r.windows}`;
  return 'was beaten by the options above';
}

/**
 * The whole search. Returns everything the results page needs.
 * input: { dataset, config, request, snapshot? }
 */
export function runSearch({ dataset, config, request, snapshot = null }) {
  const windows = makeWindows(dataset, request.years, config.firstStartYear);
  if (windows.length === 0) throw new Error('No past retirements of that length in the data.');
  const thresholds = config.thresholds;
  const grid = buildGrid(config);
  const results = grid.map((p) => evaluatePlan(p, windows, request, thresholds));
  const eligible = results.filter((r) => r.status !== 'does-not-meet');

  // The four rows; a plan winning several is shown once with all its labels.
  const rows = [];
  if (eligible.length) {
    // Most left behind must not win by simply paying less: it chooses from plans that never
    // cut income below the income wanted, else from plans whose typical income reaches it,
    // else from all eligible plans.
    const neverCut = eligible.filter((r) => r.status === 'meets-both');
    const paysEnough = eligible.filter((r) => r.typicalIncome >= request.wanted - 1);
    const leftPool = neverCut.length ? neverCut : (paysEnough.length ? paysEnough : eligible);
    for (const row of ROWS) {
      const pool = row.id === 'mostLeft' ? leftPool : eligible;
      const winner = best(pool, row.id);
      const existing = rows.find((x) => x.result === winner);
      if (existing) existing.labels.push(row.label);
      else rows.push({ result: winner, labels: [row.label] });
    }
  }

  // Best plan of each strategy not already shown.
  const shown = new Set(rows.map((x) => x.result.plan.strategy));
  const others = Object.values(STRATEGIES)
    .filter((s) => !shown.has(s.id))
    .map((s) => {
      const family = results.filter((r) => r.plan.strategy === s.id);
      const pool = family.filter((r) => r.status !== 'does-not-meet');
      const pick = pool.length ? best(pool, 'recommended') : best(family, 'closest');
      return { strategy: s.id, result: pick, reason: reasonNotShown(pick, request) };
    });

  // Your portfolio as it is now: one row per cash rule.
  const snapshotRows = [];
  if (snapshot) {
    const per = strategySettings(config).length;
    SNAPSHOT_RULES.forEach((rule, k) => {
      const own = snapshotPlans(config, snapshot, grid.length + k * per, rule).map((p) => evaluatePlan(p, windows, request, thresholds));
      const pool = own.filter((r) => r.status !== 'does-not-meet');
      snapshotRows.push({ cashRule: rule, result: pool.length ? best(pool, 'recommended') : best(own, 'closest'), meetsNeeds: pool.length > 0 });
    });
  }

  // Nothing eligible: the closest three, and what would have to change.
  const closest = [];
  if (!eligible.length) {
    const seen = new Set();
    for (const r of [...results].sort(ORDER.closest)) {
      if (seen.has(settingKey(r))) continue;
      seen.add(settingKey(r));
      closest.push(r);
      if (closest.length === 3) break;
    }
  }

  return {
    datasetId: dataset.id,
    datasetVersion: dataset.version,
    windows: windows.map((w) => ({ startYear: w.startYear, endYear: w.endYear })),
    plansTried: grid.length + (snapshot ? SNAPSHOT_RULES.length * strategySettings(config).length : 0),
    eligibleCount: eligible.length,
    rows,
    others,
    snapshotRows,
    snapshotRow: snapshotRows[0] || null,
    closest,
    results,
  };
}

/**
 * What-if: the same plan with a different cash buffer (years) or share mix.
 * Returns [{ value, result }] in order.
 */
export function whatIf({ dataset, config, request, plan, dimension, values }) {
  const windows = makeWindows(dataset, request.years, config.firstStartYear);
  return values.map((value) => {
    const variant = dimension === 'cashBuffer'
      ? { ...plan, cashBuffer: { years: value } }
      : { ...plan, mix: { equities: value } };
    return { value, result: evaluatePlan(variant, windows, request, config.thresholds) };
  });
}
