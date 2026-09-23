// Macro Atlas dashboard. Data blobs are injected at build time (atlas/build.py).
const DB = __DATA__;
const EVENTS = __EVENTS__;   // [{month, title, cat, day?, url?}]
const PRES = __PRES__;       // [[from, to (exclusive), name, party]]
const BANDS = __BANDS__;     // {fed_chair|treasury|house|senate|shutdowns: {source, rows: [[from, to, label, style]]}}
const BUILT = __BUILT__;

const { addM, fmtM, fmtN } = Stats;
const CATS = ["US markets","Global markets","Commodities & energy","Currencies","Rates & money","US economy","Housing","Europe","Asia & other","Politics & sentiment"];
const EVCAT = { political:"Political", financial:"Financial", geopolitical:"Geopolitical", health:"Health & disaster", policy:"Economic policy" };
const COLORS = ["#1F5FBF","#D1495B","#E09F3E","#2E8B57","#7B4FB8","#0FA3B1","#B5651D","#5C6B7A"];
const MODES = ['rebase','z','raw','log','yoy','dd'];
const MAX_SEL = 8;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const meta = k => DB.meta[k];

// ---------- month axis & alignment ----------
const FIRST = DB.first_month || "2000-01";
const lastM = DB.last_month;
const MONTHS = []; for (let m = FIRST; m <= lastM; m = addM(m, 1)) MONTHS.push(m);
const MI = Object.fromEntries(MONTHS.map((m, i) => [m, i]));
const ALIGNED = {}, PLOT = {};

// Observed values on the master axis (null = unobserved). Snapshot and correlations use this.
function series(k) {
  if (ALIGNED[k]) return ALIGNED[k];
  const a = new Array(MONTHS.length).fill(null), s = DB.series[k];
  for (let i = 0; i < s.d.length; i++) { const j = MI[s.d[i]]; if (j !== undefined) a[j] = s.v[i]; }
  return (ALIGNED[k] = a);
}
const isSparse = k => DB.series[k].d.length < MONTHS.length * 0.5;
const lastIdx = k => { const d = DB.series[k].d; return MI[d[d.length - 1]] ?? MONTHS.length - 1; };
const sparseFreq = k => meta(k).freq === 'E' ? 'E' : (meta(k).freq === 'A' || DB.series[k].d.length < 40) ? 'A' : 'Q';
const BAND_SETS = { pres: PRES.map(p => [p[0], p[1], p[2], p[3]]), ...Object.fromEntries(Object.entries(BANDS).map(([k, b]) => [k, b.rows])) };
const BAND_STYLE = { D: '--dem', R: '--rep', a: '--band-a', b: '--band-b', s: '--shut' };
// Plot-only step fill for sparse series.
const plotFill = (k, a) => isSparse(k) ? Stats.fillSparse(a, lastIdx(k), sparseFreq(k)) : a;
function plotRaw(k) { return PLOT[k] || (PLOT[k] = plotFill(k, series(k))); }
const REC = DB.series.usrec ? series("usrec") : [];

// ---------- state ----------
const DEFAULT = { sel: ["spx","unrate","wti","cpi_yoy"], mode: "z", from: MONTHS[0], to: lastM };
const S = { sel: [], mode: "z", i0: 0, i1: MONTHS.length - 1, evcats: new Set(Object.keys(EVCAT)), hi: null,
            basis: "chg", sx: null, sy: null, lag: 0, theme: null, cmp: null, roll: 36 };

function stateToParams() {
  const p = new URLSearchParams();
  p.set('sel', S.sel.join(',')); p.set('mode', S.mode); p.set('from', MONTHS[S.i0]); p.set('to', MONTHS[S.i1]);
  if (S.basis !== 'chg') p.set('basis', S.basis);
  if (S.lag) p.set('lag', S.lag);
  if (S.sx && S.sy) { p.set('sx', S.sx); p.set('sy', S.sy); }
  if (S.evcats.size !== Object.keys(EVCAT).length) p.set('ev', [...S.evcats].join(','));
  if (S.hi != null) p.set('hi', S.hi);
  ['shRec','shEv'].forEach(id => { const el = $(id); if (el.checked !== el.defaultChecked) p.set(id, el.checked ? 1 : 0); });
  if ($('bands').value !== 'none') p.set('bands', $('bands').value);
  if (S.cmp != null) p.set('cmp', MONTHS[S.cmp]);
  if (S.roll !== 36) p.set('roll', S.roll);
  if ($('shExt').checked) p.set('ext', 1);
  return p;
}
function applyParams(p) {
  if (!p || !p.has('sel')) return false;
  S.sel = p.get('sel').split(',').filter(k => DB.series[k]).slice(0, MAX_SEL);
  S.mode = MODES.includes(p.get('mode')) ? p.get('mode') : 'z';
  S.i0 = MI[p.get('from')] ?? 0; S.i1 = MI[p.get('to')] ?? MONTHS.length - 1;
  if (S.i1 - S.i0 < 6) { S.i0 = 0; S.i1 = MONTHS.length - 1; }
  S.basis = p.get('basis') === 'lvl' ? 'lvl' : 'chg';
  S.lag = Math.max(-24, Math.min(24, parseInt(p.get('lag') || '0', 10) || 0));
  S.sx = p.get('sx'); S.sy = p.get('sy');
  if (p.has('ev')) S.evcats = new Set(p.get('ev').split(',').filter(c => EVCAT[c]));
  const hi = p.get('hi'); S.hi = hi != null && EVENTS[+hi] ? +hi : null;
  ['shRec','shEv'].forEach(id => { if (p.has(id)) $(id).checked = p.get(id) === '1'; });
  $('bands').value = BAND_SETS[p.get('bands')] ? p.get('bands') : p.get('shPres') === '1' ? 'pres' : 'none';  // shPres: v1 links
  S.cmp = MI[p.get('cmp')] ?? null;
  S.roll = p.get('roll') === '24' ? 24 : 36;
  $('shExt').checked = p.get('ext') === '1';
  return true;
}
function saveState() {
  const qs = stateToParams().toString();
  try { history.replaceState(null, '', '#' + qs); } catch (e) { /* file:// in some browsers */ }
  try { localStorage.setItem('atlas-state', qs); } catch (e) {}
}
function loadState() {
  const h = location.hash.replace(/^#/, '');
  if (h && applyParams(new URLSearchParams(h))) return;
  let saved = null; try { saved = localStorage.getItem('atlas-state'); } catch (e) {}
  if (saved && applyParams(new URLSearchParams(saved))) return;
  applyParams(new URLSearchParams({ sel: DEFAULT.sel.join(','), mode: DEFAULT.mode, from: DEFAULT.from, to: DEFAULT.to }));
}

// ---------- toast ----------
let toastT = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600);
}

