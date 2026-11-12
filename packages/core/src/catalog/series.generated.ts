// GENERATED from schema/series.schema.json by scripts/gen-schema.mjs. Do not edit.

/**
 * A Series' permanent public key. Also a file name, so it is restricted to safe characters.
 *
 * This interface was referenced by `Series`'s JSON-Schema
 * via the `definition` "key".
 */
export type SeriesKey = string;
/**
 * Native frequency. daily covers every calendar day; business_daily covers Monday to Friday (a holiday is an explicit missing Observation); irregular has no fixed cadence (for example one Observation per election).
 *
 * This interface was referenced by `Series`'s JSON-Schema
 * via the `definition` "frequency".
 */
export type Frequency =
  "daily" | "business_daily" | "weekly" | "monthly" | "quarterly" | "annual" | "irregular";
/**
 * Origin and Channel, never merged. The Channel is the one Macro Atlas uses or proposes to use; an Endpoint is named only once an adapter fetches it. Where no route is known, channel is null and no_channel says why: the Series stays in the Catalog and is withheld.
 *
 * This interface was referenced by `Series`'s JSON-Schema
 * via the `definition` "seriesSource".
 */
export type SeriesSource = SourcedSeries | UnsourcedSeries;
/**
 * The label of a Period: 2024 (annual), 2024-Q1, 2024-01, 2024-W03 (ISO week), 2024-01-15 (a day; also used by irregular series).
 *
 * This interface was referenced by `Series`'s JSON-Schema
 * via the `definition` "period".
 */
export type PeriodLabel = string;
/**
 * The declared rule that produces a Derived series. inputs are ordered: ratio is inputs[0] / inputs[1] and difference is inputs[0] - inputs[1], each with exactly two inputs; sum and product take two or more; pct_change takes one input and params.lag, a whole number of Periods at the frequency the arithmetic is done at: the Derived series' own under aggregate_then_compute, the input's under compute_then_aggregate (docs/method/transforms.md). order is always stated. The output's unit is the entry's own unit. Only the engine in packages/core computes a Recipe (ADR 0003); other code may only check its structure.
 *
 * This interface was referenced by `Series`'s JSON-Schema
 * via the `definition` "recipe".
 */
export type Recipe = PairRecipe | CombineRecipe | PercentChangeRecipe;
/**
 * Whether inputs are brought to the output frequency before or after the arithmetic. Always stated; there is no default.
 *
 * This interface was referenced by `Series`'s JSON-Schema
 * via the `definition` "recipeOrder".
 */
export type RecipeOrder = "aggregate_then_compute" | "compute_then_aggregate";
/**
 * A calendar date, YYYY-MM-DD, in years 0001 to 9999. No time and no zone.
 *
 * This interface was referenced by `Series`'s JSON-Schema
 * via the `definition` "date".
 */
export type CalendarDate = string;
/**
 * An instant in UTC, written exactly as YYYY-MM-DDTHH:MM:SS, an optional fraction of up to nine digits, then Z. No offsets, no leap seconds, no lower case.
 *
 * This interface was referenced by `Series`'s JSON-Schema
 * via the `definition` "datetime".
 */
export type Instant = string;
/**
 * An instant in UTC, written exactly as YYYY-MM-DDTHH:MM:SS, an optional fraction of up to nine digits, then Z. No offsets, no leap seconds, no lower case.
 */
export type Instant1 = string;

/**
 * One entry of the Catalog (PLAN 5; ADR 0026): catalog/series/{key}.json. A stored Series names its Source (Origin and Channel); a Derived series names its Recipe and no Source, since its lineage is the Recipe's inputs. There is no Rights block and no Permission here: both are looked up in the rights register (schema/rights-register.json) for the entry's Origin, dataset and Channel whenever the Catalog is read, so nothing an entry says can grant anything. The definitions shared with the release contract (key, frequency, origin, channel, recipe) are copies of schema/release.schema.json's, kept equal by a test. Rules a schema cannot express are the layers of `python -m atlas check` (docs/method/catalog.md).
 */
