/**
 * The read API (PLAN section 7, M24; ADR 0038): `/api/v1`. The contract is docs/method/api.md.
 *
 *   /api/v1                          the routes
 *   /api/v1/catalog.json             every Series of the Release, as the Catalog records it; no value
 *   /api/v1/series/{key}             the values of one Series (the page's own Query)
 *   /api/v1/series/{key}/vintages    every version held of each Period, or of one (`period=`)
 *   /api/v1/events.json              the Events
 *   /api/v1/claims.json              the Claims, as records; their evidence is at each Claim's twins
 *   /api/v1/status                   how fresh what is being served is
 *
 * Each function here takes the Release the proxy fixed for the request, the Surface, and what
 * the address asked, and answers with a status and a body. The route handlers only copy that
 * out. Values leave the site, so Query is asked for the Permission to redistribute; a refusal
 * is 403 with the gate's reason and no value.
 *
 * Hidden here: the four fields every body carries; what a refusal looks like and the allowlist
 * it comes with; that an unknown key is 400 here (a twin says 404); pages of a history; the
 * fixed selections of an Event, a Claim and a Catalog entry that leave the building; and the
 * caps on bytes and time for answers Query does not make. What a value is, and whether it may
 * be given, are Query's business and the gate's. Node only; pure otherwise.
 */
import { SEMANTICS_VERSION, TRANSFORMS, type RightsGate, type Surface } from "@macro-atlas/core";
import type { CatalogEntry, Event } from "@macro-atlas/core/release";
import { CLAIM_FACETS, claimEvidence, claimsIndexView, type ClaimFilters } from "../claims";
import { categoryLabel, EVENT_CATEGORIES } from "../events";
import { AGGREGATIONS, MAX_BYTES, MAX_MS, query, TARGET_FREQUENCIES, tooManyBytes, vintageTable, type QueryFailure } from "../query";
import type { Failure, LastRun, OpenedRelease } from "../release/reader";
import { parseSeriesRequest, SERIES_PARAMS, toQuery } from "../series-request";
import { statusView } from "../status";
import { localNote, rightsOf, seriesDocument, seriesRecord, sourceOf, STAMP } from "../twin";
import { recordOf } from "../twin/claims";
import { errorBody, NO_VALUE_RIGHTS, releaseProvenance, toJson, type ApiError } from "./envelope";

export type ApiResponse = {
  status: 200 | 308 | 400 | 403 | 404 | 422 | 503;
  /** JSON. */
  body: string;
  /** For 308: the permanent address, without the base path. */
  location?: string;
  /** Whether a cache may keep it for a short while. Never a refusal, never anything but production. */
  cacheable: boolean;
};

export type ApiOptions = {
  /** The site's own address with its base path and no trailing slash, as the reader wrote it. */
  address: string;
  /** See `QueryOptions.gate`: only a test passes one. */
  gate?: Pick<RightsGate, "permits">;
  maxBytes?: number;
  maxMs?: number;
  /** Milliseconds, from any fixed start. */
  clock?: () => number;
};

/** Versions of a history in one answer; the rest are on the next page. The series page lists as many. */
export const VERSIONS_PER_PAGE = 5000;

/** The routes, in the order section 7 lists them. `/docs/api` and `GET /api/v1` are written from this. */
export const API_ROUTES: readonly { path: string; about: string; parameters: readonly string[] }[] = [
  { path: "/api/v1/catalog.json", about: "Every series of the release as the catalog records it: definition, source, rights, and whether it is shown here. No value.", parameters: [] },
  { path: "/api/v1/series/{key}", about: "The values of one series, with its provenance and rights. The same answer as the series page and its .json file.", parameters: SERIES_PARAMS },
  { path: "/api/v1/series/{key}/vintages", about: "Every version the release holds of each period of one series; with period=, the history of one period.", parameters: ["period", "page"] },
  { path: "/api/v1/events.json", about: "The events of the release, each with its sources.", parameters: ["cat"] },
  { path: "/api/v1/claims.json", about: "The claims of the release as records, and where the evidence of each is. No figure.", parameters: CLAIM_FACETS },
  { path: "/api/v1/status", about: "The release being served, its age, each source and each series, and how the last run ended.", parameters: [] },
];

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const SERIES_ALLOWED = {
  parameters: [...SERIES_PARAMS],
  transform: [...TRANSFORMS],
  freq: [...TARGET_FREQUENCIES],
  agg: [...AGGREGATIONS],
  start: "a calendar date, written YYYY-MM-DD",
  end: "a calendar date, written YYYY-MM-DD",
  as_of: "a calendar date, or an instant written YYYY-MM-DDTHH:MM:SSZ",
};