// ---------- presets ----------
const PRESETS = [
  ["COVID shock", ["spx","unrate","wti","umcsent","m2"], "rebase", "2019-06", "2022-06"],
  ["Financial crisis 2008", ["spx","caseshiller","unrate","fedfunds","vix"], "rebase", "2006-01", "2012-12"],
  ["Inflation surge 2021–24", ["cpi_yoy","fedfunds","gas","wages_yoy","umcsent"], "raw", "2020-01", lastM],
  ["Oil, gas & the pump", ["wti","brent","gas","natgas"], "raw", "2000-01", lastM],
  ["Housing", ["caseshiller","mortgage","houst","medhome"], "rebase", "2000-01", lastM],
  ["US vs Europe jobs", ["unrate","ez_unemp","de_unemp","uk_unemp","jp_unemp"], "raw", "2000-01", lastM],
  ["World stock markets", ["spx","dax","nikkei","shanghai","sensex","ftse"], "rebase", "2000-01", lastM],
  ["Politics & sentiment", ["approval","umcsent","usepu","spx"], "z", "2000-01", lastM],
  ["Rates & yield curve", ["fedfunds","gs2","gs10","t10y2y","mortgage"], "raw", "2000-01", lastM],
  ["2026 oil shock", ["wti","gas","cpi_yoy","spx","vix"], "z", "2025-06", lastM],
  ["2008 vs 2020", ["spx","unrate","wti"], "rebase", "2007-10", "2010-10", "2020-01"],
];
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
PRESETS.forEach(p => {
  const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = p[0];
  b.onclick = () => {
    S.sel = p[1].filter(k => DB.series[k]); S.mode = p[2];
    S.i0 = MI[p[3]] ?? 0; S.i1 = MI[p[4]] ?? MONTHS.length - 1; S.hi = null; S.cmp = p[5] ? MI[p[5]] ?? null : null;
    renderAll();
    const top = $('mainCard').getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo({ top, behavior: reduceMotion() ? 'auto' : 'smooth' });
  };
  $('presets').appendChild(b);
});

// ---------- picker ----------
function toggleSel(k, on) {
  if (on) {
    if (S.sel.includes(k)) return true;
    if (S.sel.length >= MAX_SEL) { toast(`Up to ${MAX_SEL} series at once keeps the chart readable — remove one first.`); return false; }
    S.sel.push(k);
  } else S.sel = S.sel.filter(x => x !== k);
  renderAll(); return true;
}
function buildPicker() {
  const g = $('groups'); g.innerHTML = '';
  const staleBefore = addM(lastM, -18);
  CATS.forEach((cat, ci) => {
    const keys = Object.keys(DB.meta).filter(k => DB.meta[k].cat === cat && DB.series[k]);
    if (!keys.length) return;
    const d = document.createElement('details'); d.className = 'grp'; d.open = ci === 0;
    d.innerHTML = `<summary>${esc(cat)}<span class="n">${keys.length}</span></summary>`;
    keys.forEach(k => {
      const m = DB.meta[k], end = DB.series[k].d[DB.series[k].d.length - 1];
      const l = document.createElement('label'); l.className = 'opt'; l.dataset.k = k;
      l.dataset.t = (m.name + " " + cat + " " + k + " " + m.src).toLowerCase();
      const u = end < staleBefore ? 'to ' + end.slice(0, 4) : m.unit;
      l.title = `${m.name} — ${m.src}${m.note ? ' · ' + m.note : ''} · ${fmtM(DB.series[k].d[0])} – ${fmtM(end)}`;
      l.innerHTML = `<input type="checkbox"><span class="nm">${esc(m.name)}</span><span class="u${end < staleBefore ? ' old' : ''}">${esc(u)}</span>`;
      l.querySelector('input').onchange = e => { if (!toggleSel(k, e.target.checked)) e.target.checked = false; };
      d.appendChild(l);
    });
    g.appendChild(d);
  });
}
function syncChecks() {
  document.querySelectorAll('.opt').forEach(l => { l.querySelector('input').checked = S.sel.includes(l.dataset.k); });
  $('selCount').textContent = `${S.sel.length} / ${MAX_SEL} selected`;
  $('openRail').textContent = `Choose series (${S.sel.length})`;
}
$('search').oninput = e => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.opt').forEach(l => l.classList.toggle('hid', !!q && !l.dataset.t.includes(q)));
  document.querySelectorAll('details.grp').forEach((d, i) => {
    const any = d.querySelector('.opt:not(.hid)');
    d.classList.toggle('hid', !!q && !any);
    if (q) d.open = !!any; else d.open = i === 0;
  });
};
$('clearBtn').onclick = () => { S.sel = []; renderAll(); };
const openRail = o => {
  $('rail').classList.toggle('open', o); $('backdrop').classList.toggle('on', o); document.body.classList.toggle('sheet-open', o);
  $('openRail').setAttribute('aria-expanded', o);
  if (o) setTimeout(() => $('search').focus({ preventScroll: true }), 50); else $('openRail').focus({ preventScroll: true });
};
$('openRail').onclick = () => openRail(true);
$('closeRail').onclick = () => openRail(false);
$('backdrop').onclick = () => openRail(false);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('rail').classList.contains('open')) openRail(false); });

