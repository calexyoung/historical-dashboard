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
 * The declared rule that produces a Derived series. inputs are ordered: ratio is inputs[0] / inputs[1] and difference is inputs[0] - inputs[1], each with exactly two inputs; sum and product take two or more; pct_change takes one input and params.lag, a whole number of the input's Periods. order is always stated. The output's unit is the entry's own unit. Only the engine in packages/core computes a Recipe (ADR 0003); other code may only check its structure.
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
 * Macro Atlas release contract, v0 (schema_version 0.1.0). A Release is a directory; this schema describes it gathered into one object: manifest.json, catalog.json, series/{key}.json, derived/{key}.json and content/annotations.json. It is the seam between the writer and every reader (PLAN 4.2). Conventions the schema cannot express, and the cross-file rules, are in schema/README.md. Structural validity is not authorisation: whether a series may appear on a Surface is decided by permits() and the rights register.
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
  annotations: AnnotationsFile;
}
/**
 * manifest.json: what this Release is and what it holds. created is when the Release was written, and is also the fixed date against which staleness (max_lag) is judged, so a Release never changes state as the clock moves.
 *
 * This interface was referenced by `Release`'s JSON-Schema
 * via the `definition` "manifest".
 */
export interface Manifest {
  /**
   * Version of this contract. Readers refuse a version they do not know.
   */
  schema_version: "0.1.0";
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
   * Hash of the register file at that version; null before the register exists (M6).
   */
  sha256: Sha256 | null;
  signed: boolean;
}
/**
 * sha256 is the hash of the file's exact bytes.
 */
export interface ManifestSeries {
  /**
   * stored: series/{key}.json. derived: derived/{key}.json.
   */
  kind: "stored" | "derived";
  sha256: Sha256;
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
 * Percent change of one input from params.lag of its Periods earlier.
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
   * Path of the content record behind this Annotation (an Event or Claim), or null.
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
