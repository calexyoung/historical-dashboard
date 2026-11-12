/**
 * Query v0 (PLAN 4.2): the one way a page, and later a twin or the read API, gets values.
 *
 * `query(release, surface, request)` takes one request shape, validates it, asks the rights gate
 * about the full lineage of everything asked for, and only then lets the engine answer from the
 * Release it was given. It never opens a Release itself: the caller has fixed one for the
 * request (ADR 0015), and a Release that may not be served never reaches here (the proxy
 * answers 503 first).
 *
 * Hidden here: request validation, the rights lineage of a derived Series (the closure of its
 * Recipe inputs), the call to `permits()`, the caps, and turning each refusal into a status.
 * What a Transform means is the engine's business (`@macro-atlas/core`, docs/method/transforms.md).
 *
 * Node only (it takes an opened Release); pure otherwise.
 */
import {
  PERMISSIONS,
  permits,
  SEMANTICS_VERSION,
  transform,
  TRANSFORMS,
  type Permission,
  type RightsUse,
  type Surface,
  type TransformName,
  type TransformResult,
} from "@macro-atlas/core";
import type { CatalogEntry, SeriesFile } from "@macro-atlas/core/release";
import type { OpenedRelease } from "../release/reader";

/** The Explorer's limit in v1, and a readable chart's. */
export const MAX_SERIES = 8;
/** Observations in one answer. Bounds the work and the bytes; a larger request must be narrowed. */
export const MAX_ROWS = 50_000;

export type QueryRequest = {
  /** One to eight Series keys, in the order they are wanted. */
  series: string[];
  transform: TransformName;
  /** Calendar dates, both inclusive; either may be left out. */
  from?: string;
  to?: string;
  /** What the answer is for: showing on a page, or handing out as a file or through the API. */
  permission: Permission;
};

export type QueryFailure = {
  ok: false;
  status: 400 | 403 | 404 | 422;
  code: "bad_request" | "unknown_series" | "withheld" | "not_permitted" | "too_large";
  message: string;
};

export type SeriesAnswer = {
  key: string;
  name: string;
  unit: string;
  freq: CatalogEntry["freq"];
  continuity: CatalogEntry["continuity"];
  representation: CatalogEntry["representation"];
  source: CatalogEntry["source"];
  /** The engine's answer: observations, or why the Transform is unavailable for this Series. */
  result: TransformResult;
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
const FIELDS = new Set(["series", "transform", "from", "to", "permission"]);

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
  const { series, from, to } = r;
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
  const request: QueryRequest = {
    series: series as string[],
    transform: r.transform as TransformName,
    permission: r.permission as Permission,
  };
  if (typeof from === "string") request.from = from;
  if (typeof to === "string") request.to = to;
  return request;
}

export type Lineage =
  | { ok: true; /** Every Series the answer rests on: those asked for and all their inputs. */ series: string[]; rightsUsed: RightsUse[] }
  | QueryFailure;

/**
 * Everything the Series in `keys` rest on, as rows for the rights gate: each Series' own Origin
 * and Channel, and those of every input of a derived Series, to any depth. A Series that is
 * unknown or withheld, or an input that cannot be found, ends in a refusal.
 */
export function rightsLineage(release: OpenedRelease, keys: readonly string[], permission: Permission): Lineage {
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
  for (const key of [...reached].sort()) {
    const entry = entries.get(key)!;
    const row: RightsUse = {
      origin: entry.source.origin.producer,
      dataset: entry.source.origin.dataset,
      channel: entry.source.channel.via,
      representation: entry.representation,
      permission,
    };
    rows.set(JSON.stringify(row), row);
  }
  return { ok: true, series: [...reached].sort(), rightsUsed: [...rows.values()] };
}

/** Ask the gate. A denial carries the gate's own reason. */
function permitted(release: OpenedRelease, surface: Surface, keys: readonly string[], permission: Permission): Lineage {
  const lineage = rightsLineage(release, keys, permission);
  if (!lineage.ok) return lineage;
  const decision = permits(lineage.rightsUsed, surface);
  if (!decision.allowed) return fail(403, "not_permitted", decision.reason);
  return lineage;
}

const fileOf = (release: OpenedRelease, key: string): SeriesFile | undefined => release.series[key] ?? release.derived[key];

export function query(
  release: OpenedRelease,
  surface: Surface,
  raw: unknown,
  caps: { maxRows?: number } = {},
): QueryAnswer | QueryFailure {
  const request = parseQueryRequest(raw);
  if ("ok" in request) return request;
  const lineage = permitted(release, surface, request.series, request.permission);
  if (!lineage.ok) return lineage;

  const maxRows = caps.maxRows ?? MAX_ROWS;
  const entries = new Map(release.catalog.series.map((entry) => [entry.key, entry]));
  const window = { from: request.from, to: request.to };
  const series: SeriesAnswer[] = [];
  let rows = 0;
  for (const key of request.series) {
    const entry = entries.get(key)!;
    const file = fileOf(release, key);
    if (!file) return fail(404, "unknown_series", `this release holds no values for ${key}`);
    const result = transform({ freq: file.freq, continuity: entry.continuity, observations: file.observations, allowed: entry.allowed_transforms, measure_kind: entry.measure_kind, agg: entry.agg }, request.transform, window);
    if (result.ok) rows += result.observations.length;
    if (rows > maxRows) {
      return fail(422, "too_large", `the answer would hold more than ${maxRows} observations; ask for fewer series or a shorter window`);
    }
    series.push({
      key,
      name: entry.name,
      unit: entry.unit,
      freq: entry.freq,
      continuity: entry.continuity,
      representation: entry.representation,
      source: entry.source,
      result,
    });
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

export type Latest =
  | { ok: true; /** null when the Series has no Observation with a value. */ latest: { period: string; period_end: string; value: number; status: string } | null }
  | QueryFailure;

/**
 * The last Observation of a Series that has a value, for a list such as the catalog page. The
 * same gate as `query()`, for display, without copying the whole Series.
 */
export function latestValue(release: OpenedRelease, surface: Surface, key: string): Latest {
  if (!KEY.test(key)) return bad("that is not a series key");
  const lineage = permitted(release, surface, [key], "display");
  if (!lineage.ok) return lineage;
  const observations = fileOf(release, key)?.observations ?? [];
  for (let i = observations.length - 1; i >= 0; i--) {
    const o = observations[i]!;
    if (o.value !== null) return { ok: true, latest: { period: o.period, period_end: o.period_end, value: o.value, status: o.status } };
  }
  return { ok: true, latest: null };
}
