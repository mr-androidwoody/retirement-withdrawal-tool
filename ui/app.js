// The page: wizard, results and option detail. All modelling happens in engine/.

import { validateDataset, makeWindows } from '../engine/dataset.js';
import { runSearch, whatIf, buildGrid, strategySettings, CASH_RULES, currentFromMix } from '../engine/search.js';
import { simulate } from '../engine/simulate.js';
import { buildProfile } from '../engine/profile.js';
import { summarisePlan, investmentIndex, worstFall } from '../engine/metrics.js';
import { allowedFailures, rankWindows, pickPeriods, subsetSummary } from '../engine/periods.js';
import { gbp, pct, escapeHtml, parseAmount, formatAmount, planName, recipe, holdingsText, money, bigMoney, signedMoney, signedPct, STRATEGY_INFO, strategyTag } from './format.js';
import { lineChart, wireCharts } from './charts.js';

const $ = (id) => document.getElementById(id);
const state = {
  config: null,
  dataset: null,
  mixLabel: null,
  riskShare: 0.05,
  ranking: null,
  worstYears: [],
  bestYears: [],
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
  'invest-excess': 'Spare cash invested',
  'reserve-topup': 'Cash reserve topped up',
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

// ---------------------------------------------------------------- saved inputs
// The form is saved in this browser's localStorage on every change and put back on reload.
// Nothing leaves the browser. Storage can be unavailable (private windows, blocked
// storage), so every read and write is wrapped and simply does nothing if it fails.

const SAVE_KEY = 'retirement-withdrawal-tool.inputs.v1';
const SAVED_FIELDS = ['pot', 'age', 'partner-age', 'years', 'wanted', 'minimum',
  'change-age', 'change-wanted', 'change-minimum',
  'other1-label', 'other1-amount', 'other1-age', 'other2-label', 'other2-amount', 'other2-age',
  'earned1-label', 'earned1-amount', 'earned1-stop', 'earned2-label', 'earned2-amount', 'earned2-stop',
  'fee', 'mix-eq', 'mix-bd', 'mix-cash'];
const SAVED_BOXES = ['change-box', 'other-box', 'other2', 'earned-box', 'earned2'];

function saveInputs() {
  if (!state.ready) return;
  const data = { version: 1, fields: {}, open: {}, mix: state.mixLabel, riskShare: state.riskShare, keepMix: $('keep-mix').checked };
  for (const id of SAVED_FIELDS) data.fields[id] = $(id).value;
  for (const id of SAVED_BOXES) data.open[id] = !$(id).hidden;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage unavailable: nothing to do */ }
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && data.version === 1 ? data : null;
  } catch { return null; }
}

/** Put saved inputs back into the form. Returns true if there were any. */
function restoreInputs() {
  const data = loadSaved();
  if (!data) return false;
  for (const id of SAVED_FIELDS) if (typeof data.fields?.[id] === 'string' && $(id)) $(id).value = data.fields[id];
  if (![...$('years').options].some((o) => o.value === $('years').value)) $('years').value = String(state.config.defaults.years);
  const open = data.open || {};
  for (const which of ['change', 'other', 'earned']) {
    const isOpen = Boolean(open[`${which}-box`]);
    $(`${which}-box`).hidden = !isOpen;
    $(`toggle-${which}`).hidden = isOpen;
    $(`toggle-${which}`).setAttribute('aria-expanded', String(isOpen));
  }
  $('other2').hidden = !open.other2;
  $('other2-hint').hidden = !open.other2;
  $('add-other2').hidden = Boolean(open.other2);
  $('earned2').hidden = !open.earned2;
  $('add-earned2').hidden = Boolean(open.earned2);
  // Older saves held a count out of 22; map it to the nearest share.
  if (Number.isFinite(data.riskShare)) state.riskShare = data.riskShare;
  else if (Number.isInteger(data.maxFailures)) state.riskShare = data.maxFailures === 0 ? 0 : (data.maxFailures === 1 ? 0.05 : 0.1);
  if (!state.config.risk.choices.some((c) => c.share === state.riskShare)) state.riskShare = state.config.defaults.riskShare;
  $('keep-mix').checked = Boolean(data.keepMix);
  const labels = [...(state.config.currentMixes || []).map((m) => m.label), 'Custom'];
  selectMix(labels.includes(data.mix) ? data.mix : (state.config.defaultMix || 'Custom'));
  return true;
}

// ---------------------------------------------------------------- form

function initForm() {
  const { config } = state;

  // Retirement lengths that the data can test.
  const lengths = config.retirementLengths.filter((y) => windowsFor(y).length > 0);
  $('years').innerHTML = lengths.map((y) => `<option value="${y}">${y} years</option>`).join('');

  // Risk choices.
  $('risk').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-risk]');
    if (!btn) return;
    state.riskShare = Number(btn.dataset.risk);
    renderRisk();
    refresh();
  });

  // Toggles.
  $('toggle-change').addEventListener('click', () => showBox('change', true));
  $('remove-change').addEventListener('click', () => showBox('change', false));
  $('toggle-other').addEventListener('click', () => showBox('other', true));
  $('remove-other').addEventListener('click', () => showBox('other', false));
  $('toggle-earned').addEventListener('click', () => showBox('earned', true));
  $('remove-earned').addEventListener('click', () => showBox('earned', false));
  $('add-earned2').addEventListener('click', () => {
    $('earned2').hidden = false;
    $('add-earned2').hidden = true;
    if (!$('partner-age').value && currentAge()) $('partner-age').value = String(currentAge());
    $('earned2-amount').focus();
    refresh();
  });
  $('add-other2').addEventListener('click', () => {
    $('other2').hidden = false;
    $('other2-hint').hidden = false;
    $('add-other2').hidden = true;
    if (!$('partner-age').value && currentAge()) $('partner-age').value = String(currentAge());
    prefillPension(2);
    $('other2-amount').focus();
    refresh();
  });
  $('toggle-fee').addEventListener('click', () => {
    const open = $('fee-box').hidden;
    $('fee-box').hidden = !open;
    $('toggle-fee').setAttribute('aria-expanded', String(open));
    if (open) $('fee').focus();
  });

  // Current mix: predefined splits plus a custom one.
  const mixes = config.currentMixes || [];
  $('mixes').innerHTML = [...mixes.map((m) => m.label), 'Custom'].map((label) =>
    `<button type="button" class="chip" role="radio" aria-checked="false" data-mix="${label}">${label === 'Custom' ? 'Custom' : label}</button>`).join('');
  $('mixes').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mix]');
    if (btn) selectMix(btn.dataset.mix);
  });
  selectMix(config.defaultMix || mixes[0]?.label || 'Custom');

  // Any edit refreshes the goal; money fields get thousands separators on blur.
  $('plan-form').addEventListener('input', (e) => {
    refresh();
  });
  $('plan-form').addEventListener('change', refresh);
  $('keep-mix').addEventListener('change', refresh);
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
  if (!restoreInputs()) {
    const typical = config.presets.find((p) => p.id === 'typical');
    if (typical) applyValues({ incomeChange: null, ...typical.values });
  }
  $('clear-saved').addEventListener('click', () => {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing saved */ }
    window.location.reload();
  });
  // The strategies overlay, opened from the line under the heading.
  $('source-line').addEventListener('click', (e) => {
    if (e.target.closest('[data-open-strategies]')) openStrategies();
  });
  $('strategies-close').addEventListener('click', () => $('strategies-dialog').close());
  $('strategies-dialog').addEventListener('click', (e) => {
    if (e.target === $('strategies-dialog')) $('strategies-dialog').close(); // a click on the backdrop
  });

  // From here on, every change is saved.
  state.ready = true;
  renderRisk();
  refresh();
}

