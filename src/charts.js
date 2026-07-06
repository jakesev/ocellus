// charts.js — tiny dependency-free SVG charts for the Progress screen.

function pts(values, w, h, min, max) {
  if (values.length === 1) return `0,${h - ((values[0] - min) / (max - min || 1)) * h} ${w},${h - ((values[0] - min) / (max - min || 1)) * h}`;
  return values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / (max - min || 1)) * h).toFixed(1)}`)
    .join(' ');
}

/**
 * Multi-series line chart. series: [{values:[], color, label}]
 * Returns an SVG string sized w×h (viewBox).
 */
export function lineChart(series, { w = 320, h = 110, pad = 6 } = {}) {
  const all = series.flatMap((s) => s.values).filter((v) => isFinite(v));
  if (!all.length) return `<svg viewBox="0 0 ${w} ${h}"></svg>`;
  let min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  min -= span * 0.12; max += span * 0.12;
  const innerH = h - pad * 2;
  const lines = series
    .filter((s) => s.values.length)
    .map((s) => {
      const p = pts(s.values, w, innerH, min, max);
      const lastY = innerH - ((s.values[s.values.length - 1] - min) / (max - min)) * innerH;
      return `<polyline points="${p}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" transform="translate(0,${pad})" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>` +
        `<circle cx="${w}" cy="${lastY + pad}" r="3.4" fill="${s.color}"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${w + 8} ${h}" preserveAspectRatio="none" style="overflow:visible">${lines}</svg>`;
}
