// The page: wizard, results and option detail. All modelling happens in engine/.

import { validateDataset, makeWindows } from '../engine/dataset.js';
import { runSearch, whatIf, buildGrid, strategySettings } from '../engine/search.js';
import { simulate } from '../engine/simulate.js';
import { parseSnapshot } from '../engine/snapshot.js';
import { buildProfile } from '../engine/profile.js';
import { gbp, pct, escapeHtml, parseAmount, formatAmount, planName, recipe } from './format.js';
import { lineChart } from './charts.js';

const $ = (id) => document.getElementById(id);
const state = {
  config: null,
  dataset: null,
  snapshot: null,
  maxFailures: 1,
  result: null,
  request: null,
  openable: [],
  detail: null,
};

const EVENT_TEXT = {
  cut: 'Cut',
  raise: 'Raised',
  'skip-inflation': 'No inflation rise',
  'inflation-capped': 'Rise capped',
  floor: 'At the floor',
  ceiling: 'At the ceiling',
};

// ---------------------------------------------------------------- loading

async function load() {
  try {
    const config = await (await fetch('data/config.json')).json();
    const dataset = validateDataset(await (await fetch(config.dataset)).json());
    state.config = config;
    state.dataset = dataset;
    initForm();
  } catch (err) {
    $('source-line').textContent = `The historical data could not be loaded (${err.message}).`;
  }
}

function windowsFor(years) {
  return makeWindows(state.dataset, years, state.config.firstStartYear);
}

// ---------------------------------------------------------------- form

function initForm() {
  const { config } = state;

  // Retirement lengths that the data can test.
  const lengths = config.retirementLengths.filter((y) => windowsFor(y).length > 0);
  $('years').innerHTML = lengths.map((y) => `<option value="${y}">${y} years</option>`).join('');

  // Presets.
  $('presets').innerHTML = config.presets.map((p) =>
    `<button type="button" class="chip" aria-pressed="false" data-preset="${p.id}">${escapeHtml(p.label)}</button>`).join('');
  $('presets').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (btn) applyPreset(btn.dataset.preset);
  });

  // Risk choices.
  $('risk').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-risk]');
    if (!btn) return;
    state.maxFailures = Number(btn.dataset.risk);
    clearPreset();
    renderRisk();
    refresh();
  });

  // Toggles.
  $('toggle-change').addEventListener('click', () => showBox('change', true));
  $('remove-change').addEventListener('click', () => showBox('change', false));
  $('toggle-other').addEventListener('click', () => showBox('other', true));
  $('remove-other').addEventListener('click', () => showBox('other', false));
  $('add-other2').addEventListener('click', () => { $('other2').hidden = false; $('add-other2').hidden = true; });
  $('toggle-fee').addEventListener('click', () => {
    const open = $('fee-box').hidden;
    $('fee-box').hidden = !open;
    $('toggle-fee').setAttribute('aria-expanded', String(open));
    if (open) $('fee').focus();
  });

  // Snapshot paste-in.
  $('snapshot').addEventListener('input', onSnapshot);

  // Any edit refreshes the goal; money fields get thousands separators on blur.
  $('plan-form').addEventListener('input', (e) => {
    if (e.target.id !== 'snapshot') clearPreset();
    refresh();
  });
  $('plan-form').addEventListener('change', refresh);
  for (const id of ['pot', 'wanted', 'minimum', 'change-wanted', 'change-minimum', 'other1-amount', 'other2-amount']) {
    $(id).addEventListener('blur', () => {
      const v = parseAmount($(id).value);
      if (Number.isFinite(v)) $(id).value = formatAmount(v);
    });
  }
  $('plan-form').addEventListener('submit', onFind);

  $('footnote').innerHTML = 'All figures are in today’s money. Historical data: Jordà-Schularick-Taylor Macrohistory Database, Release 6 '
    + '(<a href="https://www.macrohistory.net/database/">macrohistory.net</a>), used under its non-commercial licence. '
    + 'Global shares are a GDP-weighted mix of 16 developed markets, converted to pounds at year-end exchange rates; bonds are UK gilts and cash is UK Treasury bills; inflation is UK CPI.';

  $('fee').value = (config.defaults.annualFee * 100).toFixed(2);
  applyValues(config.defaults);
  const typical = config.presets.find((p) => p.id === 'typical');
  if (typical) applyPreset('typical');
}

