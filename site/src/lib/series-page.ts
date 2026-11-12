/**
 * The series page's view of a Release (PLAN section 3, `/data/{key}`): name, definition, latest
 * value, the explained figure, provenance, and breaks and notes, for one Series.
 *
 * `seriesPageView(release, surface, key)` is pure apart from the Release it is given. Values
 * come only through Query, so the rights gate decides whether there are any: a Series that is
 * Withheld, or not permitted on this Surface, still has its page, with its name, its definition,
 * the reason, and no value anywhere in the view. What the Catalog does not record is said to be
 * not recorded; nothing is defaulted.
 */
import { staleness, type RightsGate, type Surface, type VintageBasis } from "@macro-atlas/core";
import type { CatalogEntry } from "@macro-atlas/core/release";
import { FREQUENCIES, RIGHTS, SEGMENTS, VIAS } from "./catalog";
import { citation } from "./citation";
import { NO_ANSWER, renderFigure, STATE_INFO, type Figure, type MarkName, type ShownSeries } from "./figure";
import { stateOfStatus } from "./figure/states";
import { dayWords, periodWords, together } from "./figure/words";
import { formatDay } from "./freshness";
import { askGate, query, vintageTable, type Version } from "./query";
import type { OpenedRelease } from "./release/reader";
import { parseSeriesRequest, SERIES_PARAMS, toQuery, type SeriesRequest } from "./series-request";
import { asOfLines, asOfWords, BASIS_INFO, shownAs, shownUnit, unavailableWords } from "./series-words";

export type Fact = { label: string; value: string; /** An address to link the value to. */ href?: string; /** A glossary entry for the label. */ term?: string };

export type SeriesPageView = {
  key: string;
  name: string;
  description: string | null;
  facts: Fact[];
  /**
   * `unavailable`: an as-of question this Release cannot answer. `no_answer`: the address asks
   * for something that cannot be given (a parameter that is not one, a Transform the Series does
   * not offer). In every state but `shown` the view holds no value of the Series.
   */
  state: "shown" | "withheld" | "not_permitted" | "unavailable" | "no_answer";
  /** Why there are no values, when there are none. */
  reason: string | null;
  /** What the address asked of the Series, beyond the Series as it is. */
  request: {
    /** The question as an address carries it, in a fixed order; "" for the Series as it is. */
    search: string;
    /** In words, when the values are re-expressed, combined or windowed. */
    shownAs: string | null;
    /** The parameters to carry in the as-of form, so asking a date keeps the rest of the question. */
    carried: { name: string; value: string }[];
    asOf: string | null;
  };
  /** What an as-of answer rests on; null when the address did not ask. */
  asOf: { date: string; words: string; basis: VintageBasis; word: string; slug: string; meaning: string; lines: string[] } | null;
  latest: {
    /** "Latest value", or "Latest value known then". */
    label: string;
    value: string;
    unit: string;
    period: string;
    states: { mark: MarkName; word: string }[];
    /** Said when a later Period exists with no value, so the latest value is not taken for the latest Period. */
    newerGap: string | null;
  } | null;
  figure: Figure;
  provenance: {
    origin: Fact[];
    channel: Fact[];
    rights: Fact[];
    release: Fact[];
    lineage: { text: string; inputs: { key: string; name: string }[] } | null;
  };
  notes: { period: string; kind: "Break" | "Data note"; text: string }[];
  /** Every version the Release holds of the Periods that changed; null where no history is shown. */
  revisions: Revisions | null;
  downloads: Downloads;
  /** Without the base path. */
  explorerPath: string;
};

export type RevisionRow = {
  period: string;
  /** The value as held, unrounded; null for a withdrawn Period or a gap. */
  value: string | null;
  status: string;
  withdrawn: boolean;
  /** The Origin's clock: when it published this version, in words; null when the Origin did not date it. */
  published: string | null;
  /** Macro Atlas's clock. `held` is null for a version taken from the Origin's record and never held as current. */
  held: { from: string; until: string | null } | null;
  current: boolean;
};
export type Revisions =
  | { held: false; text: string }
  | { held: true; lines: string[]; rows: RevisionRow[]; /** Earlier versions not listed; `?revisions=all` lists them, up to 5,000. */ more: number; /** Whether the address asked for all of them. */ all: boolean; /** Of all of them: which page of 5,000 this is, newest first, and how many there are. */ page: number; pages: number };

