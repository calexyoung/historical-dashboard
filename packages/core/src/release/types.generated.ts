// GENERATED from schema/release.schema.json by scripts/gen-schema.mjs. Do not edit.

/**
 * public: built only from what the rights register allows; the only kind production may serve. local: may also hold v1's legacy data, drafts and user notes; never served on a public Surface (PLAN 6.1).
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "profile".
 */
export type Profile = "public" | "local";
/**
 * An instant in UTC, written exactly as YYYY-MM-DDTHH:MM:SS, an optional fraction of up to nine digits, then Z. No offsets, no leap seconds, no lower case.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "datetime".
 */
export type Instant = string;
/**
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "sha256".
 */
export type Sha256 = string;
/**
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "rightsStatus".
 */
export type RightsStatus =
  | "public_domain"
  | "cc_by"
  | "citation_required"
  | "permission_required"
  | "no_redistribution"
  | "unknown";
/**
 * native: unrounded, at native frequency, from an adapter. legacy_monthly_rounded: carried over from v1's output, already rounded; never in a public Release and never mixed with native values in one Series.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "representation".
 */
export type Representation = "native" | "legacy_monthly_rounded";
/**
 * A Series' permanent public key. Also a file name, so it is restricted to safe characters.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "key".
 */
export type SeriesKey = string;
/**
 * Native frequency. daily covers every calendar day; business_daily covers Monday to Friday (a holiday is an explicit missing Observation); irregular has no fixed cadence (for example one Observation per election).
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "frequency".
 */
export type Frequency =
  "daily" | "business_daily" | "weekly" | "monthly" | "quarterly" | "annual" | "irregular";
/**
 * A calendar date, YYYY-MM-DD, in years 0001 to 9999. No time and no zone.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "date".
 */
export type CalendarDate = string;
/**
 * The label of a Period: 2024 (annual), 2024-Q1, 2024-01, 2024-W03 (ISO week), 2024-01-15 (a day; also used by irregular series).
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "period".
 */
export type PeriodLabel = string;
/**
 * The declared rule that produces a Derived series. inputs are ordered: ratio is inputs[0] / inputs[1] and difference is inputs[0] - inputs[1], each with exactly two inputs; sum and product take two or more; pct_change takes one input and params.lag, a whole number of Periods at the frequency the arithmetic is done at: the Derived series' own under aggregate_then_compute, the input's under compute_then_aggregate (docs/method/transforms.md). order is always stated. The output's unit is the entry's own unit. Only the engine in packages/core computes a Recipe (ADR 0003); other code may only check its structure.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "recipe".
 */
export type Recipe = PairRecipe | CombineRecipe | PercentChangeRecipe;
/**
 * Whether inputs are brought to the output frequency before or after the arithmetic. Always stated; there is no default.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "recipeOrder".
 */
export type RecipeOrder = "aggregate_then_compute" | "compute_then_aggregate";
/**
 * What kind of value an Observation is. missing and suppressed carry no value. projected is never presented as observed.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "observationStatus".
 */
export type ObservationStatus =
  | "final"
  | "preliminary"
  | "revised"
  | "estimate"
  | "projected"
  | "partial"
  | "suppressed"
  | "missing";
/**
 * Where an Annotation sits on the time axis: a date, a span (end is inclusive; null means still running) or a Period.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "anchor".
 */
export type Anchor = DateAnchor | SpanAnchor | PeriodAnchor;
/**
 * The hash of the lock's file. Present exactly when it is in the Release.
 */
export type Sha2561 = string;
/**
 * An instant in UTC, written exactly as YYYY-MM-DDTHH:MM:SS, an optional fraction of up to nine digits, then Z. No offsets, no leap seconds, no lower case.
 */
export type Instant1 = string;
/**
 * The hash of the rest of the file as the writer serialises it. A lock is never edited.
 */
export type Sha2562 = string;
/**
 * A few words. Not a sentence: no full stop, question mark, exclamation mark or line break.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "topicLabel".
 */
export type TopicLabel = string;
/**
 * A Series' permanent public key. Also a file name, so it is restricted to safe characters.
 */
export type SeriesKey1 = string;
/**
 * How a Companion is related to the Topic's main Series. component: it measures a part of what the main Series measures. excludes_components: it measures the same thing with some parts left out. input: the main Series is computed from it. same_survey: both come from one survey of one agency. same_release: the agency publishes both in one release.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "topicRelation".
 */
export type TopicRelation =
  "component" | "excludes_components" | "input" | "same_survey" | "same_release";

/**
 * Macro Atlas release contract, v0 (schema_version 0.6.0). A Release is a directory; this schema describes it gathered into one object: manifest.json, catalog.json, series/{key}.json, derived/{key}.json, vintages/{key}.json, content/annotations.json, content/events.json, content/claims.json, locks/{claim_id}.v{n}.lock.json, evidence/latest.json, content/highlights.json, search.json and content/topics.json. It is the seam between the writer and every reader (PLAN 4.2). Conventions the schema cannot express, and the cross-file rules, are in schema/README.md. Structural validity is not authorisation: whether a series may appear on a Surface is decided by permits() and the rights register.
 */
