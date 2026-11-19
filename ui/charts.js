// The detail charts: one line per past retirement would be a tangle, so each chart shows the
// spread of all past retirements as two shaded bands (full range, middle half) with a median
// line, the chosen start year on top, any retirements that ran out in red, and reference lines.
// Wide screens: drawn at 760 by 300 and scaled, with labels where the lines end. Narrow screens
// (under PHONE_WIDTH): redrawn at the real width so text stays 12px, taller, fewer ticks, no end
// labels (the key under the chart names the lines), and a readout above the chart that you tap
// or drag along. wireCharts() adds the readout and the redraw.

import { money, bigMoney } from './format.js';

const W = 760;
const H = 300;
const PAD = { left: 64, right: 120, top: 16, bottom: 40 };
/** Below this width (CSS pixels) a chart uses its phone layout. */
export const PHONE_WIDTH = 600;
const PHONE_PAD = { left: 46, right: 14, top: 12, bottom: 38 };

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
 * The figures behind a chart, worked out once and drawn at any size.
 * lines:  [{ values: number[], label, highlight?: boolean, ranOut?: boolean }]
 * refs:   [{ values: number[], colour, dash, label }]  reference lines (wanted, minimum)
 */
function chartModel({ lines, refs = [], kind = 'income', title, startAge = null, startYear = null }) {
  const n = Math.max(...lines.map((l) => l.values.length));
  const all = [...lines.flatMap((l) => l.values), ...refs.flatMap((r) => r.values)].filter(Number.isFinite);
  const maxV = Math.max(1, ...all);
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
  const hi = lines.find((l) => l.highlight);
  return {
    n, maxV, kind, title, startAge, startYear, ...stats,
    hi: hi ? { label: hi.label, values: hi.values, ranOut: Boolean(hi.ranOut) } : null,
    ranOut: lines.filter((l) => l.ranOut && !l.highlight).map((l) => l.values),
    refs: refs.map((r) => ({ label: r.label, values: r.values, colour: r.colour, dash: r.dash })),
  };
}

/** The size and spacing to draw at: the fixed wide layout, or the phone layout at width w. */
function geometry(m, w) {
  if (!w || w >= PHONE_WIDTH) {
    const step = niceStep(m.maxV, 5);
    return { phone: false, W, H, PAD, step, top: Math.ceil(m.maxV / step) * step };
  }
  const Wp = Math.round(w);
  const Hp = Math.round(Math.max(220, Math.min(300, Wp * 0.72)));
  const step = niceStep(m.maxV, 4);
  return { phone: true, W: Wp, H: Hp, PAD: PHONE_PAD, step, top: Math.ceil(m.maxV / step) * step };
}

