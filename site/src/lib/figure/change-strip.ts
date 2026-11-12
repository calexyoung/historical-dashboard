/**
 * The change strip (PLAN M22; docs/method/highlights.md): one Series' latest value and its
 * change over one, five and ten years, as figures and as words. A row of Highlights is a change
 * strip; a Topic page opens with one (M23).
 *
 * The arithmetic is the engine's (`changeOver`, `shownChange`). This module decides only what
 * a page may print of it, by the Takeaway's own rules (takeaway.ts): no figure is set beside a
 * partial Period, an estimate or a projection, or across a break, and the cell then names that
 * Data state in its place. A preliminary or revised value is a figure its origin published: it
 * is compared, and the state is marked beside the latest value. A stale Series keeps its
 * figures, which are those of the Periods named, and is marked Stale.
 *
 * The words describe and never evaluate: "higher than", "lower than", "unchanged from". There
 * is no colour for up or down and no arrow. Pure: the only clock is the Release's `created`.
 */
import { changeOver, periodBounds, shownChange, staleness, type Frequency, type YearsChange } from "@macro-atlas/core";
import type { FigureObservation, ShownSeries } from "./index";
import { STATE_INFO, stateOfStatus, type MarkName } from "./states";
import { fixed, labelStart, periodWords, preposition, readingDecimals } from "./words";

export type StripMark = { mark: MarkName; word: string };

export type StripFigure = {
  /** Percentage points (a Series measured in percent), a percent of the earlier value, or the Series' own unit. */
  kind: "points" | "percent" | "unit";
  value: number;
  /** For a table cell: "+5.2%", "−0.2 pts", "+4". No sign when it rounds to nothing. */
  text: string;
  /** For a sentence: "5.2% higher than a year earlier". */
  words: string;
};

export type StripCell = {
  years: number;
  /** The Period this many years before the latest, by the calendar, whether or not the Series holds it. */
  period: string;
  /** Its first day; null only when the label cannot be dated. */
  periodStart: string | null;
  periodWords: string | null;
  /** The earlier value as it is read, when there is a figure. */
  earlier: string | null;
  figure: StripFigure | null;
  /** The Data state that stands in place of a figure. */
  state: StripMark | null;
  /** Why there is no figure, in words. */
  reason: string | null;
};

export type StripLatest = {
  period: string;
  period_start: string;
  period_end: string;
  value: string;
  /** "December 2025". */
  when: string;
  /** "109.9 in December 2025 (index, 2024-01 = 100)", "4.3% in September 2026". */
  words: string;
};

export type ChangeStrip = {
  /** The last Observation that has a value; null when the Series has none. */
  latest: StripLatest | null;
  /** The Data states of the latest value: its Status, and Stale. */
  marks: StripMark[];
  /** One cell per span asked for; null when the Series cannot be compared over years at all. */
  cells: StripCell[] | null;
  /** Why there are no cells. */
  reason: string | null;
};

const MINUS = "−";
const minus = (text: string): string => text.replace(/^-/, MINUS);
const bare = (unit: string): boolean => unit.trim() === "%";
const YEARS_WORDS: Record<number, string> = { 1: "a year earlier", 2: "two years earlier", 5: "five years earlier", 10: "ten years earlier" };
const earlierWords = (years: number): string => YEARS_WORDS[years] ?? `${years} years earlier`;
const markOf = (name: MarkName): StripMark => ({ mark: name, word: STATE_INFO[name].word });

const NO_CELLS: Record<string, string> = {
  frequency_not_supported: "This series has no fixed cadence, so there is no period a number of years earlier to set its latest value beside.",
  aggregation_not_declared: "This series is finer than monthly and declares no rule for bringing it to months, so its change over years is not worked out.",
  aggregation_not_allowed: "This series is finer than monthly and its values cannot be combined into months, so its change over years is not worked out.",
  held: "Each value of this series stands until the next one, so it has no months to set a year apart.",
};

function figureOf(change: YearsChange, s: ShownSeries, latest: number, earlier: number): StripFigure | null {
  const shown = shownChange(change, s.unitKind);
  if (shown.kind === "none") return null;
  const size = Math.abs(shown.value);
  const decimals = shown.kind === "percent" ? (size !== 0 && size < 0.05 ? 2 : 1) : Math.max(shown.kind === "points" ? 1 : 0, readingDecimals(latest), readingDecimals(earlier));
  const amount = fixed(size, decimals);
  const zero = Number(amount.replace(/,/g, "")) === 0;
  const sign = zero ? "" : shown.value < 0 ? MINUS : "+";
  const suffix = shown.kind === "percent" ? "%" : shown.kind === "points" ? " pts" : "";
  const spoken = shown.kind === "percent" ? `${amount}%` : shown.kind === "points" ? `${amount} ${amount === "1" ? "point" : "points"}` : amount;
  const than = earlierWords(change.years);
  const words = change.change === 0 ? `unchanged from ${than}` : `${spoken} ${shown.value > 0 ? "higher" : "lower"} than ${than}`;
  return { kind: shown.kind, value: shown.value, text: `${sign}${amount}${suffix}`, words };
}

