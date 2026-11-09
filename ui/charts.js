// The detail charts: one line per past retirement would be a tangle, so each chart shows the
// spread of all past retirements as two shaded bands (full range, middle half) with a median
// line, the chosen start year on top, any retirements that ran out in red, and reference lines
// labelled where they end. wireCharts() adds the hover and keyboard readout.

import { money, bigMoney } from './format.js';

const W = 760;
const H = 300;
const PAD = { left: 64, right: 120, top: 16, bottom: 40 };

// CSS variables from style.css, so the charts follow light and dark mode. They are set through
// style="..." because SVG colour attributes do not read CSS variables in every browser.
export const COLOURS = {
  accent: 'var(--accent)',
  band: 'var(--accent)',
  median: 'var(--chart-median)',
  ranOut: 'var(--critical)',
  grid: 'var(--line)',
  axis: 'var(--muted)',
};

function niceStep(range, ticks) {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

const axisMoney = (v) => {
  if (Math.abs(v) >= 1e6) return `\u00a3${+(v / 1e6).toFixed(1)}m`;
  if (Math.abs(v) >= 1e3) return `\u00a3${Math.round(v / 1e3)}k`;
  return `\u00a3${Math.round(v)}`;
};

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * lines:  [{ values: number[], label, highlight?: boolean, ranOut?: boolean }]
 * refs:   [{ values: number[], colour, dash, label }]  reference lines (wanted, minimum)
 * kind:   'income' or 'pot' (how values are written in the readout)
 * title:  accessible name for the chart
 * startAge: your age in year 1; when given, the horizontal axis shows ages
 * startYear: calendar year the highlighted retirement began, for the readout
 */
export function lineChart({ lines, refs = [], kind = 'income', title, startAge = null, startYear = null }) {
  const n = Math.max(...lines.map((l) => l.values.length));
  const all = [...lines.flatMap((l) => l.values), ...refs.flatMap((r) => r.values)].filter(Number.isFinite);
  const maxV = Math.max(1, ...all);
  const step = niceStep(maxV, 5);
  const top = Math.ceil(maxV / step) * step;
  const x = (i) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.left - PAD.right));
  const y = (v) => PAD.top + (1 - Math.max(0, v) / top) * (H - PAD.top - PAD.bottom);
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const area = (upper, lower) => `${path(upper)}${lower.map((v, i) => ({ v, i })).reverse().map(({ v, i }) => `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')}Z`;

  // The spread of all past retirements, year by year.
  const stats = { min: [], p25: [], median: [], p75: [], max: [] };
  for (let i = 0; i < n; i += 1) {
    const s = lines.map((l) => l.values[i]).filter(Number.isFinite).sort((a, b) => a - b);
    stats.min.push(s[0]);
    stats.p25.push(quantile(s, 0.25));
    stats.median.push(quantile(s, 0.5));
    stats.p75.push(quantile(s, 0.75));
    stats.max.push(s.at(-1));
  }

  const grid = [];
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid.push(`<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}" style="stroke:${COLOURS.grid}"/>`
      + `<text x="${PAD.left - 8}" y="${y(v) + 4}" text-anchor="end" font-size="12" style="fill:${COLOURS.axis}">${axisMoney(v)}</text>`);
  }
  const xticks = [];
  const every = n > 30 ? 10 : 5;
  for (let i = 0; i < n; i += 1) {
    const label = startAge ? startAge + i : i + 1;
    if (i === 0 || i === n - 1 || label % every === 0) {
      if (i !== 0 && i !== n - 1 && (i < 2 || i > n - 3)) continue;
      xticks.push(`<text x="${x(i)}" y="${H - PAD.bottom + 18}" text-anchor="middle" font-size="12" style="fill:${COLOURS.axis}">${label}</text>`);
    }
  }

  const hi = lines.find((l) => l.highlight);
  const ranOut = lines.filter((l) => l.ranOut && !l.highlight)
    .map((l) => `<path d="${path(l.values)}" fill="none" style="stroke:${COLOURS.ranOut}" stroke-width="1.5" opacity="0.85"/>`);
  const refLines = refs.map((r) => `<path d="${path(r.values)}" fill="none" style="stroke:${r.colour}" stroke-width="2" ${r.dash ? `stroke-dasharray="${r.dash}"` : ''}/>`);

  // Direct labels at the right-hand end, nudged apart so they never overlap. A label with a
  // note in brackets ("Retired 1973 (worst case)") goes on two lines, and any label too long
  // for the space is set smaller so it always fits.
  const room = PAD.right - 10;
  const fit = (text, size, weight) => Math.min(size, room / (text.length * (weight ? 0.62 : 0.56)));
  const split = (text) => {
    const m = /^(.*) \((.*)\)$/.exec(text);
    return m ? { text: m[1], note: m[2] } : { text, note: '' };
  };
  const labels = [
    ...refs.map((r) => ({ ...split(r.label), colour: r.colour, v: r.values.at(-1) })),
    ...(hi ? [{ ...split(hi.label), colour: hi.ranOut ? COLOURS.ranOut : COLOURS.accent, v: hi.values.at(-1), bold: true }] : []),
    { text: 'Median', note: '', colour: COLOURS.median, v: stats.median.at(-1) },
  ].map((l) => ({ ...l, y: y(l.v) + 4, h: l.note ? 26 : 14 })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i += 1) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + labels[i - 1].h);
  const overflow = labels.length ? labels.at(-1).y + labels.at(-1).h - 14 - (H - PAD.bottom + 4) : 0;
  if (overflow > 0) for (const l of labels) l.y -= overflow;
  const endLabels = labels.map((l) => {
    const size = fit(l.text, 12, l.bold).toFixed(1);
    const note = l.note ? `<tspan x="${W - PAD.right + 8}" dy="13" font-size="${fit(l.note, 11, false).toFixed(1)}" font-weight="400">${esc(l.note)}</tspan>` : '';
    return `<text x="${W - PAD.right + 8}" y="${l.y.toFixed(1)}" font-size="${size}" ${l.bold ? 'font-weight="600"' : ''} style="fill:${l.colour}">${esc(l.text)}${note}</text>`;
  });

  const data = {
    n, startAge, startYear, kind, top, W, H, PAD,
    hi: hi ? { label: hi.label, values: hi.values } : null,
    median: stats.median, p25: stats.p25, p75: stats.p75, min: stats.min, max: stats.max,
    refs: refs.map((r) => ({ label: r.label, values: r.values })),
  };

  return `<div class="chart-wrap" data-chart="${esc(JSON.stringify(data))}">`
    + `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" tabindex="0">`
    + grid.join('') + xticks.join('')
    + `<text x="${(PAD.left + W - PAD.right) / 2}" y="${H - 6}" text-anchor="middle" font-size="12" style="fill:${COLOURS.axis}">${startAge ? 'Your age' : 'Year of retirement'}</text>`
    + `<path d="${area(stats.max, stats.min)}" style="fill:${COLOURS.band}" opacity="0.10"/>`
    + `<path d="${area(stats.p75, stats.p25)}" style="fill:${COLOURS.band}" opacity="0.22"/>`
    + `<path d="${path(stats.median)}" fill="none" style="stroke:${COLOURS.median}" stroke-width="1.5"/>`
    + ranOut.join('') + refLines.join('')
    + (hi ? `<path d="${path(hi.values)}" fill="none" style="stroke:${hi.ranOut ? COLOURS.ranOut : COLOURS.accent}" stroke-width="3" stroke-linejoin="round"/>` : '')
    + endLabels.join('')
    + `<line class="hover-line" x1="0" x2="0" y1="${PAD.top}" y2="${H - PAD.bottom}" style="stroke:${COLOURS.axis}" stroke-width="1" visibility="hidden"/>`
    + `<circle class="hover-dot" r="5" style="fill:${COLOURS.accent};stroke:var(--card)" stroke-width="2" visibility="hidden"/>`
    + `<rect class="hover-area" x="${PAD.left}" y="${PAD.top}" width="${W - PAD.left - PAD.right}" height="${H - PAD.top - PAD.bottom}" fill="transparent"/>`
    + '</svg><div class="chart-tip" hidden></div></div>';
}