export interface Release {
  manifest: Manifest;
  catalog: Catalog;
  /**
   * series/{key}.json: stored Series at native frequency.
   */
  series: {
    [k: string]: SeriesFile;
  };
  /**
   * derived/{key}.json: outputs of Recipes, written by the engine (ADR 0003).
   */
  derived: {
    [k: string]: SeriesFile;
  };
  /**
   * vintages/{key}.json: what Macro Atlas has held for a stored Series over time (ADR 0022, ADR 0024). Optional per Series; a Series without one has no as-of answer.
   */
  vintages: {
    [k: string]: VintageFile;
  };
  annotations: AnnotationsFile;
  events?: EventsFile;
  claims?: ClaimsFile;
  /**
   * locks/{claim_id}.v{n}.lock.json, by file name without .lock.json.
   */
  locks?: {
    [k: string]: ClaimLock;
  };
  latest?: LatestFile;
  highlights?: HighlightsFile;
  search?: SearchFile;
  topics?: TopicsFile;
}
/**
 * manifest.json: what this Release is and what it holds. created is when the Release was written, and is also the fixed date against which staleness (max_lag) is judged, so a Release never changes state as the clock moves.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "manifest".
 */
export interface Manifest {
  /**
   * Version of this contract. Readers refuse a version they do not know. 0.2.0 added vintages/ and vintages_sha256; a 0.1.0 Release holds neither. 0.3.0 (M19) added content/events.json, which a 0.3.0 Release must have and an earlier one may not, and the rule that every Event is one Annotation. 0.4.0 (M20) added content/claims.json, which a 0.4.0 Release must have, locks/ and evidence/latest.json. 0.5.0 (M22) added content/highlights.json and search.json, both of which a 0.5.0 Release must have. 0.6.0 (M23) added content/topics.json, which a 0.6.0 Release must have, and the Topics' entries of search.json. Writers write the last one listed.
   */
  schema_version: "0.1.0" | "0.2.0" | "0.3.0" | "0.4.0" | "0.5.0" | "0.6.0";
  /**
   * Version of the engine's behaviour that wrote derived/ (ADR 0003).
   */
  semantics_version: string;
  /**
   * UTC time plus a short hash. Equals the directory name.
   */
  release_id: string;
  profile: Profile;
  created: Instant;
  rights_register: RightsRegisterRef;
  /**
   * One row per file under series/ and derived/.
   */
  series: {
    [k: string]: ManifestSeries;
  };
  /**
   * Series in the Catalog that are kept out of this Release, each with the reason. A withheld Series has no file and no manifest row.
   */
  withheld: WithheldSeries[];
  checks: CheckReport;
  /**
   * Per-source freshness. fetched is null when the time is not known (never filled with the conversion time).
   */
  sources?: SourceFreshness[];
  /**
   * Files this Release was converted from, when it was not built from STORE (the legacy converter, M2). generated is the input's own timestamp, kept apart from created.
   */
  inputs?: ReleaseInput[];
  /**
   * The release whose data files a content-only Release reuses (PLAN 4.4).
   */
  reused_data_from?: string;
}
/**
 * The rights register this Release was built against. signed says Alex has signed that version; a public Release requires it. It does not by itself authorise any Series: that is the writer's allowlist and permits().
 */
export interface RightsRegisterRef {
  version: string;
  /**
   * SHA-256 of the bytes of schema/rights-register.json at that version (ADR 0020); null in a Release built without the register (the legacy converter, the fixture).
   */
  sha256: Sha256 | null;
  signed: boolean;
}
/**
 * sha256 is the hash of the file's exact bytes. vintages_sha256 is the hash of vintages/{key}.json, present exactly when that file is.
 */
export interface ManifestSeries {
  /**
   * stored: series/{key}.json. derived: derived/{key}.json.
   */
  kind: "stored" | "derived";
  sha256: Sha256;
  vintages_sha256?: Sha256;
  /**
   * The writer's hash of the full normalized state (PLAN 4.3). Opaque to readers; arrives with the VintageStore.
   */
  state_hash?: string;
  /**
   * The Channel actually used (catalog source.channel.via).
   */
  channel: string;
  rights_status: RightsStatus;
  representation: Representation;
}
export interface WithheldSeries {
  key: SeriesKey;
  reason: string;
}
/**
 * The writer's check report for this Release.
 */
export interface CheckReport {
  passed: boolean;
  report: CheckResult[];
}
export interface CheckResult {
  check: string;
  outcome: "pass" | "warn" | "fail";
  detail?: string;
}
export interface SourceFreshness {
  producer: string;
  via: string;
  fetched: Instant | null;
  outcome?: "ok" | "failed" | "stale";
  detail?: string;
}
export interface ReleaseInput {
  path: string;
  sha256: Sha256;
  commit?: string | null;
  generated?: Instant | null;
  note?: string;
}
/**
 * catalog.json: every Series this Release knows about, including withheld ones (by name, without values).
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "catalog".
 */
export interface Catalog {
  series: CatalogEntry[];
}
/**
 * A minimal Catalog entry (PLAN 5). Optional fields are typed slots: absent means not recorded, never a default.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "catalogEntry".
 */