/** Why a value may not be set beside another, by its Status; null when it may. */
function unusable(freq: Frequency, o: Pick<FigureObservation, "period" | "period_start" | "status">): { state: StripMark; reason: string } | null {
  const when = periodWords(freq, o);
  const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  if (o.status === "partial") return { state: markOf("partial"), reason: sentence(`${when} is a partial period`) };
  if (o.status === "estimate") return { state: markOf("estimate"), reason: `The value for ${when} is an estimate` };
  if (o.status === "projected") return { state: markOf("projected"), reason: `The value for ${when} is a projection, not an observation` };
  return null;
}

export function changeStrip(series: ShownSeries, created: string, years: readonly number[] = [1, 5, 10]): ChangeStrip {
  const answer = changeOver({ freq: series.freq, continuity: series.continuity, measure_kind: series.measureKind, agg: series.agg, observations: series.observations }, years);

  // The latest value is the Series' own, whether or not it can be compared over years.
  let last: (FigureObservation & { value: number }) | null = null;
  for (let i = series.observations.length - 1; i >= 0 && last === null; i--) {
    const o = series.observations[i]!;
    if (o.value !== null) last = o as FigureObservation & { value: number };
  }
  if (last === null) return { latest: null, marks: [], cells: null, reason: "This series has no values." };
  const end = answer.ok ? answer.latest : last;
  const freq = answer.ok ? answer.freq : series.freq;

  const when = periodWords(freq, end);
  const value = minus(fixed(end.value, readingDecimals(end.value)));
  const latest: StripLatest = {
    period: end.period,
    period_start: end.period_start,
    period_end: end.period_end,
    value,
    when,
    words: `${value}${bare(series.unit) ? "%" : ""} ${preposition(freq)} ${when}${bare(series.unit) ? "" : ` (${series.unit})`}`,
  };
  const marks: StripMark[] = [];
  const state = stateOfStatus(end.status);
  if (state) marks.push(markOf(state));
  const age = staleness(end.period_end, series.maxLag, created);
  if (age.known && age.stale) marks.push(markOf("stale"));
  if (!answer.ok) return { latest, marks, cells: null, reason: NO_CELLS[answer.reason] ?? "This series' change over years is not worked out." };

  const endRefused = unusable(freq, end);
  const cells = answer.changes.map((change): StripCell => {
    const bounds = periodBounds(freq, change.period);
    const earlier = bounds ? { period: change.period, period_start: bounds.start } : null;
    const short = earlier ? periodWords(freq, earlier, "short") : null;
    const cell = (more: Partial<StripCell>): StripCell => ({ years: change.years, period: change.period, periodStart: bounds?.start ?? null, periodWords: short, earlier: null, figure: null, state: null, reason: null, ...more });
    if (endRefused) return cell(endRefused);
    if (change.start === null) {
      if (change.empty === "no_value_earlier") return cell({ state: markOf("missing"), reason: `No value for ${short ?? change.period}` });
      const held = series.observations.find((o) => o.period === change.period);
      if (change.empty === "partial_period" && held) return cell(unusable(freq, held) ?? { reason: `${short ?? change.period} is a partial period` });
      return cell({ reason: `The series does not go back to ${short ?? change.period}` });
    }
    const refused = unusable(freq, change.start);
    if (refused) return cell(refused);
    // A break is dated by its own label: one after the earlier Period begins, up to the last day
    // of the latest, separates the two. That takes in a break dated by a day inside either
    // Period (a daily Series compared by month): such a Period mixes both bases. A label that
    // cannot be dated is taken to lie between them.
    const broken = (series.breaks ?? []).find((b) => {
      const at = labelStart(freq, b.period);
      return at === null || (at.period_start > change.start!.period_start && at.period_start <= end.period_end);
    });
    if (broken) {
      const at = labelStart(freq, broken.period);
      return cell({ state: markOf("break"), reason: `The series has a break at ${at ? periodWords(at.freq, at) : broken.period}` });
    }
    const figure = figureOf(change, series, end.value, change.start.value!);
    if (!figure) return cell({ reason: "No figure" });
    const decimals = Math.max(readingDecimals(end.value), readingDecimals(change.start.value!));
    return cell({ earlier: minus(fixed(change.start.value!, decimals)), figure });
  });
  return { latest, marks, cells, reason: null };
}
