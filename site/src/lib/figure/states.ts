/**
 * Data states: the conditions of a value a reader must be told about (CONTEXT.md). Each has a
 * mark and a word, and they are always shown together: never colour alone (PLAN section 3).
 *
 * The marks are drawn in ink, hollow, so they cannot be taken for a Series' own filled symbol.
 * `suppressed` is a Status, not one of the nine Data states; it has its own mark and word because
 * a value an Origin held back is not a value that is merely absent, and neither is Withheld.
 */
import { h, r2, type SvgNode } from "./svg";

export const DATA_STATES = ["preliminary", "revised", "estimate", "projected", "partial", "stale", "missing", "break", "withheld"] as const;
export type DataState = (typeof DATA_STATES)[number];
export type MarkName = DataState | "suppressed";
export const MARK_NAMES: readonly MarkName[] = [...DATA_STATES, "suppressed"];

export const STATE_INFO: Record<MarkName, { word: string; shape: string; meaning: string }> = {
  preliminary: { word: "Preliminary", shape: "hollow circle", meaning: "The origin has published this value as a first figure and may change it." },
  revised: { word: "Revised", shape: "hollow square", meaning: "The origin has changed this value since it first published it." },
  estimate: { word: "Estimate", shape: "hollow diamond", meaning: "The value was estimated, not measured or counted." },
  projected: { word: "Projected", shape: "cross", meaning: "The value is a projection for a period that has not been observed. It is never shown as an observation." },
  partial: { word: "Partial period", shape: "half-filled circle", meaning: "The value covers only part of its period, so it cannot be set beside a full one." },
  stale: { word: "Stale", shape: "hollow triangle", meaning: "The latest value is older than the limit set for this series when the release was made." },
  missing: { word: "Missing", shape: "dashed bar", meaning: "There is no value for this period. Nothing is filled in or carried forward." },
  break: { word: "Break", shape: "dashed upright line", meaning: "From this period the series is on a new basis; values on either side are not comparable." },
  withheld: { word: "Withheld", shape: "barred circle", meaning: "The series is known but its values are kept back because its rights do not allow them to be shown." },
  suppressed: { word: "Suppressed", shape: "solid bar", meaning: "The origin holds this value back, for example to protect confidentiality." },
};

const STATUS_STATES: readonly string[] = ["preliminary", "revised", "estimate", "projected", "partial", "missing", "suppressed"];

/** The state an Observation's Status puts it in. `final` is no state. */
export function stateOfStatus(status: string): MarkName | null {
  return STATUS_STATES.includes(status) ? (status as MarkName) : null;
}

/**
 * The mark for a state, centred on (cx, cy), about `size` across. Stroked in the current colour.
 * Every mark is a single <g data-mark> so a test, or a reader of the markup, can find it.
 */
export function mark(name: MarkName, cx: number, cy: number, size = 10): SvgNode {
  const s = size / 2;
  const stroke = { fill: "none", stroke: "currentColor", "stroke-width": 1.5 };
  const p = (points: [number, number][]) => points.map(([x, y]) => `${r2(cx + x)},${r2(cy + y)}`).join(" ");
  let shapes: SvgNode[];
  switch (name) {
    case "preliminary":
      shapes = [h("circle", { cx: r2(cx), cy: r2(cy), r: r2(s), ...stroke })];
      break;
    case "revised":
      shapes = [h("rect", { x: r2(cx - s * 0.9), y: r2(cy - s * 0.9), width: r2(s * 1.8), height: r2(s * 1.8), ...stroke })];
      break;
    case "estimate":
      shapes = [h("polygon", { points: p([[0, -s * 1.15], [s * 1.15, 0], [0, s * 1.15], [-s * 1.15, 0]]), ...stroke })];
      break;
    case "projected":
      shapes = [h("path", { d: `M${r2(cx - s)} ${r2(cy - s)}L${r2(cx + s)} ${r2(cy + s)}M${r2(cx - s)} ${r2(cy + s)}L${r2(cx + s)} ${r2(cy - s)}`, ...stroke })];
      break;
    case "partial":
      shapes = [
        h("circle", { cx: r2(cx), cy: r2(cy), r: r2(s), ...stroke }),
        h("path", { d: `M${r2(cx)} ${r2(cy - s)}A${r2(s)} ${r2(s)} 0 0 0 ${r2(cx)} ${r2(cy + s)}Z`, fill: "currentColor", stroke: "none" }),
      ];
      break;
    case "stale":
      shapes = [h("polygon", { points: p([[0, -s * 1.1], [s * 1.1, s * 0.9], [-s * 1.1, s * 0.9]]), ...stroke, "stroke-linejoin": "round" })];
      break;
    case "missing":
      shapes = [h("line", { x1: r2(cx - s * 1.2), y1: r2(cy), x2: r2(cx + s * 1.2), y2: r2(cy), ...stroke, "stroke-width": 2, "stroke-dasharray": "2 2" })];
      break;
    case "suppressed":
      shapes = [h("line", { x1: r2(cx - s * 1.2), y1: r2(cy), x2: r2(cx + s * 1.2), y2: r2(cy), ...stroke, "stroke-width": 3 })];
      break;
    case "break":
      shapes = [h("line", { x1: r2(cx), y1: r2(cy - s * 1.3), x2: r2(cx), y2: r2(cy + s * 1.3), ...stroke, "stroke-dasharray": "3 2" })];
      break;
    case "withheld":
      shapes = [
        h("circle", { cx: r2(cx), cy: r2(cy), r: r2(s), ...stroke }),
        h("line", { x1: r2(cx - s * 0.7), y1: r2(cy + s * 0.7), x2: r2(cx + s * 0.7), y2: r2(cy - s * 0.7), ...stroke }),
      ];
      break;
  }
  return h("g", { "data-mark": name }, ...shapes);
}

/** A mark on its own, as a small inline drawing to sit beside its word. Decorative: the word carries the meaning. */
export function markIcon(name: MarkName): SvgNode {
  return h("svg", { viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": "true", focusable: "false", "data-state-mark": name }, mark(name, 8, 8, 9));
}