export interface CatalogEntry {
  key: SeriesKey;
  aliases?: string[];
  name: string;
  description?: string;
  definition?: SeriesDefinition;
  /**
   * The unit in words, as shown to a reader.
   */
  unit: string;
  unit_kind?:
    | "percent"
    | "percentage_points"
    | "index"
    | "currency"
    | "count"
    | "ratio"
    | "physical"
    | "other";
  /**
   * Decides how values may be combined across Periods.
   */
  measure_kind: "stock" | "flow" | "rate" | "index" | "annualized";
  /**
   * How finer Periods combine into a coarser one. Declared, never inferred from measure_kind (PLAN 4.5).
   */
  agg?: "mean" | "last" | "sum" | "none";
  freq: Frequency;
  /**
   * discrete: each Observation describes its own Period only. held: a value stands from its Period until the next Observation (drawn as a step); a missing Observation ends the hold, and the last value stands until the Release's created date.
   */
  continuity: "discrete" | "held";
  representation: Representation;
  seasonal_adjustment?: "sa" | "nsa" | "saar" | "not_applicable";
  price_basis?: "nominal" | "real" | "not_applicable";
  base_period?: string;
  allowed_transforms?: string[];
  /**
   * ISO 3166-1 alpha-3, or a group code such as G20.
   */
  country?: string;
  segment:
    | "economy_jobs"
    | "markets_money"
    | "infrastructure"
    | "governance_politics"
    | "disasters_health"
    | "us_in_the_world";
  topics?: string[];
  source: Source;
  rights: Rights;
  status: "draft" | "active" | "retired";
  /**
   * How far the last Observation's period_end may trail the Release's created date before the Series is stale: a count of days, weeks, months or years, such as P45D or P4M.
   */
  max_lag?: string;
  /**
   * Sanity range [low, high] for the writer's checks.
   *
   * @minItems 2
   */
  range?: never[];
  /**
   * Periods at which the Series stops being comparable with what came before (a rebasing or change of method). Values from the named Period on are on the new basis. Each has a data_note Annotation.
   */
  breaks?: SeriesBreak[];
  recipe?: Recipe;
}
export interface SeriesDefinition {
  population?: string;
  geography?: string;
  denominator?: string;
}
/**
 * Origin and Channel, never merged.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "source".
 */
export interface Source {
  origin: Origin;
  channel: Channel;
}
/**
 * The organisation that produces a Series and the dataset and identifier it publishes it under.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "origin".
 */
export interface Origin {
  producer: string;
  dataset: string;
  origin_id: string | null;
  url: string | null;
}
/**
 * The route by which Macro Atlas actually obtained the values: "direct" from the Origin, or an intermediary such as "fred". A Channel has terms of its own.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "channel".
 */
export interface Channel {
  via: string;
  adapter?: string;
  endpoint?: string;
  auth?: "none" | "api_key";
}
/**
 * What the Origin's and Channel's terms were read to allow. The three Permissions are derived from this and the Channel, never typed in.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "rights".
 */
export interface Rights {
  owner: string;
  terms_url: string | null;
  status: RightsStatus;
  attribution: string | null;
  /**
   * The date the terms were read; null when they have not been.
   */
  reviewed: CalendarDate | null;
}
export interface SeriesBreak {
  period: PeriodLabel;
  note: string;
}
/**
 * ratio is inputs[0] / inputs[1]; difference is inputs[0] - inputs[1].
 */
export interface PairRecipe {
  op: "ratio" | "difference";
  /**
   * @minItems 2
   * @maxItems 2
   */
  inputs: [SeriesKey, SeriesKey];
  order: RecipeOrder;
}
/**
 * sum and product of two or more inputs.
 */
export interface CombineRecipe {
  op: "sum" | "product";
  /**
   * @minItems 2
   */
  inputs: [SeriesKey, SeriesKey, ...SeriesKey[]];
  order: RecipeOrder;
}
/**
 * Percent change of one input from params.lag Periods earlier, counted at the frequency the arithmetic is done at.
 */
export interface PercentChangeRecipe {
  op: "pct_change";
  /**
   * @minItems 1
   * @maxItems 1
   */
  inputs: [SeriesKey];
  order: RecipeOrder;
  params: {
    lag: number;
  };
}
/**
 * series/{key}.json or derived/{key}.json. Observations are in Period order at the native frequency with no Period left out between the bounds (irregular series excepted). period_start and period_end are the bounds: the first Observation's period_start and the last one's period_end.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "seriesFile".
 */
export interface SeriesFile {
  key: SeriesKey;
  freq: Frequency;
  representation: Representation;
  period_start: CalendarDate;
  period_end: CalendarDate;
  /**
   * @minItems 1
   */
  observations: [Observation, ...Observation[]];
}
/**
 * One value of one Series for one Period. period_start and period_end are the first and last calendar day of the Period, both inclusive. A gap is an explicit Observation with value null and status missing: a Period is never simply left out.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "observation".
 */
export interface Observation {
  period: PeriodLabel;
  period_start: CalendarDate;
  period_end: CalendarDate;
  value: number | null;
  status: ObservationStatus;
}
/**
 * vintages/{key}.json: every version of every Observation of a stored Series that the Release may show, the metadata history, and the complete Captures recorded for it. rows are in Period order, and a Period's versions in the order they were recorded. captures are oldest first; one whose change is none is a capture confirmation, and confirms only the Periods inside its scope. provider_coverage is the span over which the Origin's own record of its releases is known to be complete, or null when the Series has only Atlas-observed vintages. Only packages/core resolves an as-of question from this file (ADR 0003, docs/method/vintage-resolution.md).
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "vintageFile".
 */