// ---------- controls ----------
MONTHS.forEach(m => ['from','to'].forEach(id => { const o = document.createElement('option'); o.value = m; o.textContent = fmtM(m); $(id).appendChild(o); }));
$('from').onchange = e => { S.i0 = MI[e.target.value]; if (S.i0 > S.i1 - 6) { S.i1 = Math.min(MONTHS.length - 1, S.i0 + 6); S.i0 = Math.min(S.i0, S.i1 - 6); } renderAll(); };
$('to').onchange = e => { S.i1 = MI[e.target.value]; if (S.i1 < S.i0 + 6) { S.i0 = Math.max(0, S.i1 - 6); S.i1 = Math.max(S.i1, S.i0 + 6); } renderAll(); };
$('mode').onchange = e => { S.mode = e.target.value; renderMain(); renderSnap(); saveState(); };
['shRec','shEv','bands','shExt'].forEach(id => $(id).onchange = () => { mainChart && mainChart.update('none'); saveState(); });
MONTHS.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = fmtM(m); $('cmp').appendChild(o); });
$('cmp').onchange = e => { S.cmp = e.target.value ? MI[e.target.value] : null; renderMain(); saveState(); };
$('roll').onchange = e => { S.roll = +e.target.value; renderScatter(); saveState(); };
$('basis').onchange = e => { S.basis = e.target.value; renderMatrix(); renderScatter(); saveState(); };
$('lag').oninput = e => { S.lag = +e.target.value; renderScatter(); saveState(); };
$('sx').onchange = e => { S.sx = e.target.value; renderMatrix(); renderScatter(); saveState(); };
$('sy').onchange = e => { S.sy = e.target.value; renderMatrix(); renderScatter(); saveState(); };

// ---------- theme ----------
function applyTheme(t) {
  const r = document.documentElement;
  if (t) r.dataset.theme = t; else delete r.dataset.theme;
  const dark = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
  $('themeBtn').setAttribute('aria-pressed', dark);
  $('themeBtn').textContent = dark ? 'Light theme' : 'Dark theme';
}
$('themeBtn').onclick = () => {
  const r = document.documentElement;
  const dark = r.dataset.theme === 'dark' || (!r.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  S.theme = dark ? 'light' : 'dark'; applyTheme(S.theme);
  try { localStorage.setItem('atlas-theme', S.theme); } catch (e) {}
  renderAll();
};
try { S.theme = localStorage.getItem('atlas-theme'); } catch (e) {}
applyTheme(S.theme);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (!S.theme) { applyTheme(null); renderAll(); } });