type Context = { release: OpenedRelease; surface: Surface; options: ApiOptions; started: number; clock: () => number };
const begin = (release: OpenedRelease, surface: Surface, options: ApiOptions): Context => {
  const clock = options.clock ?? (() => performance.now());
  return { release, surface, options, clock, started: clock() };
};

function refuse(c: Context, error: ApiError & { status: ApiResponse["status"] }, rights?: Record<string, unknown>): ApiResponse {
  return { status: error.status, body: toJson(errorBody(c.release, error, rights)), cacheable: false };
}
const bad = (c: Context, message: string, allowed: Record<string, unknown>): ApiResponse => refuse(c, { status: 400, code: "bad_request", message, allowed });

/** What Query, or the gate, said no to. A 403 says which Permission was asked and why it was not given. */
function failed(c: Context, failure: QueryFailure, allowed?: Record<string, unknown>): ApiResponse {
  const error = { status: failure.status, code: failure.code, message: failure.message, ...(failure.status === 400 && allowed ? { allowed } : {}) };
  return refuse(c, error, failure.status === 403 ? { permission: "redistribute", permitted: false, reason: failure.message } : undefined);
}

/** The answer, unless it took too long to make or is too large to send. */
function give(c: Context, doc: Record<string, unknown>): ApiResponse {
  const body = toJson(doc);
  const maxMs = c.options.maxMs ?? MAX_MS;
  if (c.clock() - c.started > maxMs) return refuse(c, { status: 503, code: "too_slow", message: `the answer took longer than ${maxMs} ms to make` });
  const over = tooManyBytes(body, c.options.maxBytes ?? MAX_BYTES);
  if (over) return refuse(c, { status: over.status, code: over.code, message: over.message });
  return { status: 200, body, cacheable: c.surface === "production" };
}

/** The four fields, for a body that holds no value of a Series. */
const envelope = (release: OpenedRelease) => ({ release_id: release.id, semantics_version: SEMANTICS_VERSION, provenance: releaseProvenance(release), rights: NO_VALUE_RIGHTS });

/**
 * Read an address strictly: a parameter the route does not take, or one given twice, is refused
 * with the list. An empty value is the same as leaving the parameter out.
 */
function params(c: Context, search: URLSearchParams, names: readonly string[], allowed: Record<string, unknown>): { ok: true; values: Record<string, string> } | { ok: false; response: ApiResponse } {
  const values: Record<string, string> = {};
  for (const name of new Set(search.keys())) {
    if (!names.includes(name)) {
      const takes = names.length === 0 ? "This route takes no parameter" : `It takes: ${names.join(", ")}`;
      return { ok: false, response: bad(c, `there is no parameter called ${JSON.stringify(name.slice(0, 40))}. ${takes}`, allowed) };
    }
    const all = search.getAll(name);
    if (all.length > 1) return { ok: false, response: bad(c, `${name} is given more than once`, allowed) };
    if (all[0] !== "") values[name] = all[0]!;
  }
  return { ok: true, values };
}

const entryOf = (release: OpenedRelease, key: string): CatalogEntry | undefined => (typeof key === "string" && KEY.test(key) ? release.catalog.series.find((e) => e.key === key) : undefined);

/** PLAN section 7: an unknown key is 400 with the allowlist, which is the keys this Release holds. */
function unknownSeries(c: Context, key: string): ApiResponse {
  const said = typeof key === "string" && KEY.test(key) ? ` called ${key}` : " by that name";
  return refuse(c, {
    status: 400,
    code: "unknown_series",
    message: `there is no series${said} in this release. The keys it holds are listed here and, with what each one is, in the catalog`,
    allowed: { series: c.release.catalog.series.map((e) => e.key), catalog: `${c.options.address}/api/v1/catalog.json` },
  });
}

/** A key that was renamed: the Series it now names, or nothing. */
const renamed = (release: OpenedRelease, key: string): CatalogEntry | undefined => (typeof key === "string" && KEY.test(key) ? release.catalog.series.find((e) => e.aliases?.includes(key)) : undefined);
const moved = (location: string): ApiResponse => ({ status: 308, body: toJson({ moved_to: location }), location, cacheable: false });