/** Fill a pension row with today's full State Pension and age, if the user has not typed one. */
function prefillPension(k) {
  const sp = state.config.statePension;
  if (!sp) return;
  if (!$(`other${k}-amount`).value) $(`other${k}-amount`).value = formatAmount(sp.annual);
  if (!$(`other${k}-age`).value) $(`other${k}-age`).value = String(sp.age);
}

/**
 * A pension in today's money, in pounds of the year it starts: n years away means n - 1 or n
 * yearly April rises (it depends on the birthday), at the display inflation rate.
 */
function futureRange(amount, n) {
  const i = state.config.displayInflation ?? 0.025;
  return { low: amount * (1 + i) ** (n - 1), high: amount * (1 + i) ** n, year: new Date().getFullYear() + n, rate: i };
}

const round100 = (x) => `\u00a3${(Math.round(x / 100) * 100).toLocaleString('en-GB')}`;

/**
 * What a pension in today's money is worth in pounds of the day when it starts, at the
 * display inflation rate. Without a birthday, the number of yearly April rises is n - 1 or n,
 * where n is the gap in years, so a range is shown.
 */
function pensionHint(k) {
  const el = $(`other${k}-hint`);
  if (!el) return;
  const amount = parseAmount($(`other${k}-amount`).value);
  const startAge = Number($(`other${k}-age`).value);
  const ownAge = k === 2 ? Number($('partner-age').value) : currentAge();
  const i = state.config.displayInflation ?? 0.025;
  if (!(amount > 0) || !Number.isInteger(startAge) || !Number.isInteger(ownAge) || startAge <= ownAge) {
    el.textContent = '';
    return;
  }
  const n = startAge - ownAge;
  const { low, high, year } = futureRange(amount, n);
  const who = k === 2 ? 'their' : 'your';
  el.textContent = `${gbp(amount)} a year in today's money from ${k === 2 ? 'their age' : 'age'} ${startAge} (about ${year}). In pounds of that time, at ${(i * 100).toFixed(1)}% inflation a year, that is about ${gbp(low)} to ${gbp(high)} (${n - 1} or ${n} yearly rises, depending on ${who} birthday).`;
}

function showBox(which, open) {
  if (which === 'other' && open) prefillPension(1);
  $(`${which}-box`).hidden = !open;
  $(`toggle-${which}`).hidden = open;
  $(`toggle-${which}`).setAttribute('aria-expanded', String(open));
  if (open) $({ change: 'change-age', other: 'other1-amount', earned: 'earned1-amount' }[which]).focus();
  refresh();
}

function currentAge() {
  const a = Number($('age').value);
  return Number.isInteger(a) && a > 0 ? a : null;
}

/** Fill and open the overlay that describes the four strategies and how each is tried. */
function openStrategies() {
  const rates = (xs) => {
    const t = xs.map((x) => `${+(x * 100).toFixed(1)}%`);
    return t.length > 1 ? `${t.slice(0, -1).join(', ')} and ${t.at(-1)}` : t[0];
  };
  const tried = (g) => {
    let s = `Tried at starting rates of ${rates(g.rates)} of the pot, plus the rate that pays exactly the income you want.`;
    if (g.strategy === 'floor-ceiling') s += ` Floors of ${g.floorPct.map((x) => `${Math.round(x * 100)}%`).join(' or ')} of the income you want, ceiling ${Math.round(g.ceilingPct[0] * 100)}%.`;
    return s;
  };
  const g = state.config.grid;
  $('strategies-body').innerHTML = g.strategies.map((row) => {
    const s = STRATEGY_INFO[row.strategy];
    return `<section class="strategy">
        <h3>${escapeHtml(s.name)}${s.aka ? ` <span class="aka">(${escapeHtml(s.aka)})</span>` : ''}</h3>
        <p>${escapeHtml(s.about)}</p>
        <p class="trade"><strong>Trade-off:</strong> ${escapeHtml(s.tradeOff)}</p>
        <p class="tried">${escapeHtml(tried(row))}</p>
      </section>`;
  }).join('')
    + `<p class="hint">Each strategy is also tried with ${g.mixes.length} share and bond mixes (${Math.round(g.mixes[0] * 100)}% to ${Math.round(g.mixes.at(-1) * 100)}% shares), ${g.cashBufferYears.length} cash buffers and your own mix, and every version is run through every past retirement. The results show the few that meet your needs.</p>`;
  $('strategies-dialog').showModal();
}

function applyValues(v) {
  if (v.pot !== undefined) $('pot').value = formatAmount(v.pot);
  if (v.age !== undefined && !$('age').value) $('age').value = String(v.age);
  if (v.years !== undefined) $('years').value = String(v.years);
  if (v.wanted !== undefined) $('wanted').value = formatAmount(v.wanted);
  if (v.minimum !== undefined) $('minimum').value = formatAmount(v.minimum);
  if (v.riskShare !== undefined) state.riskShare = v.riskShare;
  if (v.incomeChange) {
    // Presets store the change as a retirement year; show it as an age.
    $('change-age').value = (currentAge() ?? state.config.defaults.age) + v.incomeChange.fromYear - 1;
    $('change-wanted').value = formatAmount(v.incomeChange.wanted);
    $('change-minimum').value = formatAmount(v.incomeChange.minimum);
    $('change-box').hidden = false;
    $('toggle-change').hidden = true;
  } else {
    $('change-box').hidden = true;
    $('toggle-change').hidden = false;
  }
}

function selectMix(label) {
  state.mixLabel = label;
  for (const b of $('mixes').querySelectorAll('[data-mix]')) b.setAttribute('aria-checked', String(b.dataset.mix === label));
  const custom = label === 'Custom';
  $('custom-mix').hidden = !custom;
  if (custom && !$('mix-eq').value) {
    const m = state.config.currentMixes.find((x) => x.label === state.config.defaultMix) || { equities: 0.6, bonds: 0.3, cash: 0.1 };
    $('mix-eq').value = Math.round(m.equities * 100);
    $('mix-bd').value = Math.round(m.bonds * 100);
    $('mix-cash').value = Math.round(m.cash * 100);
  }
  refresh();
}

/** The current mix as fractions { equities, bonds, cash }, or { error } for a bad custom split. */
function readMix() {
  if (state.mixLabel !== 'Custom') {
    const m = state.config.currentMixes.find((x) => x.label === state.mixLabel);
    return m ? { equities: m.equities, bonds: m.bonds, cash: m.cash } : { error: 'Choose your current mix.' };
  }
  const v = ['mix-eq', 'mix-bd', 'mix-cash'].map((id) => Number(String($(id).value).replace('%', '').trim() || 0));
  if (v.some((x) => !Number.isFinite(x) || x < 0)) return { error: 'Mix percentages must be zero or more.' };
  const total = v[0] + v[1] + v[2];
  if (Math.abs(total - 100) > 0.5) return { error: `Your mix adds up to ${+total.toFixed(1)}%, not 100%.` };
  return { equities: v[0] / 100, bonds: v[1] / 100, cash: v[2] / 100 };
}

/** How many past retirements may run out for this length, from the chosen share. */
function allowedFor(years) {
  return allowedFailures(state.riskShare, windowsFor(years).length);
}

function renderRisk() {
  const years = Number($('years').value);
  const n = windowsFor(years).length;
  $('risk-hint').textContent = `Of the ${n} past retirements, how many may run out of money?`;
  $('risk').innerHTML = state.config.risk.choices.map((c) => {
    const k = allowedFailures(c.share, n);
    return `<button type="button" role="radio" data-risk="${c.share}" aria-checked="${c.share === state.riskShare}">${escapeHtml(c.label)}<small>${k} of ${n}</small></button>`;
  }).join('');
}

