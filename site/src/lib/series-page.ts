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
import { staleness, type Surface } from "@macro-atlas/core";
import type { CatalogEntry } from "@macro-atlas/core/release";
import { FREQUENCIES, RIGHTS, SEGMENTS, VIAS } from "./catalog";
import { renderFigure, STATE_INFO, type Figure, type MarkName, type ShownSeries } from "./figure";
import { stateOfStatus } from "./figure/states";
import { dayWords, periodWords, together } from "./figure/words";
import { formatDay } from "./freshness";
import { query } from "./query";
import type { OpenedRelease } from "./release/reader";

export type Fact = { label: string; value: string; /** An address to link the value to. */ href?: string; /** A glossary entry for the label. */ term?: string };

export type SeriesPageView = {
  key: string;
  name: string;
  description: string | null;
  facts: Fact[];
  state: "shown" | "withheld" | "not_permitted";
  /** Why there are no values, when there are none. */
  reason: string | null;
  latest: {
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
  /** Without the base path. */
  explorerPath: string;
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

function retrieved(release: OpenedRelease, entry: CatalogEntry): { line: string; fact: Fact } | null {
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

export function seriesPageView(release: OpenedRelease, surface: Surface, key: string): SeriesPageAnswer {
  if (typeof key !== "string") return { kind: "not_found" };
  const entry = release.catalog.series.find((e) => e.key === key);
  if (!entry) {
    const aliased = release.catalog.series.find((e) => e.aliases?.includes(key));
    return aliased ? { kind: "moved", key: aliased.key } : { kind: "not_found" };
  }
  if (!KEY.test(key)) return { kind: "not_found" };

  const base = {
    key: entry.key,
    name: entry.name,
    description: entry.description ?? null,
    facts: facts(entry),
    provenance: provenance(release, entry),
    explorerPath: `/explore?s=${entry.key}`,
  };
  const created = release.manifest.created;

  const answer = query(release, surface, { series: [key], transform: "lin", permission: "display" });
  if (!answer.ok) {
    const withheld = release.manifest.withheld.find((row) => row.key === key);
    const state = answer.code === "withheld" ? "withheld" : "not_permitted";
    const reason = withheld?.reason ?? answer.message;
    return {
      kind: "page",
      view: {
        ...base,
        state,
        reason,
        latest: null,
        figure: renderFigure({ created }, [{ key: entry.key, name: entry.name, heldBack: state, reason }]),
        notes: notes(release, entry, (period) => period),
      },
    };
  }

  const result = answer.series[0]!.result;
  const observations = result.ok ? result.observations : [];
  const shown: ShownSeries = {
    key: entry.key,
    name: entry.name,
    unit: entry.unit,
    unitKind: entry.unit_kind,
    measureKind: entry.measure_kind,
    freq: entry.freq,
    continuity: entry.continuity,
    representation: entry.representation,
    seasonalAdjustment: entry.seasonal_adjustment,
    priceBasis: entry.price_basis,
    country: entry.country,
    maxLag: entry.max_lag,
    breaks: entry.breaks,
    source: sourceWords(entry),
    observations,
  };
  const figure = renderFigure({ created, retrieved: retrieved(release, entry)?.line ?? null }, [shown]);

  const last = observations.at(-1);
  const valued = [...observations].reverse().find((o) => o.value !== null);
  let latest: SeriesPageView["latest"] = null;
  if (valued && valued.value !== null) {
    const states: { mark: MarkName; word: string }[] = [];
    const state = stateOfStatus(valued.status);
    if (state) states.push({ mark: state, word: STATE_INFO[state].word });
    const age = staleness(valued.period_end, entry.max_lag, created);
    if (age.known && age.stale) states.push({ mark: "stale", word: STATE_INFO.stale.word });
    latest = {
      value: together([valued.value])[0]!,
      unit: entry.unit,
      period: periodWords(entry.freq, valued),
      states,
      newerGap: last && last !== valued ? `The latest period, ${periodWords(entry.freq, last)}, has no value.` : null,
    };
  }
  const byPeriod = new Map(observations.map((o) => [o.period, o]));
  const labelOf = (period: string) => {
    const o = byPeriod.get(period);
    return o ? periodWords(entry.freq, o, "short") : period;
  };
  return { kind: "page", view: { ...base, state: "shown", reason: null, latest, figure, notes: notes(release, entry, labelOf) } };
}
