/**
 * The Overview and Highlights as views of a Release (PLAN section 3, M22; ADR 0036).
 *
 * Which Series are headline Series is the Release's own `content/highlights.json`: an editor's
 * choice that names Series and grants nothing. Each one's values reach a row only through
 * Query, asked for display on the Surface in hand, so the rights gate decides what a row may
 * say. A Series the gate holds back is a row with its name and the reason and nothing else: no
 * value, no Period, no window and no drawing is made for it, because none was read.
 *
 * Every figure is a door (PLAN section 3): a cell opens the Explorer at the window it compares
 * across, from the first month of the earlier Period to the last month of the latest one,
 * whether or not the cell has a figure; the Series' name opens its own page.
 *
 * Hidden here: the request each Series is asked with (a Series finer than monthly is brought
 * to months first, by its own declared rule, which is what its change over years is taken on);
 * turning the engine's answer into a change strip and a sparkline; the addresses. The
 * arithmetic is the engine's (`docs/method/highlights.md`). Node only (it takes an opened
 * Release); pure otherwise.
 */
import type { RightsGate, Surface } from "@macro-atlas/core";
import type { CatalogEntry } from "@macro-atlas/core/release";
import { SEGMENTS } from "./catalog";
import { changeStrip, sparkline, type ShownSeries, type StripCell, type StripLatest, type StripMark, type SvgNode } from "./figure";
import { dayWords } from "./figure/words";
import { query } from "./query";
import type { OpenedRelease } from "./release/reader";
import { sourceWords } from "./series-page";

/** The spans of Highlights (CONTEXT.md): one, five and ten years. */
export const SPANS = [1, 5, 10] as const;

export type HeadlineCell = StripCell & {
  /** The Explorer at the window this cell compares across. Without the base path. */
  href: string;
};

export type HeadlineRow =
  | {
      state: "shown";
      key: string;
      name: string;
      /** The Series' own page. Without the base path, like every address here. */
      href: string;
      unit: string;
      latest: StripLatest | null;
      marks: StripMark[];
      /** One per span; null when the Series has no change over years, and `reason` says why. */
      cells: HeadlineCell[] | null;
      reason: string | null;
      /** Said when the comparison is not at the Series' own frequency. */
      compared: string | null;
      /** The Series in the Explorer, whole. */
      explorer: string;
      /** The ten years to the latest value, drawn small (the Overview). */
      spark?: SvgNode | null;
    }
  | {
      /** Withheld in this Release; not permitted on this Surface; or the Release cannot answer for it. */
      state: "withheld" | "not_permitted" | "no_answer";
      key: string;
      name: string;
      href: string;
      reason: string;
    };

export type HighlightsView = {
  spans: readonly number[];
  segments: { segment: string; label: string; rows: HeadlineRow[] }[];
  /** How many headline Series the Release names. */
  total: number;
};

export type OverviewView = {
  /** The day the Release was made, in words. Each row names its own Period. */
  release: string;
  segments: {
    segment: string;
    label: string;
    /** The Segment's Series in the catalog. */
    href: string;
    /** The Segment's first headline Series; null when the Release names none for it. */
    row: HeadlineRow | null;
    /** How many more headline Series the Segment has in Highlights. */
    more: number;
  }[];
  total: number;
};

export type HighlightsOptions = {
  /** See `QueryOptions.gate`: only a test passes one. */
  gate?: Pick<RightsGate, "permits">;
};

const FINER_THAN_MONTHS: ReadonlySet<string> = new Set(["daily", "business_daily", "weekly"]);
const COMBINED: Record<string, string> = { mean: "the mean of", last: "the last value of", sum: "the sum of" };
const sentence = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;

/** The Explorer showing one Series from the month `from` falls in to the month `to` falls in. */
export function windowHref(key: string, from: string, to: string, freq?: "monthly"): string {
  return `/explore?s=${key}&from=${from.slice(0, 7)}&to=${to.slice(0, 7)}${freq ? `&freq=${freq}` : ""}`;
}