export interface VintageFile {
  key: SeriesKey;
  freq: Frequency;
  /**
   * Always native: v1's legacy Series have no vintages.
   */
  representation: "native";
  provider_coverage: null | ProviderCoverage;
  /**
   * The metadata history, oldest first: each was in force from recorded_from until the next one's. metadata is a fixed selection of what the vintage store recorded: the name, unit and adjustment declared, the Source, and what the rights register said of the Origin when the bytes were fetched. rights is a record of that day and authorises nothing: what may be shown is decided by today's register.
   *
   * @minItems 1
   */
  metadata: [VintageMetadata, ...VintageMetadata[]];
  captures: VintageCapture[];
  /**
   * @minItems 1
   */
  rows: [VintageRow, ...VintageRow[]];
}
export interface ProviderCoverage {
  from: Instant;
  to: Instant;
}
export interface VintageMetadata {
  hash: Sha256;
  recorded_from: Instant;
  metadata: RecordedMetadata;
}
export interface RecordedMetadata {
  name: string;
  unit: string;
  seasonal_adjustment?: string;
  source: Source;
  rights: null | RightsThen;
}
export interface RightsThen {
  licence_class: string;
  attribution: string | null;
}
export interface VintageCapture {
  retrieved_at: Instant;
  /**
   * The first and last calendar day the source was asked about; null for no bound.
   *
   * @minItems 2
   * @maxItems 2
   */
  scope: [CalendarDate | null, CalendarDate | null];
  change: "first" | "revision" | "metadata" | "none";
}
/**
 * One version of one Observation: what was held for a Period from recorded_from up to, not including, recorded_to (null: held now). Both are retrieval times of Captures, never the time a Release was written. deleted marks a tombstone: the Period was held, was asked about again and was no longer in a complete answer. provider_from is when the Origin published the version, where the Origin or an archive of its releases dates it; provider_precision says whether that is a day or an instant (a day is written as that day at 00:00:00Z). metadata is the hash of the metadata the version was recorded under.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "vintageRow".
 */
export interface VintageRow {
  period: PeriodLabel;
  period_start: CalendarDate;
  period_end: CalendarDate;
  value: number | null;
  status: ObservationStatus | null;
  deleted: boolean;
  recorded_from: Instant;
  recorded_to: Instant | null;
  provider_from: Instant | null;
  provider_to: Instant | null;
  provider_precision: "date" | "datetime" | null;
  channel: string;
  metadata: Sha256;
}
/**
 * content/annotations.json.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "annotationsFile".
 */
export interface AnnotationsFile {
  annotations: Annotation[];
}
/**
 * Anything drawn on a time axis that is not a Series. One shape for every layer (PLAN 5). An Annotation states what and when; it never says an Event caused a movement.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "annotation".
 */
export interface Annotation {
  id: string;
  kind: "event" | "claim" | "recession" | "governance" | "policy" | "data_note";
  anchor: Anchor;
  /**
   * The Series this Annotation belongs to; absent means it applies to the whole time axis.
   */
  series?: SeriesKey[];
  label: string;
  /**
   * Path of the content record behind this Annotation (an Event: content/events/{id}.md), or null. From 0.3.0 every Annotation of kind event names its Event here.
   */
  ref: string | null;
  source: Citation | null;
  /**
   * The layer within a kind, such as an Event's category (political, financial, ...).
   */
  category?: string;
  /**
   * Named facts a layer needs to draw itself, such as the party of a term of government. Never a judgment.
   */
  attributes?: {
    [k: string]: string | number | boolean;
  };
  provenance?: AnnotationProvenance;
}
export interface DateAnchor {
  type: "date";
  date: CalendarDate;
}
export interface SpanAnchor {
  type: "span";
  start: CalendarDate;
  end: CalendarDate | null;
}
export interface PeriodAnchor {
  type: "period";
  period: PeriodLabel;
}
export interface Citation {
  name?: string;
  url: string;
  archive_url?: string;
}
/**
 * Where an Annotation that is not Macro Atlas's own content came from (0.3.0): the Origin and dataset of the hand-entered file, or of v1's file, it was projected from. The rights check of a Release asks the gate about it. An Annotation in v1's legacy representation is never in a public-profile Release.
 */
export interface AnnotationProvenance {
  producer: string;
  dataset: string;
  via: string;
  representation: Representation;
}
/**
 * content/events.json (0.3.0): the Events, in the order of time. A public-profile Release holds no draft.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "eventsFile".
 */
export interface EventsFile {
  events: Event[];
}
/**
 * One Event as a Release carries it (content/events/{id}.md compiled; schema/event.schema.json is the authoring form). There is no field for a finding, a rating or an effect.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "event".
 */
export interface Event {
  /**
   * Permanent. The date as written in `date`, then a slug. The file is named for it.
   */
  id: string;
  /**
   * When it happened, or began: a day, a month or a year, as date_precision says. No day is made up.
   */
  date: string;
  /**
   * The last day, month or year of an Event that spans time, inclusive, in the precision of `date`. An Event still running has no place here yet: it is recorded when it has ended.
   */
  end?: string;
  date_precision: "day" | "month" | "year";
  title: string;
  /**
   * v1's five, then disaster, infrastructure and legislation (PLAN 5).
   */
  category:
    | "political"
    | "financial"
    | "geopolitical"
    | "health"
    | "policy"
    | "disaster"
    | "infrastructure"
    | "legislation";
  /**
   * A draft is never in a public-profile Release.
   */
  status: "draft" | "public";
  topics: string[];
  /**
   * Keys of Series in the Catalog that a reader may want beside this Event. Not a statement that the Event moved them.
   */
  related_series: string[];
  /**
   * @minItems 1
   */
  sources: [EventCitation, ...EventCitation[]];
  /**
   * The Event's own text: what happened and when, supported by the cited sources. It does not evaluate and never says an Event caused a movement. May be empty.
   */
  description: string;
}
/**
 * Where an Event can be checked: an address and an archived copy of it, or the reason there is none. One or the other, never both and never neither.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "eventCitation".
 */
export interface EventCitation {
  name?: string;
  url: string;
  archive_url?: string;
  no_archive?: string;
}
/**
 * content/claims.json (0.4.0): the Claims, oldest first. A public-profile Release holds no draft.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "claimsFile".
 */
