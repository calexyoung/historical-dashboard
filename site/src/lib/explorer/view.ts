/**
 * The Explorer's view of a Release (PLAN section 3, `/explore`; M4): the Series a reader picked,
 * a window and a mode, drawn together with Annotation layers and a readout.
 *
 * `explorerView(release, surface, state)` turns an address (state.ts) into everything the page
 * shows. It is pure apart from the Release it is given. Values come only through Query, one
 * Series at a time, so the rights gate decides for each and one Series that may not be shown
 * (or does not offer the mode) never blanks the rest: it stays in the selection, by name, with
 * the reason. All the Series together stay within Query's row cap.
 *
 * Hidden here: which Series exist and what the defaults are; how a mode names its unit and
 * groups Series into plots (one plot per unit, one time axis); which layers a Release's
 * Annotations offer and how each is named; the readout's model; v1's presets; and every address
 * the page links to.
 */
import { permits, type Surface, type TransformName, type TransformedObservation } from "@macro-atlas/core";
import type { Annotation, CatalogEntry } from "@macro-atlas/core/release";
import { FREQUENCIES, SEGMENTS } from "../catalog";
import { NO_ANSWER, renderFigure, type Figure, type Layers, type SeriesStyle, type ShownSeries } from "../figure";
import { dayWords, fixed, labelStart, periodWords, readingDecimals } from "../figure/words";
import { latestValue, MAX_ROWS, MAX_SERIES, query, type QueryFailure } from "../query";
import { relationshipsFor, type RelationshipInput, type Relationships } from "./relationships";
import { snapshotRows, type SnapshotRow } from "./snapshot";
import type { OpenedRelease } from "../release/reader";
import { sourceWords } from "../series-page";
import { stopWords, type ReadoutModel, type ReadoutSeries } from "./readout";
import { explorerQuery, MODES, V1_BAND_SETS, V1_EVENT_CATEGORIES, type ExplorerState } from "./state";

export type Selected = {
  key: string;
  name: string;
  unit: string;
  /** drawn; not_drawn: selected, but this mode has no answer for it; or kept back by the rights gate. */
  state: "drawn" | "not_drawn" | "withheld" | "not_permitted";
  reason: string | null;
  style: Pick<SeriesStyle, "color" | "dash" | "symbol"> | null;
  /** Over the range compared with: drawn there too, or why not. Null when no second range is asked for. */
  compared: { drawn: boolean; reason: string | null } | null;
  /** The address without this Series. */
  removeQuery: string;
};

export type EventRow = { id: string; date: string; when: string; category: string; label: string; url: string | null; chosen: boolean; /** Chooses it, or lets it go. */ query: string };
export type PickerRow = { key: string; name: string; detail: string; checked: boolean; available: boolean };

export type ExplorerView = {
  mode: TransformName;
  modes: { value: TransformName; label: string; current: boolean; /** How many of the selected Series offer it. */ offered: number }[];
  selection: Selected[];
  /** What the reader should be told: unread parts of the address, Series left out, Periods a mode has no answer for. */
  notes: string[];
  window: { from: string | null; to: string | null; /** The time axis: first and last day. */ start: string | null; end: string | null; words: string | null };
  figure: Figure | null;
  readout: ReadoutModel;
  /** The date the reader pinned, when it is inside the window. */
  pinned: string | null;
  /** Where the readout stands: the pinned date, else the latest date in the window. */
  shownAt: string | null;
  layers: {
    toggles: { token: string; label: string; on: boolean; count: number }[];
    /** One set of bands at a time; the first option is none. */
    bands: { token: string; label: string; on: boolean }[];
  };
  /** The bands drawn, in words, for the list under the chart. */
  bands: { label: string; when: string }[];
  recessions: { label: string; when: string }[];
  events: EventRow[];
  presets: { name: string; query: string }[];
  picker: { label: string; series: PickerRow[] }[];
  /** The address as it was read. */
  query: string;
  /** The same view with every default and open end said outright: the link to copy. */
  resolvedQuery: string;
  /** The view with everything said outright, for a form's hidden fields. */
  resolved: Omit<ExplorerState, "notes">;
  queryWith: (change: Partial<Omit<ExplorerState, "notes">>) => string;
  /** The second range, when one is asked for: the same Series over the same number of months from another start. */
  compare: { from: string; to: string; words: string; /** Months from the window's start to this range's. */ offset: number; offQuery: string } | null;
  /** Whether each drawn Series' highest and lowest value is marked. */
  extremes: boolean;
  snapshot: SnapshotRow[];
  relationships: Relationships;
  /**
   * Every value the chart's table holds, one run per table, with the Series' own value beside
   * the value as drawn: what an export of this view carries (lib/export).
   */
  runs: ViewRun[];
};

