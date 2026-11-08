// Print the results for every preset, for review before the interface exists,
// and keep the golden file that the tests compare against.
//
// Usage (from the repo root):
//   node tools/print-results.mjs                  writes tools/results-report.md
//   node tools/print-results.mjs --update-golden  also rewrites tests/golden/presets.json
//
// Only update the golden file when a change to the numbers is intended.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { validateDataset } from '../engine/dataset.js';
import { runSearch } from '../engine/search.js';
import { getStrategy } from '../engine/strategies.js';

const root = new URL('../', import.meta.url);
const dataset = validateDataset(JSON.parse(readFileSync(new URL('data/jst-r6-global-gbp.json', root))));
const config = JSON.parse(readFileSync(new URL('data/config.json', root)));

const gbp = (x) => (x === null ? 'n/a' : `£${Math.round(x).toLocaleString('en-GB')}`);
const pct = (x) => `${Math.round(x * 100)}%`;

export function planName(plan) {
  const s = getStrategy(plan.strategy);
  const buffer = plan.cashBuffer.amount !== undefined
    ? `£${Math.round(plan.cashBuffer.amount).toLocaleString('en-GB')} cash`
    : (plan.cashBuffer.years ? `${plan.cashBuffer.years}-year cash buffer` : 'no cash buffer');
  const eq = Math.round(plan.mix.equities * 100);
  return `${s.label} ${+(plan.params.rate * 100).toFixed(2)}%${plan.params.floorPct ? `, floor ${pct(plan.params.floorPct)}` : ''}, ${buffer}, ${eq}/${100 - eq} shares and bonds`;
}

/** The figures the golden file locks down, rounded so harmless float noise cannot break it. */
export function goldenView(result) {
  const view = (r) => ({
    plan: { strategy: r.plan.strategy, params: r.plan.params, mix: r.plan.mix, cashBuffer: r.plan.cashBuffer },
    status: r.status,
    typicalIncome: Math.round(r.typicalIncome),
    worstIncome: r.worstIncome === null ? null : Math.round(r.worstIncome),
    ranOutOrNearly: r.ranOutOrNearly,
    cutCount: r.cutCount,
    medianEnd: Math.round(r.medianEnd),
    worstDrawdown: Math.round(r.worstDrawdown * 1000) / 1000,
  });
  return {
    windows: result.windows.length,
    eligible: result.eligibleCount,
    rows: result.rows.map((x) => ({ labels: x.labels, ...view(x.result) })),
    others: result.others.map((o) => ({ strategy: o.strategy, reason: o.reason, ...view(o.result) })),
    closest: result.closest.map(view),
  };
}

export function runPresets() {
  return config.presets.map((p) => {
    const request = { ...config.defaults, ...p.values };
    return { preset: p, request, result: runSearch({ dataset, config, request }) };
  });
}

function report(runs) {
  const lines = [
    '# Results for the example presets',
    '',
    `Dataset \`${dataset.id}\` ${dataset.version}. All figures in today's money. Fee ${config.defaults.annualFee * 100}% a year.`,
    'Ran out, or nearly: out of the past retirements tested. Income cut: retirements with any year below the income wanted.',
    'Worst year: lowest income in any retirement that did not run out. Biggest fall: largest drop in the investments from a high point (year-end values).',
    '',
  ];
  for (const { preset, request, result } of runs) {
    const n = result.windows.length;
    lines.push(`## ${preset.label}`, '');
    const change = request.incomeChange
      ? `; from year ${request.incomeChange.fromYear} wanted ${gbp(request.incomeChange.wanted)}, minimum ${gbp(request.incomeChange.minimum)}` : '';
    lines.push(`Pot ${gbp(request.pot)}, ${request.years} years, wanted ${gbp(request.wanted)}, minimum ${gbp(request.minimum)}${change}, up to ${request.maxFailures} of ${n} may run out. ${result.plansTried} plans tried, ${result.eligibleCount} meet the needs.`, '');
    if (result.rows.length) {
      lines.push('| Option | Plan | Typical income | Worst year | Ran out, or nearly | Income cut | Typically left | Biggest fall |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const row of result.rows) {
        const r = row.result;
        lines.push(`| ${row.labels.join(', ')} | ${planName(r.plan)} | ${gbp(r.typicalIncome)} | ${gbp(r.worstIncome)} | ${r.ranOutOrNearly} of ${n} | ${r.cutCount} of ${n} | ${gbp(r.medianEnd)} | ${pct(r.worstDrawdown)} |`);
      }
      lines.push('');
    } else {
      lines.push('No plan meets these needs. Closest:', '');
      for (const r of result.closest) {
        lines.push(`- ${planName(r.plan)}: falls below the minimum or runs out in ${r.failingMinimum} of ${n}; typical income ${gbp(r.typicalIncome)}`);
      }
      lines.push('');
    }
    if (result.others.length) {
      lines.push('Other approaches:', '');
      for (const o of result.others) {
        lines.push(`- ${planName(o.result.plan)}: typical ${gbp(o.result.typicalIncome)}, worst year ${gbp(o.result.worstIncome)}; not shown because it ${o.reason}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

const isMain = import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) {
  const runs = runPresets();
  writeFileSync(new URL('tools/results-report.md', root), report(runs));
  console.log('Wrote tools/results-report.md');
  if (process.argv.includes('--update-golden')) {
    mkdirSync(new URL('tests/golden/', root), { recursive: true });
    const golden = Object.fromEntries(runs.map((r) => [r.preset.id, goldenView(r.result)]));
    writeFileSync(new URL('tests/golden/presets.json', root), `${JSON.stringify(golden, null, 1)}\n`);
    console.log('Wrote tests/golden/presets.json');
  }
}
