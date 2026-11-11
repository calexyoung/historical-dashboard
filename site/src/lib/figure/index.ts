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
import { staleness, type Frequency } from "@macro-atlas/core";
import { drawnAs, drawPlot, GAP_MARKS, leftMargin, NO_ANSWER, STATUS_MARKS, statusRuns, styleFor, yAxis, type YAxis } from "./plot";
import { MARK_NAMES, STATE_INFO, stateOfStatus, type MarkName } from "./states";
import type { SvgNode } from "./svg";
import { takeawayFor, type Silence } from "./takeaway";
import { dayWords, exactDecimals, fixed, FREQ_NOUN, FREQ_WORD, labelStart, list, periodWords } from "./words";

export { DATA_STATES, MARK_NAMES, STATE_INFO, mark, markIcon, type DataState, type MarkName } from "./states";
export { svgString, type SvgNode } from "./svg";
export type { Silence, SilenceRule } from "./takeaway";

export type FigureObservation = {
  period: string;
  period_start: string;
  period_end: string;
  value: number | null;
  status: string;
  /**
   * Where on the time axis the Observation is drawn, when that is not its own first day: a run
   * from another range laid over the window (the Explorer's compare ranges). The table and every
   * word still use the Period itself.
   */
  at?: string;
};

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
  /**
   * "ln": the values are natural logarithms (the engine's `log`). They are drawn as they are and
   * the axis is labelled with the values themselves, which makes it a logarithmic axis.
   */
  scale?: "ln";
  /** The unit as the table should name it, where it differs from the axis's (a logarithm). */
  tableUnit?: string;
  /** Where the values came from, in words, for the source line. */
  source: string;
  /**
   * A second run of a Series already in the figure (`of` is that Series' key): drawn in its
   * colour, line style and symbol, but pale and wide, with hollow symbols, so the two runs are
   * told apart by weight, never by colour alone.
   */
  ghost?: { of: string; /** The last day a standing (held) value is drawn to, on the time axis. */ standsUntil?: string };
  /** The highest and lowest drawn values to mark, each with what to write beside it. */
  extremes?: { period: string; label: string; kind: "max" | "min" }[];
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
  /** False: no Takeaway and no reason for its absence (the Explorer shows re-expressed values). */
  takeaway?: boolean;
  /** False: no Series is named at the end of its line (the page lists them itself). */
  endLabels?: boolean;
  /** Calendar dates, both inclusive: one time axis for every plot of the figure. */
  domain?: { from: string; to: string };
  /** Annotations to draw on every plot. */
  layers?: Layers;
  /** A date the reader pinned: one upright line in every plot. */
  pin?: string;
};

/**
 * Annotations as the drawing needs them: dates only. Which Annotations, in which order and with
 * which names is the caller's business. A band's tint is one of two pale neutrals; it never
 * stands for a party (DESIGN.md), so whatever it distinguishes is also in the band's name.
 */
export type Layers = {
  /** Spans drawn as pale bands the height of the plot; `end` is inclusive, null is still running. */
  bands: { start: string; end: string | null; label: string; tint: "a" | "b" }[];
  recessions: { start: string; end: string | null }[];
  /** Dated Events, drawn as ticks at the foot of the plot (one path for all of them). */
  events: { id: string; date: string }[];
  /** The Event the reader chose: a line the height of the plot, with its name. */
  highlight?: { id: string; date: string; label: string } | null;
};

export type LayoutName = "narrow" | "medium" | "wide";
export { LAYOUT_SIZES as LAYOUTS, NO_ANSWER, swatch } from "./plot";

export type SeriesStyle = {
  key: string;
  name: string;
  /** 1 to 8: `--color-series-n`. */
  color: number;
  dash: string | null;
  symbol: "circle" | "square" | "triangle" | "diamond";
  drawnAs: "line" | "points" | "step";
  /** A second run of another Series: pale and wide, hollow symbols. */
  ghost?: true;
};

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

const ADJUSTMENT: Record<string, string> = { sa: "seasonally adjusted", nsa: "not seasonally adjusted", saar: "seasonally adjusted annual rate" };
const PRICES: Record<string, string> = { real: "in real terms", nominal: "in nominal terms" };

function unitLine(group: ShownSeries[]): string {
  const shared = <T>(of: (s: ShownSeries) => T): T | undefined => (group.every((s) => of(s) === of(group[0]!)) ? of(group[0]!) : undefined);
  const parts = [group[0]!.unit];
  const adjustment = ADJUSTMENT[shared((s) => s.seasonalAdjustment) ?? ""];
  if (adjustment) parts.push(adjustment);
  const prices = PRICES[shared((s) => s.priceBasis) ?? ""];
  if (prices) parts.push(prices);
  const freq = shared((s) => s.freq);
  if (freq) parts.push(FREQ_WORD[freq]);
  if (shared((s) => s.representation) === "legacy_monthly_rounded") parts.push("v1's rounded output");
  return parts.join(" · ");
}