function showBox(which, open) {
  $(`${which}-box`).hidden = !open;
  $(`toggle-${which}`).hidden = open;
  $(`toggle-${which}`).setAttribute('aria-expanded', String(open));
  if (open) $(which === 'change' ? 'change-year' : 'other1-amount').focus();
  clearPreset();
  refresh();
}

function applyValues(v) {
  if (v.pot !== undefined) $('pot').value = formatAmount(v.pot);
  if (v.years !== undefined) $('years').value = String(v.years);
  if (v.wanted !== undefined) $('wanted').value = formatAmount(v.wanted);
  if (v.minimum !== undefined) $('minimum').value = formatAmount(v.minimum);
  if (v.maxFailures !== undefined) state.maxFailures = v.maxFailures;
  if (v.incomeChange) {
    $('change-year').value = v.incomeChange.fromYear;
    $('change-wanted').value = formatAmount(v.incomeChange.wanted);
    $('change-minimum').value = formatAmount(v.incomeChange.minimum);
    $('change-box').hidden = false;
    $('toggle-change').hidden = true;
  } else {
    $('change-box').hidden = true;
    $('toggle-change').hidden = false;
  }
}

function applyPreset(id) {
  const p = state.config.presets.find((x) => x.id === id);
  if (!p) return;
  // A preset sets the pot, so a pasted snapshot no longer applies.
  if (state.snapshot) { $('snapshot').value = ''; onSnapshot(); }
  applyValues({ incomeChange: null, ...p.values });
  for (const b of $('presets').querySelectorAll('[data-preset]')) b.setAttribute('aria-pressed', String(b.dataset.preset === id));
  renderRisk();
  refresh();
}

function clearPreset() {
  for (const b of $('presets').querySelectorAll('[aria-pressed="true"]')) b.setAttribute('aria-pressed', 'false');
}

function onSnapshot() {
  const text = $('snapshot').value;
  const box = $('snapshot-status');
  if (!text.trim()) {
    state.snapshot = null;
    box.hidden = true;
    refresh();
    return;
  }
  const s = parseSnapshot(text);
  box.hidden = false;
  if (!s.ok) {
    state.snapshot = null;
    box.className = 'status error';
    box.textContent = `Nothing was filled in: ${s.error}`;
  } else {
    state.snapshot = s;
    $('pot').value = formatAmount(s.net);
    box.className = 'status ok';
    box.innerHTML = `<span>Read${s.date ? ` from ${escapeHtml(s.date)} snapshot` : ''}: <strong>pot ${gbp(s.net)}</strong> · cash buffer ${gbp(s.cashBuffer)} · invested ${Math.round(s.equitiesShare * 100)}% shares, ${100 - Math.round(s.equitiesShare * 100)}% bonds</span>`
      + '<button type="button" class="link" id="edit-pot">Edit</button>';
    $('edit-pot').addEventListener('click', () => $('pot').focus());
    clearPreset();
  }
  refresh();
}

function renderRisk() {
  const years = Number($('years').value);
  const n = windowsFor(years).length;
  $('risk-hint').textContent = `Of the ${n} past retirements, how many may run out of money?`;
  const options = [0, 1, 2, 3].filter((k) => k < n);
  if (state.maxFailures >= n) state.maxFailures = 0;
  $('risk').innerHTML = options.map((k) =>
    `<button type="button" role="radio" data-risk="${k}" aria-checked="${k === state.maxFailures}">${k === 0 ? 'None' : `Up to ${k}`}</button>`).join('');
}