// --- GET /api/v1 ------------------------------------------------------------------------------------

export function apiIndex(release: OpenedRelease, surface: Surface, search: URLSearchParams, options: ApiOptions): ApiResponse {
  const c = begin(release, surface, options);
  const asked = params(c, search, [], { parameters: [] });
  if (!asked.ok) return asked.response;
  return give(c, {
    name: "Macro Atlas read API",
    version: "v1",
    documentation: `${options.address}/docs/api`,
    routes: API_ROUTES.map((r) => ({ path: r.path, address: `${options.address}${r.path}`, about: r.about, parameters: r.parameters })),
    ...envelope(release),
  });
}

// --- GET /api/v1/catalog.json -----------------------------------------------------------------------

export function apiCatalog(release: OpenedRelease, surface: Surface, search: URLSearchParams, options: ApiOptions): ApiResponse {
  const c = begin(release, surface, options);
  const asked = params(c, search, [], { parameters: [] });
  if (!asked.ok) return asked.response;
  const series = release.catalog.series.map((entry) => {
    const page = `${options.address}/data/${entry.key}`;
    return { ...seriesRecord(release, surface, entry, { gate: options.gate, history: false }), address: page, api: `${options.address}/api/v1/series/${entry.key}`, metadata: `${page}.metadata.json` };
  });
  return give(c, { count: series.length, series, ...envelope(release) });
}

// --- GET /api/v1/series/{key} -----------------------------------------------------------------------

export function apiSeries(release: OpenedRelease, surface: Surface, key: string, search: URLSearchParams, options: ApiOptions): ApiResponse {
  const c = begin(release, surface, options);
  const entry = entryOf(release, key);
  const alias = entry ? undefined : renamed(release, key);
  if (!entry && !alias) return unknownSeries(c, key);
  const parsed = parseSeriesRequest(search, true);
  if (!parsed.ok) return bad(c, parsed.message, SERIES_ALLOWED);
  const tail = parsed.search ? `?${parsed.search}` : "";
  if (!entry) return moved(`/api/v1/series/${alias!.key}${tail}`);

  const answer = query(release, surface, toQuery(parsed.request, entry.key, "redistribute"), { gate: options.gate, maxMs: options.maxMs, clock: options.clock });
  if (!answer.ok) return failed(c, answer, SERIES_ALLOWED);
  const series = answer.series[0]!;
  // The engine's own no: a Transform, an aggregation or a Recipe that cannot be worked for this Series.
  if (!series.result.ok) {
    return refuse(c, { status: 400, code: series.result.reason, message: series.result.message, allowed: { ...SERIES_ALLOWED, ...(entry.allowed_transforms ? { transform: [...entry.allowed_transforms] } : {}) } });
  }
  const page = `${options.address}/data/${entry.key}`;
  const self = `${options.address}/api/v1/series/${entry.key}`;
  return give(c, {
    ...seriesDocument(release, surface, entry, parsed.request, answer, series, options.address),
    links: { self: `${self}${tail}`, vintages: `${self}/vintages`, page: `${page}${tail}`, csv: `${page}.csv${tail}`, markdown: `${page}.md${tail}`, metadata: `${page}.metadata.json` },
  });
}

// --- GET /api/v1/series/{key}/vintages --------------------------------------------------------------

const WHY_NOT_HELD: Record<string, string> = {
  derived: "This series is computed from other series, so no version of it is held. The history of each input is at that input's own address.",
  legacy: "This series is held as v1 kept it, by month and rounded, with no record of earlier versions.",
  no_vintages: "This release holds no record of earlier versions of this series.",
};