function drawSvg(m, g) {
  const { n } = m;
  const { W: w, H: h, PAD: pad, step, top } = g;
  const x = (i) => pad.left + (n <= 1 ? 0 : (i / (n - 1)) * (w - pad.left - pad.right));
  const y = (v) => pad.top + (1 - Math.max(0, v) / top) * (h - pad.top - pad.bottom);
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const area = (upper, lower) => `${path(upper)}${lower.map((v, i) => ({ v, i })).reverse().map(({ v, i }) => `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')}Z`;

  const grid = [];
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid.push(`<line x1="${pad.left}" x2="${w - pad.right}" y1="${y(v)}" y2="${y(v)}" style="stroke:${COLOURS.grid}"/>`
      + `<text x="${pad.left - 8}" y="${y(v) + 4}" text-anchor="end" font-size="12" style="fill:${COLOURS.axis}">${axisMoney(v)}</text>`);
  }
  const xticks = [];
  // Phones: a label every 10 years, plus the first and last (with room kept between them).
  const every = g.phone || n > 30 ? 10 : 5;
  const gapEnds = g.phone ? 4 : 2;
  for (let i = 0; i < n; i += 1) {
    const label = m.startAge ? m.startAge + i : i + 1;
    if (i === 0 || i === n - 1 || label % every === 0) {
      if (i !== 0 && i !== n - 1 && (i < gapEnds || i > n - 1 - gapEnds)) continue;
      xticks.push(`<text x="${x(i)}" y="${h - pad.bottom + 18}" text-anchor="middle" font-size="12" style="fill:${COLOURS.axis}">${label}</text>`);
    }
  }

  const hiColour = m.hi && m.hi.ranOut ? COLOURS.ranOut : COLOURS.accent;
  const ranOut = m.ranOut.map((vals) => `<path d="${path(vals)}" fill="none" style="stroke:${COLOURS.ranOut}" stroke-width="1.5" opacity="0.85"/>`);
  const refLines = m.refs.map((r) => `<path d="${path(r.values)}" fill="none" style="stroke:${r.colour}" stroke-width="2" ${r.dash ? `stroke-dasharray="${r.dash}"` : ''}/>`);

  // Wide layout: direct labels at the right-hand end, nudged apart so they never overlap. A label
  // with a note in brackets ("Retired 1973 (worst case)") goes on two lines, and any label too
  // long for the space is set smaller so it always fits. Phones have no room: the key names them.
  let endLabels = [];
  if (!g.phone) {
    const room = pad.right - 10;
    const fit = (text, size, weight) => Math.min(size, room / (text.length * (weight ? 0.62 : 0.56)));
    const split = (text) => {
      const mm = /^(.*) \((.*)\)$/.exec(text);
      return mm ? { text: mm[1], note: mm[2] } : { text, note: '' };
    };
    const labels = [
      ...m.refs.map((r) => ({ ...split(r.label), colour: r.colour, v: r.values.at(-1) })),
      ...(m.hi ? [{ ...split(m.hi.label), colour: hiColour, v: m.hi.values.at(-1), bold: true }] : []),
      { text: 'Typical', note: '', colour: COLOURS.median, v: m.median.at(-1) },
    ].map((l) => ({ ...l, y: y(l.v) + 4, h: l.note ? 26 : 14 })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i += 1) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + labels[i - 1].h);
    const overflow = labels.length ? labels.at(-1).y + labels.at(-1).h - 14 - (h - pad.bottom + 4) : 0;
    if (overflow > 0) for (const l of labels) l.y -= overflow;
    endLabels = labels.map((l) => {
      const size = fit(l.text, 12, l.bold).toFixed(1);
      const note = l.note ? `<tspan x="${w - pad.right + 8}" dy="13" font-size="${fit(l.note, 11, false).toFixed(1)}" font-weight="400">${esc(l.note)}</tspan>` : '';
      return `<text x="${w - pad.right + 8}" y="${l.y.toFixed(1)}" font-size="${size}" ${l.bold ? 'font-weight="600"' : ''} style="fill:${l.colour}">${esc(l.text)}${note}</text>`;
    });
  }

  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(m.title)}" tabindex="0">`
    + grid.join('') + xticks.join('')
    + `<text x="${(pad.left + w - pad.right) / 2}" y="${h - 6}" text-anchor="middle" font-size="12" style="fill:${COLOURS.axis}">${m.startAge ? 'Your age' : 'Year of retirement'}</text>`
    + `<path d="${area(m.max, m.min)}" style="fill:${COLOURS.band}" opacity="0.10"/>`
    + `<path d="${area(m.p75, m.p25)}" style="fill:${COLOURS.band}" opacity="0.22"/>`
    + `<path d="${path(m.median)}" fill="none" style="stroke:${COLOURS.median}" stroke-width="1.5"/>`
    + ranOut.join('') + refLines.join('')
    + (m.hi ? `<path d="${path(m.hi.values)}" fill="none" style="stroke:${hiColour}" stroke-width="3" stroke-linejoin="round"/>` : '')
    + endLabels.join('')
    + `<line class="hover-line" x1="0" x2="0" y1="${pad.top}" y2="${h - pad.bottom}" style="stroke:${COLOURS.axis}" stroke-width="1" visibility="hidden"/>`
    + `<circle class="hover-dot" r="5" style="fill:${hiColour};stroke:var(--card)" stroke-width="2" visibility="hidden"/>`
    + `<rect class="hover-area" x="${pad.left}" y="${pad.top}" width="${w - pad.left - pad.right}" height="${h - pad.top - pad.bottom}" fill="transparent"/>`
    + '</svg>';
}