/** Read the form into a request; returns { request, errors }. */
function readRequest() {
  const errors = [];
  const years = Number($('years').value);
  const mixRead = readMix();
  if (mixRead.error) errors.push(mixRead.error);
  const pot = parseAmount($('pot').value);
  const wanted = parseAmount($('wanted').value);
  const minimum = parseAmount($('minimum').value);
  const fee = Number(String($('fee').value).replace('%', '')) / 100;
  const age = Number($('age').value);
  const mark = (id, bad) => $(id).setAttribute('aria-invalid', String(bad));
  const ageOk = Number.isInteger(age) && age >= 18 && age <= 100;
  const lastAge = age + years - 1;
  mark('age', !ageOk);
  if (!ageOk) errors.push('Enter your age now, as a whole number.');

  mark('pot', !(pot > 0)); if (!(pot > 0)) errors.push('Enter the size of your pot.');
  mark('wanted', !(wanted > 0)); if (!(wanted > 0)) errors.push('Enter the income you want.');
  const minBad = !(minimum >= 0) || (wanted > 0 && minimum > wanted);
  mark('minimum', minBad);
  if (minBad) errors.push('The lowest you could live on must be a figure no higher than the income you want.');
  if (!(fee >= 0 && fee <= 0.03)) errors.push('Charges should be between 0% and 3% a year.');

  let incomeChange = null;
  if (!$('change-box').hidden) {
    const fromAge = Number($('change-age').value);
    const fromYear = fromAge - age + 1;
    const cw = parseAmount($('change-wanted').value);
    const cm = parseAmount($('change-minimum').value);
    const yearBad = !ageOk || !(Number.isInteger(fromAge) && fromYear >= 2 && fromYear <= years);
    mark('change-age', yearBad && ageOk);
    mark('change-wanted', !(cw > 0));
    mark('change-minimum', !(cm >= 0 && cm <= cw));
    if (yearBad && ageOk) errors.push(`The income change must start between age ${age + 1} and age ${lastAge}.`);
    if (!(cw > 0) || !(cm >= 0 && cm <= cw)) errors.push('Enter the later income you want, and a later minimum no higher than it.');
    if (!yearBad && cw > 0 && cm >= 0 && cm <= cw) incomeChange = { fromYear, wanted: cw, minimum: cm };
  }

  const partnerText = $('partner-age').value.trim();
  const partnerAge = partnerText === '' ? NaN : Number(partnerText);
  if (partnerText !== '') mark('partner-age', !(Number.isInteger(partnerAge) && partnerAge >= 18 && partnerAge <= 110));

  const otherIncome = [];
  if (!$('other-box').hidden) {
    for (const k of [1, 2]) {
      if (k === 2 && $('other2').hidden) continue;
      const amount = parseAmount($(`other${k}-amount`).value);
      if (!Number.isFinite(amount) || amount === 0) {
        mark(`other${k}-amount`, false);
        mark(`other${k}-age`, false);
        continue;
      }
      // Person 2's income starts at their own age, so it needs their age now.
      const ownAge = k === 2 ? partnerAge : age;
      const ownAgeOk = Number.isInteger(ownAge) && ownAge >= 18 && ownAge <= 110;
      if (k === 2) mark('partner-age', !ownAgeOk);
      const startText = $(`other${k}-age`).value.trim();
      const startAge = startText === '' ? ownAge : Number(startText);
      const fromYear = Math.max(1, startAge - ownAge + 1);
      const label = $(`other${k}-label`).value.trim() || 'Other income';
      const bad = !(amount >= 0) || !ownAgeOk || !Number.isInteger(startAge) || fromYear > years;
      mark(`other${k}-amount`, !(amount >= 0));
      mark(`other${k}-age`, ownAgeOk && (!Number.isInteger(startAge) || fromYear > years));
      if (bad) {
        errors.push(k === 2 && !ownAgeOk
          ? `Enter your partner's age now (step 1) for "${label}".`
          : `Check the amount and starting age of "${label}" (it must start within the ${years} years).`);
        continue;
      }
      otherIncome.push({ label, amount, fromYear, startAge, person: k });
    }
  }

  if (!$('earned-box').hidden) {
    for (const k of [1, 2]) {
      if (k === 2 && $('earned2').hidden) continue;
      const amount = parseAmount($(`earned${k}-amount`).value);
      // A blank or zero amount means no earnings for this person: skip the row entirely.
      if (!Number.isFinite(amount) || amount === 0) {
        mark(`earned${k}-amount`, false);
        mark(`earned${k}-stop`, false);
        continue;
      }
      const ownAge = k === 2 ? partnerAge : age;
      const ownAgeOk = Number.isInteger(ownAge) && ownAge >= 18 && ownAge <= 110;
      const stopAge = Number($(`earned${k}-stop`).value);
      const label = $(`earned${k}-label`).value.trim() || 'Earnings';
      const stopOk = Number.isInteger(stopAge) && stopAge > ownAge;
      mark(`earned${k}-amount`, !(amount >= 0));
      mark(`earned${k}-stop`, ownAgeOk && !stopOk);
      if (k === 2 && !ownAgeOk) { mark('partner-age', true); errors.push(`Enter your partner's age now (step 1) for "${label}".`); continue; }
      if (!(amount >= 0) || !stopOk) { errors.push(`Enter the amount of "${label}" and an age it stops at, older than ${k === 2 ? 'their' : 'your'} age now.`); continue; }
      // Earned in each year from now until the year before the stopping age.
      const toYear = Math.min(years, stopAge - ownAge);
      otherIncome.push({ label, amount, fromYear: 1, toYear, kind: 'earned', stopAge, person: k });
    }
  }

  return {
    mix: mixRead.error ? null : mixRead,
    request: { pot, years, age: ageOk ? age : null, wanted, minimum, incomeChange, otherIncome, riskShare: state.riskShare, maxFailures: allowedFor(years), annualFee: fee },
    errors,
  };
}

function planCount(request) {
  const req = request && request.pot > 0 && request.wanted > 0 ? request : null;
  const per = strategySettings(state.config, req).length;
  if ($('keep-mix').checked) return CASH_RULES.length * per;
  return buildGrid(state.config, req).length + CASH_RULES.length * per;
}

