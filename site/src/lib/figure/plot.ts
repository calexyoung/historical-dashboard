/**
 * One plot: Series that share a unit, drawn at one layout width. Pure geometry.
 *
 * How a Series is drawn follows from its Catalog entry, never from how dense it looks:
 *   held                              steps: a value stands until the next Observation, and the
 *                                     last one until the Release was made
 *   discrete, monthly or finer        a line, broken wherever a value is missing
 *   discrete, quarterly or slower     points only: the Series holds nothing between them
 * Every Observation sits at the start of its Period. Nothing is filled or interpolated.
 */
import { scaleLinear } from "d3-scale";
import { curveStepAfter, line as d3line } from "d3-shape";
import type { FigureObservation, LayoutName, SeriesStyle, ShownSeries } from "./index";
import { mark, stateOfStatus, type MarkName } from "./states";
import { h, r2, type SvgNode } from "./svg";
import { dayWords, labelStart, periodWords } from "./words";

export const LAYOUT_SIZES: Record<LayoutName, { width: number; height: number }> = {
  // 256px is what a 320px phone leaves a figure inside the page's and the panel's padding.
  narrow: { width: 256, height: 190 },
  medium: { width: 448, height: 250 },
  wide: { width: 768, height: 320 },
};

const FONT = 12;
/** A generous width for one character of 12px system text (tabular figures are about 6.7px). */
const CHAR = 7;
const textWidth = (text: string): number => text.length * CHAR;

const INK = "var(--color-ink)";
const INK_2 = "var(--color-ink-2)";
const LINE = "var(--color-line)";
const LINE_STRONG = "var(--color-line-strong)";

const DAY_MS = 86_400_000;
const ms = (date: string): number => Date.parse(`${date.slice(0, 10)}T00:00:00Z`);

export const drawnAs = (s: Pick<ShownSeries, "freq" | "continuity">): SeriesStyle["drawnAs"] =>
  s.continuity === "held" ? "step" : s.freq === "quarterly" || s.freq === "annual" || s.freq === "irregular" ? "points" : "line";

/**
 * Line style and symbol are the second and third channels beside colour. The order is chosen so
 * that any two palette colours a reader with a colour-vision deficiency could confuse differ in
 * both (palette.test.ts).
 */
const PATTERNS: { dash: string | null; symbol: SeriesStyle["symbol"] }[] = [
  { dash: null, symbol: "circle" },
  { dash: "6 3", symbol: "square" },
  { dash: "1.5 3.5", symbol: "triangle" },
  { dash: "9 3 1.5 3", symbol: "diamond" },
];
const PATTERN_OF_COLOR = [0, 1, 2, 3, 1, 3, 2, 0];
export function styleFor(index: number): Pick<SeriesStyle, "color" | "dash" | "symbol"> {
  const slot = index % 8;
  return { color: slot + 1, ...PATTERNS[PATTERN_OF_COLOR[slot]!]! };
}

/** One symbol as a closed sub-path centred on (x, y). */
function symbolPath(symbol: SeriesStyle["symbol"], x: number, y: number, r: number): string {
  const p = (dx: number, dy: number) => `${r2(x + dx)} ${r2(y + dy)}`;
  switch (symbol) {
    case "circle":
      return `M${p(-r, 0)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0Z`;
    case "square":
      return `M${p(-r * 0.9, -r * 0.9)}h${r2(r * 1.8)}v${r2(r * 1.8)}h${r2(-r * 1.8)}Z`;
    case "triangle":
      return `M${p(0, -r * 1.2)}L${p(r * 1.1, r * 0.85)}L${p(-r * 1.1, r * 0.85)}Z`;
    case "diamond":
      return `M${p(0, -r * 1.25)}L${p(r * 1.25, 0)}L${p(0, r * 1.25)}L${p(-r * 1.25, 0)}Z`;
  }
}

