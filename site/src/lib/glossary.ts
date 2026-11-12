/**
 * The glossary: the words Macro Atlas's pages use, each defined once (M3). It defines the site's
 * own vocabulary only (the wording follows /CONTEXT.md); it does not explain economics, and a
 * definition never evaluates. A Data state's entry carries its mark, so the mark and the word
 * are learned together.
 */
import { BASES } from "@macro-atlas/core";
import { MARK_NAMES, STATE_INFO, type MarkName } from "./figure";
import { BASIS_INFO } from "./series-words";

export const GLOSSARY_GROUPS = ["Data states", "Where a number comes from", "What was known when", "Reading a series", "The site"] as const;
export type GlossaryGroup = (typeof GLOSSARY_GROUPS)[number];

export type GlossaryEntry = {
  slug: string;
  term: string;
  group: GlossaryGroup;
  definition: string;
  mark?: MarkName;
  /** Slugs of related entries. */
  see?: string[];
};

const STATE_SLUG: Record<MarkName, string> = {
  preliminary: "preliminary",
  revised: "revised",
  estimate: "estimate",
  projected: "projected",
  partial: "partial-period",
  stale: "stale",
  missing: "missing",
  break: "break",
  withheld: "withheld",
  suppressed: "suppressed",
};
const STATE_SEE: Partial<Record<MarkName, string[]>> = {
  preliminary: ["revised"],
  revised: ["preliminary"],
  estimate: ["projected"],
  projected: ["estimate"],
  partial: ["period", "takeaway"],
  stale: ["release", "takeaway"],
  missing: ["suppressed"],
  suppressed: ["missing", "withheld"],
  break: ["takeaway"],
  withheld: ["rights", "not-shown-here"],
};

const states: GlossaryEntry[] = MARK_NAMES.map((name) => ({
  slug: STATE_SLUG[name],
  term: STATE_INFO[name].word,
  group: "Data states",
  mark: name,
  definition: `${STATE_INFO[name].meaning} Its mark is a ${STATE_INFO[name].shape}, always shown with the word.`,
  see: STATE_SEE[name],
}));

/** The five kinds of evidence behind an as-of answer; each is always a mark and a word. */
const bases: GlossaryEntry[] = BASES.map((basis) => ({
  slug: BASIS_INFO[basis].slug,
  term: BASIS_INFO[basis].word,
  group: "What was known when",
  definition: BASIS_INFO[basis].meaning,
  see: ["basis", "as-of"],
}));