const mixLabelText = (m) => `${Math.round(m.equities * 100)}/${Math.round(m.bonds * 100)}/${Math.round(m.cash * 100)}`;

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

  $('source-line').innerHTML = `Tests <button type="button" class="link inline" data-open-strategies>${Object.keys(STRATEGY_INFO).length} withdrawal strategies</button> against ${n} real retirements, starting ${first} to ${last}`;

  const g = state.config.grid;
  const mixes = `${Math.round(g.mixes[0] * 100)}% to ${Math.round(g.mixes.at(-1) * 100)}% shares`;
  const buffers = `cash buffers of ${g.cashBufferYears.slice(0, -1).join(', ')} and ${g.cashBufferYears.at(-1)} years`;
  const fee = Number($('fee').value);
  const mix = readMix();
  const potNow = parseAmount($('pot').value);
  if (mix.error) $('mix-summary').textContent = mix.error;
  else if (potNow > 0) {
    $('mix-summary').textContent = `${gbp(potNow * mix.equities)} shares \u00b7 ${gbp(potNow * mix.bonds)} bonds \u00b7 ${gbp(potNow * mix.cash)} cash. `
      + 'Used for the "Your mix as it is now" rows; the search also tries other mixes.';
  } else $('mix-summary').textContent = '';
  pensionHint(1);
  pensionHint(2);
  const sp = state.config.statePension;
  if (sp) {
    $('pension-note').textContent = `The full new State Pension is £${sp.weekly.toFixed(2)} a week (${gbp(sp.annual)} a year) in ${sp.taxYear}, from age ${sp.age} for anyone born between 6 March 1961 and 5 April 1977. `
      + 'The tool works in today\u2019s money and assumes pensions rise with inflation; the triple lock (the highest of inflation, earnings growth or 2.5%) may add more, which is not counted.';
  }
  const age = currentAge();
  for (const opt of $('years').options) {
    const y = Number(opt.value);
    opt.textContent = age ? `${y} years (to age ${age + y - 1})` : `${y} years`;
  }
  $('settings-summary').textContent = `Global shares (£) and UK gilts · starts ${first} to ${last} · all four approaches · ${mixes} · ${buffers}${$('keep-mix').checked ? ' (keeping your mix)' : ' · plus your current mix'} · charges ${Number.isFinite(fee) ? fee : '?'}% a year`;

  // Goal in words.
  const { request } = readRequest();
  const count = planCount(request);
  for (const el of document.querySelectorAll('[data-bind="plan-count-number"]')) el.textContent = count.toLocaleString('en-GB');
  const has = (x) => Number.isFinite(x) && x > 0;
  const span = request.age ? `${years} years, from age ${request.age} to ${request.age + years - 1},` : `${years} years`;
  let text = `Find ways to draw <strong>${has(request.wanted) ? gbp(request.wanted) : '[income you want]'}</strong> a year for ${span} from <strong>${has(request.pot) ? gbp(request.pot) : '[your pot]'}</strong>. `
    + `Income should never fall below <strong>${Number.isFinite(request.minimum) ? gbp(request.minimum) : '[your minimum]'}</strong>. `;
  if (request.incomeChange) {
    text += `From age ${request.age + request.incomeChange.fromYear - 1}, ${gbp(request.incomeChange.wanted)} a year, never below ${gbp(request.incomeChange.minimum)}. `;
  }
  const choice = state.config.risk.choices.find((c) => c.share === state.riskShare);
  text += state.riskShare === 0
    ? `None of the ${n} past retirements may run out. `
    : `${choice ? choice.label : 'Some'} of the past retirements may run out (up to ${allowedFor(years)} of ${n}). `;
  for (const o of request.otherIncome) {
    let when;
    if (o.kind === 'earned') when = o.person === 2 ? `until their age ${o.stopAge}` : `until age ${o.stopAge}`;
    else when = o.fromYear <= 1 ? 'from the start' : (o.person === 2 ? `from their age ${o.startAge}` : `from age ${o.startAge}`);
    // Pensions that start later also show their value in pounds of that year, for comparison
    // with a pension forecast; the plan itself stays in today's money.
    let future = '';
    const ownAge = o.person === 2 ? Number($('partner-age').value) : request.age;
    if (o.kind !== 'earned' && o.fromYear > 1 && Number.isInteger(ownAge) && o.startAge > ownAge) {
      const f = futureRange(o.amount, o.startAge - ownAge);
      future = ` (about ${round100(f.low)} to ${round100(f.high)} in ${f.year} pounds)`;
    }
    text += `${escapeHtml(o.label)} of ${gbp(o.amount)} a year ${when}${future}. `;
  }
  $('goal-text').innerHTML = text.trim();
  // Re-reading the form should not leave stale error marks on untouched fields.
  if ($('form-errors').hidden) for (const el of document.querySelectorAll('[aria-invalid="true"]')) el.removeAttribute('aria-invalid');
  saveInputs();
}

// ---------------------------------------------------------------- search