export interface ClaimsFile {
  claims: Claim[];
}
/**
 * A Claim in a Release (CONTEXT.md): the record as its file holds it, the quote, and its locks by name. No field for a finding, a rating, a label or a context flag.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "claim".
 */
export interface Claim {
  /**
   * Permanent: said_on, then a slug. The file is named for it.
   */
  id: string;
  claimant: Claimant;
  /**
   * The New York calendar day the statement was made.
   */
  said_on: string;
  /**
   * The instant it was made, in UTC, when known. It falls on said_on in New York. With it the Cutoff is that instant; without it, 00:00 New York on said_on (D7).
   */
  said_at?: string;
  venue: string;
  /**
   * Two or more records of the statement, each archived (ADR 0011).
   *
   * @minItems 2
   */
  sources: [ClaimSource, ClaimSource, ...ClaimSource[]];
  /**
   * @maxItems 12
   */
  readings:
    | []
    | [ClaimReading]
    | [ClaimReading, ClaimReading]
    | [ClaimReading, ClaimReading, ClaimReading]
    | [ClaimReading, ClaimReading, ClaimReading, ClaimReading]
    | [ClaimReading, ClaimReading, ClaimReading, ClaimReading, ClaimReading]
    | [ClaimReading, ClaimReading, ClaimReading, ClaimReading, ClaimReading, ClaimReading]
    | [
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading
      ]
    | [
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading
      ]
    | [
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading
      ]
    | [
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading
      ]
    | [
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading
      ]
    | [
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading
      ];
  /**
   * Other ways the words could be read that this record does not measure, each in a line.
   */
  readings_not_measured: string[];
  /**
   * Why this statement was recorded.
   */
  selection_note: string;
  /**
   * The New York calendar day the Claim was recorded and its figures computed (now when checked).
   */
  checked_on: string;
  corrections: ClaimCorrection[];
  topics: string[];
  /**
   * A draft is never in a public-profile Release. Only a person makes a Claim public (D7).
   */
  status: "draft" | "public";
  /**
   * The statement, verbatim.
   */
  quote: string;
  /**
   * Every lock of the Claim, oldest first.
   */
  locks: ClaimLockListed[];
}
/**
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "claimant".
 */
export interface Claimant {
  name: string;
  /**
   * The office or position held when the Claim was made.
   */
  role: string;
  /**
   * The party at the time; "none" for a person with no party.
   */
  party: string;
}
/**
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "claimSource".
 */
export interface ClaimSource {
  name?: string;
  url: string;
  /**
   * An archived copy of the address. A Claim's source has no exception.
   */
  archive_url: string;
  /**
   * Where in the source the words are: a time in a recording, a page, a paragraph.
   */
  locator: string;
  /**
   * What kind of record it is. Two sources of one Claim are different records of the statement.
   */
  kind: "recording" | "transcript" | "own_publication" | "report";
}
/**
 * One way to turn a Claim's words into something measurable (CONTEXT.md, Reading). Which fields go with which measure is in docs/method/claims.md; both atlas check and the engine hold a Reading to it. There is no field for what the figures show.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "claimReading".
 */
export interface ClaimReading {
  /**
   * Names the Reading within its Claim. Permanent once locked.
   */
  id: string;
  series: string;
  /**
   * A slower frequency to bring the Series to before anything else. Absent: the Series' own.
   */
  freq?: "weekly" | "monthly" | "quarterly" | "annual";
  /**
   * One of the engine's Transforms (docs/method/transforms.md). rebase, z and drawdown depend on a window and go only with a measure that has one.
   */
  transform: "lin" | "chg" | "ch1" | "pch" | "pc1" | "pca" | "log" | "rebase" | "z" | "drawdown";
  /**
   * The closed list (PLAN 4.5). Each returns numbers, never true or false.
   */
  measure: "value_at" | "change" | "extreme" | "rank" | "difference";
  /**
   * value_at, rank: the Period measured, as a label at the Reading's frequency.
   */
  period?: string;
  /**
   * difference: two Periods; the answer is the second less the first.
   *
   * @minItems 2
   * @maxItems 2
   */
  periods?: [string, string];
  window?: ClaimWindow;
  /**
   * extreme: the largest or the smallest value.
   */
  which?: "max" | "min";
  /**
   * rank: whether 1 is the highest value or the lowest.
   */
  order?: "highest" | "lowest";
  /**
   * Other windows the same measure is taken over, so a reader sees how much the declared one matters (Window sensitivity). Only with change, extreme or rank.
   *
   * @maxItems 12
   */
  alternative_windows?:
    | []
    | [ClaimWindow]
    | [ClaimWindow, ClaimWindow]
    | [ClaimWindow, ClaimWindow, ClaimWindow]
    | [ClaimWindow, ClaimWindow, ClaimWindow, ClaimWindow]
    | [ClaimWindow, ClaimWindow, ClaimWindow, ClaimWindow, ClaimWindow]
    | [ClaimWindow, ClaimWindow, ClaimWindow, ClaimWindow, ClaimWindow, ClaimWindow]
    | [ClaimWindow, ClaimWindow, ClaimWindow, ClaimWindow, ClaimWindow, ClaimWindow, ClaimWindow]
    | [
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow
      ]
    | [
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow
      ]
    | [
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow
      ]
    | [
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow
      ]
    | [
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow,
        ClaimWindow
      ];
}
/**
 * Calendar dates, both inclusive.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "claimWindow".
 */
export interface ClaimWindow {
  from: string;
  to: string;
}
/**
 * A dated, public change to the Claim after publication, with the reason (CONTEXT.md, Correction).
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "claimCorrection".
 */