// ---------- CSV ----------
function csvText() {
  const rows = [["month", ...S.sel.map(k => meta(k).name)]];
  for (let i = S.i0; i <= S.i1; i++) rows.push([MONTHS[i], ...S.sel.map(k => { const v = series(k)[i]; return v == null ? '' : v; })]);
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
function downloadCsv() {
  if (!S.sel.length) { toast('Select a series first.'); return; }
  const url = URL.createObjectURL(new Blob([csvText()], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `macro-atlas_${MONTHS[S.i0]}_${MONTHS[S.i1]}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('csvBtn').onclick = async () => {
  if (!S.sel.length) { toast('Select a series first.'); return; }
  const b = $('csvBtn');
  try {
    if (!navigator.clipboard) throw new Error('no clipboard');
    await navigator.clipboard.writeText(csvText());
    b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy CSV', 1500);
  } catch (e) { downloadCsv(); toast('Clipboard blocked — downloaded the CSV instead.'); }
};
$('dlBtn').onclick = downloadCsv;
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// PNG of the main chart on an opaque card background (canvas is transparent by default).
function chartPng() {
  const src = $('main'), c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const x = c.getContext('2d'); x.fillStyle = css('--card'); x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0);
  return c.toDataURL('image/png');
}
$('pngBtn').onclick = () => {
  if (!S.sel.length) { toast('Select a series first.'); return; }
  const a = document.createElement('a'); a.href = chartPng(); a.download = `macro-atlas_${S.mode}_${MONTHS[S.i0]}_${MONTHS[S.i1]}.png`;
  document.body.appendChild(a); a.click(); a.remove();
};
function allCsv() {
  const keys = Object.keys(DB.series);
  const q = c => `"${String(c).replace(/"/g, '""')}"`;
  const rows = [['month', ...keys].map(q).join(','), ['name', ...keys.map(k => meta(k).name)].map(q).join(','),
                ['unit', ...keys.map(k => meta(k).unit)].map(q).join(','), ['source', ...keys.map(k => meta(k).src)].map(q).join(',')];
  MONTHS.forEach((m, i) => rows.push([m, ...keys.map(k => series(k)[i] ?? '')].join(',')));
  return rows.join('\n');
}
$('allBtn').onclick = () => saveBlob(new Blob([allCsv()], { type: 'text/csv;charset=utf-8' }), `macro-atlas_all_${lastM}.csv`);
$('linkBtn').onclick = async () => {
  saveState();
  const url = location.href;
  try { await navigator.clipboard.writeText(url); toast('Link to this view copied.'); }
  catch (e) { prompt('Copy this link:', url); }
};

// ---------- event category chips ----------
Object.entries(EVCAT).forEach(([c, n]) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.c = c;
  b.innerHTML = `<i style="background:var(--e-${c})"></i>${n}`;
  b.onclick = () => {
    if (S.evcats.has(c)) S.evcats.delete(c); else S.evcats.add(c);
    syncEvChips(); renderEvents(); mainChart && mainChart.update('none'); saveState();
  };
  $('evCats').appendChild(b);
});
function syncEvChips() {
  $('evCats').querySelectorAll('.chip').forEach(b => { const on = S.evcats.has(b.dataset.c); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
}

// ---------- transforms ----------
function transform(k, i0 = S.i0, i1 = S.i1) {
  // Election results hold until the next election, so every mode uses the held values for them.
  const a = S.mode === 'raw' || S.mode === 'log' || (isSparse(k) && sparseFreq(k) === 'E') ? plotRaw(k) : series(k);
  let out;
  if (S.mode === 'rebase') out = Stats.rebase(a, i0, i1);
  else if (S.mode === 'z') out = Stats.zscore(a, i0, i1);
  else if (S.mode === 'yoy') out = Stats.yoy(a, i0, i1);
  else if (S.mode === 'dd') out = Stats.drawdown(a, i0, i1);
  else out = Stats.window(a, i0, i1);
  if (S.mode === 'log') out = out.map(v => v != null && v > 0 ? v : null);
  if (S.mode !== 'raw' && S.mode !== 'log' && isSparse(k)) {
    // step-fill transformed values inside the range, same stop rule as the raw fill
    out = Stats.fillSparse(out, Math.min(lastIdx(k), i1), sparseFreq(k));
    for (let i = i1 + 1; i < out.length; i++) out[i] = null;
  }
  return out;
}
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const visibleEvents = () => EVENTS.map((e, n) => [e, n, MI[e.month]]).filter(([e, , i]) => i != null && i >= S.i0 && i <= S.i1 && S.evcats.has(e.cat));

// ---------- background plugin: presidential terms → recessions → events ----------
const bgPlugin = { id: 'bg',
  beforeDatasetsDraw(c) {
    const { ctx, chartArea: ca, scales: { x } } = c; if (!ca || !S.sel.length || S.cmp != null) return;
    ctx.save();
    const xs = i => x.getPixelForValue(i - S.i0);
    const half = (xs(S.i0 + 1) - xs(S.i0)) / 2 || 0;
    const left = i => Math.max(ca.left, xs(i) - half), right = i => Math.min(ca.right, xs(i) + half);
    (BAND_SETS[$('bands').value] || []).forEach(p => {
      const a = Math.max(MI[p[0]] ?? (p[0] < MONTHS[0] ? 0 : MONTHS.length), S.i0), b = Math.min((MI[p[1]] ?? MONTHS.length) - 1, S.i1); if (b < a) return;
      const x0 = left(a), x1 = right(b);
      ctx.fillStyle = css(BAND_STYLE[p[3]] || '--band-a'); ctx.fillRect(x0, ca.top, x1 - x0, ca.bottom - ca.top);
      if (x1 - x0 >= 44) { ctx.fillStyle = css('--ink2'); ctx.font = '500 11px "IBM Plex Sans",system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.fillText(p[2], x0 + 4, ca.top + 12); }
    });
    if ($('shRec').checked) {
      ctx.fillStyle = css('--rec'); let s = null;
      for (let i = S.i0; i <= S.i1 + 1; i++) {
        const r = i <= S.i1 && REC[i] === 1;
        if (r && s == null) s = i;
        if (!r && s != null) { ctx.fillRect(left(s), ca.top, right(i - 1) - left(s), ca.bottom - ca.top); s = null; }
      }
    }
    if ($('shEv').checked) {
      const wideSpan = (S.i1 - S.i0) > 132;
      let hiDraw = null;
      visibleEvents().forEach(([e, n, i]) => {
        if (S.hi === n) { hiDraw = [e, i]; return; }
        ctx.strokeStyle = css('--e-' + e.cat);
        ctx.globalAlpha = wideSpan ? .9 : .45; ctx.lineWidth = wideSpan ? 2 : 1; ctx.setLineDash(wideSpan ? [] : [3, 4]);
        ctx.beginPath(); ctx.moveTo(xs(i), wideSpan ? ca.bottom - 10 : ca.top); ctx.lineTo(xs(i), ca.bottom); ctx.stroke();
      });
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (hiDraw) {
        const [e, i] = hiDraw, col = css('--e-' + e.cat);
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xs(i), ca.top); ctx.lineTo(xs(i), ca.bottom); ctx.stroke();
        ctx.font = '500 12px "IBM Plex Sans",system-ui,sans-serif';
        const w = ctx.measureText(e.title).width + 12; let px = xs(i) + 6; if (px + w > ca.right) px = xs(i) - w - 6; px = Math.max(ca.left, px);
        ctx.fillStyle = css('--card'); ctx.fillRect(px, ca.top + 4, w, 20);
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(px, ca.top + 4, w, 20);
        ctx.fillStyle = css('--ink'); ctx.textAlign = 'left'; ctx.fillText(e.title, px + 6, ca.top + 18);
      }
    }
    ctx.restore();
  } };

// ---------- max/min annotations (SPEC 10.7) ----------
const extPlugin = { id: 'ext',
  afterDatasetsDraw(c) {
    if (!$('shExt').checked || !S.sel.length) return;
    const { ctx, chartArea: ca } = c; ctx.save();
    ctx.font = '500 11px "IBM Plex Sans",system-ui,sans-serif';
    c.data.datasets.forEach((d, n) => {
      if (d._b || c.getDatasetMeta(n).hidden) return;  // compare-range copies aren't annotated
      let lo = null, hi = null;
      d.data.forEach((v, i) => { if (v == null) return; if (lo == null || v < d.data[lo]) lo = i; if (hi == null || v > d.data[hi]) hi = i; });
      [[hi, 'max', -8], [lo, 'min', 14]].forEach(([i, tag, dy]) => {
        if (i == null) return;
        const pt = c.getDatasetMeta(n).data[i]; if (!pt) return;
        const k = d._k, idx = (d._i0 ?? S.i0) + i, raw = plotRaw(k)[idx];
        const txt = `${tag} ${fmtN(raw)} · ${fmtM(MONTHS[idx])}`;
        ctx.fillStyle = d.borderColor; ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.5, 0, 2 * Math.PI); ctx.fill();
        const w = ctx.measureText(txt).width; let tx = pt.x + 6; if (tx + w > ca.right) tx = pt.x - w - 6;
        const ty = Math.min(ca.bottom - 4, Math.max(ca.top + 10, pt.y + dy));
        ctx.fillStyle = css('--card'); ctx.globalAlpha = .85; ctx.fillRect(tx - 2, ty - 10, w + 4, 13); ctx.globalAlpha = 1;
        ctx.fillStyle = d.borderColor; ctx.textAlign = 'left'; ctx.fillText(txt, tx, ty);
      });
    });
    ctx.restore();
  } };

// ---------- main chart ----------
let mainChart = null;
const yTitle = () => S.mode === 'rebase' ? 'Index (range start = 100)' : S.mode === 'z' ? 'Standard deviations' : S.mode === 'yoy' ? '% change y/y' : S.mode === 'dd' ? '% below running peak' : (S.sel[0] ? meta(S.sel[0]).unit : '');
function tickLabel(labels) {
  if (S.cmp != null) return (v, i) => { const span = labels.length - 1, st = span <= 36 ? 6 : span <= 120 ? 12 : 24; return i % st === 0 ? `+${i}m` : null; };
  return (v, i) => {
    const m = labels[i]; if (!m) return null;
    const span = S.i1 - S.i0;
    if (span <= 30) return i % 3 === 0 ? fmtM(m) : null;
    if (span <= 72) return m.endsWith('-01') || m.endsWith('-07') ? fmtM(m) : null;
    const yr = +m.slice(0, 4), step = span <= 150 ? 1 : span <= 240 ? 2 : 3;
    return m.endsWith('-01') && yr % step === 0 ? String(yr) : null;
  };
}
function renderMain() {
  $('mode').value = S.mode; $('from').value = MONTHS[S.i0]; $('to').value = MONTHS[S.i1];
  $('cmp').value = S.cmp != null ? MONTHS[S.cmp] : '';
  const span = S.i1 - S.i0, cmp = S.cmp;
  const c1 = cmp != null ? Math.min(MONTHS.length - 1, cmp + span) : null;
  const labels = cmp != null ? Array.from({ length: span + 1 }, (_, i) => String(i)) : MONTHS.slice(S.i0, S.i1 + 1);
  $('emptyMsg').hidden = !!S.sel.length;
  const ink = css('--ink'), ink2 = css('--ink2'), line = css('--line2');
  const u0 = S.sel[0] ? meta(S.sel[0]).unit : null, dual = S.mode === 'raw' || S.mode === 'log';
  const others = dual ? S.sel.filter(k => meta(k).unit !== u0) : [];
  const mk = (k, n, data, extra) => ({ label: meta(k).name, data, borderColor: COLORS[n], backgroundColor: COLORS[n], _k: k,
    borderWidth: 1.8, pointRadius: 0, pointHoverRadius: 4, tension: isSparse(k) ? 0 : .15, stepped: isSparse(k) ? 'before' : false, spanGaps: true,
    yAxisID: dual && meta(k).unit !== u0 ? 'y2' : 'y', ...extra });
  const ds = [];
  S.sel.forEach((k, n) => {
    ds.push(mk(k, n, transform(k).slice(S.i0, S.i1 + 1), { _i0: S.i0 }));
    if (cmp != null) {
      const b = transform(k, cmp, c1).slice(cmp, c1 + 1);
      while (b.length < span + 1) b.push(null);
      ds.push(mk(k, n, b, { label: meta(k).name + ' (' + fmtM(MONTHS[cmp]) + ')', borderDash: [5, 4], borderWidth: 1.6, _b: true, _i0: cmp }));
    }
  });
  const scales = {
    x: { grid: { color: line }, ticks: { color: ink2, maxRotation: 0, autoSkip: false, callback: tickLabel(labels) } },
    y: { type: S.mode === 'log' ? 'logarithmic' : 'linear', grid: { color: line }, ticks: { color: ink2 },
         title: { display: true, color: ink2, text: yTitle() } } };
  if (others.length) scales.y2 = { type: S.mode === 'log' ? 'logarithmic' : 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: ink2 },
    title: { display: true, color: ink2, text: new Set(others.map(k => meta(k).unit)).size === 1 ? meta(others[0]).unit : 'other series (mixed units)' } };
  if (cmp != null) scales.x.title = { display: true, color: ink2, text: `Months from start: ${fmtM(MONTHS[S.i0])} (solid) vs ${fmtM(MONTHS[cmp])} (dashed)` };
  if (S.mode === 'z' || S.mode === 'yoy' || S.mode === 'dd') scales.y.grid.color = c => c.tick && c.tick.value === 0 ? ink : line;
  const sfx = S.mode === 'rebase' ? '' : S.mode === 'z' ? ' σ' : S.mode === 'yoy' ? '% y/y' : S.mode === 'dd' ? '% from peak' : '';
  const opts = { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false },
      tooltip: { backgroundColor: css('--card'), titleColor: ink, bodyColor: ink, footerColor: ink2, borderColor: css('--line'), borderWidth: 1,
        callbacks: {
          title: it => !it.length ? '' : cmp != null ? `+${it[0].dataIndex} months: ${fmtM(MONTHS[S.i0 + it[0].dataIndex])} vs ${MONTHS[cmp + it[0].dataIndex] ? fmtM(MONTHS[cmp + it[0].dataIndex]) : '–'}` : fmtM(labels[it[0].dataIndex]),
          label: it => {
            const d = it.dataset, k = d._k, idx = d._i0 + it.dataIndex, raw = plotRaw(k)[idx], v = it.parsed.y;
            const obs = series(k)[idx] != null;
            return ` ${d.label}: ${fmtN(raw)} ${meta(k).unit}${obs || raw == null ? '' : ' (last obs)'}${!dual && v != null ? '  (' + fmtN(v) + sfx + ')' : ''}`;
          },
          footer: it => {
            if (!it.length || cmp != null) return '';
            const m = labels[it[0].dataIndex];
            return EVENTS.filter(e => e.month === m && S.evcats.has(e.cat)).map(e => '▸ ' + e.title);
          } } } },
    scales };
  if (mainChart) { mainChart.data.labels = labels; mainChart.data.datasets = ds; mainChart.options = opts; mainChart.update('none'); }
  else mainChart = new Chart($('main'), { type: 'line', data: { labels, datasets: ds }, options: opts, plugins: [bgPlugin, extPlugin] });
  $('legend').innerHTML = S.sel.map((k, n) => `<span class="it"><i style="background:${COLORS[n]}"></i><b>${esc(meta(k).name)}</b><span class="lu">${esc(meta(k).unit)}${dual && others.includes(k) ? ' · right axis' : ''}</span><button type="button" aria-label="Remove ${esc(meta(k).name)}" data-k="${k}">×</button></span>`).join('');
  $('legend').querySelectorAll('button').forEach(b => b.onclick = () => { S.sel = S.sel.filter(x => x !== b.dataset.k); renderAll(); });
}

