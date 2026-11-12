/**
 * Query (PLAN 4.2): the one way a page, a twin or the read API gets values.
 *
 * `query(release, surface, request)` takes one request shape, validates it, asks the rights gate
 * about the full lineage of everything asked for, and only then lets the engine answer from the
 * Release it was given, in the engine's order (PLAN 4.5): resolve the Vintage, bring it to the
 * frequency asked for, apply the Transform. `vintageTable()` is the same gate over the versions a
 * Release holds of each Period. Neither opens a Release: the caller has fixed one for the request
 * (ADR 0015), and a Release that may not be served never reaches here (the proxy answers 503).
 *
 * Hidden here: request validation; the rights lineage of a derived Series (the closure of its
 * Recipe inputs) and of a Series' past (every Origin and Channel its history came through, ADR
 * 0024); the call to the gate; the Basis of the Periods an answer actually used; the metadata in
 * force at a Cutoff and what it keeps out of arithmetic; the caps on rows, on history read and on
 * time; and turning each refusal into a status. What a Transform, an aggregation or a Cutoff
 * means is the engine's business (`@macro-atlas/core`, docs/method/).
 *
 * Node only (it takes an opened Release); pure otherwise.
 */
import {
  aggregate,
  cutoffFor,
  FREQUENCIES,
  PERMISSIONS,
  permits,
  SEMANTICS_VERSION,
  transform,
  TRANSFORMS,
  weakestBasis,
  type AggregateMethod,
  type CaptureGap,
  type Cutoff,
  type Frequency,
  type Permission,
  type RightsGate,
  type RightsUse,
  type Surface,
  type TransformAggregation,
  type TransformName,
  type TransformObservation,
  type TransformResult,
  type VintageBasis,
  type VintageObservation,
} from "@macro-atlas/core";
import type { CatalogEntry, SeriesFile } from "@macro-atlas/core/release";
import { asOf, derivedAsOf } from "../release/as-of";
import type { OpenedRelease } from "../release/reader";

/** The Explorer's limit in v1, and a readable chart's. */
export const MAX_SERIES = 8;
/** Observations in one answer. Bounds the work and the bytes; a larger request must be narrowed. */
export const MAX_ROWS = 50_000;
/** Versions read to answer one as-of question or one vintage table, over every Series it rests on. */
export const MAX_VINTAGE_ROWS = 250_000;
/** How long one answer may take. An answer that took longer is not given, even if it finished. */
export const MAX_MS = 5_000;
/** The bytes of one twin or API body (the serialisers ask `tooManyBytes`). */
export const MAX_BYTES = 8 * 1024 * 1024;

export const AGGREGATIONS = ["mean", "last", "sum"] as const;
/** The frequencies a Series can be brought to: every one that has regular Periods. */
export const TARGET_FREQUENCIES = FREQUENCIES.filter((f) => f !== "irregular");

export type QueryRequest = {
  /** One to eight Series keys, in the order they are wanted. */
  series: string[];
  transform: TransformName;
  /** Calendar dates, both inclusive; either may be left out. */
  from?: string;
  to?: string;
  /** What the answer is for: showing on a page, or handing out as a file or through the API. */
  permission: Permission;
  /** A slower frequency to bring each Series to before the Transform. */
  freq?: Frequency;
  /** How to combine, in place of the Series' declared rule; only one its Measure kind allows. */
  agg?: AggregateMethod;
  /** What was known before this date (00:00 in New York) or instant. */
  as_of?: string;
};

export type QueryOptions = {
  maxRows?: number;
  maxVintageRows?: number;
  maxMs?: number;
  /** Milliseconds, from any fixed start. */
  clock?: () => number;
  /**
   * The gate to ask. Left out, it is the gate over the committed rights register, which is what
   * the app always uses; a test passes one to see how a signed row would be honoured.
   */
  gate?: Pick<RightsGate, "permits">;
};

export type QueryFailure = {
  ok: false;
  status: 400 | 403 | 404 | 422 | 503;
  code: "bad_request" | "unknown_series" | "withheld" | "not_permitted" | "too_large" | "too_slow";
  message: string;
};