export interface ClaimCorrection {
  date: string;
  reason: string;
}
/**
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "claimLockListed".
 */
export interface ClaimLockListed {
  version: number;
  locked_at: Instant;
  reason: string | null;
  record_sha256: Sha256;
  /**
   * in_release: the lock's file is in this Release. withdrawn: its numbers may not be shown now (a permission went, or a Series was withdrawn); the lock is named and its file is absent. not_carried: the writer of this Release computes no latest row, so it carries no lock.
   */
  state: "in_release" | "withdrawn" | "not_carried";
  sha256?: Sha2561;
  /**
   * Why the lock's file is absent.
   */
  why?: string;
}
/**
 * locks/{claim_id}.v{n}.lock.json (0.4.0): the frozen record of a Claim's then and now-when-checked Evidence rows and its Window sensitivity (CONTEXT.md, Claim lock; PLAN 4.5). Append-only: recording the Claim afresh adds a version with a reason. No field holds a finding, a rating or a label.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "claimLock".
 */
export interface ClaimLock {
  format: 1;
  claim_id: string;
  version: number;
  locked_at: Instant1;
  /**
   * Why the Claim was recorded afresh; null for the first lock.
   */
  reason: string | null;
  /**
   * The version this one follows; null for the first.
   */
  supersedes: number | null;
  record: ClaimRecord;
  record_sha256: Sha256;
  release: LockRelease;
  semantics_version: string;
  /**
   * Every Origin, dataset and Channel the locked numbers came through, history included.
   *
   * @minItems 1
   */
  rights_used: [RightsLineage, ...RightsLineage[]];
  /**
   * @minItems 1
   */
  readings: [LockedReading, ...LockedReading[]];
  lock_sha256: Sha2562;
}
/**
 * The part of a Claim a lock freezes: the statement, who made it, where it can be checked, and how it is read. Its status, topics and corrections are not frozen.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "claimRecord".
 */
export interface ClaimRecord {
  claimant: Claimant;
  /**
   * The New York calendar day the statement was made.
   */
  said_on: string;
  /**
   * The instant it was made, in UTC, when known. It falls on said_on in New York. With it the Cutoff is that instant; without it, 00:00 New York on said_on (D7).
   */
  said_at?: string;
  venue: string;
  /**
   * Two or more records of the statement, each archived (ADR 0011).
   *
   * @minItems 2
   */
  sources: [ClaimSource, ClaimSource, ...ClaimSource[]];
  /**
   * @maxItems 12
   */
  readings:
    | []
    | [ClaimReading]
    | [ClaimReading, ClaimReading]
    | [ClaimReading, ClaimReading, ClaimReading]
    | [ClaimReading, ClaimReading, ClaimReading, ClaimReading]
    | [ClaimReading, ClaimReading, ClaimReading, ClaimReading, ClaimReading]
    | [ClaimReading, ClaimReading, ClaimReading, ClaimReading, ClaimReading, ClaimReading]
    | [
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading
      ]
    | [
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading
      ]
    | [
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading
      ]
    | [
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading
      ]
    | [
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading
      ]
    | [
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading,
        ClaimReading
      ];
  /**
   * Other ways the words could be read that this record does not measure, each in a line.
   */
  readings_not_measured: string[];
  /**
   * Why this statement was recorded.
   */
  selection_note: string;
  /**
   * The New York calendar day the Claim was recorded and its figures computed (now when checked).
   */
  checked_on: string;
  /**
   * The statement, verbatim.
   */
  quote: string;
}
/**
 * The Release the rows were computed against. Retention keeps it.
 */
export interface LockRelease {
  release_id: string;
  created: Instant;
  profile: Profile;
}
/**
 * One Origin, dataset and Channel that values came through: a row for the rights gate.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "rightsLineage".
 */
export interface RightsLineage {
  origin: string;
  dataset: string;
  channel: string;
  representation: Representation;
}
/**
 * What one Reading resolved to and its two locked Evidence rows.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "lockedReading".
 */
export interface LockedReading {
  /**
   * Names the Reading within its Claim. Permanent once locked.
   */
  id: string;
  series: SeriesKey;
  freq: Frequency;
  unit: string;
  /**
   * One of the engine's Transforms (docs/method/transforms.md). rebase, z and drawdown depend on a window and go only with a measure that has one.
   */
  transform: "lin" | "chg" | "ch1" | "pch" | "pc1" | "pca" | "log" | "rebase" | "z" | "drawdown";
  /**
   * The closed list (PLAN 4.5). Each returns numbers, never true or false.
   */
  measure: "value_at" | "change" | "extreme" | "rank" | "difference";
  recipe: null | RecipeIdentity;
  periods: ResolvedPeriod[];
  window: null | ResolvedWindow;
  alternative_windows: ResolvedWindow[];
  then: EvidenceRow;
  now_when_checked: EvidenceRow;
}
export interface RecipeIdentity {
  key: SeriesKey;
  recipe: Recipe;
  rests_on: SeriesKey[];
}
/**
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "resolvedPeriod".
 */
export interface ResolvedPeriod {
  period: string;
  start: CalendarDate;
  end: CalendarDate;
}
/**
 * A window, and for a change the first and last Period that start inside it, fixed by the calendar before any value is looked at.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "resolvedWindow".
 */
export interface ResolvedWindow {
  from: CalendarDate;
  to: CalendarDate;
  periods: ResolvedPeriod[];
}
/**
 * The result of one Reading against one state of the data (CONTEXT.md, Evidence row): then, now when checked, or latest. Numbers and where they came from; no field says what they show about the Claim.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "evidenceRow".
 */