export function apiVintages(release: OpenedRelease, surface: Surface, key: string, search: URLSearchParams, options: ApiOptions & { perPage?: number }): ApiResponse {
  const c = begin(release, surface, options);
  const perPage = options.perPage ?? VERSIONS_PER_PAGE;
  const allowed: Record<string, unknown> = { parameters: ["period", "page"], period: "a period label as the series writes it, such as 2025-11, 2025-Q3 or 2025", page: "a whole number from 1" };
  const entry = entryOf(release, key);
  const alias = entry ? undefined : renamed(release, key);
  if (!entry && !alias) return unknownSeries(c, key);
  const asked = params(c, search, ["period", "page"], allowed);
  if (!asked.ok) return asked.response;
  const { period, page: pageText } = asked.values;
  // A page that is not a whole number is refused below with the pages there are; until then it is the first.
  const pageOk = pageText === undefined || /^[1-9][0-9]{0,8}$/.test(pageText);
  const page = pageText === undefined || !pageOk ? 1 : Number(pageText);
  const tailOf = (n: number): string => {
    const out = new URLSearchParams();
    if (period !== undefined) out.set("period", period);
    if (n > 1) out.set("page", String(n));
    const text = out.toString();
    return text ? `?${text}` : "";
  };
  if (!entry) {
    if (period !== undefined && !/^[0-9A-Za-z-]{1,16}$/.test(period)) return bad(c, "period: a period label, such as 2025-11 or 2025-Q3", allowed);
    return moved(`/api/v1/series/${alias!.key}/vintages${tailOf(page)}`);
  }

  const table = vintageTable(release, surface, entry.key, { period, permission: "redistribute", gate: options.gate, maxMs: options.maxMs, clock: options.clock });
  if (!table.ok) return failed(c, table, allowed);
  const self = `${options.address}/api/v1/series/${entry.key}`;
  const total = table.held ? table.versions.length : 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (!pageOk || page > pages) return bad(c, `page: a whole number; this history has ${pages} page${pages === 1 ? "" : "s"}`, { ...allowed, page: pages === 1 ? "1" : `a whole number from 1 to ${pages}` });
  const lineage = table.held ? table.rights_used.map(({ origin, dataset, channel }) => ({ origin, dataset, channel })) : [];
  return give(c, {
    ...(surface === "local" ? { notice: `${STAMP} · ${localNote(release)}` } : {}),
    key: entry.key,
    name: entry.name,
    frequency: entry.freq,
    held: table.held,
    ...(table.held ? {} : { why: table.why, why_words: WHY_NOT_HELD[table.why] }),
    period: period ?? null,
    provider_coverage: table.held ? table.provider_coverage : null,
    captures: table.held ? table.captures : null,
    revised_periods: table.held ? table.revised_periods : [],
    metadata_changes: table.held ? table.metadata_changes : [],
    versions_total: total,
    page,
    pages,
    per_page: perPage,
    next: page < pages ? `${self}/vintages${tailOf(page + 1)}` : null,
    // In Period order; within a Period, oldest first: the order the Release keeps them in.
    versions: table.held ? table.versions.slice((page - 1) * perPage, page * perPage) : [],
    release_id: release.id,
    semantics_version: SEMANTICS_VERSION,
    // The Source is today's. What the history came through, which may be more, is `rights.lineage`.
    provenance: { current: sourceOf(entry), representation: entry.representation, captures: table.held ? { count: table.captures.count, first: table.captures.first, last: table.captures.last } : null },
    rights: { ...rightsOf(entry), permission: "redistribute", permitted: true, lineage },
    links: { self: `${self}/vintages${tailOf(page)}`, series: self, page: `${options.address}/data/${entry.key}` },
  });
}

// --- GET /api/v1/events.json ------------------------------------------------------------------------

const https = (url: string | undefined): string | null => (url !== undefined && /^https:\/\//.test(url) ? url : null);

/** The fields of an Event that a file names: a fixed selection, so nothing rides along. */
function eventOf(event: Event, address: string) {
  return {
    id: event.id,
    date: event.date,
    end: event.end ?? null,
    date_precision: event.date_precision,
    title: event.title,
    category: event.category,
    status: event.status,
    topics: [...event.topics],
    related_series: [...event.related_series],
    sources: event.sources.flatMap((s) => {
      const url = https(s.url);
      return url === null ? [] : [{ name: s.name ?? null, url, archive_url: https(s.archive_url), no_archive: s.archive_url === undefined ? (s.no_archive ?? null) : null }];
    }),
    description: event.description,
    address: `${address}/events/${event.id}`,
  };
}

export function apiEvents(release: OpenedRelease, surface: Surface, search: URLSearchParams, options: ApiOptions): ApiResponse {
  const c = begin(release, surface, options);
  const events = release.events.events;
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.category, (counts.get(event.category) ?? 0) + 1);
  const known = [...EVENT_CATEGORIES, ...[...counts.keys()].filter((k) => !EVENT_CATEGORIES.includes(k)).sort()];
  const allowed = { parameters: ["cat"], cat: known };
  const asked = params(c, search, ["cat"], allowed);
  if (!asked.ok) return asked.response;
  const cat = asked.values.cat ?? null;
  if (cat !== null && !known.includes(cat)) return bad(c, `cat: one of ${known.join(", ")}`, allowed);
  const listed = events.filter((event) => cat === null || event.category === cat);
  return give(c, {
    count: listed.length,
    total: events.length,
    category: cat,
    categories: known.filter((k) => counts.has(k)).map((value) => ({ value, label: categoryLabel(value), count: counts.get(value)! })),
    // Oldest first, as the Release keeps them.
    events: listed.map((event) => eventOf(event, options.address)),
    ...envelope(release),
  });
}