/** Adds a crosshair readout (pointer, touch and arrow keys) to every chart under root. */
export function wireCharts(root) {
  for (const wrap of root.querySelectorAll('.chart-wrap')) {
    const d = JSON.parse(wrap.dataset.chart);
    const svg = wrap.querySelector('svg');
    const line = svg.querySelector('.hover-line');
    const dot = svg.querySelector('.hover-dot');
    const tip = wrap.querySelector('.chart-tip');
    const fmt = d.kind === 'pot' ? (v) => bigMoney(v, 2) : money;
    const xAt = (i) => d.PAD.left + (d.n <= 1 ? 0 : (i / (d.n - 1)) * (d.W - d.PAD.left - d.PAD.right));
    const yAt = (v) => d.PAD.top + (1 - Math.max(0, v) / d.top) * (d.H - d.PAD.top - d.PAD.bottom);
    let current = null;

    const row = (value, label, cls = '') => {
      const r = document.createElement('div');
      r.className = `tip-row ${cls}`;
      const v = document.createElement('strong');
      v.textContent = value;
      const l = document.createElement('span');
      l.textContent = label;
      r.append(v, l);
      return r;
    };

    function showAt(i) {
      current = Math.max(0, Math.min(d.n - 1, i));
      const px = xAt(current);
      line.setAttribute('x1', px); line.setAttribute('x2', px); line.setAttribute('visibility', 'visible');
      if (d.hi) {
        dot.setAttribute('cx', px); dot.setAttribute('cy', yAt(d.hi.values[current])); dot.setAttribute('visibility', 'visible');
      }
      tip.replaceChildren();
      const head = document.createElement('div');
      head.className = 'tip-head';
      const age = d.startAge ? `Age ${d.startAge + current}` : `Year ${current + 1}`;
      head.textContent = d.startYear ? `${age} \u00b7 ${d.startYear + current}` : age;
      tip.append(head);
      if (d.hi) tip.append(row(fmt(d.hi.values[current]), d.hi.label, 'lead'));
      tip.append(row(fmt(d.median[current]), 'Median'));
      tip.append(row(`${fmt(d.p25[current])} to ${fmt(d.p75[current])}`, 'Middle half'));
      tip.append(row(`${fmt(d.min[current])} to ${fmt(d.max[current])}`, 'Full range'));
      for (const r of d.refs) tip.append(row(fmt(r.values[current]), r.label));
      tip.hidden = false;
      // Place the readout beside the crosshair, flipping sides past the middle.
      const box = svg.getBoundingClientRect();
      const wrapBox = wrap.getBoundingClientRect();
      const left = box.left - wrapBox.left + (px / d.W) * box.width;
      const right = left > wrapBox.width / 2;
      tip.style.left = right ? '' : `${left + 12}px`;
      tip.style.right = right ? `${wrapBox.width - left + 12}px` : '';
    }

    function hide() {
      current = null;
      line.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    }

    svg.addEventListener('pointermove', (e) => {
      const box = svg.getBoundingClientRect();
      const vx = ((e.clientX - box.left) / box.width) * d.W;
      if (vx < d.PAD.left - 10 || vx > d.W - d.PAD.right + 10) { hide(); return; }
      showAt(Math.round(((vx - d.PAD.left) / (d.W - d.PAD.left - d.PAD.right)) * (d.n - 1)));
    });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('focus', () => showAt(current ?? 0));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        showAt((current ?? 0) + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Home') { e.preventDefault(); showAt(0); }
      else if (e.key === 'End') { e.preventDefault(); showAt(d.n - 1); }
      else if (e.key === 'Escape') hide();
    });
  }
}