/** The engine's answer, or why there is none for this Series: a Transform's reason, an aggregation's, or a Recipe's. */
export type SeriesResult = TransformResult | { ok: false; transform: string; reason: string; message: string };

export type Evidence = Pick<VintageObservation, "period" | "basis" | "known_from" | "known_by" | "last_checked">;

/** What an as-of answer rests on. */
export type VintageInfo = {
  as_of: string;
  /** The weakest Basis among the Periods the answer used (ADR 0024), look-back included. */
  basis: VintageBasis;
  /** Why the answer is unavailable. It then holds no Observation. */
  reason?: string;
  cutoff: Cutoff | null;
  capture_gap: CaptureGap | null;
  same_day_release: boolean;
  /** The metadata in force at the Cutoff, where one was. */
  metadata: { unit: string; in_force_from: string | null; differs_from_current: boolean; other_metadata_periods: string[] } | null;
  /** Periods kept out of arithmetic because they were still held under other metadata. */
  left_out_periods: string[];
  /** Each Observation's own evidence, when the Series is answered as it is; null once Periods are combined. */
  evidence: Evidence[] | null;
  /** A Derived series: how each stored input was resolved. */
  inputs: { key: string; basis: VintageBasis | null; capture_gap: CaptureGap | null; same_day_release: boolean }[] | null;
};

export type SeriesAnswer = {
  key: string;
  name: string;
  /** The unit of the Series' own values: the one in force at the Cutoff for an as-of answer. */
  unit: string;
  /** The Series' own frequency. */
  freq: CatalogEntry["freq"];
  /** The frequency of the Observations in `result`. */
  answered_freq: CatalogEntry["freq"];
  /** Said when the answer is not at the Series' own frequency. */
  aggregated: TransformAggregation | null;
  continuity: CatalogEntry["continuity"];
  representation: CatalogEntry["representation"];
  source: CatalogEntry["source"];
  /** Null unless the request asked what was known before a date. */
  vintage: VintageInfo | null;
  result: SeriesResult;
};

export type QueryAnswer = {
  ok: true;
  release_id: string;
  semantics_version: string;
  request: QueryRequest;
  series: SeriesAnswer[];
  /** The lineage the rights gate was asked about. */
  rights_used: RightsUse[];
  rows: number;
};

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIELDS = new Set(["series", "transform", "from", "to", "permission", "freq", "agg", "as_of"]);

const fail = (status: QueryFailure["status"], code: QueryFailure["code"], message: string): QueryFailure => ({
  ok: false,
  status,
  code,
  message,
});
const bad = (message: string): QueryFailure => fail(400, "bad_request", message);

