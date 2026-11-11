/**
 * figure: the explained figure, as data (PLAN 4.2 and section 3).
 *
 * `renderFigure(spec, series)` answers with everything an Explained figure shows: the Takeaway
 * (or the reason there is none), the drawing, the unit and source lines, the Data states present
 * with their marks and words, "how to read this", and the same values as a table. It draws
 * nothing itself and knows nothing of React or the page: components/Figure.tsx lays the answer
 * out.
 *
 * Hidden here: scales, ticks and layout at three widths; how a Series is drawn from its cadence
 * (never from how dense it looks); the marks; the Takeaway templates and silence rules; number
 * and Period wording. Pure: the only clock is `spec.created`, the Release's own.
 */
import type { Frequency } from "@macro-atlas/core";
import type { MarkName } from "./states";
import type { SvgNode } from "./svg";
import { takeawayFor, type Silence } from "./takeaway";
import { periodWords } from "./words";

export { DATA_STATES, MARK_NAMES, STATE_INFO, mark, markIcon, type DataState, type MarkName } from "./states";
export { svgString, type SvgNode } from "./svg";
export type { Silence, SilenceRule } from "./takeaway";

export type FigureObservation = { period: string; period_start: string; period_end: string; value: number | null; status: string };

/** A Series whose values the figure may show. Optional facts are absent when not recorded. */
export type ShownSeries = {
  key: string;
  name: string;
  unit: string;
  unitKind?: string;
  measureKind?: string;
  freq: Frequency;
  continuity: "discrete" | "held";
  representation: string;
  seasonalAdjustment?: string;
  priceBasis?: string;
  country?: string;
  maxLag?: string;
  breaks?: { period: string; note: string }[];
  /** Where the values came from, in words, for the source line. */
  source: string;
  /** In Period order, every gap explicit, as a Release holds them. */
  observations: readonly FigureObservation[];
};

/** A Series named in the figure with no values: Withheld, or not allowed on this Surface. */
export type HeldBackSeries = { key: string; name: string; heldBack: "withheld" | "not_permitted"; reason: string };

export type FigureSeries = ShownSeries | HeldBackSeries;

export type FigureSpec = {
  /** The Release's `created`: the one clock (staleness, how far a held value stands). */
  created: string;
  /** When the values were obtained, already in words ("retrieved 11 Nov 2026"), if known. */
  retrieved?: string | null;
};

export type LayoutName = "narrow" | "medium" | "wide";
export const LAYOUTS: Record<LayoutName, { width: number; height: number }> = {
  narrow: { width: 288, height: 200 },
  medium: { width: 448, height: 250 },
  wide: { width: 768, height: 320 },
};

export type SeriesStyle = { key: string; name: string; /** 1 to 8: `--color-series-n`. */ color: number; dash: string | null; symbol: "circle" | "square" | "triangle" | "diamond"; drawnAs: "line" | "points" | "step" };

export type Plot = {
  unit: string;
  unitLine: string;
  series: SeriesStyle[];
  /** One drawing per layout; the page shows the one that fits. */
  layouts: Record<LayoutName, SvgNode>;
  /** Whether the wide layout names each Series at the end of its line (so it needs no legend). */
  endLabels: boolean;
};

export type StateNote = { mark: MarkName; word: string; text: string; series: string };

export type TableRow = { period: string; label: string; value: string | null; exact: string | null; states: { mark: MarkName; word: string; note?: string }[] };
export type FigureTable = { key: string; name: string; unit: string; decimals: number; rounded: boolean; rows: TableRow[] };

export type Figure = {
  takeaway: string | null;
  silence: Silence | null;
  plots: Plot[];
  states: StateNote[];
  sourceLine: string;
  howToRead: { text: string; mark?: MarkName }[];
  tables: FigureTable[];
};

export const isShown = (s: FigureSeries): s is ShownSeries => !("heldBack" in s);

const STATUS_IN_SOURCE_LINE = new Set(["preliminary", "revised", "estimate", "projected", "partial"]);

function sourceLine(spec: FigureSpec, shown: ShownSeries[]): string {
  const sources = [...new Set(shown.map((s) => s.source))];
  const parts = [`${sources.length > 1 ? "Sources" : "Source"}: ${sources.join("; ")}`];
  if (shown.length === 1) {
    const s = shown[0]!;
    const latest = [...s.observations].reverse().find((o) => o.value !== null);
    if (latest) {
      parts.push(`data to ${periodWords(s.freq, latest, "short")}`);
      if (spec.retrieved) parts.push(spec.retrieved);
      if (STATUS_IN_SOURCE_LINE.has(latest.status)) parts.push(latest.status === "partial" ? "partial period" : latest.status);
    }
  } else if (spec.retrieved) parts.push(spec.retrieved);
  return parts.join(" · ");
}

export function renderFigure(spec: FigureSpec, series: readonly FigureSeries[]): Figure {
  const shown = series.filter(isShown);
  const { takeaway, silence } = takeawayFor(shown, spec.created);
  return { takeaway, silence, plots: [], states: [], sourceLine: sourceLine(spec, shown), howToRead: [], tables: [] };
}