function tableFor(s: ShownSeries, stale: boolean): FigureTable {
  const CAP = 6;
  const values = s.observations.map((o) => o.value).filter((v): v is number => v !== null);
  const needed = values.map((v) => exactDecimals(v, CAP));
  const rounded = needed.some((d) => d === null);
  const decimals = rounded ? CAP : Math.max(0, ...(needed as number[]));
  // A break belongs to the first Observation on the new basis: the first that starts on or after
  // the break's own date. Stale belongs to the last value.
  const breaks = new Map<string, string>();
  for (const b of s.breaks ?? []) {
    const at = labelStart(s.freq, b.period);
    const first = at && s.observations.find((o) => o.period_start >= at.period_start);
    if (first) breaks.set(first.period, b.note);
  }
  const lastValued = stale ? [...s.observations].reverse().find((o) => o.value !== null)?.period : undefined;
  const rows = s.observations.map((o): TableRow => {
    const states: TableRow["states"] = [];
    const state = stateOfStatus(o.status);
    if (state) states.push({ mark: state, word: STATE_INFO[state].word });
    else if (o.value === null && o.status !== NO_ANSWER) states.push({ mark: "missing", word: STATE_INFO.missing.word });
    const note = breaks.get(o.period);
    if (note !== undefined) states.push({ mark: "break", word: STATE_INFO.break.word, note });
    if (o.period === lastValued) states.push({ mark: "stale", word: STATE_INFO.stale.word });
    const tiny = o.value !== null && o.value !== 0 && Math.abs(o.value) < 10 ** -CAP;
    return {
      period: o.period,
      label: periodWords(s.freq, o, "short"),
      value: o.value === null ? null : tiny ? String(o.value) : fixed(o.value, decimals),
      exact: o.value === null ? null : String(o.value),
      states,
    };
  });
  return { key: s.key, name: s.name, unit: s.tableUnit ?? s.unit, decimals, rounded, rows };
}

/** "Aug 2025", "2020 Q1 to 2024 Q4 (20 periods)"; at most three runs, then a count of the rest. */
function runsInWords(s: ShownSeries, found: [number, number][]): string {
  const one = ([a, b]: [number, number]) => {
    const first = periodWords(s.freq, s.observations[a]!, "short");
    return a === b ? first : `${first} to ${periodWords(s.freq, s.observations[b]!, "short")} (${b - a + 1} periods)`;
  };
  const shown = found.slice(0, 3).map(one);
  const rest = found.slice(3).reduce((n, [a, b]) => n + (b - a + 1), 0);
  return rest > 0 ? `${shown.join(", ")} and ${rest} more ${rest === 1 ? "period" : "periods"}` : list(shown);
}

function statesOf(s: ShownSeries, created: string): { notes: StateNote[]; stale: boolean } {
  const notes: StateNote[] = [];
  const note = (mark: MarkName, text: string) => notes.push({ mark, word: STATE_INFO[mark].word, series: s.name, text });
  const obs = s.observations;
  for (const state of [...STATUS_MARKS, ...GAP_MARKS]) {
    const found = statusRuns(obs, state);
    if (found.length > 0) note(state, runsInWords(s, found));
  }
  for (const b of s.breaks ?? []) {
    const at = labelStart(s.freq, b.period);
    note("break", `at ${at ? periodWords(at.freq, at, "short") : b.period}. ${b.note}`);
  }
  const latest = [...obs].reverse().find((o) => o.value !== null);
  const age = latest ? staleness(latest.period_end, s.maxLag, created) : { known: false as const };
  const stale = age.known && age.stale;
  if (stale && latest && age.known) {
    note("stale", `the latest value is for ${periodWords(s.freq, latest, "short")}; the limit for this series ran out on ${dayWords(age.limit)}.`);
  }
  const order = (n: StateNote) => MARK_NAMES.indexOf(n.mark);
  return { notes: notes.sort((a, b) => order(a) - order(b)), stale };
}

