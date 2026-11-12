/**
 * Topic pages as views of a Release (PLAN section 3, M23; ADR 0037).
 *
 * A Topic is the Release's own `content/topics.json`: labels, a definition quoted from a cited
 * source, and the names of Series and Events an editor chose. This module turns one into what
 * its page shows, and writes no sentence of its own beyond fixed labels and templates that
 * state figures. Nothing here explains a movement or says one thing moved another.
 *
 * Every value reaches the page through Query, asked for display on the Surface in hand: the
 * main Series, each Companion, the Series set against a range and every member of that range,
 * one by one. A Series the rights gate refuses, or the Release does not hold, is a name and a
 * reason. A refused member is not handed to the engine at all, so nothing computed from it (a
 * lowest value, a median, a count, the reach of an axis) can appear: the range is made from
 * the members that were shown and from nothing else.
 *
 * Hidden here: the window every figure of the page shares (the ten years to the main Series'
 * latest Period, so all of them sit on one time axis), which members can be compared with the
 * range's own Series, when a range is stated at all, the words of each relation, and the
 * addresses. The arithmetic of the range is the engine's (`rangeAcross`,
 * `docs/method/topics.md`). Node only (it takes an opened Release); pure otherwise.
 */
import { rangeAcross, type RangeAcross, type RightsGate, type Surface } from "@macro-atlas/core";
import type { CatalogEntry, Topic } from "@macro-atlas/core/release";
import { SEGMENTS } from "./catalog";
import { eventWhen } from "./event-words";
import { renderFigure, type Figure, type FigureObservation, type ShownSeries } from "./figure";
import { NO_ANSWER } from "./figure/plot";
import { dayWords, fixed, FREQ_NOUN, periodWords, readingDecimals } from "./figure/words";
import { headlineFor, type HeadlineRow } from "./highlights";
import { query } from "./query";
import type { OpenedRelease } from "./release/reader";
import { sourceWords } from "./series-page";