export type Downloads = {
  /** Whether the values may be handed out here (the Permission to redistribute). */
  permitted: boolean;
  reason: string | null;
  /** Without the base path. The metadata twin holds no values and is always offered. */
  twins: { label: string; path: string }[];
  metadata: { label: string; path: string };
  citation: string;
  /** How to fetch the same values again; null when they may not be handed out or the address is not known. */
  reproduce: { label: string; code: string }[] | null;
};

export type SeriesPageAnswer = { kind: "not_found" } | { kind: "moved"; key: string } | { kind: "page"; view: SeriesPageView };

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const LEGACY = "legacy_monthly_rounded";
const NOT_RECORDED = "Not recorded";

const STANDS: Record<CatalogEntry["continuity"], string> = {
  discrete: "Each value describes its own period",
  held: "Each value stands until the next one",
};
const MEASURES: Record<CatalogEntry["measure_kind"], string> = {
  stock: "A level at a point in time",
  flow: "A total over the period",
  rate: "A rate or share",
  index: "An index",
  annualized: "An annual rate",
};
const COMBINES: Record<NonNullable<CatalogEntry["agg"]>, string> = {
  mean: "The mean of the finer periods",
  last: "The last value of the finer periods",
  sum: "The sum of the finer periods",
  none: "Not combined",
};
const ADJUSTMENT: Record<string, string> = {
  sa: "Seasonally adjusted",
  nsa: "Not seasonally adjusted",
  saar: "Seasonally adjusted annual rate",
  not_applicable: "Does not apply",
};
const PRICES: Record<string, string> = { nominal: "Nominal (not adjusted for prices)", real: "Real (adjusted for prices)", not_applicable: "Does not apply" };

/** The source in one phrase for a figure's source line: the Origin, then the Channel. */
export function sourceWords(entry: CatalogEntry): string {
  const { origin, channel } = entry.source;
  const recorded = !/^not recorded/i.test(origin.producer);
  const id = origin.origin_id && origin.origin_id !== origin.dataset ? origin.origin_id : null;
  const what = recorded
    ? [origin.producer, id ?? origin.dataset].join(", ")
    : `origin not recorded by v1 (${[origin.dataset, origin.origin_id].filter(Boolean).join(" ")})`;
  if (channel.via === "direct") return `${what}, obtained directly`;
  if (channel.via === "hand_entered") return `${what}, entered by hand`;
  if (channel.via === "computed") return `${what}, computed by v1`;
  return `${what}, via ${VIAS[channel.via] ?? channel.via}`;
}

export function retrieved(release: OpenedRelease, entry: CatalogEntry): { line: string; fact: Fact } | null {
  const { origin, channel } = entry.source;
  const source = release.manifest.sources?.find((s) => s.producer === origin.producer && s.via === channel.via);
  if (source?.fetched) return { line: `retrieved ${formatDay(source.fetched)}`, fact: { label: "Retrieved", value: formatDay(source.fetched) } };
  if (entry.representation === LEGACY) {
    const built = release.manifest.inputs?.find((input) => input.generated)?.generated;
    if (built) return { line: `v1 built its file on ${formatDay(built)}`, fact: { label: "v1 built its file on", value: formatDay(built) } };
  }
  return null;
}

function facts(entry: CatalogEntry): Fact[] {
  const out: Fact[] = [
    { label: "Unit", value: entry.unit, term: "unit" },
    { label: "Frequency", value: FREQUENCIES[entry.freq] ?? entry.freq, term: "frequency" },
    { label: "How values stand", value: STANDS[entry.continuity], term: entry.continuity === "held" ? "held-series" : undefined },
    { label: "Measures", value: MEASURES[entry.measure_kind] },
    { label: "Seasonal adjustment", value: entry.seasonal_adjustment ? (ADJUSTMENT[entry.seasonal_adjustment] ?? entry.seasonal_adjustment) : NOT_RECORDED },
    { label: "Prices", value: entry.price_basis ? (PRICES[entry.price_basis] ?? entry.price_basis) : NOT_RECORDED },
  ];
  const add = (label: string, value: string | undefined) => {
    if (value) out.push({ label, value });
  };
  add("Base period", entry.base_period);
  add("Population", entry.definition?.population);
  add("Geography", entry.definition?.geography);
  add("Denominator", entry.definition?.denominator);
  add("Country", entry.country);
  add("Brought to a coarser period as", entry.agg ? COMBINES[entry.agg] : undefined);
  out.push({ label: "Segment", value: SEGMENTS[entry.segment] ?? entry.segment });
  return out;
}