function onFind(e) {
  e.preventDefault();
  const { request, errors, mix } = readRequest();
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
      state.mix = mix;
      // Rank every start year once, by the real return of your mix over its first years.
      const rk = state.config.risk;
      state.ranking = rankWindows(windowsFor(request.years), mix, rk.rankYears);
      state.worstYears = pickPeriods(state.ranking, 'worst', rk.subsetSize);
      state.bestYears = pickPeriods(state.ranking, 'best', rk.subsetSize);
      state.result = runSearch({ dataset: state.dataset, config: state.config, request,
        current: currentFromMix(request.pot, mix), keepMix: $('keep-mix').checked });
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

// Status marks: colour is never the only signal, each comes with an icon and words.
const ICON = {
  good: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l6.3 11.3H1.7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 6.6v3.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.9" r="1" fill="currentColor"/></svg>',
  bad: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

/** Status of a count of past retirements: ran out (against your limit) or income cut. */
function countStatus(count, kind, limit) {
  if (count === 0) return { cls: 'good', word: { ranout: 'none ran out', cut: 'no cuts', worst: 'held up in all of them' }[kind] };
  if (kind === 'cut') return { cls: 'warn', word: 'some years below what you want' };
  if (kind === 'worst') return { cls: 'bad', word: 'ran out or fell below your minimum' };
  return count <= limit ? { cls: 'warn', word: 'within your limit' } : { cls: 'bad', word: 'over your limit' };
}

function statusMark(count, kind, limit) {
  const s = countStatus(count, kind, limit);
  return `<span class="st ${s.cls}">${ICON[s.cls]}<span class="st-n">${count}</span><span class="sr">, ${s.word}</span></span>`;
}

// Column specs shared by the results tables and the what-if tables.
const COLS = [
  { key: 'typicalIncome', head: 'Typical spending', unit: 'a year', better: 'high', cmp: (v) => Math.round(v / 100) },
  { key: 'worstIncome', head: 'Lowest year', unit: 'a year', better: 'high', cmp: (v) => Math.round(v / 100) },
  { key: 'ranOutOrNearly', head: 'Ran out or nearly', unit: (n) => `of ${n}`, better: 'low', cmp: (v) => v },
  { key: 'cutCount', head: 'Income cut', unit: (n) => `of ${n}`, better: 'low', cmp: (v) => v },
  { key: 'worstSet', head: () => `Worst ${state.worstYears.length} starts`, unit: 'fell short', better: 'low', cmp: (v) => v, get: worstShortfalls },
  { key: 'medianEnd', head: 'Typically left', unit: (n, years) => `after ${years} years`, better: 'high', cmp: (v) => Math.round(v / 1e5) },
  { key: 'worstDrawdown', head: 'Biggest fall', unit: 'in investments', better: 'low', cmp: (v) => Math.round(v * 100) },
];

/** How many of the worst starts this plan ran out in or fell below the minimum (cached). */
function worstShortfalls(r) {
  if (r.worstSet === undefined) {
    const s = state.worstYears.length ? subsetSummary(r, state.worstYears, state.request) : null;
    r.worstSet = s ? s.failingMinimum : NaN;
  }
  return r.worstSet;
}

const val = (c, r) => (c.get ? c.get(r) : r[c.key]);
const headText = (c) => (typeof c.head === 'function' ? c.head() : c.head);

/** For each column, the winning value, or null when there is nothing to choose between. */
function bestValues(results) {
  const best = {};
  for (const c of COLS) {
    const vals = results.map((r) => c.cmp(val(c, r))).filter(Number.isFinite);
    const top = c.better === 'high' ? Math.max(...vals) : Math.min(...vals);
    best[c.key] = results.length > 1 && vals.some((v) => v !== top) ? top : null;
  }
  return best;
}

const isBest = (best, c, r) => best[c.key] !== null && c.cmp(val(c, r)) === best[c.key];

function figure(c, r, n, req) {
  const v = val(c, r);
  switch (c.key) {
    case 'typicalIncome': return `${money(v)}<span class="gap">${signedMoney(v - req.wanted)} vs wanted</span>`;
    case 'worstIncome': return `${money(v)}<span class="gap">${signedMoney(v - req.minimum)} vs minimum</span>`;
    case 'ranOutOrNearly': return statusMark(v, 'ranout', req.maxFailures);
    case 'cutCount': return statusMark(v, 'cut', req.maxFailures);
    case 'worstSet': return Number.isFinite(v) ? statusMark(v, 'worst', 0) : 'n/a';
    case 'medianEnd': return bigMoney(v);
    default: return pct(v);
  }
}

function cells(r, n, req, best) {
  // data-label lets phones show each figure with its heading when the table stacks.
  return COLS.map((c) => `<td class="num${isBest(best, c, r) ? ' best' : ''}" data-label="${headText(c)}"><span class="fig">${figure(c, r, n, req)}</span></td>`).join('');
}

function headRow(n, years, first = 'Option') {
  const unit = (c) => (typeof c.unit === 'function' ? c.unit(n, years) : c.unit);
  return `<thead><tr><th scope="col">${first}</th>${COLS.map((c) => `<th scope="col" class="num">${headText(c)}<span class="unit">${unit(c)}</span></th>`).join('')}</tr></thead>`;
}

function optionRows(r, badges, req, n, best, flag) {
  const idx = state.openable.push({ result: r, labels: badges.map((b) => b.text) }) - 1;
  const rec = recipe(r.plan, req);
  const diff = !r.plan.fromCurrent && state.mix
    ? `<p class="diff">Different mix from yours: ${escapeHtml(holdingsText(r.plan))} (yours: ${mixLabelText(state.mix)})</p>` : '';
  return `<tbody class="opt">
    <tr class="opt-main"><td><div class="option">
      <div class="badges">${badges.map((b) => `<span class="badge ${b.cls || ''}">${escapeHtml(b.text)}</span>`).join('')}</div>
      <div class="strategy-tag">Strategy: <strong>${escapeHtml(strategyTag(r.plan))}</strong></div>
      <div class="plan-name">${escapeHtml(planName(r.plan))}</div>
    </div></td>${cells(r, n, req, best)}</tr>
    <tr class="opt-recipe"><td colspan="${COLS.length + 1}">
      <div class="recipe-grid">
        <p><strong>Income</strong>${escapeHtml(rec.income)}</p>
        <p><strong>Cash</strong>${escapeHtml(rec.cash)}</p>
        <p><strong>The rest</strong>${escapeHtml(rec.rest)}</p>
      </div>
      ${diff}
      <button type="button" class="link" data-open="${idx}">See this option in detail ›</button>
    </td></tr>
    ${flag ? `<tr><td colspan="${COLS.length + 1}" class="recipe flag">${flag}</td></tr>` : ''}
  </tbody>`;
}

/** items: [{ result, badges, flag? }] */
function optionsTable(items, n, req, mine = false) {
  const best = bestValues(items.map((i) => i.result));
  return `<div class="table-box${mine ? ' mine' : ''}"><table class="results-table">${headRow(n, req.years)}`
    + items.map((i) => optionRows(i.result, i.badges, req, n, best, i.flag)).join('')
    + '</table></div>';
}

function renderResults() {
  const r = state.result;
  const req = state.request;
  const n = r.windows.length;
  state.openable = [];
  const k = r.rows.length;
  const mixName = state.mix ? mixLabelText(state.mix) : '';
  let heading;
  if (r.keepMix) heading = k ? `${k} way${k > 1 ? 's' : ''} to draw your ${mixName} mix that meet${k > 1 ? '' : 's'} your needs` : `No way of drawing your ${mixName} mix meets these needs`;
  else if (r.currentRows && r.currentRows.length) heading = 'Your results';
  else heading = k ? `${k} way${k > 1 ? 's' : ''} that meet${k > 1 ? '' : 's'} your needs` : 'No way of drawing your pot meets these needs';

  let html = `<button type="button" class="link back" data-nav="plan">‹ Change your inputs</button>
    <header class="results-head">
      <h1>${heading}</h1>
      <p class="hint">You asked for ${gbp(req.wanted)} a year, never below ${gbp(req.minimum)}, with ${req.maxFailures === 0 ? 'none' : `up to ${req.maxFailures}`} of ${n} past retirements (starting ${r.windows[0].startYear} to ${r.windows.at(-1).startYear}) allowed to run out. ${r.plansTried.toLocaleString('en-GB')} plans were tested${r.keepMix ? `, all with your ${mixName} mix` : ''}.</p>
      ${state.worstYears.length ? `<p class="hint">The worst ${state.worstYears.length} starts for your ${mixName} mix, judged by its return after inflation over the first ${state.config.risk.rankYears} years: ${[...state.worstYears].sort((x, y) => x - y).join(', ')}.</p>` : ''}
    </header>`;

  // The recommendation in one box, before the tables.
  const recRow = r.rows.find((x) => x.labels.includes('Recommended'));
  if (recRow) {
    const p = recRow.result;
    const info = STRATEGY_INFO[p.plan.strategy] || { name: planName(p.plan), aka: '', about: '' };
    const recipeLines = recipe(p.plan, req);
    const idx = state.openable.push({ result: p, labels: recRow.labels }) - 1;
    const ws = worstShortfalls(p);
    const ro = countStatus(p.ranOutOrNearly, 'ranout', req.maxFailures);
    const wsS = countStatus(ws, 'worst', 0);
    const diff = !p.plan.fromCurrent && state.mix
      ? `<p class="diff">Different mix from yours: ${escapeHtml(holdingsText(p.plan))} (yours: ${mixName}).</p>` : '';
    html += `<section class="rec-box" aria-labelledby="rec-title">
        <div class="rec-label">Recommended${r.keepMix ? ` for your ${mixName} mix` : ''}</div>
        <h2 id="rec-title">${escapeHtml(info.name)}${info.aka ? ` <span class="aka">(${escapeHtml(info.aka)})</span>` : ''}</h2>
        <p class="rec-about">${escapeHtml(info.about)}</p>
        <div class="recipe-grid">
          <p><strong>Income</strong>${escapeHtml(recipeLines.income)}</p>
          <p><strong>Cash</strong>${escapeHtml(recipeLines.cash)}</p>
          <p><strong>The rest</strong>${escapeHtml(recipeLines.rest)}</p>
        </div>
        ${diff}
        <div class="rec-figs">
          <div><span class="k">Typical spending</span><span class="v">${money(p.typicalIncome)}</span><span class="s">a year, ${signedMoney(p.typicalIncome - req.wanted)} vs wanted</span></div>
          <div><span class="k">Lowest year</span><span class="v">${money(p.worstIncome)}</span><span class="s">${signedMoney(p.worstIncome - req.minimum)} vs minimum</span></div>
          <div><span class="k">Ran out or nearly</span><span class="v">${p.ranOutOrNearly} of ${n}</span><span class="s st ${ro.cls}">${ICON[ro.cls]}${ro.word}</span></div>
          ${Number.isFinite(ws) ? `<div><span class="k">Worst ${state.worstYears.length} starts</span><span class="v">${ws} of ${state.worstYears.length}</span><span class="s st ${wsS.cls}">${ICON[wsS.cls]}${ws ? 'fell short' : 'held up in all'}</span></div>` : ''}
          <div><span class="k">Typically left</span><span class="v">${bigMoney(p.medianEnd)}</span><span class="s">after ${req.years} years</span></div>
        </div>
        <button type="button" class="link" data-open="${idx}">See this option in detail ›</button>
      </section>`;
  }

  // 1. Your mix as it is now (first, so it is the reference point).
  if (r.currentRows && r.currentRows.length) {
    const RULE_TEXT = { 'spend-first': 'Cash spent first', flexible: 'Cash kept as a reserve' };
    html += `<h2 class="section-title">Your ${mixName} mix as it is now</h2>
      <p class="hint">Your current split, drawn whichever of the four ways suited it best, with your cash handled two ways.</p>
      ${optionsTable(r.currentRows.map((c) => ({
        result: c.result,
        badges: [{ text: 'Your mix as it is now', cls: 'strong' }, { text: RULE_TEXT[c.cashRule] || c.cashRule, cls: 'plain' }],
        flag: c.meetsNeeds ? '' : 'With this cash rule and any of the four approaches, your current mix did not meet these needs; this is its nearest miss.',
      })), n, req, true)}`;
  }

  // 2. The best options found.
  if (r.currentRows && r.currentRows.length) {
    const otherTitle = k ? `Other ways to draw your pot: ${k} that meet${k > 1 ? '' : 's'} your needs` : 'Other ways to draw your pot';
    html += `<h2 class="section-title">${otherTitle}</h2>
      <p class="hint">The best options from the full search. They may use a different mix from yours; each one says how. Tick "Keep my mix" in step 4 to search only your mix.</p>`;
  }
  if (k) {
    html += optionsTable(r.rows.map((row, i) => ({
      result: row.result,
      badges: row.labels.map((t) => ({ text: t, cls: t === 'Recommended' ? 'strong' : '' })),
      flag: i === 0 && row.result.status === 'meets-minimum' ? `No plan paid the full ${money(req.wanted)} in every past retirement; these options stay above your minimum.` : '',
    })), n, req);
  } else {
    html += `<section class="closest"><h2>Closest options</h2>
      <p class="hint">Try a lower income, a lower minimum, or allowing more past retirements to run out. The nearest misses were:</p><ul>`
      + r.closest.map((c) => `<li><strong>${escapeHtml(planName(c.plan))}</strong>: ran out or fell below your minimum in ${c.failingMinimum} of ${n}; typical spending ${money(c.typicalIncome)}. <button type="button" class="link" data-open="${state.openable.push({ result: c, labels: ['Closest'] }) - 1}">See detail</button></li>`).join('')
      + '</ul></section>';
  }

  if (r.others.length) {
    html += `<section class="compare"><h2>How the other approaches compare</h2>
      <p class="hint">The best plan from each approach not shown above, so all four are always compared.</p><div class="cards">`
      + r.others.map((o) => {
        const idx = state.openable.push({ result: o.result, labels: ['Comparison'] }) - 1;
        return `<div class="mini"><h3>${escapeHtml(planName(o.result.plan))}</h3>
          <div class="hint">Typical ${money(o.result.typicalIncome)} · lowest year ${money(o.result.worstIncome)} · ran out ${o.result.failures} of ${n}</div>
          <div class="why">Not shown because it ${escapeHtml(o.reason)}.</div>
          <div><button type="button" class="link" data-open="${idx}">See detail ›</button></div></div>`;
      }).join('') + '</div></section>';
  }

  html += `<p class="hint">All money in today's pounds, before tax; spending rounded to the nearest \u00a3100. Typical spending: what you would have to live on each year (from the pot plus other income) in a typical past retirement. Lowest year: the lowest year in any past retirement that did not run out. Ran out or nearly: ran out, or less than one year's withdrawal left at the end. Income cut: past retirements with any year below what you want to spend. Worst ${state.worstYears.length} starts: of the past retirements whose first ${state.config.risk.rankYears} years were worst for your mix after inflation, how many ran out or fell below your minimum. Biggest fall: the largest drop in your investments from a high point, from year-end values. Bold marks the best figure in each column.</p>`;

  const view = $('view-results');
  view.innerHTML = html;
  view.onclick = (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { openDetail(state.openable[Number(open.dataset.open)]); return; }
    if (e.target.closest('[data-nav="plan"]')) show('plan');
  };
}

// ---------------------------------------------------------------- detail

/**
 * The start year a detail view opens on: the lowest income in any year; when incomes tie
 * (within £1, as with a fixed income that never ran out), the one that came closest to running
 * out, judged by the least left at the end.
 */
function worstCase(sims) {
  const lowest = Math.min(...sims.map((s) => s.minIncomeReal));
  const tied = sims.filter((s) => s.minIncomeReal <= lowest + 1);
  const year = [...tied].sort((a, b) => a.endReal - b.endReal || a.startYear - b.startYear)[0].startYear;
  let reason = 'Lowest income in any year';
  if (tied.length === sims.length && sims.length > 1) reason = 'Paid the same in every year, and left the least at the end';
  else if (tied.length > 1) reason = 'Joint lowest income in any year, and left the least at the end';
  return { year, reason };
}

const defaultYear = (sims) => worstCase(sims).year;

function openDetail(item) {
  const req = state.request;
  const windows = windowsFor(req.years);
  const sims = windows.map((w) => simulate(item.result.plan, w, req, { rows: true, thresholds: state.config.thresholds }));
  const plan = item.result.plan;
  const whatIfs = {
    cash: whatIf({ dataset: state.dataset, config: state.config, request: req, plan, dimension: 'cashBuffer', values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }),
    mix: whatIf({ dataset: state.dataset, config: state.config, request: req, plan, dimension: 'mix', values: [0.6, 0.7, 0.8, 0.9, 1.0] }),
  };
  state.detail = { item, sims, selected: defaultYear(sims), whatIfs, periods: 'all' };
  renderDetail();
  show('detail');
}

function whatIfTable(rows, firstHead, label, isCurrent, n, req) {
  const best = bestValues(rows.map((x) => x.result));
  return `<div class="table-box"><table class="whatif">`
    + headRow(n, req.years, firstHead).replace('</tr></thead>', '<th scope="col" class="num">Spending change<span class="unit">typical, yearly</span></th></tr></thead>')
    + '<tbody>'
    + rows.map(({ value, result: r }) => `<tr class="${isCurrent(value) ? 'current' : ''}"><td>${label(value)}${isCurrent(value) ? ' (this option)' : ''}</td>`
        + cells(r, n, req, best) + `<td class="num">${pct(r.medianVolatility, 1)}</td></tr>`).join('')
    + '</tbody></table></div>';
}

function renderDetail() {
  const { item, whatIfs, periods } = state.detail;
  const req = state.request;
  const total = state.detail.sims.length;
  // All past retirements, or only the worst or best starts for your mix.
  const keep = periods === 'all' ? null : new Set(periods === 'worst' ? state.worstYears : state.bestYears);
  const sims = keep ? state.detail.sims.filter((s) => keep.has(s.startYear)) : state.detail.sims;
  if (!sims.some((s) => s.startYear === state.detail.selected)) {
    state.detail.selected = defaultYear(sims);
  }
  const selected = state.detail.selected;
  const r = keep ? { ...item.result, ...summarisePlan(sims, req) } : item.result;
  const n = sims.length;
  const worst = worstCase(sims);
  const worstName = keep ? `Worst case of these ${n}` : 'Worst case for this option';
  const retiredLabel = (y) => `Retired ${y}${y === worst.year ? ' (worst case)' : ''}`;
  const limit = keep ? allowedFailures(req.riskShare ?? 0, n) : req.maxFailures;
  const rankOf = new Map((state.ranking || []).map((x) => [x.startYear, x]));
  const subsetName = keep ? `${periods === 'worst' ? 'Worst' : 'Best'} ${n} starts` : '';
  const plan = r.plan;
  const rec = recipe(plan, req);
  const profile = buildProfile(req);
  const sel = sims.find((s) => s.startYear === selected);

  const chartLines = (pick) => sims.map((s) => ({
    values: s.rows.map(pick), highlight: s.startYear === selected, ranOut: s.depleted || s.nearlyDepleted, label: retiredLabel(s.startYear),
  }));
  const anyRanOut = sims.some((s) => s.depleted || s.nearlyDepleted);
  const incomeChart = lineChart({
    title: 'What you could afford to spend each year across past retirements',
    startAge: req.age, startYear: selected, kind: 'income',
    lines: chartLines((x) => x.totalIncomeReal),
    refs: [
      { values: profile.wanted, colour: '#2f855a', dash: '7 5', label: `Want ${money(profile.wanted.at(-1))}` },
      { values: profile.minimum, colour: '#9a3412', dash: '2 4', label: `Minimum ${money(profile.minimum.at(-1))}` },
    ],
  });
  const potChart = lineChart({
    title: 'Pot at the end of each year across past retirements',
    startAge: req.age, startYear: selected, kind: 'pot',
    lines: chartLines((x) => x.endTotalReal),
  });
  const selRanOut = sel.depleted || sel.nearlyDepleted;
  const key = (colour, width, dash = '') => `<svg class="key" viewBox="0 0 22 8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke="${colour}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linecap="butt"/></svg>`;
  const legend = (refs) => `<div class="legend">
      <span>${key(selRanOut ? '#b42318' : '#0b5f7a', 3)}${retiredLabel(selected)}</span>
      <span>${key('#4b5563', 1.5)}Median</span>
      <span><i class="box mid"></i>Middle half of past retirements</span>
      <span><i class="box range"></i>Full range</span>
      ${anyRanOut ? `<span>${key('#b42318', 1.5)}Ran out or nearly</span>` : ''}
      ${refs ? `<span>${key('#2f855a', 2, '5 3')}What you want to spend</span><span>${key('#9a3412', 2, '2 3')}Lowest you could live on</span>` : ''}
    </div>
    <p class="hint chart-help">Point at the chart, or select it and use the arrow keys, to read the figures for each year.</p>`;

  const ordered = keep ? [...sims].sort((a, b) => (rankOf.get(a.startYear)?.rank ?? 0) - (rankOf.get(b.startYear)?.rank ?? 0)) : sims;
  const strip = ordered.map((s) => {
    const cuts = s.rows.filter((x) => x.belowWanted).length;
    const ranOutAge = req.age ? req.age + s.depletionYear - 1 : s.depletionYear;
    const [cls, word] = s.depleted ? ['bad', `out ${req.age ? 'at ' : 'yr '}${ranOutAge}`]
      : s.nearlyDepleted ? ['bad', 'nearly ran out']
        : cuts ? ['warn', `${cuts} yr${cuts > 1 ? 's' : ''} cut`] : ['good', 'lasted'];
    const rk = rankOf.get(s.startYear);
    const rankTag = rk ? `<span class="rk" title="Rank ${rk.rank} of ${total}: 1 is the worst start for your mix">#${rk.rank}</span>` : '';
    const isWorst = s.startYear === worst.year;
    return `<button type="button" class="yr ${cls}${isWorst ? ' worst' : ''}" data-year="${s.startYear}" aria-pressed="${s.startYear === selected}"${isWorst ? ` aria-label="${s.startYear}, ${word}, ${worstName.toLowerCase()}"` : ''}>${rankTag}<span class="yr-y">${ICON[cls]}${s.startYear}</span><small>${word}</small>${isWorst ? '<span class="worst-tag">Worst case</span>' : ''}</button>`;
  }).join('');

  const zeroOr = (v, f) => (Math.round(v / 100) === 0 ? '<span class="zero">0</span>' : f(v));
  const yearRows = sel.rows.map((x) => {
    const fromCash = x.cashUsed / x.inflationIndex;
    const fromInv = (x.actualWithdrawal - x.cashUsed) / x.inflationIndex;
    const short = x.actualWithdrawal < x.targetWithdrawal - 1e-6;
    const notes = short ? 'Ran out' : [...(x.events || []).map((ev) => EVENT_TEXT[ev] || ev), x.belowMinimum ? 'Below minimum' : (x.belowWanted ? 'Below what you want' : '')].filter(Boolean).join(', ');
    const cls = short || x.belowMinimum ? 'bad' : (x.belowWanted ? 'warn' : '');
    return `<tr class="${cls}"><td>${req.age ? req.age + x.yearIndex - 1 : x.yearIndex}</td><td>${x.calendarYear}</td><td class="num strong">${money(x.totalIncomeReal)}</td>
      <td class="num">${zeroOr(fromCash, money)}</td><td class="num">${zeroOr(fromInv, money)}</td><td class="num">${zeroOr(x.guaranteedIncome / x.inflationIndex, money)}</td>
      <td class="num${x.portfolioReturn < 0 ? ' neg' : ''}">${signedPct(x.portfolioReturn, 1)}</td><td class="num">${signedPct(x.inflation, 1)}</td><td class="num">${zeroOr(x.endTotalReal, (v) => bigMoney(v, 2))}</td><td class="notes">${escapeHtml(notes)}</td></tr>`;
  }).join('');

  const ro = countStatus(r.ranOutOrNearly, 'ranout', limit);
  const cut = countStatus(r.cutCount, 'cut', limit);
  const selRank = rankOf.get(selected);
  const mixName = state.mix ? mixLabelText(state.mix) : '';
  const ageAt = (t) => (req.age ? req.age + t : t + 1);
  const atAge = (t) => (req.age ? `at age ${ageAt(t)}` : `in year ${t + 1}`);
  const selCuts = sel.rows.filter((x) => x.belowWanted).length;
  const [selCls, selWord] = sel.depleted ? ['bad', `Ran out ${atAge(sel.depletionYear - 1)}`]
    : sel.nearlyDepleted ? ['bad', 'Nearly ran out']
      : selCuts ? ['warn', 'Lasted, with cuts'] : ['good', 'Lasted'];
  const lowT = sel.rows.reduce((m, x, t) => (x.totalIncomeReal < sel.rows[m].totalIncomeReal ? t : m), 0);
  const lowGap = sel.rows[lowT].totalIncomeReal - profile.minimum[lowT];
  const potT = sel.rows.reduce((m, x, t) => (x.endTotalReal < sel.rows[m].endTotalReal ? t : m), 0);
  const fall = worstFall(investmentIndex(sel.rows));
  const fallWhen = fall.fall > 0
    ? (sel.rows[fall.peak].calendarYear === sel.rows[fall.trough - 1].calendarYear
      ? `in ${sel.rows[fall.peak].calendarYear}`
      : `${sel.rows[fall.peak].calendarYear} to ${sel.rows[fall.trough - 1].calendarYear}`)
    : 'never fell';
  const incomes = sel.rows.map((x) => x.totalIncomeReal);
  const firstInc = incomes[0];
  const lastInc = incomes.at(-1);
  const spendSub = Math.max(...incomes) - Math.min(...incomes) < 100 ? 'the same every year'
    : `${money(firstInc)} at first, ${money(lastInc)} by the end`;
  const selFig = (k, v, sub, subCls = '') => `<div class="sel-fig"><div class="k">${k}</div><div class="v">${v}</div><div class="sub ${subCls}">${sub}</div></div>`;
  const selBlock = `<div class="sel-box">
      <div class="sel-head">
        <div>
          <h4>Retired in ${selected} <span class="st-chip ${selCls}">${ICON[selCls]}${escapeHtml(selWord)}</span>${selected === worst.year ? `<span class="worst-chip">${worstName}</span>` : ''}</h4>
          ${selected === worst.year ? `<p class="worst-why">${escapeHtml(worst.reason)}.</p>` : ''}
        </div>
        ${selRank && mixName ? `<p>Rank ${selRank.rank} of ${total} for your ${escapeHtml(mixName)} mix: ${signedPct(selRank.realReturn, 1)} a year after inflation over its first ${state.config.risk.rankYears} years. Rank 1 is the worst start.</p>` : ''}
      </div>
      <div class="sel-figs">
        ${selFig('Typical spending', money(sel.medianIncomeReal), spendSub)}
        ${selFig('Lowest year', money(sel.rows[lowT].totalIncomeReal), `${signedMoney(lowGap)} vs minimum, ${atAge(lowT)}`, lowGap < -100 ? 'bad' : 'good')}
        ${selFig('Years cut', String(selCuts), selCuts ? 'below what you want' : 'never below what you want', selCuts ? 'warn' : '')}
        ${selFig('Lowest pot', bigMoney(sel.rows[potT].endTotalReal), atAge(potT))}
        ${selFig(`Left ${req.age ? `at ${ageAt(sel.rows.length - 1)}` : 'at the end'}`, bigMoney(sel.endReal), "today's money")}
        ${selFig('Biggest fall', pct(fall.fall), fallWhen)}
      </div>
    </div>`;
  const size = state.config.risk.subsetSize;
  const periodChoices = [['all', `All ${total}`], ['worst', `Worst ${size}`], ['best', `Best ${size}`]]
    .map(([id, label]) => `<button type="button" role="radio" data-periods="${id}" aria-checked="${periods === id}">${label}</button>`).join('');
  const periodHint = keep
    ? `Showing the ${n} ${periods} starts for your ${mixName} mix, judged by its return after inflation over the first ${state.config.risk.rankYears} years. The figures, charts and boxes below cover only these; the what-if tables still use all ${total}.`
    : `Showing all ${total} past retirements, starting ${state.detail.sims[0].startYear} to ${state.detail.sims.at(-1).startYear}. Choose the worst or best starts for your mix to see how this option did in them.`;
  const fact = (k, v, ref, cls = 'neutral') => `<div class="fact ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="ref">${cls !== 'neutral' ? ICON[cls] : ''}${ref}</div></div>`;
  const facts = [
    fact('Typical spending', money(r.typicalIncome), `a year, ${signedMoney(r.typicalIncome - req.wanted)} vs ${money(req.wanted)} wanted`, r.typicalIncome >= req.wanted - 100 ? 'good' : 'warn'),
    fact('Lowest year', money(r.worstIncome), `${signedMoney(r.worstIncome - req.minimum)} vs ${money(req.minimum)} minimum`, r.worstIncome >= req.minimum - 100 ? 'good' : 'bad'),
    fact('Ran out or nearly', `${r.ranOutOrNearly} of ${n}`, `${ro.word}, limit ${limit}`, ro.cls),
    fact('Income cut', `${r.cutCount} of ${n}`, r.cutCount ? 'past retirements with a year below what you want' : 'never below what you want', cut.cls),
    fact('Typically left', bigMoney(r.medianEnd), `after ${req.years} years, in today's money`),
    fact('Biggest fall', pct(r.worstDrawdown), 'largest drop in your investments'),
  ].join('');
  const isBufferYears = plan.cashBuffer.years !== undefined;
  const html = `<button type="button" class="link back" data-nav="results">‹ Back to your options</button>
    <div class="detail">
      <header class="results-head">
        <div class="badges">${item.labels.map((t) => `<span class="badge ${t === 'Recommended' ? 'strong' : ''}">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="strategy-tag">Strategy: <strong>${escapeHtml(strategyTag(plan))}</strong>. ${escapeHtml(STRATEGY_INFO[plan.strategy]?.about || '')}</div>
        <h1>${escapeHtml(planName(plan))}</h1>
        <p class="recipe"><strong>Income:</strong> ${escapeHtml(rec.income)}</p>
        <p class="recipe"><strong>Cash:</strong> ${escapeHtml(rec.cash)}</p>
        <p class="recipe"><strong>The rest:</strong> ${escapeHtml(rec.rest)}</p>
      </header>

      <div class="periods-bar">
        <div class="segmented periods" role="radiogroup" aria-label="Which past retirements to show">${periodChoices}</div>
        <p class="hint">${escapeHtml(periodHint)}</p>
      </div>

      <div class="facts">${facts}      </div>

      <section class="panel">
        <h3>${keep ? `${subsetName}, worst first` : 'Each past retirement'}</h3>
        <p class="hint">Choose a start year to highlight it in the charts and see it year by year. The small number is each start's rank for your mix, 1 being the worst.</p>
        <div class="strip" id="strip">${strip}</div>
        ${selBlock}
        <div class="legend"><span class="st good">${ICON.good}Lasted, never below what you want</span><span class="st warn">${ICON.warn}Lasted, some years below what you want</span><span class="st bad">${ICON.bad}Ran out, or under a year's withdrawal left</span></div>
      </section>

      <section class="panel chart">
        <h3>What you could afford to spend each year${keep ? ` <span class="tag">${subsetName}</span>` : ''}</h3>
        <p class="hint">Money from your pot plus any State Pension or other income, before tax, in today's money. This is what you would have to live on, not what your investments earned: those returns are in the table below and in the pot chart.</p>
        ${incomeChart}
        ${legend(true)}
      </section>

      <section class="panel chart">
        <h3>What is left in the pot, in today's money${keep ? ` <span class="tag">${subsetName}</span>` : ''}</h3>
        ${potChart}
        ${legend(false)}
      </section>

      <section class="panel">
        <h3>Retired in ${selected}, year by year</h3>
        <div class="table-box"><table class="year-table"><thead><tr>
          <th scope="col">${req.age ? 'Your age' : 'Year'}</th><th scope="col">Calendar year</th><th scope="col" class="num">You could spend</th>
          <th scope="col" class="num">From cash</th><th scope="col" class="num">From investments</th><th scope="col" class="num">Pensions and earnings</th>
          <th scope="col" class="num">Investment return</th><th scope="col" class="num">Inflation</th><th scope="col" class="num">Pot left</th><th scope="col">Notes</th>
        </tr></thead><tbody>${yearRows}</tbody></table></div>
        <p class="hint">Money in today's pounds, rounded to the nearest \u00a3100. You could spend = from cash + from investments + pensions and earnings. Investment return is what the whole pot gained or lost that year, after charges; falls are shown in red. Shaded rows: amber is below what you want to spend, red is below your minimum or ran out.</p>
      </section>

      <section class="panel">
        <h3>What if the cash buffer were different?</h3>
        ${whatIfTable(whatIfs.cash, 'Cash buffer', (v) => (v === 0 ? 'None' : `${v} year${v > 1 ? 's' : ''}`), (v) => isBufferYears && v === plan.cashBuffer.years, total, req)}
      </section>

      <section class="panel">
        <h3>What if the shares and bonds mix were different?</h3>
        ${whatIfTable(whatIfs.mix, 'Shares / bonds', (v) => `${Math.round(v * 100)} / ${100 - Math.round(v * 100)}`, (v) => Math.abs(v - plan.mix.equities) < 1e-9, total, req)}
      </section>
    </div>`;

  const view = $('view-detail');
  view.innerHTML = html;
  wireCharts(view);
  view.onclick = (e) => {
    const pick = e.target.closest('[data-periods]');
    if (pick) {
      state.detail.periods = pick.dataset.periods;
      renderDetail();
      const again = view.querySelector(`[data-periods="${pick.dataset.periods}"]`);
      if (again) again.focus();
      return;
    }
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
