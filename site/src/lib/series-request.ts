/**
 * What an address may ask of one Series (PLAN section 7): `?transform=&freq=&agg=&start=&end=&as_of=`.
 * One parser for the series page and its twins, so the page and the files behind it are asked the
 * same question in the same words. What each value may be is Query's business; this module only
 * reads the address and writes it back in one fixed order.
 */
import { TRANSFORMS, type AggregateMethod, type Frequency, type Permission, type TransformName } from "@macro-atlas/core";
import { AGGREGATIONS, parseQueryRequest, TARGET_FREQUENCIES, type QueryRequest } from "./query";

export const SERIES_PARAMS = ["transform", "freq", "agg", "start", "end", "as_of"] as const;
export type SeriesParam = (typeof SERIES_PARAMS)[number];

export type SeriesRequest = { transform: TransformName; freq?: Frequency; agg?: AggregateMethod; start?: string; end?: string; as_of?: string };

export type ParsedSeriesRequest =
  | { ok: true; request: SeriesRequest; /** The request as an address would carry it, in a fixed order; "" for the Series as it is. */ search: string }
  | { ok: false; message: string };

/** What each parameter may be, in words, for a refusal (PLAN section 7: "400 with the allowlist"). */
export const ALLOWLIST = [
  `transform: one of ${TRANSFORMS.join(", ")}`,
  `freq: one of ${TARGET_FREQUENCIES.join(", ")}`,
  `agg: one of ${AGGREGATIONS.join(", ")}`,
  "start, end: calendar dates, written YYYY-MM-DD",
  "as_of: a calendar date, or an instant written YYYY-MM-DDTHH:MM:SSZ",
].join("; ");

export function searchOf(request: SeriesRequest): string {
  const out = new URLSearchParams();
  for (const name of SERIES_PARAMS) {
    const value = request[name];
    if (value !== undefined && !(name === "transform" && value === "lin")) out.set(name, value);
  }
  return out.toString();
}

/**
 * Read an address. `strict` (a twin, the API) refuses a parameter it does not know; a page lets
 * one pass, since links arrive with things appended. A known parameter with a value Query would
 * refuse is refused either way: an answer to a question nobody asked is never shown in its place.
 */
export function parseSeriesRequest(params: URLSearchParams, strict: boolean): ParsedSeriesRequest {
  const raw: Partial<Record<SeriesParam, string>> = {};
  for (const name of new Set(params.keys())) {
    if (!(SERIES_PARAMS as readonly string[]).includes(name)) {
      if (name === "pin") return { ok: false, message: "pin: a pinned release cannot be asked for here yet" };
      if (strict) return { ok: false, message: `there is no parameter called ${JSON.stringify(name.slice(0, 40))}. ${ALLOWLIST}` };
      continue;
    }
    const all = params.getAll(name);
    if (all.length > 1) return { ok: false, message: `${name} is given more than once` };
    if (all[0] !== "") raw[name as SeriesParam] = all[0]!;
  }
  const checked = parseQueryRequest(toQuery({ transform: "lin", ...raw } as SeriesRequest, "x", "display"));
  if ("ok" in checked) {
    const message = checked.message.replace(/^from:/, "start:").replace(/^to:/, "end:");
    return { ok: false, message: strict ? `${message}. ${ALLOWLIST}` : message };
  }
  const request: SeriesRequest = { transform: checked.transform };
  if (checked.freq) request.freq = checked.freq;
  if (checked.agg) request.agg = checked.agg;
  if (checked.from) request.start = checked.from;
  if (checked.to) request.end = checked.to;
  if (checked.as_of) request.as_of = checked.as_of;
  return { ok: true, request, search: searchOf(request) };
}

/** The request Query takes, for one Series. */
export function toQuery(request: SeriesRequest, key: string, permission: Permission): Record<string, unknown> {
  const out: Record<string, unknown> = { series: [key], transform: request.transform, permission } satisfies Partial<QueryRequest>;
  if (request.freq !== undefined) out.freq = request.freq;
  if (request.agg !== undefined) out.agg = request.agg;
  if (request.start !== undefined) out.from = request.start;
  if (request.end !== undefined) out.to = request.end;
  if (request.as_of !== undefined) out.as_of = request.as_of;
  return out;
}