type Gate = Pick<RightsGate, "permits">;
export type TopicOptions = {
  /** See `QueryOptions.gate`: only a test passes one. */
  gate?: Gate;
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isTopicSlug = (slug: string): boolean => typeof slug === "string" && slug.length <= 40 && SLUG.test(slug);

/** The years every figure of a Topic page spans: the longest change of Highlights. */
export const TOPIC_YEARS = 10;

/**
 * How a Companion is related to the main Series, in words: one fixed label per relation of the
 * contract's closed list. Each states where a Series comes from or what it is made of; none
 * says that one moved the other.
 */
export const RELATION_WORDS: Record<Topic["companions"][number]["relation"], string> = {
  component: "Measures a part of what the main series measures",
  excludes_components: "Measures what the main series measures, with some parts left out",
  input: "The main series is computed from it",
  same_survey: "From the same survey as the main series",
  same_release: "Published by the same agency in the same release as the main series",
};

/** Whether a Series can be shown here, and why not. */
export type SeriesState = "shown" | "withheld" | "not_permitted" | "no_answer" | "not_in_release";
export type SeriesRef = {
  key: string;
  /** The Series' name; its key when the Release does not hold it. */
  name: string;
  /** The Series' own page, without the base path; null when the Release does not hold it. */
  href: string | null;
  state: SeriesState;
  /** Said in place of values: the reason it is held back, or that it is not in this Release. */
  note: string | null;
};

export type TopicCitation = { name: string; url: string; archive: string | null; /** Why there is no archived copy. */ noArchive: string | null };

export type TopicIndexView = {
  topics: { slug: string; title: string; href: string; segment: string; quote: string; source: string; draft: boolean; main: SeriesRef }[];
};

export type RangeMemberView = SeriesRef & { country: string; /** Counted in the range in at least one Period of the window. */ counted: boolean };
export type RangeRow = { period: string; label: string; n: number; minimum: string | null; median: string | null; maximum: string | null };
export type RangeView = {
  /** "Fixture five": what the group is called. */
  label: string;
  /** "Inflation (y/y)": the indicator, as the coverage matrix names it. */
  indicator: string;
  /** The Series set against the range. */
  series: SeriesRef;
  /** Every declared member, in the matrix's order. */
  members: RangeMemberView[];
  /** How many members the group was declared with: the denominator. */
  of: number;
  /** How many of them this page can show and compare. */
  shown: number;
  /** The fewest members a Period's range is stated for. */
  least: number;
  /** Null when no range is drawn, and `reason` says why. */
  figure: Figure | null;
  reason: string | null;
  /** A sentence that states the latest figures, or null. */
  sentence: string | null;
  /** What the band is, in template sentences. */
  caption: string[];
  /** Each Period of the window: how many members were counted, and the three figures as read. */
  rows: RangeRow[];
  /** The Series set against the range, in the Explorer at this window; without the base path. */
  explorer: string | null;
};

export type TopicPageView = {
  slug: string;
  title: string;
  draft: boolean;
  segment: { label: string; href: string };
  definition: { quote: string; source: TopicCitation };
  /** The main Series' change strip: a row of Highlights. */
  main: HeadlineRow | (SeriesRef & { state: "not_in_release" });
  /** The window every figure shares, in words; null when the main Series cannot be shown. */
  window: string | null;
  /** The main Series' explained figure over the window; null when it cannot be shown. */
  figure: Figure | null;
  explorer: string | null;
  companions: {
    items: (SeriesRef & { relation: string })[];
    /** The main Series and each Companion that can be shown, each in a plot of its own on one time axis. */
    figure: Figure | null;
    explorer: string | null;
  };
  range: RangeView | null;
  claims: { id: string; href: string; title: string; quote: string; draft: boolean }[];
  events: { id: string; href: string; title: string; when: string; draft: boolean }[];
  series: SeriesRef[];
};

const https = (url: string | undefined): string | null => (url !== undefined && /^https:\/\//.test(url) ? url : null);
const sentence = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;

type Asked = { ref: SeriesRef; entry: CatalogEntry | null; shown: ShownSeries | null };

/** One Series, asked through Query for display here: what a figure may draw, or the reason there is nothing. */
function ask(release: OpenedRelease, surface: Surface, key: string, options: TopicOptions): Asked {
  const entry = release.catalog.series.find((e) => e.key === key) ?? null;
  if (!entry) return { ref: { key, name: key, href: null, state: "not_in_release", note: "Not in this release." }, entry, shown: null };
  const named = { key, name: entry.name, href: `/data/${key}` };
  const answer = query(release, surface, { series: [key], transform: "lin", permission: "display" }, { gate: options.gate });
  if (!answer.ok) {
    if (answer.status !== 403) return { ref: { ...named, state: "no_answer", note: sentence(answer.message) }, entry, shown: null };
    const withheld = release.manifest.withheld.find((row) => row.key === key);
    const state = answer.code === "withheld" ? "withheld" : "not_permitted";
    return { ref: { ...named, state, note: `${state === "withheld" ? "Withheld" : "Not shown here"}: ${withheld?.reason ?? sentence(answer.message)}` }, entry, shown: null };
  }
  const series = answer.series[0]!;
  if (!series.result.ok) return { ref: { ...named, state: "no_answer", note: sentence(series.result.message) }, entry, shown: null };
  return {
    ref: { ...named, state: "shown", note: null },
    entry,
    shown: {
      key,
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
    },
  };
}

type Window = { from: string; to: string };

/** The ten years to a Series' latest value: from the same day of the year, ten years earlier. */
function windowOf(series: ShownSeries): Window | null {
  const latest = [...series.observations].reverse().find((o) => o.value !== null);
  if (!latest) return null;
  const from = `${String(Number(latest.period_start.slice(0, 4)) - TOPIC_YEARS).padStart(4, "0")}${latest.period_start.slice(4)}`;
  return { from, to: latest.period_end };
}

/** A Series cut to the window: the Observations whose Periods touch it. */
const within = (series: ShownSeries, window: Window): ShownSeries => ({
  ...series,
  observations: series.observations.filter((o) => o.period_end >= window.from && o.period_start <= window.to),
});

const explorerHref = (keys: readonly string[], window: Window): string => `/explore?s=${keys.join(",")}&from=${window.from.slice(0, 7)}&to=${window.to.slice(0, 7)}`;


function rangeView(release: OpenedRelease, surface: Surface, topic: Topic, options: TopicOptions): RangeView | null {
  const declared = topic.range;
  if (!declared) return null;
  const of = declared.members.length;
  // The contract holds a range to three members or more; fewer is no range, never a failure of the page.
  if (of < 3) return null;
  const own = ask(release, surface, declared.series, options);
  const base = { label: declared.label, indicator: declared.indicator.name, series: own.ref, of };
  const asked = declared.members.map((member) => ({ member, ...(member.key === declared.series ? own : ask(release, surface, member.key, options)) }));
  const none = (reason: string, members: RangeMemberView[], shown: number): RangeView => ({
    ...base, members, shown, least: Math.floor(of / 2) + 1, figure: null, reason, sentence: null, caption: [], rows: [], explorer: null,
  });
  const plain = (): RangeMemberView[] => asked.map(({ member, ref }) => ({ ...ref, country: member.country, counted: false }));

  // The Series set against the range is asked first and on its own: without it there is
  // nothing to set the range against, and no other Series stands in for it.
  if (!own.shown) return none(`${own.ref.name} cannot be shown here, so no range is drawn beside it. ${own.ref.note ?? ""}`.trim(), plain(), asked.filter((a) => a.shown).length);
  const window = windowOf(own.shown);
  if (!window) return none(`${own.ref.name} has no value in this release.`, plain(), asked.filter((a) => a.shown).length);

  // Only what can be compared with it: the same frequency and the same unit. Only what was
  // shown: a refused member never reaches the engine.
  const comparable = asked.map((a) => {
    if (!a.shown) return { ...a, used: null };
    if (a.shown.freq !== own.shown!.freq || a.shown.unit !== own.shown!.unit) {
      return { ...a, used: null, ref: { ...a.ref, note: `Not counted: its ${a.shown.freq !== own.shown!.freq ? "frequency" : "unit"} is not that of ${own.ref.name}.` } };
    }
    return { ...a, used: within(a.shown, window) };
  });
  const used = comparable.filter((a): a is typeof a & { used: ShownSeries } => a.used !== null);
  const answer: RangeAcross = rangeAcross(used.map((a) => ({ key: a.member.key, observations: a.used.observations })), { of });
  const counted = new Set(answer.periods.filter((p) => p.median !== null).flatMap((p) => p.members));
  const members: RangeMemberView[] = comparable.map((a) => ({ ...a.ref, country: a.member.country, counted: counted.has(a.member.key) }));
  if (used.length < answer.least) {
    return none(`No range is drawn: this page can show ${used.length} of the ${of} ${declared.label} members, and a range is stated only for at least ${answer.least}.`, members, used.length);
  }

  const ownSeries = within(own.shown, window);
  const freq = ownSeries.freq;
  const sources = [...new Set(used.map((a) => a.used.source))];
  const edge = (name: "minimum" | "median" | "maximum", word: string): ShownSeries => ({
    key: `${topic.slug}_range_${name}`,
    name: `${declared.label} ${word}`,
    unit: ownSeries.unit,
    unitKind: ownSeries.unitKind,
    freq,
    continuity: "discrete",
    representation: "native",
    source: `Computed by Macro Atlas from ${used.length} series (${sources.join("; ")})`,
    // A Period with no range is not a missing value of anything: there is no answer for it.
    observations: answer.periods.map((p): FigureObservation => ({ period: p.period, period_start: p.period_start, period_end: p.period_end, value: p[name], status: p[name] === null ? NO_ANSWER : "final" })),
  });
  const [low, middle, high] = [edge("minimum", "lowest"), edge("median", "median"), edge("maximum", "highest")];
  const figure = renderFigure(
    { created: release.manifest.created, takeaway: false, domain: window, endLabels: false, band: { low: low.key, high: high.key, label: `${declared.label}: lowest to highest` } },
    [ownSeries, middle, low, high],
  );

  // Every figure of the range is read with the same number of decimals: what the values of
  // the window need, as a Takeaway reads the Series' own.
  const stated = [...ownSeries.observations.map((o) => o.value), ...answer.periods.flatMap((p) => [p.minimum, p.median, p.maximum])].filter((v): v is number => v !== null);
  const decimals = Math.max(0, ...stated.map(readingDecimals));
  const read = (value: number): string => fixed(value, decimals);

  // The latest Period that has both a range and a published value of the Series itself.
  const ownBy = new Map(ownSeries.observations.map((o) => [o.period, o]));
  const NOT_STATED = new Set(["estimate", "projected", "partial"]);
  const latest = [...answer.periods].reverse().find((p) => p.median !== null && ownBy.get(p.period)?.value != null && !NOT_STATED.has(ownBy.get(p.period)!.status));
  const isMember = declared.members.some((m) => m.key === declared.series);
  const lineFor = latest
    ? `In ${periodWords(freq, latest)}, ${own.ref.name} was ${read(ownBy.get(latest.period)!.value!)}. Among ${latest.n} of the ${of} ${declared.label} members the lowest value was ${read(latest.minimum!)}, the median ${read(latest.median!)} and the highest ${read(latest.maximum!)} (${ownSeries.unit}).`
    : null;
  const caption = [
    `The band runs from the lowest to the highest value of ${declared.indicator.name} among the ${declared.label} members that can be shown here: ${used.length} of ${of}.`,
    `The median is unweighted: each member counts once. A ${FREQ_NOUN[freq]} has a range when at least ${answer.least} members have a published value in it; estimates, projections and partial periods are not counted.`,
    "Which members are counted changes from period to period, so the band can move when no member's value has. The table says how many were counted in each.",
    ...(isMember ? [`${own.ref.name} is one of the members.`] : []),
  ];
  const rows = answer.periods.map((p): RangeRow => ({
    period: p.period,
    label: periodWords(freq, p, "short"),
    n: p.n,
    minimum: p.minimum === null ? null : read(p.minimum),
    median: p.median === null ? null : read(p.median),
    maximum: p.maximum === null ? null : read(p.maximum),
  }));
  return { ...base, members, shown: used.length, least: answer.least, figure, reason: null, sentence: lineFor, caption, rows, explorer: explorerHref([declared.series], window) };
}

/** Why a citation has no archived copy: fixed words for each reason of the contract's closed list. */
export const NO_ARCHIVE_WORDS: Record<NonNullable<Topic["definition"]["source"]["no_archive"]>, string> = {
  no_copy_found: "The Internet Archive holds no copy of this address.",
  archiving_refused: "The publisher does not allow its pages to be archived.",
  page_removed: "The page is no longer at this address and no copy was kept.",
};

const citation = (source: Topic["definition"]["source"]): TopicCitation => ({
  name: source.name,
  url: https(source.url) ?? "",
  archive: https(source.archive_url),
  noArchive: source.archive_url === undefined ? (source.no_archive ? NO_ARCHIVE_WORDS[source.no_archive] : "None is recorded.") : null,
});

export function topicsIndexView(release: OpenedRelease, surface: Surface, options: TopicOptions = {}): TopicIndexView {
  return {
    topics: release.topics.topics.map((topic) => ({
      slug: topic.slug,
      title: topic.title,
      href: `/topics/${topic.slug}`,
      segment: SEGMENTS[topic.segment] ?? topic.segment,
      quote: topic.definition.quote,
      source: topic.definition.source.name,
      draft: topic.status === "draft",
      main: ask(release, surface, topic.main, options).ref,
    })),
  };
}

/** The Topics a page links to by name: the Overview, and the bar's own test of whether there are any. */
export function topicLinks(release: Pick<OpenedRelease, "topics">): { slug: string; title: string; href: string }[] {
  return release.topics.topics.map((topic) => ({ slug: topic.slug, title: topic.title, href: `/topics/${topic.slug}` }));
}

export function topicPageView(release: OpenedRelease, surface: Surface, slug: string, options: TopicOptions = {}): TopicPageView | null {
  if (!isTopicSlug(slug)) return null;
  const topic = release.topics.topics.find((t) => t.slug === slug);
  if (!topic) return null;
  const created = release.manifest.created;

  const main = ask(release, surface, topic.main, options);
  const window = main.shown ? windowOf(main.shown) : null;
  const mainShown = main.shown && window ? within(main.shown, window) : null;
  const strip: TopicPageView["main"] = main.entry ? headlineFor(release, surface, main.entry, options) : { ...main.ref, state: "not_in_release" };

  // What else moved: the main Series and each Companion that can be shown, each in a plot of
  // its own, all over the main Series' window. With no main Series there is no axis to share.
  const companions = topic.companions.map((companion) => ({ companion, ...ask(release, surface, companion.series, options) }));
  const drawn = window ? companions.filter((c) => c.shown).map((c) => within(c.shown!, window)).filter((s) => s.observations.some((o) => o.value !== null)) : [];
  const multiples =
    mainShown && window && drawn.length > 0
      ? renderFigure({ created, takeaway: false, endLabels: false, domain: window, separate: true, compact: true }, [mainShown, ...drawn])
      : null;

  const events = new Map(release.events.events.map((event) => [event.id, event]));
  return {
    slug: topic.slug,
    title: topic.title,
    draft: topic.status === "draft",
    segment: { label: SEGMENTS[topic.segment] ?? topic.segment, href: `/data?segment=${topic.segment}` },
    definition: { quote: topic.definition.quote, source: citation(topic.definition.source) },
    main: strip,
    window: window ? `${dayWords(window.from, "short")} to ${dayWords(window.to, "short")}` : null,
    figure: mainShown && window ? renderFigure({ created, domain: window }, [mainShown]) : null,
    explorer: window ? explorerHref([topic.main], window) : null,
    companions: {
      items: companions.map((c) => ({ ...c.ref, relation: RELATION_WORDS[c.companion.relation] })),
      figure: multiples,
      explorer: multiples && window ? explorerHref([topic.main, ...drawn.map((s) => s.key)].slice(0, 8), window) : null,
    },
    range: rangeView(release, surface, topic, options),
    claims: release.claims.claims
      .filter((claim) => (claim.topics ?? []).includes(topic.slug))
      .map((claim) => ({ id: claim.id, href: `/claims/${claim.id}`, title: `${claim.claimant.name}, ${dayWords(claim.said_on)}`, quote: claim.quote, draft: claim.status === "draft" })),
    // The contract holds every id to the Release's own Events; one that is not there is not listed.
    events: topic.events.flatMap((id) => {
      const event = events.get(id);
      return event ? [{ id, href: `/events/${id}`, title: event.title, when: eventWhen(event, "long"), draft: event.status === "draft" }] : [];
    }),
    series: topic.series.map((key) => (key === topic.main ? main.ref : ask(release, surface, key, options).ref)),
  };
}