export type ViewRun = {
  /** The table's key: the Series' key, or that of its run over the second range. */
  key: string;
  series: string;
  name: string;
  run: "window" | "comparison";
  unit: string;
  /** The unit of the value as drawn. */
  shownUnit: string;
  freq: CatalogEntry["freq"];
  source: string;
  rows: { period: string; period_start: string; period_end: string; value: number | null; shown: number | null; status: string }[];
};

/** v1's opening view, used when an address names no Series and the Release has these. */
const DEFAULT_VIEW = { series: ["spx", "unrate", "wti", "cpi_yoy"], mode: "z" as TransformName };

/** v1's eleven presets (web/app.js). A `to` of null runs to the latest value, as v1's `lastM` did. */
const PRESETS: { name: string; series: string[]; mode: TransformName; from: string; to: string | null; cmp?: string }[] = [
  { name: "COVID shock", series: ["spx", "unrate", "wti", "umcsent", "m2"], mode: "rebase", from: "2019-06", to: "2022-06" },
  { name: "Financial crisis 2008", series: ["spx", "caseshiller", "unrate", "fedfunds", "vix"], mode: "rebase", from: "2006-01", to: "2012-12" },
  { name: "Inflation surge 2021–24", series: ["cpi_yoy", "fedfunds", "gas", "wages_yoy", "umcsent"], mode: "lin", from: "2020-01", to: null },
  { name: "Oil, gas & the pump", series: ["wti", "brent", "gas", "natgas"], mode: "lin", from: "2000-01", to: null },
  { name: "Housing", series: ["caseshiller", "mortgage", "houst", "medhome"], mode: "rebase", from: "2000-01", to: null },
  { name: "US vs Europe jobs", series: ["unrate", "ez_unemp", "de_unemp", "uk_unemp", "jp_unemp"], mode: "lin", from: "2000-01", to: null },
  { name: "World stock markets", series: ["spx", "dax", "nikkei", "shanghai", "sensex", "ftse"], mode: "rebase", from: "2000-01", to: null },
  { name: "Politics & sentiment", series: ["approval", "umcsent", "usepu", "spx"], mode: "z", from: "2000-01", to: null },
  { name: "Rates & yield curve", series: ["fedfunds", "gs2", "gs10", "t10y2y", "mortgage"], mode: "lin", from: "2000-01", to: null },
  { name: "2026 oil shock", series: ["wti", "gas", "cpi_yoy", "spx", "vix"], mode: "z", from: "2025-06", to: null },
  { name: "2008 vs 2020", series: ["spx", "unrate", "wti"], mode: "rebase", from: "2007-10", to: "2010-10", cmp: "2020-01" },
];

export const MODE_LABELS: Record<TransformName, string> = {
  lin: "Values as published",
  log: "Values on a logarithmic scale",
  rebase: "Index: start of the window = 100",
  z: "Standard deviations from the window mean",
  pc1: "Percent change from a year earlier",
  drawdown: "Percent below the running peak",
};

/** The unit of what is drawn, and how a drawn value is written in the readout. */
const DRAWN: Record<Exclude<TransformName, "lin" | "log">, { unit: string; suffix: string; decimals: number }> = {
  rebase: { unit: "index, first value in the window = 100", suffix: " index", decimals: 1 },
  z: { unit: "standard deviations from the mean of the window", suffix: " sd", decimals: 2 },
  pc1: { unit: "percent change from a year earlier", suffix: "% y/y", decimals: 1 },
  drawdown: { unit: "percent below the highest value so far in the window", suffix: "% from peak", decimals: 1 },
};

const EMPTY_WORDS: Record<string, string> = {
  no_year_earlier: "no value a year earlier",
  zero_year_earlier: "a value of zero a year earlier",
  not_positive: "a value that is not above zero, which has no logarithm",
  peak_not_positive: "a running peak that is not above zero",
};