function headlineRow(release: OpenedRelease, surface: Surface, entry: CatalogEntry, options: HighlightsOptions & { spark: boolean }): HeadlineRow {
  const named = { key: entry.key, name: entry.name, href: `/data/${entry.key}` };
  const ask = (freq?: "monthly") => query(release, surface, { series: [entry.key], transform: "lin", permission: "display", ...(freq ? { freq } : {}) }, { gate: options.gate });

  const finer = FINER_THAN_MONTHS.has(entry.freq);
  let answer = ask(finer ? "monthly" : undefined);
  if (!answer.ok) {
    if (answer.status !== 403) return { state: "no_answer", ...named, reason: sentence(answer.message) };
    const withheld = release.manifest.withheld.find((row) => row.key === entry.key);
    return { state: answer.code === "withheld" ? "withheld" : "not_permitted", ...named, reason: withheld?.reason ?? sentence(answer.message) };
  }
  // A Series that cannot be brought to months is shown at its own frequency: it has a latest
  // value, and the strip says why it has no change over years.
  if (finer && !answer.series[0]!.result.ok) {
    const own = ask();
    if (own.ok) answer = own;
  }
  const series = answer.series[0]!;
  if (!series.result.ok) return { state: "no_answer", ...named, reason: sentence(series.result.message) };

  const shown: ShownSeries = {
    key: entry.key,
    name: entry.name,
    unit: series.unit,
    unitKind: entry.unit_kind,
    measureKind: entry.measure_kind,
    freq: series.answered_freq,
    continuity: entry.continuity,
    representation: entry.representation,
    seasonalAdjustment: entry.seasonal_adjustment,
    priceBasis: entry.price_basis,
    country: entry.country,
    maxLag: entry.max_lag,
    agg: entry.agg,
    breaks: entry.breaks,
    source: sourceWords(entry),
    observations: series.result.observations,
  };
  const strip = changeStrip(shown, release.manifest.created, SPANS);
  const monthly = series.aggregated ? ("monthly" as const) : undefined;
  const end = strip.latest;
  return {
    state: "shown",
    ...named,
    unit: series.unit,
    latest: end,
    marks: strip.marks,
    cells: strip.cells && end ? strip.cells.map((cell) => ({ ...cell, href: cell.periodStart ? windowHref(entry.key, cell.periodStart, end.period_end, monthly) : `/explore?s=${entry.key}` })) : null,
    reason: strip.reason,
    compared: series.aggregated ? `Compared by month: each month is ${COMBINED[series.aggregated.method] ?? "combined from"} its ${series.aggregated.from.replace("_", " ")} values.` : null,
    explorer: `/explore?s=${entry.key}`,
    ...(options.spark ? { spark: sparkline(shown) } : {}),
  };
}

function entriesOf(release: OpenedRelease): Map<string, CatalogEntry> {
  return new Map(release.catalog.series.map((entry) => [entry.key, entry]));
}

export function highlightsView(release: OpenedRelease, surface: Surface, options: HighlightsOptions = {}): HighlightsView {
  const entries = entriesOf(release);
  const segments = release.highlights.segments.map((held) => ({
    segment: held.segment as string,
    label: SEGMENTS[held.segment] ?? held.segment,
    // The contract holds every key to the Catalog; a key that is not there is not a row.
    rows: held.series.flatMap((key) => (entries.has(key) ? [headlineRow(release, surface, entries.get(key)!, { ...options, spark: false })] : [])),
  }));
  return { spans: SPANS, segments, total: segments.reduce((n, s) => n + s.rows.length, 0) };
}

export function overviewView(release: OpenedRelease, surface: Surface, options: HighlightsOptions = {}): OverviewView {
  const entries = entriesOf(release);
  let total = 0;
  const segments = release.highlights.segments.map((held) => {
    const keys = held.series.filter((key) => entries.has(key));
    total += keys.length;
    return {
      segment: held.segment as string,
      label: SEGMENTS[held.segment] ?? held.segment,
      href: `/data?segment=${held.segment}`,
      row: keys.length > 0 ? headlineRow(release, surface, entries.get(keys[0]!)!, { ...options, spark: true }) : null,
      more: Math.max(0, keys.length - 1),
    };
  });
  return { release: dayWords(release.manifest.created.slice(0, 10)), segments, total };
}
