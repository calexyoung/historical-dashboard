/**
 * The one drawing a Reading has on a Claim's page (PLAN section 3: "one figure showing both"):
 * the locked *then* and *now when checked* figures, side by side, on one value axis.
 *
 * It is drawn from the lock's own numbers and from nothing else, so it can never disagree with
 * the table beside it. Only figures that are values of the Series are drawn (a value, the two
 * ends of a change, an extreme, the two Periods of a difference); a change, a rank or a count
 * is a number in the table. *Then* is hollow with a dashed line, *now when checked* filled with
 * a solid one: shape and line, never colour (DESIGN.md), both in ink. Nothing here moves.
 *
 * Laid out 256 units wide so its 12px text is only ever scaled up, like the Explorer's small
 * drawings. Pure.
 */
import { periodBounds, type Frequency } from "@macro-atlas/core";
import type { EvidenceFigure } from "@macro-atlas/core/release";
import { scaleLinear } from "d3-scale";
import { h, r2, type SvgNode } from "./figure/svg";
import { fixed, periodWords, readingDecimals } from "./figure/words";

const DRAWN: ReadonlySet<string> = new Set(["value", "start", "end", "extreme", "a", "b"]);
const W = 256;
const H = 132;
const LEFT = 44;
const RIGHT = 10;
const TOP = 10;
const BOTTOM = 26;
const DODGE = 9;

type Point = { period: string; start: string; value: number };

function points(figures: EvidenceFigure[] | null, freq: Frequency): Point[] {
  const out: Point[] = [];
  for (const figure of figures ?? []) {
    if (!DRAWN.has(figure.name) || typeof figure.value !== "number" || !figure.period) continue;
    const start = periodBounds(freq, figure.period)?.start;
    if (start) out.push({ period: figure.period, start, value: figure.value });
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function claimDrawing(input: { freq: Frequency; unit: string; then: EvidenceFigure[] | null; now: EvidenceFigure[] | null }): SvgNode | null {
  const then = points(input.then, input.freq);
  const now = points(input.now, input.freq);
  const all = [...then, ...now];
  if (all.length === 0) return null;
  const periods = [...new Map(all.map((p) => [p.period, p.start])).entries()].sort((a, b) => (a[1] < b[1] ? -1 : 1));
  const lo = Math.min(...all.map((p) => p.value));
  const hi = Math.max(...all.map((p) => p.value));
  const pad = hi === lo ? Math.max(Math.abs(hi) * 0.02, 0.5) : (hi - lo) * 0.25;
  const y = scaleLinear().domain([lo - pad, hi + pad]).range([H - BOTTOM, TOP]).nice(3);
  const ticks = y.ticks(3);
  const decimals = Math.max(0, ...ticks.map(readingDecimals));
  const slot = (W - LEFT - RIGHT) / periods.length;
  const x = (period: string): number => LEFT + slot * (periods.findIndex(([p]) => p === period) + 0.5);
  const label = (period: string, start: string) => periodWords(input.freq, { period, period_start: start }, "short");
  const path = (run: Point[], dx: number) => run.map((p, i) => `${i === 0 ? "M" : "L"}${r2(x(p.period) + dx)},${r2(y(p.value))}`).join("");
  const said = (name: string, run: Point[]) => (run.length === 0 ? `${name}: no figure` : `${name}: ${run.map((p) => `${fixed(p.value, readingDecimals(p.value))} in ${label(p.period, p.start)}`).join(", ")}`);

  return h(
    "svg",
    { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${said("Then", then)}. ${said("Now when checked", now)}. ${input.unit}.`, "data-claim-drawing": "", fill: "none" },
    ...ticks.map((t) => h("line", { x1: LEFT, x2: W - RIGHT, y1: r2(y(t)), y2: r2(y(t)), stroke: "var(--color-line)", "stroke-width": 1 })),
    ...ticks.map((t) => h("text", { x: LEFT - 6, y: r2(y(t) + 4), "text-anchor": "end", "font-size": 12, fill: "var(--color-ink-2)" }, fixed(t, decimals))),
    ...periods.map(([period, start]) => h("text", { x: r2(x(period)), y: H - 8, "text-anchor": "middle", "font-size": 12, fill: "var(--color-ink-2)" }, label(period, start))),
    then.length > 1 && h("path", { d: path(then, -DODGE), stroke: "currentColor", "stroke-width": 1.5, "stroke-dasharray": "4 3", "data-run": "then" }),
    now.length > 1 && h("path", { d: path(now, DODGE), stroke: "currentColor", "stroke-width": 1.75, "data-run": "now" }),
    ...then.map((p) => h("circle", { cx: r2(x(p.period) - DODGE), cy: r2(y(p.value)), r: 4, fill: "var(--color-panel)", stroke: "currentColor", "stroke-width": 1.5, "data-point": "then" })),
    ...now.map((p) => h("circle", { cx: r2(x(p.period) + DODGE), cy: r2(y(p.value)), r: 4, fill: "currentColor", "data-point": "now" })),
  );
}