function isDate(text: string): boolean {
  if (!DATE.test(text) || text.startsWith("0000")) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** The request, checked field by field. Anything the shape does not name is refused. */
export function parseQueryRequest(raw: unknown): QueryRequest | QueryFailure {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("a query is an object");
  const r = raw as Record<string, unknown>;
  for (const field of Object.keys(r)) {
    if (!FIELDS.has(field)) return bad(`a query has no field called ${JSON.stringify(field)}`);
  }
  const { series, from, to, freq, agg, as_of } = r;
  if (!Array.isArray(series) || series.length < 1) return bad("series: name at least one series");
  if (series.length > MAX_SERIES) return bad(`series: at most ${MAX_SERIES} at once`);
  for (const key of series) {
    if (typeof key !== "string" || !KEY.test(key)) return bad("series: each entry is a series key");
  }
  if (new Set(series).size !== series.length) return bad("series: the same series is named twice");
  if (typeof r.transform !== "string" || !(TRANSFORMS as readonly string[]).includes(r.transform)) {
    return bad(`transform: one of ${TRANSFORMS.join(", ")}`);
  }
  if (typeof r.permission !== "string" || !(PERMISSIONS as readonly string[]).includes(r.permission)) {
    return bad(`permission: one of ${PERMISSIONS.join(", ")}`);
  }
  for (const [name, value] of [["from", from], ["to", to]] as const) {
    if (value !== undefined && (typeof value !== "string" || !isDate(value))) {
      return bad(`${name}: a calendar date, written YYYY-MM-DD`);
    }
  }
  if (typeof from === "string" && typeof to === "string" && from > to) return bad("the window ends before it starts");
  if (freq !== undefined && (typeof freq !== "string" || !(TARGET_FREQUENCIES as readonly string[]).includes(freq))) {
    return bad(`freq: one of ${TARGET_FREQUENCIES.join(", ")}`);
  }
  if (agg !== undefined && (typeof agg !== "string" || !(AGGREGATIONS as readonly string[]).includes(agg))) {
    return bad(`agg: one of ${AGGREGATIONS.join(", ")}`);
  }
  if (as_of !== undefined && (typeof as_of !== "string" || cutoffFor(as_of) === null)) {
    return bad("as_of: a calendar date from 1900 on, written YYYY-MM-DD, or an instant written YYYY-MM-DDTHH:MM:SSZ");
  }
  const request: QueryRequest = {
    series: series as string[],
    transform: r.transform as TransformName,
    permission: r.permission as Permission,
  };
  if (typeof from === "string") request.from = from;
  if (typeof to === "string") request.to = to;
  if (typeof freq === "string") request.freq = freq as Frequency;
  if (typeof agg === "string") request.agg = agg as AggregateMethod;
  if (typeof as_of === "string") request.as_of = as_of;
  return request;
}

export type Lineage =
  | { ok: true; /** Every Series the answer rests on: those asked for and all their inputs. */ series: string[]; rightsUsed: RightsUse[] }
  | QueryFailure;

const own = <T>(folder: Record<string, T>, key: string): T | undefined => (Object.hasOwn(folder, key) ? folder[key] : undefined);

/**
 * Everything the Series in `keys` rest on, as rows for the rights gate: each Series' own Origin
 * and Channel, and those of every input of a derived Series, to any depth. A Series that is
 * unknown or withheld, or an input that cannot be found, ends in a refusal.
 *
 * With `history`, the rows also name every Origin, dataset and Channel that the past versions of
 * those Series came through, as their vintage files record it: past values are values (ADR 0024).
 */
export function rightsLineage(release: OpenedRelease, keys: readonly string[], permission: Permission, options: { history?: boolean } = {}): Lineage {
  const entries = new Map(release.catalog.series.map((entry) => [entry.key, entry]));
  const withheld = new Map(release.manifest.withheld.map((row) => [row.key, row.reason]));
  const reached = new Set<string>();
  const stack = [...keys];
  while (stack.length > 0) {
    const key = stack.pop()!;
    if (reached.has(key)) continue;
    const entry = entries.get(key);
    if (!entry) return fail(404, "unknown_series", `there is no series called ${key} in this release`);
    const reason = withheld.get(key);
    if (reason !== undefined) return fail(403, "withheld", `${entry.name} (${key}) is withheld: ${reason}`);
    reached.add(key);
    for (const input of entry.recipe?.inputs ?? []) stack.push(input);
  }
  const rows = new Map<string, RightsUse>();
  const add = (origin: string, dataset: string, channel: string, representation: RightsUse["representation"]) => {
    const row: RightsUse = { origin, dataset, channel, representation, permission };
    rows.set(JSON.stringify(row), row);
  };
  for (const key of [...reached].sort()) {
    const entry = entries.get(key)!;
    add(entry.source.origin.producer, entry.source.origin.dataset, entry.source.channel.via, entry.representation);
    const file = options.history ? own(release.vintages, key) : undefined;
    if (!file) continue;
    // The same rows the release writer asks about (atlas/publish/export.py, history_lineages).
    const sources = new Map<string, { producer: string; dataset: string }[]>();
    for (const line of file.metadata) {
      const { origin, channel } = line.metadata.source;
      add(origin.producer, origin.dataset, channel.via, file.representation);
      sources.set(line.hash, [...(sources.get(line.hash) ?? []), { producer: origin.producer, dataset: origin.dataset }]);
    }
    const seen = new Set<string>();
    for (const row of file.rows) {
      const pair = `${row.metadata} ${row.channel}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      const named = sources.get(row.metadata);
      if (!named) return fail(403, "not_permitted", `the history of ${key} does not say where every version came from, so it is not shown`);
      for (const source of named) add(source.producer, source.dataset, row.channel, file.representation);
    }
  }
  return { ok: true, series: [...reached].sort(), rightsUsed: [...rows.values()] };
}

/**
 * Ask the gate whether these Series may be used this way here, without answering anything: for a
 * page that must decide whether to offer a download. A denial carries the gate's own reason.
 */
export function askGate(
  release: OpenedRelease,
  surface: Surface,
  keys: readonly string[],
  permission: Permission,
  options: { history?: boolean; gate?: Pick<RightsGate, "permits"> } = {},
): Lineage {
  const lineage = rightsLineage(release, keys, permission, { history: options.history });
  if (!lineage.ok) return lineage;
  const decision = options.gate ? options.gate.permits(lineage.rightsUsed, surface) : permits(lineage.rightsUsed, surface);
  if (!decision.allowed) return fail(403, "not_permitted", decision.reason);
  return lineage;
}

const fileOf = (release: OpenedRelease, key: string): SeriesFile | undefined => own(release.series, key) ?? own(release.derived, key);

/** Whether a body is larger than a twin or an API answer may be. */
export function tooManyBytes(body: string, max: number = MAX_BYTES): QueryFailure | null {
  return Buffer.byteLength(body, "utf8") > max ? fail(422, "too_large", `the answer would be larger than ${max} bytes; ask for a shorter window`) : null;
}

/** Versions the Release holds for these Series, counted before any of them is read. */
function historySize(release: OpenedRelease, keys: readonly string[]): number {
  let rows = 0;
  for (const key of keys) rows += own(release.vintages, key)?.rows.length ?? 0;
  return rows;
}
const historyTooLong = (max: number): QueryFailure => fail(422, "too_large", `the history asked for holds more than ${max} versions; ask for fewer series`);

/** Transforms that set a Period beside the one before it, and beside the one a year earlier. */
const PERIOD_BEFORE = new Set<string>(["chg", "pch", "pca"]);
const YEAR_BEFORE = new Set<string>(["ch1", "pc1"]);
const yearBefore = (date: string): string => {
  const year = String(Number(date.slice(0, 4)) - 1).padStart(4, "0");
  // 29 February has no day a year earlier; the 28th is inside the same month.
  return `${year}${date.slice(4) === "-02-29" ? "-02-28" : date.slice(4)}`;
};
/** A stretch of calendar days, both inclusive. */
type Span = { from: string; to: string };
const shifted = (span: Span, months: number): Span => {
  const move = (date: string, end: boolean): string => {
    const total = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 - months;
    const [year, month] = [Math.floor(total / 12), (total % 12) + 1];
    const last = new Date(Date.UTC(2000, month, 0));
    last.setUTCFullYear(year, month, 0);
    const day = end ? last.getUTCDate() : Math.min(Number(date.slice(8, 10)), last.getUTCDate());
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  return { from: move(span.from, false), to: move(span.to, true) };
};
const MONTHS_PER_PERIOD: Partial<Record<Frequency, number>> = { monthly: 1, quarterly: 3, annual: 12 };

/**
 * The days whose Observations an answer rests on: the Periods it shows, and those its Transform
 * set them beside (the Period before, or the same Periods a year earlier). `sequence` is what
 * the Transform was given, so "the Period before" is the one before in that sequence.
 */
function spansUsed(shown: readonly TransformObservation[], sequence: readonly TransformObservation[], name: TransformName): Span[] {
  if (shown.length === 0) return [];
  const first = shown[0]!;
  const span: Span = { from: first.period_start, to: shown[shown.length - 1]!.period_end };
  if (PERIOD_BEFORE.has(name)) {
    const at = sequence.findIndex((o) => o.period === first.period);
    if (at > 0) span.from = sequence[at - 1]!.period_start;
    // Not in the sequence: the Transform brought it to months itself. A year back covers any Period before.
    else if (at < 0) span.from = yearBefore(span.from);
    return [span];
  }
  if (YEAR_BEFORE.has(name)) return [span, { from: yearBefore(span.from), to: yearBefore(span.to) }];
  return [span];
}
const within = (spans: readonly Span[], o: { period_start: string; period_end: string }): boolean => spans.some((span) => o.period_end >= span.from && o.period_start <= span.to);
/** The Basis an answer on Macro Atlas's clock starts from: the last Capture before the Cutoff. */
const clockBasis = (gap: CaptureGap | null, basis: VintageBasis): VintageBasis => (gap ? (gap.missed_days > 0 ? "uncertain" : "atlas_observed") : basis);
const plain = (o: TransformObservation, value: number | null = o.value): TransformObservation => ({
  period: o.period,
  period_start: o.period_start,
  period_end: o.period_end,
  value,
  status: value === null ? "missing" : o.status,
});

type Resolved = { observations: readonly TransformObservation[]; unit: string; vintage: VintageInfo | null; early?: SeriesResult; resolved?: readonly VintageObservation[]; clock?: VintageBasis; /** A Derived series the engine computed: its Basis is narrowed input by input. */ computed?: true };

/** Stage one: the Vintage. Without an as-of question, the Release's own state. */
function resolved(release: OpenedRelease, entry: CatalogEntry, file: SeriesFile, request: QueryRequest, combining: boolean): Resolved {
  const date = request.as_of;
  if (date === undefined) return { observations: file.observations, unit: entry.unit, vintage: null };
  const none: SeriesResult = { ok: true, transform: request.transform, observations: [] };

  const computed = derivedAsOf(release, entry.key, date);
  if (computed) {
    const basis = computed.basis ?? "unavailable";
    const vintage: VintageInfo = {
      as_of: date,
      basis,
      ...(computed.unavailable && basis === "unavailable" ? { reason: computed.unavailable.reason } : {}),
      cutoff: cutoffFor(date),
      capture_gap: null,
      same_day_release: computed.inputs.some((input) => input.same_day_release),
      metadata: null,
      left_out_periods: [...new Set(computed.inputs.flatMap((input) => input.left_out_periods))].sort(),
      evidence: null,
      inputs: computed.inputs.map((input) => ({ key: input.key, basis: input.basis, capture_gap: input.capture_gap, same_day_release: input.same_day_release })),
    };
    if (basis === "unavailable") return { observations: [], unit: entry.unit, vintage, early: none };
    if (computed.unavailable) {
      return { observations: [], unit: entry.unit, vintage, early: { ok: false, transform: request.transform, reason: computed.unavailable.reason, message: computed.unavailable.message } };
    }
    return { observations: computed.observations, unit: entry.unit, vintage, computed: true };
  }

  const answer = asOf(release, entry.key, date)!;
  const basis = answer.basis ?? "unavailable";
  const others = answer.metadata?.other_metadata_periods ?? [];
  const vintage: VintageInfo = {
    as_of: date,
    basis,
    ...(answer.reason ? { reason: answer.reason } : {}),
    cutoff: answer.cutoff,
    capture_gap: answer.capture_gap,
    same_day_release: answer.same_day_release,
    metadata: answer.metadata
      ? { unit: answer.metadata.metadata.unit, in_force_from: answer.metadata.in_force_from, differs_from_current: answer.metadata.differs_from_current, other_metadata_periods: others }
      : null,
    left_out_periods: [],
    evidence: null,
    inputs: null,
  };
  if (basis === "unavailable") return { observations: [], unit: entry.unit, vintage, early: none };
  const unit = answer.metadata?.metadata.unit ?? entry.unit;
  const clock = clockBasis(answer.capture_gap, basis);
  if (!combining) return { observations: answer.observations.map((o) => plain(o)), unit, vintage, resolved: answer.observations, clock };
  // Arithmetic across Periods needs them under one unit and definition (as a Recipe does).
  if (answer.metadata === null && basis !== "legacy" && answer.observations.length > 0) {
    const message = "the versions known then were recorded under more than one unit or definition, and which applied to each period cannot be told; nothing is computed across them";
    return { observations: [], unit, vintage, early: { ok: false, transform: request.transform, reason: "metadata_mixed", message } };
  }
  const out = new Set(others);
  vintage.left_out_periods = others;
  return { observations: answer.observations.map((o) => (out.has(o.period) ? plain(o, null) : plain(o))), unit, vintage, resolved: answer.observations, clock };
}

/**
 * The Basis of a Derived answer narrowed to the days it used: each stored input resolved on its
 * own, and judged by its Periods in those days and in the days its Recipe looks back to. Null
 * when that cannot be worked out exactly (a Recipe over other Recipes, or a look-back counted in
 * Periods that are not months): the answer then keeps the weakest Basis of its whole inputs,
 * which claims no more than is true.
 */
function derivedBasis(release: OpenedRelease, entry: CatalogEntry, spans: readonly Span[], date: string): VintageBasis | null {
  const recipe = entry.recipe;
  if (!recipe || spans.length === 0) return null;
  const entries = new Map(release.catalog.series.map((e) => [e.key, e]));
  if (recipe.inputs.some((input) => entries.get(input)?.recipe)) return null;
  let all = [...spans];
  if (recipe.op === "pct_change") {
    const months = MONTHS_PER_PERIOD[entry.freq];
    const lag = Number(recipe.params.lag);
    if (months === undefined || !Number.isInteger(lag) || lag < 1) return null;
    all = [...all, ...spans.map((span) => shifted(span, lag * months))];
  }
  const bases: VintageBasis[] = [];
  for (const input of recipe.inputs) {
    const answer = asOf(release, input, date);
    if (!answer || answer.basis === null) return null;
    bases.push(clockBasis(answer.capture_gap, answer.basis), ...answer.observations.filter((o) => within(all, o)).flatMap((o) => (o.basis ? [o.basis] : [])));
  }
  return weakestBasis(bases);
}

export function query(release: OpenedRelease, surface: Surface, raw: unknown, options: QueryOptions = {}): QueryAnswer | QueryFailure {
  const clock = options.clock ?? (() => performance.now());
  const started = clock();
  const maxMs = options.maxMs ?? MAX_MS;
  const late = (): QueryFailure | null => (clock() - started > maxMs ? fail(503, "too_slow", `the answer took longer than ${maxMs} ms; ask for fewer series or a shorter window`) : null);

  const request = parseQueryRequest(raw);
  if ("ok" in request) return request;
  const history = request.as_of !== undefined;
  const lineage = askGate(release, surface, request.series, request.permission, { history, gate: options.gate });
  if (!lineage.ok) return lineage;
  const maxVintageRows = options.maxVintageRows ?? MAX_VINTAGE_ROWS;
  if (history && historySize(release, lineage.series) > maxVintageRows) return historyTooLong(maxVintageRows);

  const maxRows = options.maxRows ?? MAX_ROWS;
  const entries = new Map(release.catalog.series.map((entry) => [entry.key, entry]));
  const window = { from: request.from, to: request.to };
  const series: SeriesAnswer[] = [];
  let rows = 0;
  for (const key of request.series) {
    const entry = entries.get(key)!;
    const file = fileOf(release, key);
    if (!file) return fail(404, "unknown_series", `this release holds no values for ${key}`);
    const slower = request.freq !== undefined && request.freq !== file.freq;
    const agg = request.agg ?? entry.agg;

    const first = resolved(release, entry, file, request, slower || request.transform !== "lin");
    let over = late();
    if (over) return over;

    let result: SeriesResult | undefined = first.early;
    let observations = first.observations;
    let freq: Frequency = file.freq;
    let aggregated: TransformAggregation | null = null;
    /** What the Transform was given, for "the Period before". */
    let transformed: readonly TransformObservation[] = [];
    if (!result && slower) {
      const brought = aggregate({ freq, continuity: entry.continuity, measure_kind: entry.measure_kind, agg, observations }, request.freq!);
      if (!brought.ok) result = { ok: false, transform: request.transform, reason: brought.reason, message: brought.message };
      else {
        if (brought.method) aggregated = { from: file.freq, to: brought.freq, method: brought.method };
        observations = brought.observations.map((o) => plain(o));
        freq = brought.freq;
      }
      over = late();
      if (over) return over;
    }
    if (!result) {
      transformed = observations;
      const answered = transform({ freq, continuity: entry.continuity, observations, allowed: entry.allowed_transforms, measure_kind: entry.measure_kind, agg }, request.transform, window);
      if (answered.ok && answered.aggregated) {
        aggregated = { from: file.freq, to: answered.aggregated.to, method: answered.aggregated.method };
        freq = answered.aggregated.to;
      }
      result = answered;
    }
    if (result.ok) rows += result.observations.length;
    if (rows > maxRows) {
      return fail(422, "too_large", `the answer would hold more than ${maxRows} observations; ask for fewer series or a shorter window`);
    }

    const vintage = first.vintage;
    if (vintage && result.ok && (first.resolved || first.computed)) {
      // The Basis of what the answer used: its own Periods, and those a Transform set them beside.
      const shown = result.observations;
      const spans = spansUsed(shown, transformed, request.transform);
      if (first.resolved && first.clock) {
        const used = first.resolved.filter((o) => within(spans, o));
        vintage.basis = weakestBasis([first.clock, ...used.flatMap((o) => (o.basis ? [o.basis] : []))]) ?? vintage.basis;
        if (!slower && request.transform === "lin") {
          const byPeriod = new Map(first.resolved.map((o) => [o.period, o]));
          vintage.evidence = shown.map((o) => {
            const e = byPeriod.get(o.period);
            return { period: o.period, basis: e?.basis ?? null, known_from: e?.known_from ?? null, known_by: e?.known_by ?? null, last_checked: e?.last_checked ?? null };
          });
        }
      } else {
        const narrowed = derivedBasis(release, entry, spans, request.as_of!);
        if (narrowed) vintage.basis = narrowed;
      }
    }

    series.push({
      key,
      name: entry.name,
      unit: first.unit,
      freq: entry.freq,
      answered_freq: freq,
      aggregated,
      continuity: entry.continuity,
      representation: entry.representation,
      source: entry.source,
      vintage,
      result,
    });
    over = late();
    if (over) return over;
  }
  return {
    ok: true,
    release_id: release.id,
    semantics_version: SEMANTICS_VERSION,
    request,
    series,
    rights_used: lineage.rightsUsed,
    rows,
  };
}

/** One version of one Observation, with the two clocks it can be dated by kept apart. */
export type Version = {
  period: string;
  period_start: string;
  period_end: string;
  value: number | null;
  status: string | null;
  /** A tombstone: the Period was held, was asked about again and was no longer in a complete answer. */
  withdrawn: boolean;
  /** Macro Atlas's clock: the Captures that first held the version and that replaced it. */
  held_from: string;
  held_to: string | null;
  /** The Origin's clock: when it published the version and when it replaced it, to the day or the instant. */
  published: string | null;
  published_precision: "date" | "datetime" | null;
  superseded: string | null;
  /** Whether this is the version the Release holds now. */
  current: boolean;
};

export type VintageTable =
  | { ok: true; held: false; key: string; why: "no_vintages" | "derived" | "legacy" }
  | {
      ok: true;
      held: true;
      key: string;
      freq: Frequency;
      release_id: string;
      /** The span over which the Origin's own record of its releases is known complete. */
      provider_coverage: { from: string; to: string } | null;
      /** In Period order; within a Period, oldest first. */
      versions: Version[];
      /** Periods whose value or Status changed, or that were withdrawn. */
      revised_periods: string[];
      captures: { count: number; first: string | null; last: string | null; /** New York days between them with no Capture (at most 60 listed). */ missed_days: string[]; missed_count: number };
      /** When the Series' unit, definition or Source changed, as Macro Atlas recorded it. */
      metadata_changes: { recorded_from: string; unit: string; name: string }[];
      rights_used: RightsUse[];
    }
  | QueryFailure;

const DAY_MS = 86_400_000;

/**
 * Every version a Release holds of each Period of one stored Series (`vintages/{key}.json`),
 * or of one Period. The same gate as `query()`, asked about the Series' whole past.
 */
export function vintageTable(
  release: OpenedRelease,
  surface: Surface,
  key: string,
  options: { period?: string; permission?: Permission; gate?: Pick<RightsGate, "permits">; maxVintageRows?: number; maxMs?: number; clock?: () => number } = {},
): VintageTable {
  const clock = options.clock ?? (() => performance.now());
  const started = clock();
  const maxMs = options.maxMs ?? MAX_MS;
  const late = (): QueryFailure | null => (clock() - started > maxMs ? fail(503, "too_slow", `the history took longer than ${maxMs} ms to read`) : null);
  if (typeof key !== "string" || !KEY.test(key)) return bad("that is not a series key");
  if (options.period !== undefined && (typeof options.period !== "string" || !/^[0-9A-Za-z-]{1,16}$/.test(options.period))) return bad("period: a period label, such as 2025-11 or 2025-Q3");
  const lineage = askGate(release, surface, [key], options.permission ?? "display", { history: true, gate: options.gate });
  if (!lineage.ok) return lineage;
  const entry = release.catalog.series.find((e) => e.key === key)!;
  const file = own(release.vintages, key);
  if (!file) return { ok: true, held: false, key, why: entry.recipe ? "derived" : entry.representation !== "native" ? "legacy" : "no_vintages" };
  const max = options.maxVintageRows ?? MAX_VINTAGE_ROWS;
  if (file.rows.length > max) return historyTooLong(max);
  let over = late();
  if (over) return over;

  const day = (instant: string | null, precision: "date" | "datetime" | null): string | null => (instant === null ? null : precision === "date" ? instant.slice(0, 10) : instant);
  const versions: Version[] = [];
  const changed = new Set<string>();
  let before: (typeof file.rows)[number] | null = null;
  for (const row of file.rows) {
    if (before && before.period === row.period && (row.deleted || before.deleted || before.value !== row.value || before.status !== row.status)) changed.add(row.period);
    else if (row.deleted) changed.add(row.period);
    before = row;
    if (options.period !== undefined && row.period !== options.period) continue;
    versions.push({
      period: row.period,
      period_start: row.period_start,
      period_end: row.period_end,
      value: row.deleted ? null : row.value,
      status: row.deleted ? null : row.status,
      withdrawn: row.deleted,
      held_from: row.recorded_from,
      held_to: row.recorded_to,
      published: day(row.provider_from, row.provider_precision),
      published_precision: row.provider_from === null ? null : row.provider_precision,
      superseded: day(row.provider_to, row.provider_precision),
      current: row.recorded_to === null,
    });
  }

  over = late();
  if (over) return over;
  // Days are New York's, as the Cutoff's are (docs/method/vintage-resolution.md).
  const days = [...new Set(file.captures.map((c) => cutoffFor(c.retrieved_at)?.day).filter((d): d is string => typeof d === "string"))].sort();
  const missed: string[] = [];
  let missedCount = 0;
  for (let i = 1; i < days.length; i++) {
    const [from, to] = [Date.parse(`${days[i - 1]}T00:00:00Z`), Date.parse(`${days[i]}T00:00:00Z`)];
    const gap = Math.round((to - from) / DAY_MS) - 1;
    missedCount += gap;
    for (let d = 1; d <= gap && missed.length < 60; d++) missed.push(new Date(from + d * DAY_MS).toISOString().slice(0, 10));
  }
  const times = file.captures.map((c) => c.retrieved_at).sort();
  over = late();
  if (over) return over;
  return {
    ok: true,
    held: true,
    key,
    freq: file.freq,
    release_id: release.id,
    provider_coverage: file.provider_coverage,
    versions,
    revised_periods: [...changed],
    captures: { count: file.captures.length, first: times[0] ?? null, last: times.at(-1) ?? null, missed_days: missed, missed_count: missedCount },
    metadata_changes: file.metadata.map((line) => ({ recorded_from: line.recorded_from, unit: line.metadata.unit, name: line.metadata.name })),
    rights_used: lineage.rightsUsed,
  };
}

export type Latest =
  | { ok: true; /** null when the Series has no Observation with a value. */ latest: { period: string; period_end: string; value: number; status: string } | null }
  | QueryFailure;

/**
 * The last Observation of a Series that has a value, for a list such as the catalog page. The
 * same gate as `query()`, for display, without copying the whole Series.
 */
export function latestValue(release: OpenedRelease, surface: Surface, key: string, gate?: Pick<RightsGate, "permits">): Latest {
  if (!KEY.test(key)) return bad("that is not a series key");
  const lineage = askGate(release, surface, [key], "display", { gate });
  if (!lineage.ok) return lineage;
  const observations = fileOf(release, key)?.observations ?? [];
  for (let i = observations.length - 1; i >= 0; i--) {
    const o = observations[i]!;
    if (o.value !== null) return { ok: true, latest: { period: o.period, period_end: o.period_end, value: o.value, status: o.status } };
  }
  return { ok: true, latest: null };
}
