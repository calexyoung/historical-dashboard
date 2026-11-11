/**
 * The three small drawings of the Explorer's Relationships panel (PLAN M5): a scatter of the
 * chosen pair, r at every lag, and r over a rolling window. Pure geometry, as data (svg.ts).
 *
 * One layout, 256 units wide: the width a 320px phone leaves, so the 12px text is only ever
 * scaled up. Colour says nothing here: every mark is ink, the sign of r is its side of the zero
 * line, and the lag in hand is the one mark in the accent (the reader's own choice, like a pin).
 * Each drawing has a table beside it on the page; nothing animates.
 */
import { scaleLinear } from "d3-scale";
import { h, r2, type SvgNode } from "./svg";

const W = 256;
const H = 190;
const FONT = 12;
const CHAR = 7;
const INK = "var(--color-ink)";
const INK_2 = "var(--color-ink-2)";
const LINE = "var(--color-line)";
const LINE_STRONG = "var(--color-line-strong)";
const ACCENT = "var(--color-accent)";

const text = (content: string, attrs: Record<string, string | number>) => h("text", { "font-size": FONT, fill: INK_2, ...attrs }, content);

/** Ticks and their labels for a run of values: as many decimals as the step between ticks needs. */
function axisFor(values: number[], count: number): { domain: [number, number]; ticks: number[]; format: (v: number) => string } {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1];
  if (lo === hi) [lo, hi] = [lo - (Math.abs(lo) * 0.1 || 1), hi + (Math.abs(hi) * 0.1 || 1)];
  const scale = scaleLinear().domain([lo, hi]).nice(count);
  const ticks = scale.ticks(count);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
  const size = Math.max(...ticks.map(Math.abs));
  const f = size >= 1e5 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }) : new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return { domain: scale.domain() as [number, number], ticks, format: (v) => f.format(v).replace(/^-/, "−") };
}

function frame(label: string, kind: string, left: number, ...children: (SvgNode | null | false | undefined)[]): SvgNode {
  return h("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": label, "data-drawing": kind, "data-left": left, preserveAspectRatio: "xMinYMin meet" }, ...children);
}

/** Cut a name to what a drawing 256 wide can hold beside its axis. */
const fit = (name: string, room: number): string => (name.length * CHAR <= room ? name : `${name.slice(0, Math.max(1, Math.floor(room / CHAR) - 1)).trimEnd()}…`);

export type ScatterSpec = { points: { x: number; y: number }[]; xLabel: string; yLabel: string; label: string };

/** One dot per pair of Periods: X across, Y up. Each axis has its own scale; neither starts at zero. */
export function scatterDrawing(spec: ScatterSpec): SvgNode {
  const xs = axisFor(spec.points.map((p) => p.x), 4);
  const ys = axisFor(spec.points.map((p) => p.y), 4);
  const left = Math.max(34, Math.max(...ys.ticks.map((t) => ys.format(t).length)) * CHAR + 10);
  const [x0, x1, yTop, yBottom] = [left, W - 10, 22, H - 40];
  const x = scaleLinear().domain(xs.domain).range([x0 + 4, x1 - 4]);
  const y = scaleLinear().domain(ys.domain).range([yBottom - 4, yTop + 4]);
  const grid: SvgNode[] = [];
  for (const t of ys.ticks) {
    grid.push(h("line", { x1: x0, y1: r2(y(t)), x2: x1, y2: r2(y(t)), stroke: t === 0 ? LINE_STRONG : LINE, "stroke-width": 1 }));
    grid.push(text(ys.format(t), { x: left - 6, y: r2(y(t) + 4), "text-anchor": "end" }));
  }
  let lastRight = -Infinity;
  for (const t of xs.ticks) {
    const label = xs.format(t);
    const tx = x(t);
    grid.push(h("line", { x1: r2(tx), y1: yTop, x2: r2(tx), y2: yBottom, stroke: t === 0 ? LINE_STRONG : LINE, "stroke-width": 1 }));
    if (tx - (label.length * CHAR) / 2 - lastRight < 6) continue;
    grid.push(text(label, { x: r2(tx), y: yBottom + 14, "text-anchor": "middle" }));
    lastRight = tx + (label.length * CHAR) / 2;
  }
  const dots = spec.points.map((p) => `M${r2(x(p.x) - 2.25)} ${r2(y(p.y))}a2.25 2.25 0 1 0 4.5 0a2.25 2.25 0 1 0 -4.5 0Z`).join("");
  return frame(
    spec.label,
    "scatter",
    left,
    h("g", { "data-axis": "grid" }, ...grid),
    h("rect", { x: x0, y: yTop, width: x1 - x0, height: yBottom - yTop, fill: "none", stroke: LINE_STRONG, "stroke-width": 1 }),
    spec.points.length > 0 && h("path", { "data-points": spec.points.length, d: dots, fill: INK, "fill-opacity": 0.55 }),
    text(`↑ ${fit(spec.yLabel, W - 20)}`, { x: 2, y: 12, fill: INK }),
    text(`${fit(spec.xLabel, W - left - 24)} →`, { x: x1, y: H - 6, "text-anchor": "end", fill: INK }),
  );
}

/** r from −1 to 1 on the vertical axis, shared by the two drawings below. */
function rAxis(x0: number, x1: number, y: (r: number) => number): SvgNode[] {
  const out: SvgNode[] = [];
  for (const t of [-1, -0.5, 0, 0.5, 1]) {
    out.push(h("line", { x1: x0, y1: r2(y(t)), x2: x1, y2: r2(y(t)), stroke: t === 0 ? LINE_STRONG : LINE, "stroke-width": 1 }));
    out.push(text(t === 0 ? "0" : t.toFixed(1).replace("-", "−"), { x: x0 - 6, y: r2(y(t) + 4), "text-anchor": "end" }));
  }
  return out;
}