export const GLOSSARY: readonly GlossaryEntry[] = [
  ...states,
  {
    slug: "as-of",
    term: "As of",
    group: "What was known when",
    definition:
      "A question put to a series: what did it say before a given date? The answer is the values that were public before 00:00 in New York on that date, with the basis they rest on. Where nothing says, the answer is unavailable and no value stands in for it.",
    see: ["basis", "vintage", "capture"],
  },
  {
    slug: "basis",
    term: "Basis",
    group: "What was known when",
    definition:
      "The kind of evidence behind an as-of answer: a provider vintage, Atlas-observed, legacy, uncertain or unavailable. An answer built from several periods or several series states the weakest among them.",
    see: ["provider-vintage", "atlas-observed", "uncertain", "unavailable"],
  },
  {
    slug: "vintage",
    term: "Vintage",
    group: "What was known when",
    definition: "The state of knowledge about a whole series at one moment: which value was current for each period then.",
    see: ["revision", "as-of"],
  },
  {
    slug: "revision",
    term: "Revision",
    group: "What was known when",
    definition: "A change to the value, status or definition of a period that had already been published. A series page lists every version Macro Atlas holds of each period that changed.",
    see: ["vintage", "revised"],
  },
  {
    slug: "capture",
    term: "Capture",
    group: "What was known when",
    definition:
      "One successful fetch of a source's exact bytes, kept as evidence whether or not anything had changed. A day with no capture is a day on which a figure could have changed unseen.",
    see: ["atlas-observed", "uncertain"],
  },
  {
    slug: "twin",
    term: "Twin",
    group: "The site",
    definition: "The data behind a page, at the page's own address with a suffix added: .csv, .json, .metadata.json or .md. A twin answers the same question as its page, from the same release.",
    see: ["release", "rights"],
  },
  ...bases,
  {
    slug: "not-shown-here",
    term: "Not shown here",
    group: "Data states",
    mark: undefined,
    definition:
      "The series is in the catalog, but this copy of the site may not show its values. The page names the series and gives the reason, and holds no value.",
    see: ["withheld", "rights"],
  },
  {
    slug: "source",
    term: "Source",
    group: "Where a number comes from",
    definition: "Where a series comes from. It always has two parts that are never merged: an origin and a channel.",
    see: ["origin", "channel"],
  },
  {
    slug: "origin",
    term: "Origin",
    group: "Where a number comes from",
    definition: "The organisation that produces a series, with the dataset and identifier it publishes it under.",
    see: ["channel", "source"],
  },
  {
    slug: "channel",
    term: "Channel",
    group: "Where a number comes from",
    definition:
      "The route by which Macro Atlas obtained a value: directly from the origin, or through an intermediary. A channel has terms of its own, separate from the origin's.",
    see: ["origin", "rights"],
  },
  {
    slug: "provenance",
    term: "Provenance",
    group: "Where a number comes from",
    definition: "The full answer to where a number came from: origin, channel, address, the time it was obtained, the release it is in, and any processing applied.",
    see: ["origin", "channel", "release"],
  },
  {
    slug: "rights",
    term: "Rights",
    group: "Where a number comes from",
    definition:
      "What the origin's and the channel's terms allow Macro Atlas to do with a series, recorded as a status with the terms that were read and the date they were read. Not settled means the terms have not been read.",
    see: ["withheld", "channel"],
  },
  {
    slug: "legacy-representation",
    term: "v1's rounded output",
    group: "Where a number comes from",
    definition:
      "Values carried over unchanged from the first version of Macro Atlas. They were already rounded there (two decimal places for percentages, three otherwise), and daily and weekly series were already reduced to one value a month. They are shown on a local build only and are never mixed with unrounded values in one series.",
    see: ["release", "channel"],
  },
  {
    slug: "release",
    term: "Release",
    group: "Where a number comes from",
    definition: "One complete, checked, unchangeable publication of Macro Atlas's data. Every page is drawn from a single release, named in the footer.",
    see: ["stale"],
  },
  {
    slug: "series",
    term: "Series",
    group: "Reading a series",
    definition: "One measured quantity followed over time, with a fixed definition, unit and frequency, and a permanent key.",
    see: ["observation", "frequency"],
  },
  {
    slug: "observation",
    term: "Observation",
    group: "Reading a series",
    definition: "One value of one series for one period, held as the release has it. Rounding happens only where a value is displayed.",
    see: ["period", "series"],
  },
  {
    slug: "period",
    term: "Period",
    group: "Reading a series",
    definition: "The span of time an observation describes: a day, week, month, quarter or year. It is not the date the value was published or obtained.",
    see: ["frequency", "partial-period"],
  },
  {
    slug: "frequency",
    term: "Frequency",
    group: "Reading a series",
    definition:
      "How often a series has an observation. A series is drawn at its own frequency: a quarterly series is one point per quarter and is never spread over months.",
    see: ["period", "held-series"],
  },
  {
    slug: "held-series",
    term: "Held series",
    group: "Reading a series",
    definition:
      "A series in which each value stands from its date until the next observation, such as an election result. It is drawn as a step, and the last value stands until the day the release was made. A missing observation ends the hold.",
    see: ["frequency", "missing"],
  },
  {
    slug: "unit",
    term: "Unit",
    group: "Reading a series",
    definition: "What a value counts or measures, in words, as the catalog records it. Series in different units never share an axis.",
    see: ["series"],
  },
  {
    slug: "explained-figure",
    term: "Explained figure",
    group: "The site",
    definition:
      "A chart that carries its own summary sentence, its unit in words, its source line, a note on how to read it, and the same values as a table.",
    see: ["takeaway"],
  },
  {
    slug: "takeaway",
    term: "Takeaway",
    group: "The site",
    definition:
      "The one sentence above a figure, written from a fixed template, that states the latest figure and its change. It describes and never evaluates. A figure has no sentence when its latest period is partial, stale, an estimate or a projection, when a break lies between the two periods it would compare, or when two series are not comparable; the figure then says which.",
    see: ["explained-figure", "break", "stale"],
  },
  {
    slug: "catalog",
    term: "Catalog",
    group: "The site",
    definition: "The list of every series Macro Atlas knows about, with each one's definition, source and rights.",
    see: ["series", "rights"],
  },
];

const BY_SLUG = new Map(GLOSSARY.map((entry) => [entry.slug, entry]));

export function glossaryEntry(slug: string): GlossaryEntry | null {
  return BY_SLUG.get(slug) ?? null;
}

export const glossaryHref = (basePath: string, slug?: string): string => `${basePath}/docs/glossary${slug ? `/${slug}` : ""}`;
export const stateSlug = (mark: MarkName): string => STATE_SLUG[mark];