/** Read the form into a request; returns { request, errors }. */
function readRequest() {
  const errors = [];
  const years = Number($('years').value);
  const pot = parseAmount($('pot').value);
  const wanted = parseAmount($('wanted').value);
  const minimum = parseAmount($('minimum').value);
  const fee = Number(String($('fee').value).replace('%', '')) / 100;
  const mark = (id, bad) => $(id).setAttribute('aria-invalid', String(bad));

  mark('pot', !(pot > 0)); if (!(pot > 0)) errors.push('Enter the size of your pot.');
  mark('wanted', !(wanted > 0)); if (!(wanted > 0)) errors.push('Enter the income you want.');
  const minBad = !(minimum >= 0) || (wanted > 0 && minimum > wanted);
  mark('minimum', minBad);
  if (minBad) errors.push('The lowest you could live on must be a figure no higher than the income you want.');
  if (!(fee >= 0 && fee <= 0.03)) errors.push('Charges should be between 0% and 3% a year.');

  let incomeChange = null;
  if (!$('change-box').hidden) {
    const fromYear = Number($('change-year').value);
    const cw = parseAmount($('change-wanted').value);
    const cm = parseAmount($('change-minimum').value);
    const yearBad = !(Number.isInteger(fromYear) && fromYear >= 2 && fromYear <= years);
    mark('change-year', yearBad);
    mark('change-wanted', !(cw > 0));
    mark('change-minimum', !(cm >= 0 && cm <= cw));
    if (yearBad) errors.push(`The income change must start between year 2 and year ${years}.`);
    if (!(cw > 0) || !(cm >= 0 && cm <= cw)) errors.push('Enter the later income you want, and a later minimum no higher than it.');
    if (!yearBad && cw > 0 && cm >= 0 && cm <= cw) incomeChange = { fromYear, wanted: cw, minimum: cm };
  }

  const otherIncome = [];
  if (!$('other-box').hidden) {
    for (const k of [1, 2]) {
      if (k === 2 && $('other2').hidden) continue;
      const amount = parseAmount($(`other${k}-amount`).value);
      const fromYear = Number($(`other${k}-year`).value || 1);
      if (!Number.isFinite(amount)) continue;
      const bad = !(amount >= 0) || !(Number.isInteger(fromYear) && fromYear >= 1 && fromYear <= years);
      mark(`other${k}-amount`, !(amount >= 0));
      mark(`other${k}-year`, bad && amount >= 0);
      if (bad) { errors.push(`Check the amount and start year of "${$(`other${k}-label`).value}".`); continue; }
      otherIncome.push({ label: $(`other${k}-label`).value.trim() || 'Other income', amount, fromYear });
    }
  }

  return {
    request: { pot, years, wanted, minimum, incomeChange, otherIncome, maxFailures: state.maxFailures, annualFee: fee },
    errors,
  };
}

function planCount() {
  return buildGrid(state.config).length + (state.snapshot ? strategySettings(state.config).length : 0);
}

function refresh() {
  if (!state.dataset) return;
  const years = Number($('years').value);
  const windows = windowsFor(years);
  const first = windows[0]?.startYear;
  const last = windows.at(-1)?.startYear;
  const n = windows.length;
  if ($('risk').childElementCount === 0 || $('risk').dataset.years !== String(years)) {
    renderRisk();
    $('risk').dataset.years = String(years);
  }

  $('source-line').textContent = `Tested against ${n} real retirements starting ${first} to ${last} · global shares in £, UK gilts and cash, UK inflation`;
  const count = planCount();
  for (const el of document.querySelectorAll('[data-bind="plan-count"]')) el.textContent = count.toLocaleString('en-GB');
  for (const el of document.querySelectorAll('[data-bind="plan-count-number"]')) el.textContent = count.toLocaleString('en-GB');

  const g = state.config.grid;
  const mixes = `${Math.round(g.mixes[0] * 100)}% to ${Math.round(g.mixes.at(-1) * 100)}% shares`;
  const buffers = `cash buffers of ${g.cashBufferYears.slice(0, -1).join(', ')} and ${g.cashBufferYears.at(-1)} years`;
  const fee = Number($('fee').value);
  $('settings-summary').textContent = `Global shares (£) and UK gilts · starts ${first} to ${last} · all four approaches · ${mixes} · ${buffers}${state.snapshot ? ' · plus your current portfolio' : ''} · charges ${Number.isFinite(fee) ? fee : '?'}% a year`;

  // Goal in words.
  const { request } = readRequest();
  const has = (x) => Number.isFinite(x) && x > 0;
  let text = `Find ways to draw <strong>${has(request.wanted) ? gbp(request.wanted) : '[income you want]'}</strong> a year for ${years} years from <strong>${has(request.pot) ? gbp(request.pot) : '[your pot]'}</strong>. `
    + `Income should never fall below <strong>${Number.isFinite(request.minimum) ? gbp(request.minimum) : '[your minimum]'}</strong>. `;
  if (request.incomeChange) {
    text += `From year ${request.incomeChange.fromYear}, ${gbp(request.incomeChange.wanted)} a year, never below ${gbp(request.incomeChange.minimum)}. `;
  }
  text += state.maxFailures === 0
    ? `None of the ${n} past retirements may run out. `
    : `Up to ${state.maxFailures} of the ${n} past retirements may run out. `;
  for (const o of request.otherIncome) text += `${escapeHtml(o.label)} of ${gbp(o.amount)} a year from year ${o.fromYear}. `;
  $('goal-text').innerHTML = text.trim();
  // Re-reading the form should not leave stale error marks on untouched fields.
  if ($('form-errors').hidden) for (const el of document.querySelectorAll('[aria-invalid="true"]')) el.removeAttribute('aria-invalid');
}