export type LagSpec = { profile: { lag: number; r: number | null }[]; current: number; label: string };

/** One bar per lag, up for a positive r and down for a negative one. The lag in hand is in the accent. */
export function lagDrawing(spec: LagSpec): SvgNode {
  const [x0, x1, yTop, yBottom] = [34, W - 8, 10, H - 30];
  const lags = spec.profile.map((p) => p.lag);
  const [lo, hi] = [Math.min(...lags), Math.max(...lags)];
  const x = scaleLinear().domain([lo - 0.5, hi + 0.5]).range([x0, x1]);
  const y = scaleLinear().domain([-1, 1]).range([yBottom, yTop]);
  const width = Math.max(1.5, (x1 - x0) / (hi - lo + 1) - 1);
  const bar = (p: { lag: number; r: number | null }): string => {
    if (p.r === null) return "";
    const [a, b] = [y(Math.max(0, p.r)), y(Math.min(0, p.r))];
    return `M${r2(x(p.lag) - width / 2)} ${r2(a)}h${r2(width)}v${r2(Math.max(1, b - a))}h${r2(-width)}Z`;
  };
  const others = spec.profile.filter((p) => p.lag !== spec.current).map(bar).join("");
  const chosen = spec.profile.find((p) => p.lag === spec.current);
  const ticks: SvgNode[] = [];
  for (let lag = Math.ceil(lo / 12) * 12; lag <= hi; lag += 12) {
    ticks.push(h("line", { x1: r2(x(lag)), y1: yBottom, x2: r2(x(lag)), y2: yBottom + 4, stroke: LINE_STRONG, "stroke-width": 1 }));
    const label = lag > 0 ? `+${lag}` : String(lag).replace("-", "−");
    const edge = x(lag) + (label.length * CHAR) / 2 > W - 2;
    ticks.push(text(label, { x: edge ? W - 2 : r2(x(lag)), y: H - 12, "text-anchor": edge ? "end" : "middle" }));
  }
  return frame(
    spec.label,
    "lag-profile",
    x0,
    h("g", { "data-axis": "r" }, ...rAxis(x0, x1, y)),
    ...ticks,
    others !== "" && h("path", { "data-bars": spec.profile.filter((p) => p.r !== null && p.lag !== spec.current).length, d: others, fill: INK_2 }),
    chosen && h("line", { "data-current-lag": spec.current, x1: r2(x(spec.current)), y1: yTop, x2: r2(x(spec.current)), y2: yBottom, stroke: ACCENT, "stroke-width": 1, "stroke-dasharray": "2 2" }),
    chosen && chosen.r !== null && h("path", { "data-current-bar": spec.current, d: bar(chosen), fill: ACCENT }),
  );
}

export type RollingSpec = { /** One per Period of the window: its first day and r there, null where there is none. */ points: { date: string; r: number | null }[]; label: string };

/** r over the trailing window ending at each Period: a line, broken wherever there is no answer. */
export function rollingDrawing(spec: RollingSpec): SvgNode {
  const [x0, x1, yTop, yBottom] = [34, W - 8, 10, H - 30];
  const ms = (date: string) => Date.parse(`${date}T00:00:00Z`);
  const times = spec.points.map((p) => ms(p.date));
  const [t0, t1] = [Math.min(...times), Math.max(...times)];
  const x = scaleLinear().domain(t0 === t1 ? [t0 - 1, t1 + 1] : [t0, t1]).range([x0 + 2, x1 - 2]);
  const y = scaleLinear().domain([-1, 1]).range([yBottom, yTop]);
  let d = "";
  let pen = false;
  let lonely = "";
  spec.points.forEach((p, i) => {
    if (p.r === null) {
      pen = false;
      return;
    }
    const [px, py] = [r2(x(times[i]!)), r2(y(p.r))];
    d += `${pen ? "L" : "M"}${px} ${py}`;
    const alone = !pen && (i === spec.points.length - 1 || spec.points[i + 1]!.r === null);
    if (alone) lonely += `M${r2(px - 2)} ${py}a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z`;
    pen = true;
  });
  const years = [...new Set(spec.points.map((p) => Number(p.date.slice(0, 4))))];
  const step = Math.max(1, Math.ceil(years.length / 4));
  const ticks: SvgNode[] = [];
  for (const year of years.filter((yr) => yr % step === 0)) {
    const t = Date.UTC(year, 0, 1);
    if (t < t0 || t > t1) continue;
    ticks.push(h("line", { x1: r2(x(t)), y1: yBottom, x2: r2(x(t)), y2: yBottom + 4, stroke: LINE_STRONG, "stroke-width": 1 }));
    ticks.push(text(String(year), { x: r2(x(t)), y: H - 12, "text-anchor": x(t) < x0 + 14 ? "start" : x(t) > x1 - 14 ? "end" : "middle" }));
  }
  return frame(
    spec.label,
    "rolling",
    x0,
    h("g", { "data-axis": "r" }, ...rAxis(x0, x1, y)),
    ...ticks,
    d !== "" && h("path", { "data-line": spec.points.filter((p) => p.r !== null).length, d, fill: "none", stroke: INK, "stroke-width": 1.5, "stroke-linejoin": "round" }),
    lonely !== "" && h("path", { d: lonely, fill: INK }),
  );
}