export interface EvidenceRow {
  state: "then" | "now_when_checked" | "latest";
  /**
   * The day or instant asked about (then); null for a Release's own state.
   */
  as_of: string | null;
  cutoff: null | EvidenceCutoff;
  basis: null | ("provider" | "atlas_observed" | "legacy" | "uncertain" | "unavailable");
  unavailable?: EvidenceUnavailable;
  same_day_release: boolean;
  inputs: EvidenceInput[];
  /**
   * The Series' unit in force for this row, before the Transform.
   */
  unit: string | null;
  figures: EvidenceFigure[];
  window_sensitivity: EvidenceSensitivity[];
  release_id: string;
  semantics_version: string;
}
export interface EvidenceCutoff {
  instant: Instant;
  day: CalendarDate;
  precision: "date" | "datetime";
  zone: "America/New_York";
}
/**
 * Why there is no answer. A reason code and a sentence written by the engine; it states what is missing and judges nothing.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "evidenceUnavailable".
 */
export interface EvidenceUnavailable {
  reason: string;
  message: string;
}
/**
 * One stored Series an Evidence row rests on, as it was resolved.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "evidenceInput".
 */
export interface EvidenceInput {
  key: SeriesKey;
  basis: null | ("provider" | "atlas_observed" | "legacy" | "uncertain" | "unavailable");
  capture_gap: null | EvidenceCaptureGap;
  same_day_release: boolean;
  unit: string;
  last_capture: null | Instant;
}
export interface EvidenceCaptureGap {
  from: Instant;
  to: null | Instant;
  missed_days: number;
  changed_across: boolean | null;
}
/**
 * One number a Measure returned (CONTEXT.md, Measure).
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "evidenceFigure".
 */
export interface EvidenceFigure {
  name:
    | "value"
    | "start"
    | "end"
    | "change"
    | "pct_change"
    | "extreme"
    | "n"
    | "rank"
    | "of"
    | "a"
    | "b"
    | "difference";
  /**
   * A number, or null with `empty`. Never true or false.
   */
  value: number | null;
  period?: string;
  status?: string;
  /**
   * Why the figure has no value.
   */
  empty?: string;
}
/**
 * The same Measure over one alternative window (CONTEXT.md, Window sensitivity).
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "evidenceSensitivity".
 */
export interface EvidenceSensitivity {
  from: CalendarDate;
  to: CalendarDate;
  figures: EvidenceFigure[];
  unavailable?: EvidenceUnavailable;
}
/**
 * evidence/latest.json (0.4.0): for the newest lock of each Claim whose lock is in the Release, the latest Evidence row of every Reading, recomputed by the engine on this Release, and the drift report. Present exactly when the Release holds a lock.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "latestFile".
 */
export interface LatestFile {
  semantics_version: string;
  claims: LatestClaim[];
}
/**
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "latestClaim".
 */
export interface LatestClaim {
  claim_id: string;
  lock_version: number;
  rights_used: RightsLineage[];
  readings: LatestReading[];
}
/**
 * One locked Reading on this Release: its latest row, or why this Release cannot measure it, and the drift.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "latestReading".
 */
export interface LatestReading {
  /**
   * Names the Reading within its Claim. Permanent once locked.
   */
  id: string;
  latest: null | EvidenceRow;
  refused: null | EvidenceUnavailable;
  drift: DriftEntry[];
}
/**
 * One place where a row computed on this Release is not the locked one. It states the difference and names no cause; only a person re-locks.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "driftEntry".
 */
export interface DriftEntry {
  /**
   * latest_differs: the latest row is not the locked now-when-checked row. then_differs: the then row, computed again on this Release, is not the locked one.
   */
  kind: "latest_differs" | "then_differs";
  window: null | ClaimWindow;
  figure:
    | null
    | (
        | "value"
        | "start"
        | "end"
        | "change"
        | "pct_change"
        | "extreme"
        | "n"
        | "rank"
        | "of"
        | "a"
        | "b"
        | "difference"
      );
  field: "value" | "period" | "status" | "empty" | "unit" | "availability";
  locked: number | string | null;
  now: number | string | null;
}
/**
 * content/highlights.json (0.5.0): the headline Series of each Segment, chosen by an editor (CONTEXT.md, Highlights, Overview). All six Segments, once each, in the order of the Overview. The first Series of a Segment is its row of the Overview; all of them are rows of Highlights. Every key is a Series of this Release's catalog.json in that Segment. It names Series and holds no value; a Withheld Series may be named.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "highlightsFile".
 */
export interface HighlightsFile {
  /**
   * @minItems 6
   * @maxItems 6
   */
  segments: [
    {
      segment:
        | "economy_jobs"
        | "markets_money"
        | "infrastructure"
        | "governance_politics"
        | "disasters_health"
        | "us_in_the_world";
      /**
       * @maxItems 24
       */
      series: SeriesKey[];
    },
    {
      segment:
        | "economy_jobs"
        | "markets_money"
        | "infrastructure"
        | "governance_politics"
        | "disasters_health"
        | "us_in_the_world";
      /**
       * @maxItems 24
       */
      series: SeriesKey[];
    },
    {
      segment:
        | "economy_jobs"
        | "markets_money"
        | "infrastructure"
        | "governance_politics"
        | "disasters_health"
        | "us_in_the_world";
      /**
       * @maxItems 24
       */
      series: SeriesKey[];
    },
    {
      segment:
        | "economy_jobs"
        | "markets_money"
        | "infrastructure"
        | "governance_politics"
        | "disasters_health"
        | "us_in_the_world";
      /**
       * @maxItems 24
       */
      series: SeriesKey[];
    },
    {
      segment:
        | "economy_jobs"
        | "markets_money"
        | "infrastructure"
        | "governance_politics"
        | "disasters_health"
        | "us_in_the_world";
      /**
       * @maxItems 24
       */
      series: SeriesKey[];
    },
    {
      segment:
        | "economy_jobs"
        | "markets_money"
        | "infrastructure"
        | "governance_politics"
        | "disasters_health"
        | "us_in_the_world";
      /**
       * @maxItems 24
       */
      series: SeriesKey[];
    }
  ];
}
/**
 * search.json (0.5.0): one entry for every Series of catalog.json, then every Event of content/events.json, then every Claim of content/claims.json, then (0.6.0) every Topic of content/topics.json, each in that file's order. A public-profile Release holds no draft, so its index names none.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "searchFile".
 */