// --- GET /api/v1/claims.json ------------------------------------------------------------------------

export function apiClaims(release: OpenedRelease, surface: Surface, search: URLSearchParams, options: ApiOptions): ApiResponse {
  const c = begin(release, surface, options);
  const all = claimsIndexView(release, { person: null, party: null, topic: null });
  const allowed: Record<string, unknown> = { parameters: [...CLAIM_FACETS] };
  for (const facet of CLAIM_FACETS) allowed[facet] = all.options[facet].map((o) => o.value);
  const asked = params(c, search, CLAIM_FACETS, allowed);
  if (!asked.ok) return asked.response;
  const filters = {} as ClaimFilters;
  for (const facet of CLAIM_FACETS) {
    const value = asked.values[facet] ?? null;
    if (value !== null && !all.options[facet].some((o) => o.value === value)) {
      return bad(c, `${facet}: this release holds no claim for ${JSON.stringify(value.slice(0, 60))}. The values it holds are listed`, allowed);
    }
    filters[facet] = value;
  }
  const view = claimsIndexView(release, filters);
  const byId = new Map(release.claims.claims.map((claim) => [claim.id, claim]));
  const claims = view.rows.map((row) => {
    const claim = byId.get(row.id)!;
    const page = `${options.address}/claims/${claim.id}`;
    // The files of a Claim hold its figures, so they are named only where they would be given.
    const found = claimEvidence(release, surface, claim, "redistribute", options.gate);
    const reason = found.state === "none" ? "This claim has no lock: no figure has been computed for it." : found.state === "absent" ? found.why : found.state === "not_permitted" ? found.reason : null;
    const twins = found.state === "not_permitted" ? {} : { json: `${page}.json`, markdown: `${page}.md`, ...(found.state === "held" ? { evidence_csv: `${page}/evidence.csv`, lock: `${page}/lock.json` } : {}) };
    return { ...recordOf(claim), evidence_state: found.state, ...(reason ? { evidence_reason: reason } : {}), address: page, twins };
  });
  return give(c, {
    count: claims.length,
    total: view.total,
    filters: view.filters,
    options: view.options,
    // Newest first, as the index lists them.
    claims,
    corrections: view.corrections.map((x) => ({ claim: x.claim, date: x.date, reason: x.reason })),
    ...envelope(release),
  });
}

// --- GET /api/v1/status -----------------------------------------------------------------------------

export function apiStatus(
  release: OpenedRelease,
  surface: Surface,
  search: URLSearchParams,
  context: { refreshFailed: Omit<Failure, "ok"> | null; now: number; lastRun: LastRun | null; gate?: Pick<RightsGate, "permits"> },
): ApiResponse {
  const c = begin(release, surface, { address: "" });
  const asked = params(c, search, [], { parameters: [] });
  if (!asked.ok) return asked.response;
  const { release_id, semantics_version, ...view } = statusView(release, surface, context);
  // Its age and its clock move on their own, so no cache may keep it.
  return { ...give(c, { ...view, release_id, semantics_version, provenance: releaseProvenance(release), rights: NO_VALUE_RIGHTS }), cacheable: false };
}

// --- anything else under /api/v1 --------------------------------------------------------------------

export function apiNotFound(release: OpenedRelease, surface: Surface, pathname: string, options: ApiOptions): ApiResponse {
  const c = begin(release, surface, options);
  return refuse(c, {
    status: 404,
    code: "unknown_route",
    message: `there is no route at ${JSON.stringify(String(pathname).slice(0, 80))}. The routes are listed, and described at ${options.address}/docs/api`,
    allowed: { routes: API_ROUTES.map((r) => r.path) },
  });
}