const EVENT_LABELS: Record<string, string> = { political: "Political", financial: "Financial", geopolitical: "Geopolitical", health: "Health & disaster", policy: "Economic policy" };
const BAND_LABELS: Record<string, string> = {
  pres: "Presidential terms",
  house: "House control",
  senate: "Senate control",
  fed_chair: "Fed chair",
  treasury: "Treasury secretary",
  shutdowns: "Government shutdowns",
};
const PARTY: Record<string, string> = { D: "Democratic", R: "Republican" };
const sentence = (token: string): string => {
  const words = token.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const monthStart = (month: string): string => `${month}-01`;
function monthEnd(month: string): string {
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const last = new Date(Date.UTC(2000, m, 0));
  last.setUTCFullYear(y, m, 0);
  return `${month}-${String(last.getUTCDate()).padStart(2, "0")}`;
}
const monthIndex = (month: string): number => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthAt = (index: number): string => `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
/** A date moved by whole months, its day held to the length of the month it lands in. */
function shiftDate(date: string, months: number): string {
  const month = monthAt(monthIndex(date.slice(0, 7)) + months);
  const day = Math.min(Number(date.slice(8, 10)), Number(monthEnd(month).slice(8, 10)));
  return `${month}-${String(day).padStart(2, "0")}`;
}
const list = (items: string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** Known names first, in the order given; then whatever else a Release has, by name. */
function ordered(found: Iterable<string>, known: readonly string[]): string[] {
  const all = new Set(found);
  return [...known.filter((k) => all.has(k)), ...[...all].filter((k) => !known.includes(k)).sort()];
}

/** Where an Annotation starts on the time axis. */
function anchorDate(a: Annotation): string | null {
  if (a.anchor.type === "date") return a.anchor.date;
  if (a.anchor.type === "span") return a.anchor.start;
  return labelStart("monthly", a.anchor.period)?.period_start ?? null;
}
function anchorWords(a: Annotation): string {
  const monthly = a.attributes?.date_precision === "month";
  const day = (date: string) => (monthly ? stopWords(`${date.slice(0, 7)}-01`) : dayWords(date, "short"));
  if (a.anchor.type === "date") return day(a.anchor.date);
  if (a.anchor.type === "span") return a.anchor.end === null ? `${day(a.anchor.start)} on` : a.anchor.start.slice(0, monthly ? 7 : 10) === a.anchor.end.slice(0, monthly ? 7 : 10) ? day(a.anchor.start) : `${day(a.anchor.start)} to ${day(a.anchor.end)}`;
  const at = labelStart("monthly", a.anchor.period);
  return at ? periodWords(at.freq, at, "short") : a.anchor.period;
}
const layerToken = (a: Annotation): string | null =>
  a.kind === "recession" ? "rec" : a.kind === "policy" ? "pol" : a.kind === "event" ? (a.category ? `ev.${a.category}` : "ev") : a.kind === "governance" ? (a.category ? `gov.${a.category}` : "gov") : null;
const isBandToken = (token: string): boolean => token === "pol" || token === "gov" || token.startsWith("gov.");

export function explorerView(release: OpenedRelease, surface: Surface, state: ExplorerState): ExplorerView {
  const created = release.manifest.created;
  const madeOn = created.slice(0, 10);
  const entries = new Map(release.catalog.series.map((e) => [e.key, e]));
  const aliases = new Map(release.catalog.series.flatMap((e) => (e.aliases ?? []).map((alias) => [alias, e.key] as const)));
  const withheld = new Map(release.manifest.withheld.map((row) => [row.key, row.reason]));
  const notes = [...state.notes];

  // --- the selection: unknown keys go first, then the cap, as v1 did ---
  let asked = state.series;
  let mode: TransformName = state.mode ?? "lin";
  if (asked === null) {
    const defaults = DEFAULT_VIEW.series.filter((k) => entries.has(k));
    asked = defaults;
    if (defaults.length > 0 && state.mode === null) mode = DEFAULT_VIEW.mode;
  }
  const known: string[] = [];
  const unknown: string[] = [];
  for (const key of asked) {
    const resolved = entries.has(key) ? key : aliases.get(key);
    if (!resolved) unknown.push(key);
    else if (!known.includes(resolved)) known.push(resolved);
  }
  if (unknown.length > 0) notes.push(`This release has no series called ${list(unknown)}; ${unknown.length === 1 ? "it was" : "they were"} left out.`);
  const keys = known.slice(0, MAX_SERIES);
  if (known.length > MAX_SERIES) notes.push(`At most ${MAX_SERIES} series are shown at once; the first ${MAX_SERIES} of the ${known.length} asked for are shown.`);

  // --- values, through Query, one Series at a time, within one row cap for the page ---
  const window = { from: state.from ? monthStart(state.from) : undefined, to: state.to ? monthEnd(state.to) : undefined };
  let rowsLeft = MAX_ROWS;
  type Got = { entry: CatalogEntry; raw: TransformedObservation[]; drawn: TransformedObservation[] | null; failure: QueryFailure | null; reason: string | null };
  const got: Got[] = keys.map((key) => {
    const entry = entries.get(key)!;
    const ask = (transform: TransformName) => query(release, surface, { series: [key], transform, permission: "display", ...window }, { maxRows: rowsLeft });
    const lin = ask("lin");
    if (!lin.ok) return { entry, raw: [], drawn: null, failure: lin, reason: lin.code === "withheld" ? (withheld.get(key) ?? lin.message) : lin.message };
    rowsLeft -= lin.rows;
    const linResult = lin.series[0]!.result;
    const raw = linResult.ok ? linResult.observations : [];
    if (mode === "lin") return { entry, raw, drawn: raw, failure: null, reason: null };
    const answer = ask(mode);
    if (!answer.ok) return { entry, raw, drawn: null, failure: null, reason: answer.message };
    rowsLeft -= answer.rows;
    const result = answer.series[0]!.result;
    if (!result.ok) {
      const reason = result.reason === "not_offered" ? `This series does not offer “${MODE_LABELS[mode].toLowerCase()}”.` : `${sentence(result.message)}.`;
      return { entry, raw, drawn: null, failure: null, reason };
    }
    return { entry, raw, drawn: result.observations, failure: null, reason: null };
  });

  // --- the window as a time axis: what was asked, else everything the selected Series hold ---
  const withValues = got.filter((g) => g.raw.length > 0);
  const starts = withValues.flatMap((g) => g.raw.map((o) => o.period_start));
  let start: string | null = window.from ?? null;
  let end: string | null = window.to ?? null;
  if (starts.length > 0) {
    if (start === null) start = monthStart(starts.reduce((a, b) => (a < b ? a : b)).slice(0, 7));
    if (end === null) {
      let latest = starts.reduce((a, b) => (a > b ? a : b));
      // A held value still standing is drawn up to the day the Release was made.
      if (withValues.some((g) => g.entry.continuity === "held" && g.raw.at(-1)!.value !== null) && madeOn > latest) latest = madeOn;
      end = monthEnd(latest.slice(0, 7));
    }
  }
  if (start !== null && end !== null && start > end) end = monthEnd(start.slice(0, 7));
  const inWindow = (date: string) => start !== null && end !== null && date >= start && date <= end;

  // --- a second range: the same Series over the same number of months from another start ---
  type Run = { raw: TransformedObservation[]; drawn: TransformedObservation[] | null; reason: string | null };
  let compare: ExplorerView["compare"] = null;
  const second = new Map<string, Run>();
  if (state.cmp !== null && start !== null && end !== null) {
    const offset = monthIndex(state.cmp) - monthIndex(start.slice(0, 7));
    const span = monthIndex(end.slice(0, 7)) - monthIndex(start.slice(0, 7));
    if (offset === 0) notes.push("The range to compare with starts where the window starts, so there is nothing to compare.");
    else {
      const range = { from: monthStart(state.cmp), to: monthEnd(monthAt(monthIndex(state.cmp) + span)) };
      compare = { from: state.cmp, to: range.to.slice(0, 7), words: `${stopWords(range.from)} to ${stopWords(monthStart(range.to.slice(0, 7)))}`, offset, offQuery: "" };
      for (const g of got) {
        if (g.failure) continue;
        const ask = (transform: TransformName) => query(release, surface, { series: [g.entry.key], transform, permission: "display", ...range }, { maxRows: rowsLeft });
        const lin = ask("lin");
        if (!lin.ok) {
          second.set(g.entry.key, { raw: [], drawn: null, reason: lin.message });
          continue;
        }
        rowsLeft -= lin.rows;
        const linResult = lin.series[0]!.result;
        const raw = linResult.ok ? linResult.observations : [];
        if (mode === "lin") {
          second.set(g.entry.key, { raw, drawn: raw, reason: null });
          continue;
        }
        const answer = ask(mode);
        if (!answer.ok) second.set(g.entry.key, { raw, drawn: null, reason: answer.message });
        else {
          rowsLeft -= answer.rows;
          const result = answer.series[0]!.result;
          second.set(g.entry.key, result.ok ? { raw, drawn: result.observations, reason: null } : { raw, drawn: null, reason: result.reason === "not_offered" ? `This series does not offer “${MODE_LABELS[mode].toLowerCase()}”.` : `${sentence(result.message)}.` });
        }
      }
    }
  }

  // --- layers the Release's Annotations offer ---
  const annotations = release.annotations.annotations;
  const tokens = new Map<string, Annotation[]>();
  for (const a of annotations) {
    const token = layerToken(a);
    if (token) tokens.set(token, [...(tokens.get(token) ?? []), a]);
  }
  const eventTokens = ordered([...tokens.keys()].filter((t) => t === "ev" || t.startsWith("ev.")), V1_EVENT_CATEGORIES.map((c) => `ev.${c}`));
  const bandTokens = ordered([...tokens.keys()].filter(isBandToken), [...V1_BAND_SETS.map((s) => `gov.${s}`), "gov", "pol"]);
  const toggleTokens = [...(tokens.has("rec") ? ["rec"] : []), ...eventTokens];
  const saidLayers = state.layers?.filter((t) => tokens.has(t)) ?? null;
  const on = new Set(saidLayers ?? toggleTokens); // v1's defaults: recessions and every Event category, no bands
  const band = bandTokens.find((t) => on.has(t)) ?? null; // one set at a time
  const labelOf = (token: string): string =>
    token === "rec" ? "Recessions" : token === "pol" ? "Policy periods" : token === "ev" ? "Events" : token === "gov" ? "Terms of government" : token.startsWith("ev.") ? (EVENT_LABELS[token.slice(3)] ?? sentence(token.slice(3))) : (BAND_LABELS[token.slice(4)] ?? sentence(token.slice(4)));

  const overlaps = (a: Annotation): boolean => {
    if (a.anchor.type !== "span" || start === null || end === null) return false;
    return a.anchor.start <= end && (a.anchor.end === null || a.anchor.end >= start);
  };
  const bandAnnotations = band ? tokens.get(band)!.filter(overlaps) : [];
  const parties = [...new Set((band ? tokens.get(band)! : []).map((a) => a.attributes?.party).filter((p): p is string => typeof p === "string"))];
  const bandLabel = (a: Annotation): string => {
    const party = a.attributes?.party;
    return typeof party === "string" ? `${a.label} (${PARTY[party] ?? party})` : a.label;
  };
  const recessionAnnotations = on.has("rec") ? tokens.get("rec")!.filter(overlaps) : [];

  const allEvents = annotations.filter((a) => a.kind === "event");
  const chosenId = state.event ?? (state.hi !== null ? (allEvents[state.hi]?.id ?? null) : null);
  if (state.event !== null && !allEvents.some((a) => a.id === state.event)) notes.push("The event named in the address is not in this release.");
  const shownEvents = allEvents
    .map((a) => ({ a, date: anchorDate(a), token: layerToken(a)! }))
    .filter((e): e is { a: Annotation; date: string; token: string } => e.date !== null && on.has(e.token) && inWindow(e.date))
    .sort((x, y) => x.date.localeCompare(y.date));
  const chosen = shownEvents.find((e) => e.a.id === chosenId) ?? null;

  // --- the address, and every address the page links to ---
  const base: Omit<ExplorerState, "notes"> = {
    series: state.series,
    mode: state.mode,
    from: state.from,
    to: state.to,
    layers: state.layers,
    at: state.at,
    event: state.event,
    hi: state.hi,
    cmp: state.cmp,
    ext: state.ext,
    levels: state.levels,
    lag: state.lag,
    sx: state.sx,
    sy: state.sy,
    roll: state.roll,
    pick: false,
    table: state.table,
  };
  const queryWith: ExplorerView["queryWith"] = (change) => {
    const next = { ...base, ...change };
    if ("event" in change) next.hi = null; // choosing or letting go of an Event replaces v1's index
    return explorerQuery(next);
  };
  const explicitLayers = [...toggleTokens.filter((t) => on.has(t)), ...(band ? [band] : [])];
  const pinned = state.at !== null && inWindow(state.at) ? state.at : null;
  if (state.at !== null && pinned === null && starts.length > 0) notes.push("The pinned date in the address is outside the window, so the readout shows the latest date.");
  const resolved: Omit<ExplorerState, "notes"> = {
    series: keys,
    mode,
    from: start?.slice(0, 7) ?? state.from,
    to: end?.slice(0, 7) ?? state.to,
    layers: explicitLayers,
    at: pinned,
    event: chosenId !== null && allEvents.some((a) => a.id === chosenId) ? chosenId : null,
    hi: null,
    pick: false,
    table: state.table,
    cmp: compare?.from ?? null,
    ext: state.ext,
    levels: state.levels,
    lag: state.lag,
    sx: state.sx !== null && keys.includes(state.sx) ? state.sx : null,
    sy: state.sy !== null && keys.includes(state.sy) ? state.sy : null,
    roll: state.roll,
  };
  if (compare) compare.offQuery = queryWith({ cmp: null });

  // --- what is drawn ---
  const drawnGot = got.filter((g) => g.drawn !== null && g.raw.some((o) => o.value !== null) && g.drawn.some((o) => o.value !== null));
  for (const g of got) {
    if (g.drawn !== null && g.reason === null && !drawnGot.includes(g)) g.reason = g.raw.some((o) => o.value !== null) ? "Shown this way, this series has no value in the window." : "This series has no value in the window.";
  }
  const showsLatest = (key: string, raw: TransformedObservation[]): boolean => {
    const latest = latestValue(release, surface, key);
    return latest.ok && latest.latest !== null && [...raw].reverse().find((o) => o.value !== null)?.period === latest.latest.period;
  };
  const runs: ViewRun[] = [];
  const unitOf = (e: CatalogEntry): string => (mode === "lin" ? e.unit : mode === "log" ? `${e.unit}, on a logarithmic scale` : DRAWN[mode].unit);
  const shownFor = (e: CatalogEntry, run: Run, over: { key: string; name: string; which: "window" | "comparison" }): ShownSeries => {
    const unit = unitOf(e);
    // A Period the mode has no answer for is not a gap in the data: it is noted, not marked Missing.
    const counts = new Map<string, number>();
    const observations = run.drawn!.map((o) => {
      if (o.value !== null || !o.empty || o.empty === "missing") return o;
      counts.set(o.empty, (counts.get(o.empty) ?? 0) + 1);
      return { ...o, status: NO_ANSWER };
    });
    for (const [why, n] of counts) notes.push(`${over.name}: ${n} ${n === 1 ? "period has" : "periods have"} nothing to draw when shown this way (${EMPTY_WORDS[why] ?? why}).`);
    const own = new Map(run.raw.map((o) => [o.period, o.value]));
    runs.push({
      key: over.key,
      series: e.key,
      name: over.name,
      run: over.which,
      unit: e.unit,
      shownUnit: mode === "log" ? `natural logarithm of ${e.unit}` : unit,
      freq: e.freq,
      source: sourceWords(e),
      rows: run.drawn!.map((o) => ({ period: o.period, period_start: o.period_start, period_end: o.period_end, value: own.get(o.period) ?? null, shown: o.value, status: o.status })),
    });
    return {
      key: over.key,
      name: over.name,
      unit,
      tableUnit: mode === "log" ? `natural logarithm of ${e.unit}` : undefined,
      scale: mode === "log" ? ("ln" as const) : undefined,
      unitKind: e.unit_kind,
      measureKind: e.measure_kind,
      freq: e.freq,
      continuity: e.continuity,
      representation: e.representation,
      seasonalAdjustment: mode === "lin" || mode === "log" ? e.seasonal_adjustment : undefined,
      priceBasis: mode === "lin" || mode === "log" ? e.price_basis : undefined,
      country: e.country,
      // Stale is said of a Series' latest value: only where the window still shows that value.
      maxLag: over.which === "window" && showsLatest(e.key, run.raw) ? e.max_lag : undefined,
      breaks: e.breaks,
      source: sourceWords(e),
      observations,
    };
  };
  /** The highest and lowest value as drawn (the first of equals, as v1), each named with the Series' own value. */
  const extremesOf = (e: CatalogEntry, run: Run): ShownSeries["extremes"] => {
    const valued = run.drawn!.filter((o): o is TransformedObservation & { value: number } => o.value !== null);
    if (valued.length === 0) return [];
    let [low, high] = [valued[0]!, valued[0]!];
    for (const o of valued) {
      if (o.value < low.value) low = o;
      if (o.value > high.value) high = o;
    }
    const own = new Map(run.raw.map((o) => [o.period, o.value]));
    const decimals = Math.max(0, ...run.raw.map((o) => (o.value === null ? 0 : readingDecimals(o.value))));
    const label = (kind: "max" | "min", o: TransformedObservation) => {
      const value = own.get(o.period);
      return { period: o.period, kind, label: `${kind} ${value === null || value === undefined ? "" : `${fixed(value, decimals).replace(/^-/, "−")} · `}${periodWords(e.freq, o, "short")}` };
    };
    return high === low ? [label("max", high)] : [label("max", high), label("min", low)];
  };
  const shown: ShownSeries[] = drawnGot.map((g) => {
    const s = shownFor(g.entry, { raw: g.raw, drawn: g.drawn, reason: null }, { key: g.entry.key, name: g.entry.name, which: "window" });
    return state.ext ? { ...s, extremes: extremesOf(g.entry, { raw: g.raw, drawn: g.drawn, reason: null }) } : s;
  });
  // The second range's runs: each laid over the window, so that both start at the left edge.
  const ghostKey = (key: string): string => `${key}.compared`;
  const comparedUntil = compare && end !== null ? (shiftDate(madeOn, -compare.offset) < end ? shiftDate(madeOn, -compare.offset) : end) : null;
  if (compare) {
    for (const g of drawnGot) {
      const run = second.get(g.entry.key);
      if (!run || run.drawn === null) continue;
      if (!run.drawn.some((o) => o.value !== null)) {
        run.reason = "This series has no value in the range compared with.";
        run.drawn = null;
        continue;
      }
      const s = shownFor(g.entry, run, { key: ghostKey(g.entry.key), name: `${g.entry.name}, from ${stopWords(monthStart(compare.from))}`, which: "comparison" });
      shown.push({
        ...s,
        ghost: { of: g.entry.key, standsUntil: comparedUntil ?? undefined },
        observations: s.observations.map((o) => ({ ...o, at: shiftDate(o.period_start, -compare!.offset) })),
      });
    }
  }

  const parts = new Map(parties.map((p, i) => [p, i % 2 === 0 ? ("a" as const) : ("b" as const)]));
  const layers: Layers = {
    bands: bandAnnotations.map((a, i) => {
      const span = a.anchor as { start: string; end: string | null };
      const party = a.attributes?.party;
      return { start: span.start, end: span.end, label: bandLabel(a), tint: typeof party === "string" ? parts.get(party)! : i % 2 === 0 ? "a" : "b" };
    }),
    recessions: recessionAnnotations.map((a) => a.anchor as { start: string; end: string | null }),
    events: shownEvents.map((e) => ({ id: e.a.id, date: e.date })),
    highlight: chosen ? { id: chosen.a.id, date: chosen.date, label: chosen.a.label } : null,
  };
  // With two ranges on one axis a date on it is true of the first only, so no Layer is drawn (as v1).
  if (compare && (layers.bands.length > 0 || layers.recessions.length > 0 || layers.events.length > 0)) {
    notes.push("Layers are not drawn while two ranges are compared: a date on the axis belongs to the first range only.");
  }
  const figure =
    shown.length > 0 && start !== null && end !== null
      ? renderFigure({ created, takeaway: false, endLabels: false, domain: { from: start, to: end }, layers: compare ? undefined : layers, pin: pinned ?? undefined }, shown)
      : null;
  const styles = new Map((figure?.plots ?? []).flatMap((p) => p.series.map((s) => [s.key, { color: s.color, dash: s.dash, symbol: s.symbol }] as const)));

  const selection: Selected[] = got.map((g) => {
    const key = g.entry.key;
    const state_ = g.failure ? (g.failure.code === "withheld" ? "withheld" : "not_permitted") : styles.has(key) ? "drawn" : "not_drawn";
    return {
      key,
      name: g.entry.name,
      unit: g.entry.unit,
      state: state_,
      reason: state_ === "drawn" ? null : g.reason,
      style: styles.get(key) ?? null,
      compared: compare && !g.failure ? { drawn: styles.has(ghostKey(key)), reason: styles.has(ghostKey(key)) ? null : (second.get(key)?.reason ?? (styles.has(key) ? "This series has no value in the range compared with." : null)) } : null,
      removeQuery: queryWith({ series: keys.filter((k) => k !== key) }),
    };
  });

  // --- the readout ---
  // A value standing since before the window opened can be read where the window opens.
  const ghosts = compare ? got.filter((g) => styles.has(ghostKey(g.entry.key))) : [];
  const laid = (date: string): string => shiftDate(date, -(compare?.offset ?? 0));
  const stops =
    start === null
      ? []
      : [...new Set([...withValues.flatMap((g) => g.raw.map((o) => o.period_start)), ...ghosts.flatMap((g) => second.get(g.entry.key)!.raw.map((o) => laid(o.period_start)))].map((d) => (d < start! ? start! : d)))].filter(inWindow).sort();
  const readoutSeries: ReadoutSeries[] = got.map((g, i): ReadoutSeries => {
    const s = selection[i]!;
    const values = g.raw.map((o) => o.value).filter((v): v is number => v !== null);
    const drawnBy = new Map((g.drawn ?? []).map((o) => [o.period, o.value]));
    const kept = s.state === "withheld" || s.state === "not_permitted";
    return {
      key: s.key,
      name: s.name,
      unit: s.unit,
      freq: g.entry.freq,
      continuity: g.entry.continuity,
      style: s.style,
      decimals: Math.max(0, ...values.map(readingDecimals)),
      rows: g.raw.map((o) => [o.period, o.period_start, o.period_end, o.value, drawnBy.get(o.period) ?? null]),
      absent: kept ? `${s.state === "withheld" ? "Withheld" : "Not shown here"}: ${s.reason}` : null,
    };
  });
  for (const g of ghosts) {
    const run = second.get(g.entry.key)!;
    const drawnBy = new Map((run.drawn ?? []).map((o) => [o.period, o.value]));
    const values = run.raw.map((o) => o.value).filter((v): v is number => v !== null);
    const at = readoutSeries.findIndex((r) => r.key === g.entry.key);
    readoutSeries.splice(at + 1, 0, {
      key: ghostKey(g.entry.key),
      name: `${g.entry.name}, from ${stopWords(monthStart(compare!.from))}`,
      unit: g.entry.unit,
      freq: g.entry.freq,
      continuity: g.entry.continuity,
      style: { ...styles.get(ghostKey(g.entry.key))!, ghost: true },
      decimals: Math.max(0, ...values.map(readingDecimals)),
      // Laid over the window; each row keeps its own first day, which is what the readout names.
      rows: run.raw.map((o) => [o.period, laid(o.period_start), laid(o.period_end), o.value, drawnBy.get(o.period) ?? null, o.period_start]),
      until: comparedUntil ?? undefined,
      absent: null,
    });
  }
  const readout: ReadoutModel = {
    mode,
    drawn: mode === "lin" || mode === "log" ? null : { suffix: DRAWN[mode].suffix, decimals: DRAWN[mode].decimals },
    stops,
    until: madeOn,
    series: readoutSeries,
  };

  // --- lists ---
  const events: EventRow[] = shownEvents.map((e) => ({
    id: e.a.id,
    date: e.date,
    when: anchorWords(e.a),
    category: labelOf(e.token),
    label: e.a.label,
    url: e.a.source && /^https:\/\//.test(e.a.source.url) ? e.a.source.url : null,
    chosen: e.a.id === chosenId,
    query: queryWith({ event: e.a.id === chosenId ? null : e.a.id }),
  }));

  const selectedEntries = keys.map((k) => entries.get(k)!);
  const offers = (e: CatalogEntry, m: TransformName) => !e.allowed_transforms || e.allowed_transforms.length === 0 || e.allowed_transforms.includes(m);
  const modes = MODES.map((value) => ({ value, label: MODE_LABELS[value], current: value === mode, offered: selectedEntries.filter((e) => offers(e, value)).length }));

  const presets = PRESETS.filter((p) => p.series.some((k) => entries.has(k))).map((p) => ({
    name: p.name,
    // v1's presets changed the Series, the mode and the range, and left the layers as they were.
    query: explorerQuery({
      series: p.series.filter((k) => entries.has(k)),
      mode: p.mode,
      from: p.from,
      to: p.to,
      layers: state.layers,
      at: null,
      event: null,
      hi: null,
      // The second range is the preset's own (or none); the rest was left as it was, as in v1.
      cmp: p.cmp ?? null,
      ext: state.ext,
      levels: state.levels,
      lag: state.lag,
      sx: state.sx,
      sy: state.sy,
      roll: state.roll,
      pick: false,
      table: false,
    }),
  }));

  const mayShow = (e: CatalogEntry): boolean =>
    permits([{ origin: e.source.origin.producer, dataset: e.source.origin.dataset, channel: e.source.channel.via, representation: e.representation, permission: "display" }], surface).allowed;
  const picker = Object.entries(SEGMENTS)
    .map(([segment, label]) => ({
      label,
      series: release.catalog.series
        .filter((e) => e.segment === segment)
        .map((e): PickerRow => {
          const kept = withheld.has(e.key) ? "Withheld" : !mayShow(e) ? "Not shown here" : null;
          const cadence = e.freq === "monthly" ? "" : ` · ${(FREQUENCIES[e.freq] ?? e.freq).toLowerCase()}`;
          return { key: e.key, name: e.name, detail: kept ?? `${e.unit}${cadence}`, checked: keys.includes(e.key), available: kept === null };
        }),
    }))
    .filter((group) => group.series.length > 0);

  // --- the snapshot table and the relationships: from each Series' own values, whatever the mode ---
  const latestWords = (e: CatalogEntry): string | null => {
    const latest = latestValue(release, surface, e.key);
    return latest.ok && latest.latest ? periodWords(e.freq, { period: latest.latest.period, period_start: labelStart(e.freq, latest.latest.period)?.period_start ?? latest.latest.period_end }, "short") : null;
  };
  const snapshot = snapshotRows(
    got.map((g, i) => ({
      key: g.entry.key,
      name: g.entry.name,
      unit: g.entry.unit,
      unitKind: g.entry.unit_kind,
      freq: g.entry.freq,
      source: sourceWords(g.entry),
      observations: g.failure ? null : g.raw,
      latest: g.failure ? null : latestWords(g.entry),
      absent: g.failure ? `${selection[i]!.state === "withheld" ? "Withheld" : "Not shown here"}: ${g.reason}` : null,
    })),
  );
  // A change at the window's first Period looks back before the window, so the whole Series is asked for.
  const whole: RelationshipInput[] = got.map((g) => {
    if (g.failure) return { entry: g.entry, observations: null, reason: g.reason };
    if (got.length < 2 || start === null || end === null) return { entry: g.entry, observations: [], reason: null };
    const all = query(release, surface, { series: [g.entry.key], transform: "lin", permission: "display" }, { maxRows: rowsLeft });
    if (!all.ok) return { entry: g.entry, observations: null, reason: all.message };
    rowsLeft -= all.rows;
    const result = all.series[0]!.result;
    return result.ok ? { entry: g.entry, observations: result.observations, reason: null } : { entry: g.entry, observations: null, reason: `${sentence(result.message)}.` };
  });
  const windowWords = start !== null && end !== null ? `${stopWords(monthStart(start.slice(0, 7)))} to ${stopWords(monthStart(end.slice(0, 7)))}` : "";
  const relationships = relationshipsFor(whole, { from: start ?? "0001-01-01", to: end ?? "9999-12-31", words: windowWords }, state, queryWith);

  const span = (a: Annotation) => ({ label: isBandToken(layerToken(a) ?? "") ? bandLabel(a) : a.label, when: anchorWords(a) });

  return {
    mode,
    modes,
    selection,
    notes,
    window: {
      from: state.from,
      to: state.to,
      start,
      end,
      words: windowWords === "" ? null : windowWords,
    },
    figure,
    readout,
    pinned,
    shownAt: pinned ?? stops.at(-1) ?? null,
    layers: {
      toggles: toggleTokens.map((token) => ({ token, label: labelOf(token), on: on.has(token), count: tokens.get(token)!.length })),
      bands: [{ token: "", label: "None", on: band === null }, ...bandTokens.map((token) => ({ token, label: labelOf(token), on: token === band }))],
    },
    bands: bandAnnotations.map(span),
    recessions: recessionAnnotations.map(span),
    events,
    presets,
    picker,
    query: explorerQuery(base),
    resolvedQuery: explorerQuery(resolved),
    resolved,
    queryWith,
    compare,
    extremes: state.ext,
    snapshot,
    relationships,
    runs,
  };
}