export interface SearchFile {
  entries: SearchEntry[];
}
/**
 * One thing a reader can search for: a Series, an Event, a Claim or a Topic of this Release. Words only: a name, the text that describes it, and keywords. No field holds an Observation's value, and both validators hold every entry to the projection of the Release's own catalog.json, content/events.json, content/claims.json and content/topics.json (schema/README.md).
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "searchEntry".
 */
export interface SearchEntry {
  kind: "series" | "event" | "claim" | "topic";
  /**
   * The Series key, the Event id, the Claim id or the Topic slug: what the page's address ends in.
   */
  id: string;
  title: string;
  /**
   * A Series' description, an Event's description, a Claim's quote, the definition a Topic quotes. Empty when there is none.
   */
  text: string;
  keywords: string[];
  /**
   * A Series only: it is Withheld in this Release (listed by name, no values anywhere).
   */
  withheld?: true;
}
/**
 * content/topics.json (0.6.0): the Topics, by slug. A public-profile Release holds no draft, and of each Topic's Events only those it holds itself.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "topicsFile".
 */
export interface TopicsFile {
  topics: Topic[];
}
/**
 * One Topic as a Release carries it (content/topics/{slug}.md compiled; schema/topic.schema.json is the authoring form). Labels, a definition quoted from a cited source, and the names of Series and Events. There is no field for prose of the site's own: none for an explanation, a finding, a cause or a published account.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "topic".
 */
export interface Topic {
  /**
   * Permanent. The file is named for it and the page is /topics/{slug}.
   */
  slug: string;
  title: TopicLabel;
  segment:
    | "economy_jobs"
    | "markets_money"
    | "infrastructure"
    | "governance_politics"
    | "disasters_health"
    | "us_in_the_world";
  /**
   * A draft is never in a public-profile Release.
   */
  status: "draft" | "public";
  definition: TopicDefinition;
  main: SeriesKey1;
  /**
   * The Topic's member Series, in the order they are listed on its page. The main Series is one of them.
   */
  series: SeriesKey[];
  /**
   * What else moved (CONTEXT.md, Companion): Series an editor chose to show beside the main Series on one time axis. Each states how it is related to the main Series, as one of a closed list of factual relations. It is never said to have caused, or to explain, a movement.
   */
  companions: {
    series: SeriesKey;
    relation: TopicRelation;
  }[];
  range?: TopicRange;
  /**
   * Events an editor lists on the Topic's page, by id. Not a statement that any of them moved a Series.
   */
  events: string[];
}
/**
 * What the Topic's main measure is, in its origin agency's own words: quoted, never paraphrased.
 */
export interface TopicDefinition {
  /**
   * The agency's words, verbatim, as they stand at the cited address.
   */
  quote: string;
  source: TopicCitation;
}
/**
 * Where the quoted words stand: the publisher and the page, the address, and an archived copy of it or which of a closed list of reasons there is none. No field of it holds a sentence of the site's own.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "topicCitation".
 */
export interface TopicCitation {
  /**
   * The publisher and the name of the page the words stand on, as the page gives it: 'U.S. Bureau of Labor Statistics, Consumer Price Index'. One line. A name, held to the word list like a title.
   */
  name: string;
  url: string;
  archive_url?: string;
  /**
   * Why this citation has no archived copy: one of a closed list, each with fixed words on the page. no_copy_found: the Internet Archive holds no copy of the address. archiving_refused: the publisher does not allow its pages to be archived. page_removed: the page is no longer at the address and no copy was kept.
   */
  no_archive?: "no_copy_found" | "archiving_refused" | "page_removed";
}
/**
 * One Series set against the range of a group: the lowest, the middle and the highest value among the members in each Period. The members are resolved when the Release is written, from the coverage matrix the Topic's file names: one Series per country. A member is named by key whether or not the Release holds it; nothing here is a value.
 */
export interface TopicRange {
  series: SeriesKey;
  /**
   * A few words. Not a sentence: no full stop, question mark, exclamation mark or line break.
   */
  label: string;
  indicator: {
    id: string;
    /**
     * The column's name in the coverage matrix: a label.
     */
    name: string;
  };
  /**
   * @minItems 3
   */
  members: [
    {
      key: SeriesKey;
      /**
       * ISO 3166-1 alpha-3.
       */
      country: string;
    },
    {
      key: SeriesKey;
      /**
       * ISO 3166-1 alpha-3.
       */
      country: string;
    },
    {
      key: SeriesKey;
      /**
       * ISO 3166-1 alpha-3.
       */
      country: string;
    },
    ...{
      key: SeriesKey;
      /**
       * ISO 3166-1 alpha-3.
       */
      country: string;
    }[]
  ];
}