function howToRead(plots: { group: ShownSeries[]; axis: YAxis }[], notes: StateNote[], created: string): Figure["howToRead"] {
  const lines: Figure["howToRead"] = [];
  const all = plots.flatMap((p) => p.group);
  const kinds = new Set(all.map(drawnAs));
  const nouns = (as: string) => [...new Set(all.filter((s) => drawnAs(s) === as).map((s) => FREQ_NOUN[s.freq]))];
  if (kinds.has("line")) lines.push({ text: `The line joins one value per ${list(nouns("line"))}, each placed at the start of its period. It stops wherever a value is missing.` });
  if (kinds.has("points")) {
    const noun = list(nouns("points"));
    lines.push({ text: `Each point is one ${noun}, placed at the start of the ${nouns("points").length === 1 && noun !== "observation" ? noun : "period"} it describes. Points are not joined: the series holds nothing between them.` });
  }
  if (kinds.has("step")) lines.push({ text: `Each value stands from its date until the next one, drawn as a step. The last value stands until the day this release was made, ${dayWords(created.slice(0, 10))}.` });
  for (const { axis, group } of plots) {
    const [lo, hi] = axis.domain;
    if (axis.log) {
      const which = plots.length > 1 ? ` for ${group[0]!.unit}` : "";
      lines.push({ text: `The vertical axis${which} is logarithmic: equal distances are equal percent changes.` });
    } else if (lo > 0 || hi < 0) {
      const which = plots.length > 1 ? ` for ${group[0]!.unit}` : "";
      lines.push({ text: `The vertical axis${which} runs from ${axis.format(lo)} to ${axis.format(hi)}. It does not start at zero.` });
    }
  }
  if (all.filter((s) => !s.ghost).length > 1) lines.push({ text: "Each series has its own colour, line style and symbol; none of the three is used alone." });
  if (all.some((s) => s.ghost)) lines.push({ text: "A pale, wide line with hollow symbols is the same series over the range compared with, laid over the window so that both start at the left edge. Its dates are in the readout and the table, not on the axis." });
  if (all.some((s) => s.extremes && s.extremes.length > 0)) lines.push({ text: "A ring marks each series' highest and lowest value in the window, as drawn; the figure beside it is the series' own value." });
  if (all.some((s) => STATUS_MARKS.some((m) => statusRuns(s.observations, m).some(([a, b]) => b > a)))) {
    lines.push({ text: "Where several values in a row share a state, the mark is drawn on the first and the last of them." });
  }
  for (const name of MARK_NAMES) {
    if (notes.some((n) => n.mark === name && n.word === STATE_INFO[name].word)) lines.push({ mark: name, text: `${STATE_INFO[name].word}. ${STATE_INFO[name].meaning}` });
  }
  if (all.length > 0) lines.push({ text: "The table holds every value drawn here." });
  return lines;
}

export function renderFigure(spec: FigureSpec, series: readonly FigureSeries[]): Figure {
  const shown = series.filter(isShown);
  const { takeaway, silence } = spec.takeaway === false ? { takeaway: null, silence: null } : takeawayFor(shown, spec.created);

  const states: StateNote[] = [];
  const stale = new Set<string>();
  // A Series keeps one colour, line style and symbol wherever it is drawn.
  const styles = new Map<string, SeriesStyle>();
  // A second run takes the style of the Series it is a run of, and no place in the palette.
  shown.filter((s) => !s.ghost).forEach((s, i) => styles.set(s.key, { key: s.key, name: s.name, ...styleFor(i), drawnAs: drawnAs(s) }));
  const own = shown.filter((s) => !s.ghost).length;
  shown.filter((s) => s.ghost).forEach((s, i) => {
    // A run whose Series is not itself in the figure takes the next free place in the palette.
    const of = styles.get(s.ghost!.of);
    styles.set(s.key, { key: s.key, name: s.name, ...(of ? { color: of.color, dash: of.dash, symbol: of.symbol } : styleFor(own + i)), drawnAs: drawnAs(s), ghost: true });
  });
  for (const s of series) {
    if (isShown(s)) {
      const of = statesOf(s, spec.created);
      states.push(...of.notes);
      if (of.stale) stale.add(s.key);
    } else {
      states.push({ mark: "withheld", word: s.heldBack === "withheld" ? STATE_INFO.withheld.word : "Not shown here", series: s.name, text: s.reason });
    }
  }

  // Series that share a unit share a plot; a Series with no values at all has nothing to draw.
  const groups = new Map<string, ShownSeries[]>();
  for (const s of shown) {
    if (!s.observations.some((o) => o.value !== null)) continue;
    groups.set(s.unit, [...(groups.get(s.unit) ?? []), s]);
  }
  const measured = [...groups.values()].map((group) => ({ group, axis: yAxis(group) }));
  // Plots stacked in one figure share their left edge, so a date is at one place in all of them.
  const minLeft = Math.max(0, ...measured.map(({ axis }) => leftMargin(axis)));
  const options = { domain: spec.domain, minLeft, layers: spec.layers, pin: spec.pin };
  const plots = measured.map(({ group, axis }): Plot => {
    const input = group.map((s) => ({ series: s, style: styles.get(s.key)!, stale: stale.has(s.key) }));
    const layouts = {} as Record<LayoutName, SvgNode>;
    let endLabels = false;
    for (const layout of ["narrow", "medium", "wide"] as const) {
      const drawing = drawPlot(input, spec.created, layout, axis, layout === "wide" && spec.endLabels !== false, options);
      layouts[layout] = drawing.svg;
      if (layout === "wide") endLabels = drawing.endLabels;
    }
    return { unit: group[0]!.unit, unitLine: unitLine(group), series: input.map((i) => i.style), layouts, endLabels };
  });

  return {
    takeaway,
    silence,
    plots,
    states,
    sourceLine: sourceLine(spec, shown),
    howToRead: howToRead(measured, states, spec.created),
    tables: shown.map((s) => tableFor(s, stale.has(s.key))),
  };
}