// ---------------------------------------------------------------- search

function onFind(e) {
  e.preventDefault();
  const { request, errors } = readRequest();
  const box = $('form-errors');
  if (errors.length) {
    box.hidden = false;
    box.innerHTML = `<ul>${errors.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
    return;
  }
  box.hidden = true;
  const btn = $('find');
  btn.disabled = true;
  btn.textContent = 'Working...';
  // Let the button repaint before the search runs (well under a second).
  setTimeout(() => {
    try {
      state.request = request;
      state.result = runSearch({ dataset: state.dataset, config: state.config, request, snapshot: state.snapshot });
      renderResults();
      show('results');
    } catch (err) {
      box.hidden = false;
      box.textContent = `Something went wrong: ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Find options';
    }
  }, 30);
}

function show(view) {
  for (const v of ['plan', 'results', 'detail']) $(`view-${v}`).hidden = v !== view;
  window.scrollTo(0, 0);
  const h = $(`view-${view}`).querySelector('h1');
  if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
}

// ---------------------------------------------------------------- results

function cells(r, n) {
  // data-label lets phones show each figure with its heading when the table stacks.
  return `<td class="num" data-label="Typical income a year">${gbp(r.typicalIncome)}</td>`
    + `<td class="num" data-label="Your worst year">${gbp(r.worstIncome)}</td>`
    + `<td class="num" data-label="Ran out, or nearly">${r.ranOutOrNearly} of ${n}</td>`
    + `<td class="num" data-label="Income cut">${r.cutCount} of ${n}</td>`
    + `<td class="num" data-label="Typically left">${gbp(r.medianEnd)}</td>`
    + `<td class="num" data-label="Biggest fall">${pct(r.worstDrawdown)}</td>`;
}

function optionCell(r, badges, request) {
  const idx = state.openable.push({ result: r, labels: badges.map((b) => b.text) }) - 1;
  const rec = recipe(r.plan, request);
  return `<td><div class="option">
      <div class="badges">${badges.map((b) => `<span class="badge ${b.cls || ''}">${escapeHtml(b.text)}</span>`).join('')}</div>
      <div class="plan-name">${escapeHtml(planName(r.plan))}</div>
      <div class="recipe"><strong>Income:</strong> ${escapeHtml(rec.income)}</div>
      <div class="recipe"><strong>Cash:</strong> ${escapeHtml(rec.cash)}</div>
      <div class="recipe"><strong>The rest:</strong> ${escapeHtml(rec.rest)}</div>
      <div><button type="button" class="link" data-open="${idx}">See this option in detail ›</button></div>
    </div></td>`;
}

const HEAD = (n, years) => `<thead><tr>
    <th scope="col">Option</th>
    <th scope="col" class="num">Typical income a year</th>
    <th scope="col" class="num">Your worst year</th>
    <th scope="col" class="num">Ran out, or nearly (of ${n})</th>
    <th scope="col" class="num">Income cut (of ${n})</th>
    <th scope="col" class="num">Typically left after ${years} years</th>
    <th scope="col" class="num">Biggest fall</th>
  </tr></thead>`;

