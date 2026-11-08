// The page: wizard, results and option detail. All modelling happens in engine/.

import { validateDataset, makeWindows } from '../engine/dataset.js';
import { runSearch, whatIf, buildGrid, strategySettings, CASH_RULES, currentFromMix } from '../engine/search.js';
import { simulate } from '../engine/simulate.js';
import { buildProfile } from '../engine/profile.js';
import { gbp, pct, escapeHtml, parseAmount, formatAmount, planName, recipe, holdingsText } from './format.js';
import { lineChart } from './charts.js';

const $ = (id) => document.getElementById(id);
const state = {
  config: null,
  dataset: null,
  mixLabel: null,
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
    if (!['mix-eq', 'mix-bd', 'mix-cash'].includes(e.target.id)) clearPreset();
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
  const typical = config.presets.find((p) => p.id === 'typical');
  if (typical) applyPreset('typical');
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
  clearPreset();
  refresh();
}

function currentAge() {
  const a = Number($('age').value);
  return Number.isInteger(a) && a > 0 ? a : null;
}

function applyValues(v) {
  if (v.pot !== undefined) $('pot').value = formatAmount(v.pot);
  if (v.age !== undefined && !$('age').value) $('age').value = String(v.age);
  if (v.years !== undefined) $('years').value = String(v.years);
  if (v.wanted !== undefined) $('wanted').value = formatAmount(v.wanted);
  if (v.minimum !== undefined) $('minimum').value = formatAmount(v.minimum);
  if (v.maxFailures !== undefined) state.maxFailures = v.maxFailures;
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

function applyPreset(id) {
  const p = state.config.presets.find((x) => x.id === id);
  if (!p) return;
  applyValues({ incomeChange: null, ...p.values });
  for (const b of $('presets').querySelectorAll('[data-preset]')) b.setAttribute('aria-pressed', String(b.dataset.preset === id));
  renderRisk();
  refresh();
}

function clearPreset() {
  for (const b of $('presets').querySelectorAll('[aria-pressed="true"]')) b.setAttribute('aria-pressed', 'false');
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
    request: { pot, years, age: ageOk ? age : null, wanted, minimum, incomeChange, otherIncome, maxFailures: state.maxFailures, annualFee: fee },
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

  $('source-line').textContent = `Tested against ${n} real retirements starting ${first} to ${last} · global shares in £, UK gilts and cash, UK inflation`;

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
  for (const el of document.querySelectorAll('[data-bind="plan-count"]')) el.textContent = count.toLocaleString('en-GB');
  for (const el of document.querySelectorAll('[data-bind="plan-count-number"]')) el.textContent = count.toLocaleString('en-GB');
  const has = (x) => Number.isFinite(x) && x > 0;
  const span = request.age ? `${years} years, from age ${request.age} to ${request.age + years - 1},` : `${years} years`;
  let text = `Find ways to draw <strong>${has(request.wanted) ? gbp(request.wanted) : '[income you want]'}</strong> a year for ${span} from <strong>${has(request.pot) ? gbp(request.pot) : '[your pot]'}</strong>. `
    + `Income should never fall below <strong>${Number.isFinite(request.minimum) ? gbp(request.minimum) : '[your minimum]'}</strong>. `;
  if (request.incomeChange) {
    text += `From age ${request.age + request.incomeChange.fromYear - 1}, ${gbp(request.incomeChange.wanted)} a year, never below ${gbp(request.incomeChange.minimum)}. `;
  }
  text += state.maxFailures === 0
    ? `None of the ${n} past retirements may run out. `
    : `Up to ${state.maxFailures} of the ${n} past retirements may run out. `;
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

function cells(r, n) {
  // data-label lets phones show each figure with its heading when the table stacks.
  return `<td class="num" data-label="Typically you could spend a year">${gbp(r.typicalIncome)}</td>`
    + `<td class="num" data-label="Least you could spend in a year">${gbp(r.worstIncome)}</td>`
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
      ${!r.plan.fromCurrent && state.mix ? `<div class="recipe diff">Different mix from yours: ${escapeHtml(holdingsText(r.plan))} (yours: ${mixLabelText(state.mix)})</div>` : ''}
      <div><button type="button" class="link" data-open="${idx}">See this option in detail ›</button></div>
    </div></td>`;
}

const HEAD = (n, years) => `<thead><tr>
    <th scope="col">Option</th>
    <th scope="col" class="num">Typically you could spend a year</th>
    <th scope="col" class="num">Least you could spend in a year</th>
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
  const mixName = state.mix ? mixLabelText(state.mix) : '';
  let heading;
  if (r.keepMix) heading = k ? `${k} way${k > 1 ? 's' : ''} to draw your ${mixName} mix that meet${k > 1 ? '' : 's'} your needs` : `No way of drawing your ${mixName} mix meets these needs`;
  else if (r.currentRows && r.currentRows.length) heading = 'Your results';
  else heading = k ? `${k} way${k > 1 ? 's' : ''} that meet${k > 1 ? '' : 's'} your needs` : 'No way of drawing your pot meets these needs';

  let html = `<button type="button" class="link back" data-nav="plan">‹ Change your inputs</button>
    <header class="results-head">
      <h1>${heading}</h1>
      <p class="hint">You asked for ${gbp(req.wanted)} a year, never below ${gbp(req.minimum)}, with ${req.maxFailures === 0 ? 'none' : `up to ${req.maxFailures}`} of ${n} past retirements (starting ${r.windows[0].startYear} to ${r.windows.at(-1).startYear}) allowed to run out. ${r.plansTried.toLocaleString('en-GB')} plans were tested${r.keepMix ? `, all with your ${mixName} mix` : ''}.</p>
    </header>`;

  // 1. Your mix as it is now (first, so it is the reference point).
  if (r.currentRows && r.currentRows.length) {
    const RULE_TEXT = { 'spend-first': 'Cash spent first', flexible: 'Cash kept as a reserve' };
    html += `<h2 class="section-title">Your ${mixName} mix as it is now</h2>
      <p class="hint">Your current split, drawn whichever of the four ways suited it best, with your cash handled two ways.</p>
      <div class="table-box mine"><table class="results-table">${HEAD(n, req.years)}<tbody>`;
    for (const c of r.currentRows) {
      const badges = [{ text: 'Your mix as it is now', cls: 'strong' }, { text: RULE_TEXT[c.cashRule] || c.cashRule, cls: 'plain' }];
      html += `<tr>${optionCell(c.result, badges, req)}${cells(c.result, n)}</tr>`;
      if (!c.meetsNeeds) html += `<tr><td colspan="7" class="recipe flag">With this cash rule and any of the four approaches, your current mix did not meet these needs; this is its nearest miss.</td></tr>`;
    }
    html += '</tbody></table></div>';
  }

  // 2. The best options found.
  if (r.currentRows && r.currentRows.length) {
    const otherTitle = k ? `Other ways to draw your pot: ${k} that meet${k > 1 ? '' : 's'} your needs` : 'Other ways to draw your pot';
    html += `<h2 class="section-title">${otherTitle}</h2>
      <p class="hint">The best options from the full search. They may use a different mix from yours; each one says how. Tick "Keep my mix" in step 4 to search only your mix.</p>`;
  }
  if (k) {
    html += `<div class="table-box"><table class="results-table">${HEAD(n, req.years)}<tbody>`;
    r.rows.forEach((row, i) => {
      const badges = row.labels.map((t) => ({ text: t, cls: t === 'Recommended' ? 'strong' : '' }));
      html += `<tr>${optionCell(row.result, badges, req)}${cells(row.result, n)}</tr>`;
      if (i === 0 && row.result.status === 'meets-minimum') {
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

  html += `<p class="hint">Ran out, or nearly: ran out, or less than one year's withdrawal left at the end. Typically you could spend: what you would have to live on each year (from the pot plus other income, before tax, in today's money), in a typical past retirement. Income cut: any year below what you want to spend. Least you could spend in a year: the lowest year in any past retirement that did not run out. Biggest fall: the largest drop in your investments from a high point, from year-end values.</p>`;

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
      <th scope="col">${firstHead}</th><th scope="col" class="num">Typically you could spend</th><th scope="col" class="num">Least in a year</th>
      <th scope="col" class="num">Ran out, or nearly</th><th scope="col" class="num">Income cut</th>
      <th scope="col" class="num">Typically left</th><th scope="col" class="num">Biggest fall</th><th scope="col" class="num">Typical yearly change in spending</th>
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
    title: 'What you could afford to spend each year in each past retirement',
    startAge: req.age,
    lines: sims.map((s) => ({ values: s.rows.map((x) => x.totalIncomeReal), highlight: s.startYear === selected, label: `Retired ${s.startYear}` })),
    refs: [
      { values: profile.wanted, colour: '#2f855a', dash: '7 5' },
      { values: profile.minimum, colour: '#9a3412', dash: '2 4' },
    ],
  });
  const potChart = lineChart({
    title: 'Pot at the end of each year in each past retirement',
    startAge: req.age,
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
    return `<tr class="${short ? 'short' : ''}"><td>${req.age ? req.age + x.yearIndex - 1 : x.yearIndex}</td><td>${x.calendarYear}</td><td class="num">${gbp(x.totalIncomeReal)}</td>
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
        <div class="fact"><div class="k">Typically you could spend a year</div><div class="v">${gbp(r.typicalIncome)}</div></div>
        <div class="fact"><div class="k">Least you could spend in a year</div><div class="v">${gbp(r.worstIncome)}</div></div>
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
        <h3>What you could afford to spend each year</h3>
        <p class="hint">Money from your pot plus any State Pension or other income, before tax, in today's money. This is what you would have to live on, not what your investments earned: those returns are in the table below and in the pot chart.</p>
        ${incomeChart}
        <div class="legend"><span><i class="sw" style="border-color:#0b5f7a"></i>Retired ${selected}</span><span><i class="sw" style="border-color:#9fb7c0"></i>Other start years</span><span><i class="sw dash" style="border-color:#2f855a"></i>What you want to spend</span><span><i class="sw dash" style="border-color:#9a3412"></i>Lowest you could live on</span></div>
      </section>

      <section class="panel chart">
        <h3>What is left in the pot, in today's money</h3>
        ${potChart}
        <div class="legend"><span><i class="sw" style="border-color:#0b5f7a"></i>Retired ${selected}</span><span><i class="sw" style="border-color:#9fb7c0"></i>Other start years</span></div>
      </section>

      <section class="panel">
        <h3>Retired in ${selected}, year by year</h3>
        <div class="table-box"><table class="year-table"><thead><tr>
          <th scope="col">${req.age ? 'Your age' : 'Year'}</th><th scope="col">Calendar year</th><th scope="col" class="num">You could spend</th>
          <th scope="col" class="num">From cash</th><th scope="col" class="num">From investments</th><th scope="col" class="num">Pensions and earnings</th>
          <th scope="col" class="num">Investment return</th><th scope="col" class="num">Inflation</th><th scope="col" class="num">Pot left</th><th scope="col">Notes</th>
        </tr></thead><tbody>${yearRows}</tbody></table></div>
        <p class="hint">Money figures in today's money. You could spend = from cash + from investments + other income. Investment return is what the whole pot gained or lost that year, after charges.</p>
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