function lineage(release: OpenedRelease, entry: CatalogEntry): SeriesPageView["provenance"]["lineage"] {
  const recipe = entry.recipe;
  if (!recipe) return null;
  const names = new Map(release.catalog.series.map((e) => [e.key, e.name]));
  const what =
    recipe.op === "pct_change"
      ? `the percent change of one series from ${recipe.params.lag} periods earlier`
      : recipe.op === "ratio"
        ? "the first series below divided by the second"
        : recipe.op === "difference"
          ? "the first series below minus the second"
          : recipe.op === "sum"
            ? "the sum of the series below"
            : "the product of the series below";
  const text =
    entry.representation === LEGACY
      ? `Computed by v1 (${what}). The values here are the ones v1 stored; Macro Atlas has not recomputed them.`
      : `Computed by Macro Atlas: ${what}.`;
  return { text, inputs: recipe.inputs.map((key) => ({ key, name: names.get(key) ?? key })) };
}

function provenance(release: OpenedRelease, entry: CatalogEntry): SeriesPageView["provenance"] {
  const { origin, channel } = entry.source;
  const originFacts: Fact[] = [
    { label: "Produced by", value: origin.producer },
    { label: "Dataset", value: origin.dataset },
  ];
  if (origin.origin_id) originFacts.push({ label: "Identifier", value: origin.origin_id });
  if (origin.url) originFacts.push({ label: "Address", value: origin.url, href: /^https:\/\//.test(origin.url) ? origin.url : undefined });

  const channelFacts: Fact[] = [{ label: "Obtained", value: VIAS[channel.via] ?? channel.via }];
  if (channel.adapter) channelFacts.push({ label: "Adapter", value: channel.adapter });
  if (channel.endpoint) channelFacts.push({ label: "Endpoint", value: channel.endpoint });

  const { rights } = entry;
  const rightsFacts: Fact[] = [
    { label: "Status", value: RIGHTS[rights.status] ?? rights.status },
    { label: "Owner", value: rights.owner },
    { label: "Terms read", value: rights.reviewed ? dayWords(rights.reviewed) : "Not yet read" },
  ];
  if (rights.terms_url) rightsFacts.push({ label: "Terms", value: rights.terms_url, href: /^https:\/\//.test(rights.terms_url) ? rights.terms_url : undefined });
  if (rights.attribution) rightsFacts.push({ label: "Attribution", value: rights.attribution });

  const releaseFacts: Fact[] = [
    { label: "Release", value: release.id },
    { label: "Made on", value: formatDay(release.manifest.created) },
    {
      label: "Values held as",
      value:
        entry.representation === LEGACY
          ? "v1's rounded output, carried over as it is (already rounded by v1: two decimal places for percentages, three otherwise)"
          : "Unrounded, at the series' own frequency",
      term: entry.representation === LEGACY ? "legacy-representation" : undefined,
    },
  ];
  const when = retrieved(release, entry);
  if (when) releaseFacts.push(when.fact);

  return { origin: originFacts, channel: channelFacts, rights: rightsFacts, release: releaseFacts, lineage: lineage(release, entry) };
}

function notes(release: OpenedRelease, entry: CatalogEntry, labelOf: (period: string) => string): SeriesPageView["notes"] {
  const out: SeriesPageView["notes"] = (entry.breaks ?? []).map((b) => ({ period: labelOf(b.period), kind: "Break", text: b.note }));
  for (const a of release.annotations.annotations) {
    if (a.kind !== "data_note" || !a.series?.includes(entry.key)) continue;
    const period = a.anchor.type === "period" ? labelOf(a.anchor.period) : a.anchor.type === "date" ? dayWords(a.anchor.date, "short") : `${dayWords(a.anchor.start, "short")} on`;
    out.push({ period, kind: "Data note", text: a.label });
  }
  return out;
}

const instantWords = (instant: string): string => `${dayWords(instant.slice(0, 10), "short")}, ${instant.slice(11, 16)} UTC`;
/** Versions listed at first, and when the address asks for all of them (`?revisions=all`). */
const REVISION_ROWS = 48;
const ALL_REVISION_ROWS = 5_000;

function revisionRow(freq: CatalogEntry["freq"], v: Version): RevisionRow {
  const neverHeld = v.held_to !== null && v.held_to === v.held_from;
  return {
    period: periodWords(freq, v, "short"),
    value: v.value === null ? null : String(v.value),
    status: v.withdrawn ? "withdrawn" : (v.status ?? "missing"),
    withdrawn: v.withdrawn,
    published: v.published === null ? null : v.published_precision === "date" ? dayWords(v.published, "short") : instantWords(v.published),
    held: neverHeld ? null : { from: instantWords(v.held_from), until: v.held_to === null ? null : instantWords(v.held_to) },
    current: v.current,
  };
}

function revisions(release: OpenedRelease, surface: Surface, entry: CatalogEntry, gate: Pick<RightsGate, "permits"> | undefined, all: boolean, rows: number = REVISION_ROWS, page = 1): Revisions | null {
  const table = vintageTable(release, surface, entry.key, { gate });
  // What the gate refuses of a Series' past is said in one line; today's values are not affected.
  if (!table.ok) {
    return { held: false, text: table.status === 403 ? `The earlier versions of this series are not shown here: ${table.message}.` : `The earlier versions of this series cannot be listed here (${table.message}).` };
  }
  if (!table.held) {
    const built = release.manifest.inputs?.find((input) => input.generated)?.generated;
    const text =
      table.why === "derived"
        ? "This series is computed from other series. Each of those keeps its own history; ask what this one said before a date with the form above."
        : table.why === "legacy"
          ? `These are v1's values: one state${built ? `, generated on ${formatDay(built)}` : ""}, with no earlier versions.`
          : "This release holds no earlier versions of this series, only its values as they are now.";
    return { held: false, text };
  }
  const lines: string[] = [];
  const { captures } = table;
  if (captures.count > 0 && captures.first && captures.last) {
    lines.push(`Macro Atlas fetched this series ${captures.count} ${captures.count === 1 ? "time" : "times"}, from ${instantWords(captures.first)} to ${instantWords(captures.last)}.`);
    if (captures.missed_count > 0) {
      const named = captures.missed_days.slice(0, 6).map((d) => dayWords(d, "short"));
      const rest = captures.missed_count - named.length;
      lines.push(`Days in between with no Capture: ${named.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}.`);
    }
  }
  if (table.provider_coverage) {
    lines.push(`The origin's own record of its releases is held from ${dayWords(table.provider_coverage.from.slice(0, 10), "short")} to ${dayWords(table.provider_coverage.to.slice(0, 10), "short")}.`);
  }
  for (const change of table.metadata_changes.slice(1)) lines.push(`The unit, definition or source recorded for this series changed on ${instantWords(change.recorded_from)}; the unit recorded from then: ${change.unit}.`);
  const changed = new Set(table.revised_periods);
  const listed = table.versions.filter((v) => changed.has(v.period));
  if (listed.length === 0) lines.push("No period has changed since Macro Atlas first held it.");
  if (all) {
    // Every version, newest page first, in pages of a fixed size so that none is out of reach.
    const pages = Math.max(1, Math.ceil(listed.length / ALL_REVISION_ROWS));
    const at = Math.min(Math.max(1, page), pages);
    const end = listed.length - (at - 1) * ALL_REVISION_ROWS;
    const shown = listed.slice(Math.max(0, end - ALL_REVISION_ROWS), end);
    return { held: true, lines, rows: shown.map((v) => revisionRow(table.freq, v)), more: Math.max(0, end - ALL_REVISION_ROWS), all, page: at, pages };
  }
  // The latest versions, and never part of one Period's history: a cut falls between Periods
  // (unless one Period's history is longer than the list, which is then cut where it must be).
  const cut = Math.max(0, listed.length - rows);
  let from = cut;
  while (from > 0 && from < listed.length && listed[from]!.period === listed[from - 1]!.period) from++;
  if (from >= listed.length) from = cut;
  const shown = listed.slice(from);
  return { held: true, lines, rows: shown.map((v) => revisionRow(table.freq, v)), more: listed.length - shown.length, all, page: 1, pages: 1 };
}

function downloads(release: OpenedRelease, surface: Surface, entry: CatalogEntry, request: SeriesRequest | null, search: string, address: string, gate: Pick<RightsGate, "permits"> | undefined): Downloads {
  const asked = askGate(release, surface, [entry.key], "redistribute", { history: request?.as_of !== undefined, gate });
  const tail = search ? `?${search}` : "";
  const path = (suffix: string, carry = true) => `/data/${entry.key}.${suffix}${carry ? tail : ""}`;
  const cite = citation(release, entry, `${address}/data/${entry.key}`, request?.as_of);
  const csv = `${address}${path("csv")}`;
  return {
    permitted: asked.ok,
    reason: asked.ok ? null : asked.message,
    twins: asked.ok
      ? [
          { label: "CSV", path: path("csv") },
          { label: "JSON", path: path("json") },
          { label: "Markdown", path: path("md") },
        ]
      : [],
    metadata: { label: "Metadata (JSON)", path: path("metadata.json", false) },
    citation: cite,
    reproduce:
      asked.ok && address
        ? [
            { label: "Shell", code: `curl -sL '${csv}'` },
            { label: "Python", code: `import pandas as pd\ndf = pd.read_csv("${csv}", comment="#")` },
          ]
        : null,
  };
}

export type SeriesPageOptions = {
  /** The address's query, as asked. */
  search?: URLSearchParams;
  /** The site's own address with its base path and no trailing slash, as a reader would write it; "" when not known. */
  address?: string;
  /** See `QueryOptions.gate`: only a test passes one. */
  gate?: Pick<RightsGate, "permits">;
  /** How many versions the revisions table lists at first (48). */
  revisionRows?: number;
};

export function seriesPageView(release: OpenedRelease, surface: Surface, key: string, options: SeriesPageOptions = {}): SeriesPageAnswer {
  if (typeof key !== "string") return { kind: "not_found" };
  const entry = release.catalog.series.find((e) => e.key === key);
  if (!entry) {
    const aliased = release.catalog.series.find((e) => e.aliases?.includes(key));
    return aliased ? { kind: "moved", key: aliased.key } : { kind: "not_found" };
  }
  if (!KEY.test(key)) return { kind: "not_found" };

  const { gate } = options;
  const address = options.address ?? "";
  const parsed = parseSeriesRequest(options.search ?? new URLSearchParams(), false);
  const request = parsed.ok ? parsed.request : null;
  const search = parsed.ok ? parsed.search : "";
  const plain = search === "";
  const created = release.manifest.created;
  const base = {
    key: entry.key,
    name: entry.name,
    description: entry.description ?? null,
    facts: facts(entry),
    provenance: provenance(release, entry),
    explorerPath: `/explore?s=${entry.key}`,
    downloads: downloads(release, surface, entry, request, search, address, gate),
  };
  const asked = {
    search,
    shownAs: null as string | null,
    carried: request ? SERIES_PARAMS.filter((name) => name !== "as_of" && request[name] !== undefined && !(name === "transform" && request.transform === "lin")).map((name) => ({ name, value: request[name]! })) : [],
    asOf: request?.as_of ?? null,
  };
  /** A page with no value of the Series anywhere in it. */
  const empty = (state: Exclude<SeriesPageView["state"], "shown">, reason: string, more: Partial<SeriesPageView> = {}): SeriesPageAnswer => ({
    kind: "page",
    view: {
      ...base,
      state,
      reason,
      request: asked,
      asOf: null,
      latest: null,
      figure: renderFigure({ created }, state === "withheld" || state === "not_permitted" ? [{ key: entry.key, name: entry.name, heldBack: state, reason }] : []),
      notes: notes(release, entry, (period) => period),
      revisions: null,
      ...more,
    },
  });
  if (!parsed.ok) return empty("no_answer", `This address asks for something that cannot be given (${parsed.message}).`);

  const answer = query(release, surface, toQuery(parsed.request, key, "display"), { gate });
  if (!answer.ok) {
    if (answer.status !== 403) return empty("no_answer", `${answer.message.charAt(0).toUpperCase()}${answer.message.slice(1)}.`);
    const withheld = release.manifest.withheld.find((row) => row.key === key);
    return empty(answer.code === "withheld" ? "withheld" : "not_permitted", withheld?.reason ?? answer.message);
  }

  const series = answer.series[0]!;
  const { vintage, result } = series;
  asked.shownAs = shownAs(parsed.request, series);
  const asOf: SeriesPageView["asOf"] = vintage
    ? { date: vintage.as_of, words: asOfWords(vintage.as_of), basis: vintage.basis, ...BASIS_INFO[vintage.basis], lines: asOfLines(vintage).slice(1) }
    : null;
  if (vintage?.basis === "unavailable") {
    // Never filled with today's figures: no value, no figure, and no list of later versions.
    return empty("unavailable", `Nothing here says what this series showed before ${asOfWords(vintage.as_of)}: ${unavailableWords(vintage.reason)}.`, { asOf });
  }
  if (!result.ok) {
    const message = result.reason === "not_offered" ? `This series does not offer that transform (${result.message})` : `${result.message.charAt(0).toUpperCase()}${result.message.slice(1)}`;
    return empty("no_answer", `${message}.`, { asOf });
  }

  const freq = series.answered_freq;
  // A Period a Transform has nothing to say about is drawn as no answer, not as a missing value.
  const observations = result.observations.map((o) => (o.value === null && o.empty && o.empty !== "missing" ? { ...o, status: NO_ANSWER } : o));
  const unit = shownUnit(parsed.request.transform, series.unit);
  const log = parsed.request.transform === "log";
  const shown: ShownSeries = {
    key: entry.key,
    name: entry.name,
    unit: log ? series.unit : unit,
    unitKind: plain ? entry.unit_kind : undefined,
    measureKind: plain ? entry.measure_kind : undefined,
    freq,
    continuity: entry.continuity,
    representation: entry.representation,
    seasonalAdjustment: entry.seasonal_adjustment,
    priceBasis: entry.price_basis,
    country: entry.country,
    // Staleness is judged against the Release's own day; it says nothing of what was known earlier.
    maxLag: vintage ? undefined : entry.max_lag,
    breaks: entry.breaks,
    ...(log ? { scale: "ln" as const, tableUnit: unit } : {}),
    source: sourceWords(entry),
    observations,
  };
  // A Takeaway states the Series' own latest figure; a re-expressed or earlier view gets none.
  const figure = renderFigure({ created, retrieved: vintage ? null : (retrieved(release, entry)?.line ?? null), takeaway: plain }, [shown]);

  const last = observations.at(-1);
  const valued = [...observations].reverse().find((o) => o.value !== null);
  let latest: SeriesPageView["latest"] = null;
  if (valued && valued.value !== null) {
    const states: { mark: MarkName; word: string }[] = [];
    const state = stateOfStatus(valued.status);
    if (state) states.push({ mark: state, word: STATE_INFO[state].word });
    const age = vintage ? { known: false as const } : staleness(valued.period_end, entry.max_lag, created);
    if (age.known && age.stale) states.push({ mark: "stale", word: STATE_INFO.stale.word });
    latest = {
      label: vintage ? "Latest value known then" : parsed.request.end ? "Last value in the window" : "Latest value",
      value: together([valued.value])[0]!,
      unit,
      period: periodWords(freq, valued),
      states,
      newerGap: last && last !== valued ? `The latest period, ${periodWords(freq, last)}, has no value.` : null,
    };
  }
  const byPeriod = new Map(observations.map((o) => [o.period, o]));
  const labelOf = (period: string) => {
    const o = byPeriod.get(period);
    return o ? periodWords(freq, o, "short") : period;
  };
  return {
    kind: "page",
    view: {
      ...base,
      state: "shown",
      reason: null,
      request: asked,
      asOf,
      latest,
      figure,
      notes: notes(release, entry, labelOf),
      // Under an as-of question the list of every version, later ones included, is left to the plain page.
      revisions: vintage ? null : revisions(release, surface, entry, gate, options.search?.get("revisions") === "all", options.revisionRows, Number.parseInt(options.search?.get("revisions_page") ?? "1", 10) || 1),
    },
  };
}
