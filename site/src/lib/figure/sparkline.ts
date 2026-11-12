/**
 * The sparkline (PLAN M22; DESIGN.md): the last ten years of one Series as a small drawing with
 * no axis, to sit beside a sentence that states its latest value. It is the explained figure's
 * drawing with everything but the Series taken away, and it keeps that figure's rules: cadence
 * is visible (a line for monthly or finer, points for quarterly, annual and irregular, steps
 * for a held Series) and nothing is drawn between values the Series does not hold.
 *
 * It says nothing a reader could not get from the row it sits in: its accessible name is the
 * Series and the Periods it runs between, and no value is written into it. Drawn in the
 * current text colour, so it is ink in both themes and never one of the eight series colours
 * (there is no second Series to tell it from). Pure.
 */
import type { ShownSeries } from "./index";
import { drawnAs } from "./plot";
import { h, r2, type SvgNode } from "./svg";
import { periodWords } from "./words";

/** The drawing's own size, in its units; a page may show it larger and never smaller. */
export const SPARK = { width: 120, height: 28 } as const;
const PAD = 3;
/** The span drawn: the same ten years as the longest change of Highlights. */
const YEARS = 10;

const day = (date: string): number => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

export function sparkline(series: Pick<ShownSeries, "key" | "name" | "freq" | "continuity" | "observations">, options: { years?: number } = {}): SvgNode | null {
  const all = series.observations;
  let last = all.length - 1;
  while (last >= 0 && all[last]!.value === null) last--;
  if (last < 0) return null;
  const latest = all[last]!;
  // The same day of the year `years` earlier: the Period Highlights sets the latest beside.
  const years = options.years ?? YEARS;
  const from = `${String(Number(latest.period_start.slice(0, 4)) - years).padStart(4, "0")}${latest.period_start.slice(4)}`;
  let first = 0;
  while (all[first]!.period_start < from) first++;
  const shown = all.slice(first, last + 1);
  const valued = shown.filter((o): o is typeof o & { value: number } => o.value !== null);

  const [t0, t1] = [day(shown[0]!.period_start), day(latest.period_start)];
  let [low, high] = [Infinity, -Infinity];
  for (const o of valued) {
    low = Math.min(low, o.value);
    high = Math.max(high, o.value);
  }
  const x = (date: string): number => (t1 === t0 ? SPARK.width - PAD : r2(PAD + ((day(date) - t0) / (t1 - t0)) * (SPARK.width - 2 * PAD)));
  // A Series that does not move is a level line through the middle, not a line along an edge.
  const y = (value: number): number => (high === low ? SPARK.height / 2 : r2(SPARK.height - PAD - ((value - low) / (high - low)) * (SPARK.height - 2 * PAD)));

  const kind = drawnAs(series);
  const marks: SvgNode[] = [];
  if (kind === "points") {
    for (const o of valued) marks.push(h("circle", { "data-point": "", cx: x(o.period_start), cy: y(o.value), r: 1.25, fill: "currentColor" }));
  } else if (valued.length > 1) {
    // One run per stretch of Periods that have values: a gap is a break in the line.
    let d = "";
    let open = false;
    for (const o of shown) {
      if (o.value === null) {
        open = false;
        continue;
      }
      const [px, py] = [x(o.period_start), y(o.value)];
      d += open ? (kind === "step" ? `H${px}V${py}` : `L${px} ${py}`) : `M${px} ${py}`;
      open = true;
    }
    marks.push(h("path", { "data-line": "", d, fill: "none", stroke: "currentColor", "stroke-width": 1.25, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  }
  marks.push(h("circle", { "data-last": "", cx: x(latest.period_start), cy: y(latest.value!), r: 2, fill: "currentColor" }));

  const span = valued.length > 1 ? `${periodWords(series.freq, valued[0]!)} to ${periodWords(series.freq, latest)}` : periodWords(series.freq, latest);
  return h(
    "svg",
    { viewBox: `0 0 ${SPARK.width} ${SPARK.height}`, width: SPARK.width, height: SPARK.height, role: "img", "aria-label": `${series.name}, ${span}`, "data-sparkline": series.key, focusable: "false" },
    ...marks,
  );
}
