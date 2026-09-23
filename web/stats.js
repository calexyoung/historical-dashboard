// Pure math helpers shared by the dashboard and tests (node: `require('./web/stats.js')`).
// Arrays are aligned to the master month axis; missing months are null.
const Stats = (() => {
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function addM(ym, n) {
    let [y, m] = ym.split('-').map(Number);
    m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  const fmtM = m => MON[+m.slice(5, 7) - 1] + " " + m.slice(0, 4);

  // Sparse (quarterly/annual) series: forward-fill for plotting only, stopping 2 months (Q)
  // or 11 months (A) after the last observation so we never invent a future. Election results
  // (E) hold until the next election, i.e. to the end of the axis.
  function fillSparse(a, lastIdx, freq) {
    const stop = freq === 'E' ? Infinity : lastIdx + (freq === 'A' ? 11 : 2);
    const out = a.slice(); let last = null;
    for (let i = 0; i < out.length; i++) {
      if (out[i] != null) last = out[i];
      else if (last != null && i <= stop) out[i] = last;
    }
    return out;
  }

  // Transforms over the visible range [i0, i1]; values outside the range are null.
  function rebase(a, i0, i1) {
    const out = new Array(a.length).fill(null); let base = null;
    for (let i = i0; i <= i1; i++) if (a[i] != null) { base = a[i]; break; }
    if (base == null || base === 0) return out;
    for (let i = i0; i <= i1; i++) if (a[i] != null) out[i] = a[i] / base * 100;
    return out;
  }
  function zscore(a, i0, i1) {
    const out = new Array(a.length).fill(null); const v = [];
    for (let i = i0; i <= i1; i++) if (a[i] != null) v.push(a[i]);
    if (!v.length) return out;
    const mu = v.reduce((s, x) => s + x, 0) / v.length;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / v.length); // population sd
    if (!sd) return out;
    for (let i = i0; i <= i1; i++) if (a[i] != null) out[i] = (a[i] - mu) / sd;
    return out;
  }
  function yoy(a, i0, i1) {
    const out = new Array(a.length).fill(null);
    for (let i = Math.max(i0, 12); i <= i1; i++)
      if (a[i] != null && a[i - 12] != null && a[i - 12] !== 0) out[i] = (a[i] / a[i - 12] - 1) * 100;
    return out;
  }
  // % below the running peak within the range (0 at new highs).
  function drawdown(a, i0, i1) {
    const out = new Array(a.length).fill(null); let peak = null;
    for (let i = i0; i <= i1; i++) {
      if (a[i] == null) continue;
      if (peak == null || a[i] > peak) peak = a[i];
      out[i] = peak > 0 ? (a[i] / peak - 1) * 100 : null;
    }
    return out;
  }
  // Rolling Pearson r over a trailing window of `w` months ending at each i in [i0, i1].
  function rollingCorr(x, y, i0, i1, w, minN = 8) {
    const out = new Array(x.length).fill(null);
    for (let i = Math.max(i0, i0 + w - 1); i <= i1; i++) out[i] = pearson(x, y, i - w + 1, i, 0).r;
    return out;
  }
  function window_(a, i0, i1) {
    const out = new Array(a.length).fill(null);
    for (let i = i0; i <= i1; i++) out[i] = a[i];
    return out;
  }

  // Monthly % change on observed values only: both x[t] and x[t-1] must be observed, so gaps
  // (and never-filled quarterly/annual data) produce no change rather than runs of zeros.
  function changes(a) {
    const o = new Array(a.length).fill(null);
    for (let i = 1; i < a.length; i++)
      if (a[i] != null && a[i - 1] != null && a[i - 1] !== 0) o[i] = (a[i] / a[i - 1] - 1) * 100;
    return o;
  }

  // Pearson r over months i in [i0, i1] pairing x[i] with y[i + lag] (positive lag = X leads Y).
  function pearson(x, y, i0, i1, lag = 0) {
    const px = [], py = [];
    for (let i = i0; i <= i1; i++) {
      const j = i + lag; if (j < i0 || j > i1) continue;
      if (x[i] != null && y[j] != null) { px.push(x[i]); py.push(y[j]); }
    }
    const n = px.length;
    if (n < 8) return { r: null, n, px, py };
    const mx = px.reduce((s, v) => s + v, 0) / n, my = py.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = px[i] - mx, dy = py[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return { r: sxx && syy ? Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))) : null, n, px, py };
  }

  // Standard normal CDF (Abramowitz & Stegun 7.1.26 on erf).
  function normCdf(z) {
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
    return z >= 0 ? (1 + e) / 2 : (1 - e) / 2;
  }
  // Two-sided p for r with n pairs: t = r·√((n−2)/(1−r²)), normal approximation.
  function pValue(r, n) {
    if (r == null || n < 3) return null;
    if (Math.abs(r) >= 1) return 0;
    const t = r * Math.sqrt((n - 2) / (1 - r * r));
    return 2 * (1 - normCdf(Math.abs(t)));
  }

  function fmtN(v) {
    if (v == null || !isFinite(v)) return '–';
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + 'M';
    const d = a >= 1e4 ? 0 : a >= 100 ? 1 : 2;
    return v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
  }

  return { addM, fmtM, fillSparse, rebase, zscore, yoy, drawdown, rollingCorr, window: window_, changes, pearson, normCdf, pValue, fmtN };
})();
if (typeof module !== 'undefined') module.exports = Stats;