// Chart figures waiting for wireCharts, by id (the HTML is built before it is on the page).
const pending = new Map();
let nextId = 1;

/**
 * kind:   'income' or 'pot' (how values are written in the readout)
 * title:  accessible name for the chart
 * startAge: your age in year 1; when given, the horizontal axis shows ages
 * startYear: calendar year the highlighted retirement began, for the readout
 */
export function lineChart(spec) {
  const m = chartModel(spec);
  const id = nextId++;
  pending.set(id, m);
  // The readout box: beside the crosshair on wide screens; above the chart, in the page, on phones.
  return `<div class="chart-wrap" data-chart-id="${id}">`
    + `<div class="chart-tip" hidden aria-live="polite"></div>`
    + drawSvg(m, geometry(m, null))
    + '</div>';
}

/** Adds the readout (pointer, touch and arrow keys) and the phone redraw to every chart under root. */
export function wireCharts(root) {
  for (const wrap of root.querySelectorAll('.chart-wrap[data-chart-id]')) {
    const m = pending.get(Number(wrap.dataset.chartId));
    if (!m) continue;
    pending.delete(Number(wrap.dataset.chartId));
    const tip = wrap.querySelector('.chart-tip');
    const fmt = m.kind === 'pot' ? (v) => bigMoney(v, 2) : money;
    let g = geometry(m, null);
    let drawnAt = null;
    let current = null;
    // Rows in the readout, so the phone box can keep its height whether a year is shown or not.
    const rowCount = 4 + (m.hi ? 1 : 0) + m.refs.length;
    const svg = () => wrap.querySelector('svg');
    const xAt = (i) => g.PAD.left + (m.n <= 1 ? 0 : (i / (m.n - 1)) * (g.W - g.PAD.left - g.PAD.right));
    const yAt = (v) => g.PAD.top + (1 - Math.max(0, v) / g.top) * (g.H - g.PAD.top - g.PAD.bottom);

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

    // The readout's rows for year i. Phones show the last year until another is chosen, so the
    // box is never empty and the chart does not move on the first tap.
    function fill(i, idleNote = '') {
      tip.replaceChildren();
      const head = document.createElement('div');
      head.className = 'tip-head';
      const age = m.startAge ? `Age ${m.startAge + i}` : `Year ${i + 1}`;
      head.textContent = m.startYear ? `${age} \u00b7 ${m.startYear + i}` : age;
      if (idleNote) {
        const note = document.createElement('span');
        note.className = 'tip-note';
        note.textContent = idleNote;
        head.append(note);
      }
      tip.append(head);
      if (m.hi) tip.append(row(fmt(m.hi.values[i]), m.hi.label, 'lead'));
      tip.append(row(fmt(m.median[i]), 'Typical'));
      tip.append(row(`${fmt(m.p25[i])} to ${fmt(m.p75[i])}`, 'Middle half'));
      tip.append(row(`${fmt(m.min[i])} to ${fmt(m.max[i])}`, 'Full range'));
      for (const r of m.refs) tip.append(row(fmt(r.values[i]), r.label));
      tip.hidden = false;
    }

    function idle() {
      if (g.phone) fill(m.n - 1, ', the end. Tap or drag for others');
      else { tip.replaceChildren(); tip.hidden = true; }
    }

    function showAt(i) {
      current = Math.max(0, Math.min(m.n - 1, i));
      const s = svg();
      const line = s.querySelector('.hover-line');
      const dot = s.querySelector('.hover-dot');
      const px = xAt(current);
      line.setAttribute('x1', px); line.setAttribute('x2', px); line.setAttribute('visibility', 'visible');
      if (m.hi) {
        dot.setAttribute('cx', px); dot.setAttribute('cy', yAt(m.hi.values[current])); dot.setAttribute('visibility', 'visible');
      }
      fill(current);
      if (g.phone) { tip.style.left = ''; tip.style.right = ''; return; }
      // Wide screens: place the readout beside the crosshair, flipping sides past the middle.
      const box = s.getBoundingClientRect();
      const wrapBox = wrap.getBoundingClientRect();
      const left = box.left - wrapBox.left + (px / g.W) * box.width;
      const right = left > wrapBox.width / 2;
      tip.style.left = right ? '' : `${left + 12}px`;
      tip.style.right = right ? `${wrapBox.width - left + 12}px` : '';
    }

    function hide() {
      current = null;
      const s = svg();
      s.querySelector('.hover-line').setAttribute('visibility', 'hidden');
      s.querySelector('.hover-dot').setAttribute('visibility', 'hidden');
      idle();
    }

    function draw() {
      const w = wrap.clientWidth;
      if (!w) return;
      const phone = w < PHONE_WIDTH;
      const key = phone ? `p${Math.round(w)}` : 'wide';
      if (key === drawnAt) return;
      drawnAt = key;
      const focused = wrap.contains(document.activeElement);
      g = geometry(m, phone ? w : null);
      wrap.classList.toggle('is-phone', phone);
      wrap.style.setProperty('--tip-rows', rowCount);
      svg().outerHTML = drawSvg(m, g);
      if (focused) svg().focus({ preventScroll: true });
      if (current !== null) showAt(current); else idle();
    }

    const indexAt = (clientX) => {
      const box = svg().getBoundingClientRect();
      const vx = ((clientX - box.left) / box.width) * g.W;
      if (vx < g.PAD.left - 10 || vx > g.W - g.PAD.right + 10) return null;
      return Math.round(((vx - g.PAD.left) / (g.W - g.PAD.left - g.PAD.right)) * (m.n - 1));
    };
    const onSvg = (e) => e.target instanceof Element && e.target.closest('svg') && wrap.contains(e.target);
    // Touch: a tap or a sideways drag reads a year; an up or down drag still scrolls the page
    // (touch-action: pan-y in style.css). The year stays shown until you tap somewhere else.
    wrap.addEventListener('pointerdown', (e) => {
      if (!onSvg(e)) return;
      const i = indexAt(e.clientX);
      if (i !== null) showAt(i);
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!onSvg(e)) return;
      if (e.pointerType === 'touch' && e.buttons === 0) return;
      const i = indexAt(e.clientX);
      if (i === null) { if (e.pointerType !== 'touch') hide(); return; }
      showAt(i);
    });
    wrap.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hide(); });
    const outside = (e) => {
      if (!wrap.isConnected) { document.removeEventListener('pointerdown', outside); return; }
      if (current !== null && !wrap.contains(e.target)) hide();
    };
    document.addEventListener('pointerdown', outside);
    wrap.addEventListener('focusin', (e) => { if (e.target.closest('svg')) showAt(current ?? 0); });
    wrap.addEventListener('focusout', (e) => { if (e.target.closest('svg') && !g.phone) hide(); });
    wrap.addEventListener('keydown', (e) => {
      if (!e.target.closest('svg')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        showAt((current ?? 0) + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key === 'Home') { e.preventDefault(); showAt(0); }
      else if (e.key === 'End') { e.preventDefault(); showAt(m.n - 1); }
      else if (e.key === 'Escape') hide();
    });

    draw();
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => { if (wrap.isConnected) draw(); else ro.disconnect(); });
      ro.observe(wrap);
    }
  }
}