/** Runs of consecutive Observations for which `test` holds, as [first index, last index]. */
function runs(observations: readonly FigureObservation[], test: (o: FigureObservation) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  observations.forEach((o, i) => {
    if (test(o)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, observations.length - 1]);
  return out;
}

export const STATUS_MARKS: readonly MarkName[] = ["preliminary", "revised", "estimate", "projected", "partial"];
export const GAP_MARKS: readonly MarkName[] = ["missing", "suppressed"];
/** Runs of one state. Missing is any Observation with no value that is not marked suppressed. */
export const statusRuns = (observations: readonly FigureObservation[], state: MarkName): [number, number][] =>
  runs(observations, (o) => (state === "missing" ? o.value === null && o.status !== "suppressed" : stateOfStatus(o.status) === state));

function tickDecimals(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

export type YAxis = { domain: [number, number]; ticks: number[]; format: (v: number) => string };

/** One vertical axis for a plot, the same at every width. */
export function yAxis(series: readonly ShownSeries[]): YAxis {
  const values = series.flatMap((s) => s.observations.map((o) => o.value).filter((v): v is number => v !== null));
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (values.length === 0) [lo, hi] = [0, 1];
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    [lo, hi] = [lo - pad, hi + pad];
  }
  const scale = scaleLinear().domain([lo, hi]).nice(5);
  const ticks = scale.ticks(5);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  const [d0, d1] = scale.domain() as [number, number];
  return { domain: [d0, d1], ticks, format: tickFormat(ticks, step) };
}

/**
 * How tick values are written: the shortest of a fixed list of forms in which every tick reads
 * differently from its neighbours. Precision follows the spacing of the ticks, never a fixed
 * number of places, so a narrow range far from zero is not flattened into one repeated label.
 */
function tickFormat(ticks: number[], step: number): (v: number) => string {
  const distinct = (format: (v: number) => string) => new Set(ticks.map(format)).size === ticks.length;
  const size = Math.max(...ticks.map(Math.abs));
  const plain = (decimals: number) => {
    const f = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return (v: number) => f.format(v);
  };
  const compact = (decimals: number) => {
    const f = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: decimals });
    return (v: number) => f.format(v);
  };
  const exponent = (digits: number) => (v: number) => (v === 0 ? "0" : v.toExponential(digits));
  const candidates: ((v: number) => string)[] = [];
  if (size >= 1e6) candidates.push(compact(0), compact(1), compact(2), compact(3));
  const decimals = tickDecimals(step);
  if (decimals <= 6) candidates.push(plain(decimals));
  for (let digits = 0; digits <= 12; digits++) candidates.push(exponent(digits));
  return candidates.find(distinct) ?? plain(Math.min(20, decimals));
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Ticks on the time axis: whole years where the span allows two or more, else months, else the two ends. */
function timeTicks(t0: number, t1: number, room: number): { t: number; label: string }[] {
  const y0 = new Date(t0).getUTCFullYear();
  const y1 = new Date(t1).getUTCFullYear();
  const jan = (year: number) => Date.UTC(year, 0, 1);
  const fit = (labelWidth: number) => Math.max(2, Math.floor(room / (labelWidth + 14)));
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) {
    const ticks: { t: number; label: string }[] = [];
    for (let year = Math.ceil(y0 / step) * step; year <= y1 + 1; year += step) {
      if (jan(year) >= t0 && jan(year) <= t1) ticks.push({ t: jan(year), label: String(year) });
    }
    if (ticks.length <= fit(textWidth("2000"))) {
      if (ticks.length >= 2) return ticks;
      break;
    }
  }
  for (const step of [1, 2, 3, 6]) {
    const ticks: { t: number; label: string }[] = [];
    const start = new Date(t0);
    let index = start.getUTCFullYear() * 12 + start.getUTCMonth();
    index = Math.ceil(index / step) * step;
    for (; ; index += step) {
      const t = Date.UTC(Math.floor(index / 12), index % 12, 1);
      if (t > t1) break;
      if (t >= t0) ticks.push({ t, label: `${MONTH[index % 12]} ${Math.floor(index / 12)}` });
    }
    if (ticks.length >= 2 && ticks.length <= fit(textWidth("Jan 2000"))) return ticks;
  }
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return [
    { t: t0, label: dayWords(iso(t0), "short") },
    { t: t1, label: dayWords(iso(t1), "short") },
  ];
}