// ---------- events list ----------
function renderEvents() {
  syncEvChips();
  const list = $('evList'); list.innerHTML = '';
  visibleEvents().forEach(([e, n]) => {
    const d = document.createElement('div'); d.className = 'ev' + (S.hi === n ? ' on' : ''); d.tabIndex = 0; d.setAttribute('role', 'button');
    d.setAttribute('aria-pressed', S.hi === n);
    const date = (e.day ? e.day + ' ' : '') + fmtM(e.month);
    d.innerHTML = `<span class="d">${date}</span><i style="background:var(--e-${e.cat})" aria-hidden="true"></i><span class="t">${esc(e.title)}${/^https?:\/\//.test(e.url || '') ? ` <a href="${esc(e.url)}" target="_blank" rel="noopener" title="Source">source ↗</a>` : ''}</span>`;
    const act = () => { S.hi = S.hi === n ? null : n; renderEvents(); mainChart && mainChart.update('none'); saveState(); };
    d.onclick = ev => { if (ev.target.tagName !== 'A') act(); };
    d.onkeydown = ev => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === d) { ev.preventDefault(); act(); } };
    list.appendChild(d);
  });
  if (!list.children.length) list.innerHTML = '<div class="sub">No events in this range for the selected categories.</div>';
}

// ---------- correlation ----------
function basisArr(k) { const a = series(k); return S.basis === 'lvl' ? a : Stats.changes(a); }
const pear = (x, y, lag) => Stats.pearson(x, y, S.i0, S.i1, lag);
function rColor(r) {
  if (r == null) return 'transparent';
  const t = Math.min(1, Math.abs(r)), c = r > 0 ? [31, 95, 191] : [209, 73, 91];
  return `rgba(${c[0]},${c[1]},${c[2]},${(0.08 + 0.82 * t).toFixed(2)})`;
}
function short(k) { const n = meta(k).name; return n.length > 16 ? n.slice(0, 15) + '…' : n; }
function renderMatrix() {
  $('basis').value = S.basis;
  const m = $('matrix');
  if (S.sel.length < 2) { m.innerHTML = '<div class="sub">Select at least two series.</div>'; return; }
  const B = S.sel.map(basisArr);
  let h = '<table><thead><tr><th></th>' + S.sel.map(k => `<th scope="col" title="${esc(meta(k).name)}">${esc(short(k))}</th>`).join('') + '</tr></thead><tbody>';
  S.sel.forEach((ka, a) => {
    h += `<tr><th scope="row" class="row" title="${esc(meta(ka).name)}">${esc(short(ka))}</th>`;
    S.sel.forEach((kb, b) => {
      const { r, n } = pear(B[a], B[b], 0), p = a === b ? null : Stats.pValue(r, n);
      const sel = S.sx === ka && S.sy === kb, sig = p != null && p < 0.05;
      const lbl = r == null ? `${meta(ka).name} vs ${meta(kb).name}: not enough overlapping months (n=${n})` : `${meta(ka).name} vs ${meta(kb).name}: r=${r.toFixed(2)}, n=${n}${p != null ? ', p' + (sig ? '<0.05' : '≥0.05') : ''}`;
      h += `<td><button type="button" class="cell${sel ? ' sel' : ''}" data-a="${ka}" data-b="${kb}" title="${esc(lbl)}" aria-label="${esc(lbl)}" style="background:${rColor(r)};color:${r != null && Math.abs(r) > .5 ? '#fff' : 'var(--ink)'}">${r == null ? '·' : r.toFixed(2)}${sig ? '<sup>*</sup>' : ''}</button></td>`;
    });
    h += '</tr>';
  });
  m.innerHTML = h + '</tbody></table><div class="note">* p &lt; 0.05 (t-test, normal approximation; serial correlation makes this optimistic). · = fewer than 8 overlapping months.</div>';
  m.querySelectorAll('button.cell').forEach(d => d.onclick = () => {
    if (d.dataset.a === d.dataset.b) return;
    S.sx = d.dataset.a; S.sy = d.dataset.b; renderMatrix(); renderScatter(); saveState();
  });
}