function renderResults() {
  const r = state.result;
  const req = state.request;
  const n = r.windows.length;
  state.openable = [];
  const k = r.rows.length;
  const heading = k ? `${k} way${k > 1 ? 's' : ''} that meet${k > 1 ? '' : 's'} your needs` : 'No way of drawing your pot meets these needs';

  let html = `<button type="button" class="link back" data-nav="plan">‹ Change your inputs</button>
    <header class="results-head">
      <h1>${heading}</h1>
      <p class="hint">You asked for ${gbp(req.wanted)} a year, never below ${gbp(req.minimum)}, with ${req.maxFailures === 0 ? 'none' : `up to ${req.maxFailures}`} of ${n} past retirements (starting ${r.windows[0].startYear} to ${r.windows.at(-1).startYear}) allowed to run out. ${r.plansTried.toLocaleString('en-GB')} plans were tested.</p>
    </header>`;

  if (k) {
    html += `<div class="table-box"><table class="results-table">${HEAD(n, req.years)}<tbody>`;
    r.rows.forEach((row, i) => {
      const badges = row.labels.map((t) => ({ text: t, cls: t === 'Recommended' ? 'strong' : '' }));
      html += `<tr>${optionCell(row.result, badges, req)}${cells(row.result, n)}</tr>`;
      if (i === 0 && row.result.status === 'meets-minimum') {
        // Nothing meets the income wanted in full: say so once.
        html += `<tr><td colspan="7" class="recipe">No plan paid the full ${gbp(req.wanted)} in every past retirement; these options stay above your minimum.</td></tr>`;
      }
    });
    html += '</tbody></table></div>';
  } else {
    html += `<section class="closest"><h2>Closest options</h2>
      <p class="hint">Try a lower income, a lower minimum, or allowing more past retirements to run out. The nearest misses were:</p><ul>`
      + r.closest.map((c) => `<li><strong>${escapeHtml(planName(c.plan))}</strong>: ran out or fell below your minimum in ${c.failingMinimum} of ${n}; typical income ${gbp(c.typicalIncome)}. <button type="button" class="link" data-open="${state.openable.push({ result: c, labels: ['Closest'] }) - 1}">See detail</button></li>`).join('')
      + '</ul></section>';
  }

  if (r.snapshotRow) {
    const s = r.snapshotRow;
    const badge = { text: 'Your portfolio as it is now', cls: 'strong' };
    html += `<div class="table-box mine"><table class="results-table">${HEAD(n, req.years)}<tbody><tr>${optionCell(s.result, [badge], req)}${cells(s.result, n)}</tr>`;
    if (!s.meetsNeeds) html += `<tr><td colspan="7" class="recipe flag">Drawn any of the four ways, your current portfolio did not meet these needs; this is its nearest miss.</td></tr>`;
    html += '</tbody></table></div>';
  }

  if (r.others.length) {
    html += `<section class="compare"><h2>How the other approaches compare</h2>
      <p class="hint">The best plan from each approach not shown above, so all four are always compared.</p><div class="cards">`
      + r.others.map((o) => {
        const idx = state.openable.push({ result: o.result, labels: ['Comparison'] }) - 1;
        return `<div class="mini"><h3>${escapeHtml(planName(o.result.plan))}</h3>
          <div class="hint">Typical ${gbp(o.result.typicalIncome)} · worst year ${gbp(o.result.worstIncome)} · ran out ${o.result.failures} of ${n}</div>
          <div class="why">Not shown because it ${escapeHtml(o.reason)}.</div>
          <div><button type="button" class="link" data-open="${idx}">See detail ›</button></div></div>`;
      }).join('') + '</div></section>';
  }

  html += `<p class="hint">Ran out, or nearly: ran out, or less than one year's withdrawal left at the end. Income cut: any year below the income you want. Your worst year: the lowest income in any past retirement that did not run out. Biggest fall: the largest drop in your investments from a high point, from year-end values.</p>`;

  const view = $('view-results');
  view.innerHTML = html;
  view.onclick = (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { openDetail(state.openable[Number(open.dataset.open)]); return; }
    if (e.target.closest('[data-nav="plan"]')) show('plan');
  };
}

// ---------------------------------------------------------------- detail

function openDetail(item) {
  const req = state.request;
  const windows = windowsFor(req.years);
  const sims = windows.map((w) => simulate(item.result.plan, w, req, { rows: true, thresholds: state.config.thresholds }));
  const worst = [...sims].sort((a, b) => a.minIncomeReal - b.minIncomeReal)[0];
  const plan = item.result.plan;
  const whatIfs = {
    cash: whatIf({ dataset: state.dataset, config: state.config, request: req, plan, dimension: 'cashBuffer', values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }),
    mix: whatIf({ dataset: state.dataset, config: state.config, request: req, plan, dimension: 'mix', values: [0.6, 0.7, 0.8, 0.9, 1.0] }),
  };
  state.detail = { item, sims, selected: worst.startYear, whatIfs };
  renderDetail();
  show('detail');
}

