// Two small SVG builders: a many-line chart (one line per past retirement) and nothing else.
// Returns SVG markup strings; colours are fixed here so the page CSS stays simple.

const W = 760;
const H = 300;
const PAD = { left: 64, right: 16, top: 16, bottom: 40 };

function niceStep(range, ticks) {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

const shortMoney = (v) => {
  if (Math.abs(v) >= 1e6) return `£${+(v / 1e6).toFixed(1)}m`;
  if (Math.abs(v) >= 1e3) return `£${Math.round(v / 1e3)}k`;
  return `£${Math.round(v)}`;
};

/**
 * lines: [{ values: number[], highlight?: boolean, label: string }]
 * refs:  [{ values: number[], colour, dash }]  reference lines (wanted, minimum)
 * title: accessible name for the chart
 */
export function lineChart({ lines, refs = [], title }) {
  const n = Math.max(...lines.map((l) => l.values.length));
  const all = [...lines.flatMap((l) => l.values), ...refs.flatMap((r) => r.values)].filter(Number.isFinite);
  const maxV = Math.max(1, ...all);
  const step = niceStep(maxV, 5);
  const top = Math.ceil(maxV / step) * step;
  const x = (i) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.left - PAD.right));
  const y = (v) => PAD.top + (1 - Math.max(0, v) / top) * (H - PAD.top - PAD.bottom);
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');

  const grid = [];
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid.push(`<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e5ea"/>`
      + `<text x="${PAD.left - 8}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="#4b5563">${shortMoney(v)}</text>`);
  }
  const xticks = [];
  const every = n > 30 ? 10 : 5;
  for (let i = 0; i < n; i += 1) {
    const year = i + 1;
    if (year === 1 || year % every === 0) {
      xticks.push(`<text x="${x(i)}" y="${H - PAD.bottom + 18}" text-anchor="middle" font-size="12" fill="#4b5563">${year}</text>`);
    }
  }
  const quiet = lines.filter((l) => !l.highlight)
    .map((l) => `<path d="${path(l.values)}" fill="none" stroke="#9fb7c0" stroke-width="1.2" opacity="0.7"><title>${l.label}</title></path>`);
  const loud = lines.filter((l) => l.highlight)
    .map((l) => `<path d="${path(l.values)}" fill="none" stroke="#0b5f7a" stroke-width="3"><title>${l.label}</title></path>`);
  const refLines = refs.map((r) => `<path d="${path(r.values)}" fill="none" stroke="${r.colour}" stroke-width="2" ${r.dash ? `stroke-dasharray="${r.dash}"` : ''}/>`);

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">`
    + grid.join('') + xticks.join('')
    + `<text x="${(PAD.left + W - PAD.right) / 2}" y="${H - 6}" text-anchor="middle" font-size="12" fill="#4b5563">Year of retirement</text>`
    + quiet.join('') + refLines.join('') + loud.join('')
    + '</svg>';
}