export interface Series {
  key: SeriesKey;
  /**
   * Other keys that resolve to this Series. None may be another Series' key.
   */
  aliases?: SeriesKey[];
  name: string;
  description?: string;
  definition?: SeriesDefinition;
  /**
   * The unit in words, as shown to a reader.
   */
  unit: string;
  unit_kind:
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
  agg: "mean" | "last" | "sum" | "none";
  freq: Frequency;
  /**
   * discrete: each Observation describes its own Period only. held: a value stands from its Period until the next Observation (drawn as a step); a missing Observation ends the hold, and the last value stands until the Release's created date.
   */
  continuity: "discrete" | "held";
  seasonal_adjustment: "sa" | "nsa" | "saar" | "not_applicable";
  price_basis: "nominal" | "real" | "not_applicable";
  /**
   * What an index equals 100 in, or the year of the prices a real figure is in.
   */
  base_period?: string;
  allowed_transforms?: string[];
  /**
   * ISO 3166-1 alpha-3 (three capital letters; the schema checks the shape, not the list), or a group code: EA (euro area), EU, G20, WLD.
   */
  country: string | ("EA" | "EU" | "G20" | "WLD");
  segment:
    | "economy_jobs"
    | "markets_money"
    | "infrastructure"
    | "governance_politics"
    | "disasters_health"
    | "us_in_the_world";
  topics?: string[];
  source?: SeriesSource;
  fallback?: FallbackSource[];
  /**
   * How often the Origin publishes new or revised values. none: the Series has ended or has no source.
   */
  refresh: "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "irregular" | "none";
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
  /**
   * draft: declared, not yet in the pipeline. active: captured and recorded (a stored Series names its Endpoint) or computed (a Derived series). retired: no longer updated.
   */
  status: "draft" | "active" | "retired";
  recipe?: Recipe;
  /**
   * The date the Origin has announced for its next publication, when known.
   */
  next_release?: CalendarDate | null;
  migration?: MigrationNote;
  /**
   * Earlier versions of name, unit and seasonal_adjustment, oldest first, in the shape the vintage store replays (ADR 0022): the first is in force from the start (from: null), each later one from its own instant. A version that has been in force is never edited; when the declared metadata changes, the old version is moved here and metadata_from says when the entry's own took effect.
   *
   * @minItems 1
   */
  earlier_metadata?: [EarlierMetadata, ...EarlierMetadata[]];
  metadata_from?: Instant1;
}
export interface SeriesDefinition {
  population?: string;
  geography?: string;
  denominator?: string;
}
export interface SourcedSeries {
  origin: Origin;
  channel: Channel;
}
/**
 * The organisation that produces a Series and the dataset and identifier it publishes it under.
 *
 * This interface was referenced by `Series`'s JSON-Schema
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
 * This interface was referenced by `Series`'s JSON-Schema
 * via the `definition` "channel".
 */
export interface Channel {
  via: string;
  adapter?: string;
  endpoint?: string;
  auth?: "none" | "api_key";
}
export interface UnsourcedSeries {
  origin: Origin;
  channel: null;
  no_channel: NoChannel;
}
/**
 * Why a Series has no Channel. rights_restriction: the terms read forbid republication on every free channel found. no_route_established: no origin-agency route has been found or assessed yet. discontinued: the Origin no longer publishes it.
 *
 * This interface was referenced by `Series`'s JSON-Schema
 * via the `definition` "noChannel".
 */
export interface NoChannel {
  kind: "rights_restriction" | "no_route_established" | "discontinued";
  reason: string;
}
/**
 * Another Source the Series could be taken from. Listing one clears nothing: it is asked about at the rights gate like any other.
 *
 * This interface was referenced by `Series`'s JSON-Schema
 * via the `definition` "fallback".
 */
export interface FallbackSource {
  origin: Origin;
  channel: Channel;
  note?: string;
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
 * Where a Series carried over from v1 came from there, and what is proposed for it. Information for the migration table (docs/v2/catalog-migration.md); it decides nothing.
 *
 * This interface was referenced by `Series`'s JSON-Schema
 * via the `definition` "migration".
 */
export interface MigrationNote {
  /**
   * v1's own source label, such as FRED CPIAUCSL.
   */
  v1_source: string;
  note?: string;
  /**
   * The milestone or release planned to build the adapter.
   */
  milestone?: string;
  /**
   * How the proposed Source's figure relates to the one v1 showed under this key. same: the same quantity. representation: the same quantity at another cadence, unit, scale or base. different: another quantity (a deliberate, recorded exception; otherwise a different quantity takes a new key).
   */
  change: "same" | "representation" | "different";
}
/**
 * A version of the declared metadata that is no longer in force, with the instant it took effect (null: from the start).
 *
 * This interface was referenced by `Series`'s JSON-Schema
 * via the `definition` "metadataVersion".
 */
export interface EarlierMetadata {
  from: Instant | null;
  name: string;
  unit: string;
  seasonal_adjustment: "sa" | "nsa" | "saar" | "not_applicable";
}