// ---------- scatter + lag profile ----------
let scChart = null, lagChart = null, rollChart = null;
function renderScatter() {
  ['sx','sy'].forEach(id => { $(id).innerHTML = S.sel.map(k => `<option value="${k}">${esc(meta(k).name)}</option>`).join(''); });
  $('lag').value = S.lag; $('lagV').textContent = (S.lag > 0 ? '+' : '') + S.lag;
  if (S.sel.length < 2) {
    $('scatterSub').textContent = 'Select at least two series.'; $('rline').textContent = '';
    if (scChart) { scChart.destroy(); scChart = null; } if (lagChart) { lagChart.destroy(); lagChart = null; } if (rollChart) { rollChart.destroy(); rollChart = null; }
    return;
  }
  if (!S.sel.includes(S.sx)) S.sx = S.sel[0];
  if (!S.sel.includes(S.sy) || S.sy === S.sx) S.sy = S.sel.find(k => k !== S.sx);
  $('sx').value = S.sx; $('sy').value = S.sy;
  const bx = basisArr(S.sx), by = basisArr(S.sy);
  const { r, n, px, py } = pear(bx, by, S.lag);
  const basisTxt = S.basis === 'chg' ? 'monthly % changes' : 'levels';
  $('scatterSub').textContent = `${meta(S.sx).name} vs ${meta(S.sy).name}, ${basisTxt}, ${fmtM(MONTHS[S.i0])} – ${fmtM(MONTHS[S.i1])}`;
  const p = Stats.pValue(r, n);
  $('rline').innerHTML = r == null ? `Not enough overlapping months (${n}).`
    : `r = <b>${r.toFixed(3)}</b> &nbsp; r² = ${(r * r).toFixed(3)} &nbsp; n = ${n} months${S.lag ? ` &nbsp; lag ${S.lag > 0 ? '+' : ''}${S.lag} (X ${S.lag > 0 ? 'leads' : 'lags'} Y)` : ''}${p != null && p < 0.05 ? ' &nbsp; p &lt; 0.05' : ''}`;
  const pts = r == null ? [] : px.map((x, i) => ({ x, y: py[i] }));
  const ink2 = css('--ink2'), line = css('--line2'), acc = css('--accent');
  const unitSfx = S.basis === 'chg' ? ' (% m/m)' : '';
  const data = { datasets: [{ data: pts, backgroundColor: acc + '73', pointRadius: 3 }] };
  const opts = { responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: it => `(${fmtN(it.parsed.x)}, ${fmtN(it.parsed.y)})` } } },
    scales: { x: { title: { display: true, text: short(S.sx) + unitSfx, color: ink2 }, grid: { color: line }, ticks: { color: ink2 } },
              y: { title: { display: true, text: short(S.sy) + unitSfx, color: ink2 }, grid: { color: line }, ticks: { color: ink2 } } } };
  if (scChart) { scChart.data = data; scChart.options = opts; scChart.update('none'); }
  else scChart = new Chart($('scatter'), { type: 'scatter', data, options: opts });

  // lag profile: r at every lag −24..24
  const lags = [], rs = [];
  for (let L = -24; L <= 24; L++) { lags.push(L); rs.push(pear(bx, by, L).r); }
  let best = null; rs.forEach((v, i) => { if (v != null && (best == null || Math.abs(v) > Math.abs(rs[best]))) best = i; });
  $('lagPeak').textContent = best == null ? '' : `Strongest |r| at lag ${lags[best] > 0 ? '+' : ''}${lags[best]}: r = ${rs[best].toFixed(2)}`;
  const lagData = { labels: lags, datasets: [{ data: rs, borderWidth: 0,
    backgroundColor: rs.map((v, i) => lags[i] === S.lag ? css('--ink') : v == null ? 'transparent' : v >= 0 ? 'rgba(31,95,191,.6)' : 'rgba(209,73,91,.6)') }] };
  const lagOpts = { responsive: true, maintainAspectRatio: false, animation: false,
    onClick: (e, els) => { if (els.length) { S.lag = lags[els[0].index]; renderScatter(); saveState(); } },
    plugins: { legend: { display: false }, tooltip: { callbacks: { title: it => `lag ${lags[it[0].dataIndex]}`, label: it => it.parsed.y == null ? 'n < 8' : `r = ${it.parsed.y.toFixed(3)}` } } },
    scales: { x: { grid: { display: false }, ticks: { color: ink2, maxRotation: 0, autoSkip: false, callback: (v, i) => lags[i] % 6 === 0 ? lags[i] : null } },
              y: { min: -1, max: 1, grid: { color: c => c.tick && c.tick.value === 0 ? ink2 : line }, ticks: { color: ink2, stepSize: .5 } } } };
  if (lagChart) { lagChart.data = lagData; lagChart.options = lagOpts; lagChart.update('none'); }
  else lagChart = new Chart($('lagChart'), { type: 'bar', data: lagData, options: lagOpts });

  // rolling correlation of the pair (lag 0) over a trailing window
  $('roll').value = S.roll;
  const rc = Stats.rollingCorr(bx, by, S.i0, S.i1, S.roll).slice(S.i0, S.i1 + 1);
  const rLabels = MONTHS.slice(S.i0, S.i1 + 1);
  $('rollNote').textContent = rc.some(v => v != null) ? '' : `Needs ≥ ${S.roll} months with ≥ 8 overlapping observations.`;
  const rollData = { labels: rLabels, datasets: [{ data: rc, borderColor: acc, borderWidth: 1.6, pointRadius: 0, spanGaps: false, tension: .1 }] };
  const rollOpts = { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false }, tooltip: { callbacks: { title: it => fmtM(rLabels[it[0].dataIndex]), label: it => `r = ${it.parsed.y.toFixed(2)} (${S.roll} m)` } } },
    scales: { x: { grid: { display: false }, ticks: { color: ink2, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, callback: (v, i) => rLabels[i].slice(0, 4) } },
              y: { min: -1, max: 1, grid: { color: c => c.tick && c.tick.value === 0 ? ink2 : line }, ticks: { color: ink2, stepSize: .5 } } } };
  if (rollChart) { rollChart.data = rollData; rollChart.options = rollOpts; rollChart.update('none'); }
  else rollChart = new Chart($('rollChart'), { type: 'line', data: rollData, options: rollOpts });
}