export type PlotInput = { series: ShownSeries; style: SeriesStyle; /** Stale in this Release: marked on its last value. */ stale: boolean }[];

export function drawPlot(input: PlotInput, created: string, layout: LayoutName, axis: YAxis, wantEndLabels: boolean): { svg: SvgNode; endLabels: boolean } {
  const { width: W, height: H } = LAYOUT_SIZES[layout];
  const all = input.map((i) => i.series);

  // The time axis runs from the first Period's start to the last one's, or to the day the Release
  // was made where a held value is still standing.
  const starts = all.flatMap((s) => s.observations.map((o) => ms(o.period_start)));
  let t0 = Math.min(...starts);
  let t1 = Math.max(...starts);
  const madeOn = ms(created);
  const standing = (s: ShownSeries) => s.continuity === "held" && s.observations.at(-1)?.value !== null && madeOn > ms(s.observations.at(-1)!.period_start);
  if (all.some(standing)) t1 = Math.max(t1, madeOn);
  if (t1 - t0 < 60 * DAY_MS) [t0, t1] = [t0 - 45 * DAY_MS, t1 + 45 * DAY_MS];

  const yLabels = axis.ticks.map(axis.format);
  const left = Math.max(30, Math.max(...yLabels.map(textWidth)) + 10);
  const top = 12;
  const bottom = 28;

  // End labels (wide layout, two or more Series): only where every name fits beside the plot.
  const names = input.map((i) => i.style.name);
  const labelRoom = Math.max(...names.map(textWidth)) + 30;
  const endLabels = wantEndLabels && input.length > 1 && labelRoom <= W * 0.3;
  const right = endLabels ? labelRoom : 16;

  const x0 = left;
  const x1 = W - right;
  const yTop = top;
  const yBottom = H - bottom;
  // Values keep clear of the plot's edges by the size of a symbol, so none is cut by an axis.
  const INSET = 4;
  const x = (t: number) => x0 + INSET + ((t - t0) / (t1 - t0)) * (x1 - x0 - 2 * INSET);
  const yScale = scaleLinear().domain(axis.domain).range([yBottom, yTop]);
  const y = (v: number) => yScale(v);

  const text = (content: string, attrs: Record<string, string | number>) => h("text", { "font-size": FONT, fill: INK_2, ...attrs }, content);

  // --- axes ---
  const grid: SvgNode[] = [];
  axis.ticks.forEach((tick, i) => {
    const ty = r2(y(tick));
    const zero = tick === 0 && axis.domain[0] < 0;
    grid.push(h("line", { x1: x0, y1: ty, x2: x1, y2: ty, stroke: zero ? LINE_STRONG : LINE, "stroke-width": 1 }));
    grid.push(text(yLabels[i]!, { x: left - 6, y: r2(Math.min(ty + 4, H - 4)), "text-anchor": "end" }));
  });
  grid.push(h("line", { x1: x0, y1: yBottom, x2: x1, y2: yBottom, stroke: LINE_STRONG, "stroke-width": 1 }));

  const timeAxis: SvgNode[] = [];
  let lastRight = -Infinity;
  for (const tick of timeTicks(t0, t1, x1 - x0)) {
    const tx = x(tick.t);
    const w = textWidth(tick.label);
    const anchor = tx - w / 2 < 0 ? "start" : tx + w / 2 > W ? "end" : "middle";
    const labelLeft = anchor === "start" ? tx : anchor === "end" ? tx - w : tx - w / 2;
    timeAxis.push(h("line", { x1: r2(tx), y1: yBottom, x2: r2(tx), y2: yBottom + 4, stroke: LINE_STRONG, "stroke-width": 1 }));
    if (labelLeft - lastRight < 6) continue;
    timeAxis.push(text(tick.label, { x: r2(tx), y: H - 8, "text-anchor": anchor }));
    lastRight = labelLeft + w;
  }

  // --- states that belong to the plot, behind the Series ---
  const stateMarks: SvgNode[] = [];
  const within = (px: number) => px >= x0 - 0.01 && px <= x1 + 0.01;
  for (const { series: s } of input) {
    for (const b of s.breaks ?? []) {
      const at = labelStart(s.freq, b.period);
      if (!at || !within(x(ms(at.period_start)))) continue;
      const bx = r2(x(ms(at.period_start)));
      stateMarks.push(
        h("g", { "data-mark": "break", color: INK_2 }, h("line", { x1: bx, y1: yTop, x2: bx, y2: yBottom, stroke: "currentColor", "stroke-width": 1.5, "stroke-dasharray": "3 2" })),
      );
    }
    for (const state of GAP_MARKS) {
      for (const [a, b] of statusRuns(s.observations, state)) {
        let ax = x(ms(s.observations[a]!.period_start));
        let bx = x(ms(s.observations[b]!.period_start));
        if (bx - ax < 12) [ax, bx] = [Math.max(x0, (ax + bx) / 2 - 6), Math.min(x1, (ax + bx) / 2 + 6)];
        const bar = { x1: r2(ax), y1: yBottom - 3, x2: r2(bx), y2: yBottom - 3, stroke: "currentColor" };
        stateMarks.push(
          h("g", { "data-mark": state, color: INK }, h("line", state === "missing" ? { ...bar, "stroke-width": 2.5, "stroke-dasharray": "2 2" } : { ...bar, "stroke-width": 3 })),
        );
      }
    }
  }

  // --- the Series ---
  const drawn: SvgNode[] = [];
  const overlay: SvgNode[] = [];
  const ends: { name: string; style: SeriesStyle; y: number }[] = [];
  for (const { series: s, style, stale } of input) {
    const colour = `var(--color-series-${style.color})`;
    const obs = s.observations;
    const px = (o: FigureObservation) => x(ms(o.period_start));
    const valued = obs.filter((o): o is FigureObservation & { value: number } => o.value !== null);
    const spacing = (x1 - x0) / Math.max(1, obs.length - 1);
    const common = { "data-series": s.key, stroke: colour };

    if (style.drawnAs === "line") {
      const path = d3line<FigureObservation>()
        .defined((o) => o.value !== null)
        .x(px)
        .y((o) => y(o.value!))
        .digits(2)(obs as FigureObservation[]);
      if (path) drawn.push(h("path", { ...common, "data-drawn": "line", d: path, fill: "none", "stroke-width": 1.75, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": style.dash }));
    } else if (style.drawnAs === "step") {
      // Each run of values, plus the point at which its last value stops standing: the next
      // Observation (a missing one ends the hold) or the day the Release was made.
      const parts: string[] = [];
      for (const [a, b] of runs(obs, (o) => o.value !== null)) {
        const points: [number, number][] = obs.slice(a, b + 1).map((o) => [px(o), y(o.value!)]);
        const until = b + 1 < obs.length ? px(obs[b + 1]!) : madeOn > ms(obs[b]!.period_start) ? x(madeOn) : null;
        if (until !== null) points.push([until, points.at(-1)![1]]);
        const path = d3line().curve(curveStepAfter).digits(2)(points);
        if (path) parts.push(path);
      }
      if (parts.length > 0) drawn.push(h("path", { ...common, "data-drawn": "step", d: parts.join(""), fill: "none", "stroke-width": 1.75, "stroke-linejoin": "round", "stroke-dasharray": style.dash }));
    }

    // A symbol at each value: always for points and steps; on a line where the values are far
    // enough apart to tell them from each other, and wherever a value has no neighbour to join.
    const lonely = (i: number) => obs[i]!.value !== null && (i === 0 || obs[i - 1]!.value === null) && (i === obs.length - 1 || obs[i + 1]!.value === null);
    const symbolAt = style.drawnAs !== "line" || spacing >= 7 ? valued : obs.filter((_, i) => lonely(i)).filter((o): o is FigureObservation & { value: number } => o.value !== null);
    if (symbolAt.length > 0) {
      const r = style.drawnAs === "line" ? 2.25 : Math.min(3, Math.max(1.25, spacing * 0.42));
      const d = symbolAt.map((o) => symbolPath(style.symbol, px(o), y(o.value), r)).join("");
      drawn.push(h("path", { ...common, "data-drawn": "points", "data-count": symbolAt.length, d, fill: colour, "stroke-width": 0.5 }));
    }

    // Status marks: hollow, in ink, around the first and last value of each run.
    for (const state of STATUS_MARKS) {
      for (const [a, b] of statusRuns(obs, state)) {
        for (const i of a === b ? [a] : [a, b]) {
          const o = obs[i]!;
          if (o.value === null) continue;
          overlay.push(h("g", { color: INK }, mark(state, px(o), y(o.value), 11)));
        }
      }
    }
    const last = valued.at(-1);
    if (last && stale) overlay.push(h("g", { color: INK }, mark("stale", px(last), y(last.value), 14)));
    if (last) ends.push({ name: style.name, style, y: y(last.value) });
  }

  // --- names at the ends of the lines ---
  const labels: SvgNode[] = [];
  if (endLabels) {
    const placed = [...ends].sort((a, b) => a.y - b.y).map((e) => ({ ...e, at: Math.max(yTop + 4, Math.min(yBottom - 2, e.y + 4)) }));
    for (let i = 1; i < placed.length; i++) placed[i]!.at = Math.max(placed[i]!.at, placed[i - 1]!.at + FONT + 2);
    const overflow = placed.length > 0 ? placed.at(-1)!.at - (H - 4) : 0;
    if (overflow > 0) for (const p of placed) p.at -= overflow;
    for (const p of placed) {
      const colour = `var(--color-series-${p.style.color})`;
      labels.push(h("line", { x1: x1 + 6, y1: r2(p.at - 4), x2: x1 + 22, y2: r2(p.at - 4), stroke: colour, "stroke-width": 1.75, "stroke-dasharray": p.style.dash }));
      labels.push(h("text", { "data-end-label": p.style.key, x: x1 + 26, y: r2(p.at), "font-size": FONT, fill: INK }, p.name));
    }
  }

  const first = all.flatMap((s) => s.observations.slice(0, 1).map((o) => ({ s, o }))).sort((a, b) => a.o.period_start.localeCompare(b.o.period_start))[0];
  const lastOne = all.flatMap((s) => s.observations.slice(-1).map((o) => ({ s, o }))).sort((a, b) => b.o.period_start.localeCompare(a.o.period_start))[0];
  const span = first && lastOne ? `, ${periodWords(first.s.freq, first.o, "short")} to ${periodWords(lastOne.s.freq, lastOne.o, "short")}` : "";
  const label = `Chart of ${names.join(", ")}${span}. Every value is in the table below.`;

  const svg = h(
    "svg",
    { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": label, "data-layout": layout, preserveAspectRatio: "xMinYMin meet" },
    h("rect", { "data-plot-area": "", x: x0, y: yTop, width: r2(x1 - x0), height: yBottom - yTop, fill: "none" }),
    h("g", { "data-axis": "y" }, ...grid),
    h("g", { "data-axis": "time" }, ...timeAxis),
    ...stateMarks,
    ...drawn,
    ...overlay,
    ...labels,
  );
  return { svg, endLabels };
}

/** A Series' colour, line style and symbol on their own, for a legend entry. Decorative. */
export function swatch(style: Pick<SeriesStyle, "color" | "dash" | "symbol">): SvgNode {
  const colour = `var(--color-series-${style.color})`;
  return h(
    "svg",
    { viewBox: "0 0 32 12", width: 32, height: 12, "aria-hidden": "true", focusable: "false" },
    h("line", { x1: 1, y1: 6, x2: 31, y2: 6, stroke: colour, "stroke-width": 1.75, "stroke-dasharray": style.dash }),
    h("path", { d: symbolPath(style.symbol, 16, 6, 3), fill: colour, stroke: colour, "stroke-width": 0.5 }),
  );
}