function whatIfTable(rows, firstHead, label, isCurrent, n) {
  return `<div class="table-box"><table class="whatif"><thead><tr>
      <th scope="col">${firstHead}</th><th scope="col" class="num">Typical income</th><th scope="col" class="num">Worst year</th>
      <th scope="col" class="num">Ran out, or nearly</th><th scope="col" class="num">Income cut</th>
      <th scope="col" class="num">Typically left</th><th scope="col" class="num">Biggest fall</th><th scope="col" class="num">Typical yearly change in income</th>
    </tr></thead><tbody>`
    + rows.map(({ value, result: r }) => `<tr class="${isCurrent(value) ? 'current' : ''}"><td>${label(value)}${isCurrent(value) ? ' (this option)' : ''}</td>
        <td class="num">${gbp(r.typicalIncome)}</td><td class="num">${gbp(r.worstIncome)}</td>
        <td class="num">${r.ranOutOrNearly} of ${n}</td><td class="num">${r.cutCount} of ${n}</td>
        <td class="num">${gbp(r.medianEnd)}</td><td class="num">${pct(r.worstDrawdown)}</td><td class="num">${pct(r.medianVolatility, 1)}</td></tr>`).join('')
    + '</tbody></table></div>';
}

function renderDetail() {
  const { item, sims, selected, whatIfs } = state.detail;
  const r = item.result;
  const req = state.request;
  const n = sims.length;
  const plan = r.plan;
  const rec = recipe(plan, req);
  const profile = buildProfile(req);
  const sel = sims.find((s) => s.startYear === selected);

  const incomeChart = lineChart({
    title: 'Income each year in each past retirement',
    lines: sims.map((s) => ({ values: s.rows.map((x) => x.totalIncomeReal), highlight: s.startYear === selected, label: `Retired ${s.startYear}` })),
    refs: [
      { values: profile.wanted, colour: '#2f855a', dash: '7 5' },
      { values: profile.minimum, colour: '#9a3412', dash: '2 4' },
    ],
  });
  const potChart = lineChart({
    title: 'Pot at the end of each year in each past retirement',
    lines: sims.map((s) => ({ values: s.rows.map((x) => x.endTotalReal), highlight: s.startYear === selected, label: `Retired ${s.startYear}` })),
  });

  const strip = sims.map((s) => {
    const cls = s.depleted ? 'ranout' : (s.nearlyDepleted ? 'nearly' : 'fine');
    const word = s.depleted ? `ran out yr ${s.depletionYear}` : (s.nearlyDepleted ? 'nearly' : 'lasted');
    return `<button type="button" class="yr ${cls}" data-year="${s.startYear}" aria-pressed="${s.startYear === selected}">${s.startYear}<small>${word}</small></button>`;
  }).join('');

  const yearRows = sel.rows.map((x) => {
    const fromCash = x.cashUsed / x.inflationIndex;
    const fromInv = (x.actualWithdrawal - x.cashUsed) / x.inflationIndex;
    const short = x.actualWithdrawal < x.targetWithdrawal - 1e-6;
    const notes = [...(x.events || []).map((ev) => EVENT_TEXT[ev] || ev), short ? 'Ran out' : '', x.belowMinimum ? 'Below minimum' : (x.belowWanted ? 'Below income wanted' : '')].filter(Boolean).join(', ');
    return `<tr class="${short ? 'short' : ''}"><td>${x.yearIndex}</td><td>${x.calendarYear}</td><td class="num">${gbp(x.totalIncomeReal)}</td>
      <td class="num">${gbp(fromCash)}</td><td class="num">${gbp(fromInv)}</td><td class="num">${gbp(x.guaranteedIncome / x.inflationIndex)}</td>
      <td class="num">${pct(x.portfolioReturn, 1)}</td><td class="num">${pct(x.inflation, 1)}</td><td class="num">${gbp(x.endTotalReal)}</td><td>${escapeHtml(notes)}</td></tr>`;
  }).join('');

  const isBufferYears = plan.cashBuffer.years !== undefined;
  const html = `<button type="button" class="link back" data-nav="results">‹ Back to your options</button>
    <div class="detail">
      <header class="results-head">
        <div class="badges">${item.labels.map((t) => `<span class="badge ${t === 'Recommended' ? 'strong' : ''}">${escapeHtml(t)}</span>`).join('')}</div>
        <h1>${escapeHtml(planName(plan))}</h1>
        <p class="recipe"><strong>Income:</strong> ${escapeHtml(rec.income)}</p>
        <p class="recipe"><strong>Cash:</strong> ${escapeHtml(rec.cash)}</p>
        <p class="recipe"><strong>The rest:</strong> ${escapeHtml(rec.rest)}</p>
      </header>

      <div class="facts">
        <div class="fact"><div class="k">Typical income a year</div><div class="v">${gbp(r.typicalIncome)}</div></div>
        <div class="fact"><div class="k">Your worst year</div><div class="v">${gbp(r.worstIncome)}</div></div>
        <div class="fact"><div class="k">Ran out, or nearly</div><div class="v">${r.ranOutOrNearly} of ${n}</div></div>
        <div class="fact"><div class="k">Income cut</div><div class="v">${r.cutCount} of ${n}</div></div>
        <div class="fact"><div class="k">Typically left after ${req.years} years</div><div class="v">${gbp(r.medianEnd)}</div></div>
        <div class="fact"><div class="k">Biggest fall</div><div class="v">${pct(r.worstDrawdown)}</div></div>
      </div>

      <section class="panel">
        <h3>Each past retirement</h3>
        <p class="hint">Choose a start year to highlight it in the charts and see it year by year. It opens on the retirement with the lowest income.</p>
        <div class="strip" id="strip">${strip}</div>
        <div class="legend"><span>Lasted: money left</span><span>Nearly: under a year's withdrawal left</span><span>Ran out: income fell to other income only</span></div>
      </section>

      <section class="panel chart">
        <h3>Income each year, in today's money</h3>
        ${incomeChart}
        <div class="legend"><span><i class="sw" style="border-color:#0b5f7a"></i>Retired ${selected}</span><span><i class="sw" style="border-color:#9fb7c0"></i>Other start years</span><span><i class="sw dash" style="border-color:#2f855a"></i>Income you want</span><span><i class="sw dash" style="border-color:#9a3412"></i>Lowest you could live on</span></div>
      </section>

      <section class="panel chart">
        <h3>What is left in the pot, in today's money</h3>
        ${potChart}
        <div class="legend"><span><i class="sw" style="border-color:#0b5f7a"></i>Retired ${selected}</span><span><i class="sw" style="border-color:#9fb7c0"></i>Other start years</span></div>
      </section>

      <section class="panel">
        <h3>Retired in ${selected}, year by year</h3>
        <div class="table-box"><table class="year-table"><thead><tr>
          <th scope="col">Year</th><th scope="col">Calendar year</th><th scope="col" class="num">Income</th>
          <th scope="col" class="num">From cash</th><th scope="col" class="num">From investments</th><th scope="col" class="num">Other income</th>
          <th scope="col" class="num">Investment return</th><th scope="col" class="num">Inflation</th><th scope="col" class="num">Pot left</th><th scope="col">Notes</th>
        </tr></thead><tbody>${yearRows}</tbody></table></div>
        <p class="hint">Money figures in today's money. Investment return is for the whole pot, after charges.</p>
      </section>

      <section class="panel">
        <h3>What if the cash buffer were different?</h3>
        ${whatIfTable(whatIfs.cash, 'Cash buffer', (v) => (v === 0 ? 'None' : `${v} year${v > 1 ? 's' : ''}`), (v) => isBufferYears && v === plan.cashBuffer.years, n)}
      </section>

      <section class="panel">
        <h3>What if the shares and bonds mix were different?</h3>
        ${whatIfTable(whatIfs.mix, 'Shares / bonds', (v) => `${Math.round(v * 100)} / ${100 - Math.round(v * 100)}`, (v) => Math.abs(v - plan.mix.equities) < 1e-9, n)}
      </section>
    </div>`;

  const view = $('view-detail');
  view.innerHTML = html;
  view.onclick = (e) => {
    const yr = e.target.closest('[data-year]');
    if (yr) {
      state.detail.selected = Number(yr.dataset.year);
      renderDetail();
      const again = view.querySelector(`[data-year="${yr.dataset.year}"]`);
      if (again) again.focus();
      return;
    }
    if (e.target.closest('[data-nav="results"]')) show('results');
  };
}

load();