// ---------- snapshot table ----------
function renderSnap() {
  const t = $('snap'); if (!S.sel.length) { t.innerHTML = ''; return; }
  let h = `<thead><tr><th>Series</th><th>Unit</th><th class="num">${fmtM(MONTHS[S.i0])}</th><th class="num">Latest in range</th><th class="num">Change</th><th class="num">Range low</th><th class="num">Range high</th><th>Source</th></tr></thead><tbody>`;
  S.sel.forEach(k => {
    const a = series(k), m = meta(k);
    let first = null, last = null, lastMo = null, lo = Infinity, hi = -Infinity, loM, hiM;
    for (let i = S.i0; i <= S.i1; i++) {
      const v = a[i]; if (v == null) continue;
      if (first == null) first = v; last = v; lastMo = MONTHS[i];
      if (v < lo) { lo = v; loM = MONTHS[i]; } if (v > hi) { hi = v; hiM = MONTHS[i]; }
    }
    const isPct = /%|pp/.test(m.unit);
    const pct = first != null && first !== 0 ? (last / first - 1) * 100 : null;
    const dv = first == null ? null : isPct ? last - first : pct;
    const chg = dv == null ? '–' : isPct ? `${dv >= 0 ? '+' : ''}${dv.toFixed(2)} pts` : `${dv >= 0 ? '+' : ''}${dv.toFixed(1)}%`;
    const sign = dv == null ? '' : dv >= 0 ? 'pos' : 'neg';
    const dm = x => x ? `<span class="dim">${fmtM(x)}</span>` : '';
    h += `<tr><td>${esc(m.name)}</td><td class="dim">${esc(m.unit)}</td><td class="num">${fmtN(first)}</td><td class="num">${fmtN(last)} ${dm(lastMo)}</td><td class="num ${sign}">${chg}</td><td class="num">${first == null ? '–' : fmtN(lo) + ' ' + dm(loM)}</td><td class="num">${first == null ? '–' : fmtN(hi) + ' ' + dm(hiM)}</td><td class="dim">${esc(m.src)}${m.note ? ' · ' + esc(m.note) : ''} · last obs ${fmtM(m.last_obs || DB.series[k].d.at(-1))}</td></tr>`;
  });
  t.innerHTML = h + '</tbody>';
}

function renderAll() { syncChecks(); renderMain(); renderEvents(); renderMatrix(); renderScatter(); renderSnap(); saveState(); }

// ---------- init ----------
buildPicker();
$('subtitle').textContent = `${Object.keys(DB.series).length} monthly series and ${EVENTS.length} events, ${fmtM(MONTHS[0])} – ${fmtM(lastM)}. Overlay, rebase, and correlate economic, market, and political data against what happened.`;
$('built').textContent = BUILT;
$('sources').textContent = 'Sources: Federal Reserve Economic Data (FRED, St. Louis Fed) for economic, rates, housing, currency, European and Asian series; Yahoo Finance for equity indices, futures, bitcoin and the dollar index; Baker-Bloom-Davis for policy uncertainty; NBER recession dates via FRED USREC.';
loadState();
window.addEventListener('hashchange', () => { if (applyParams(new URLSearchParams(location.hash.slice(1)))) renderAll(); });
renderAll();
