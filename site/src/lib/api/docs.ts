/**
 * What `/docs/api` says (PLAN M24): the read API described from the same tables the routes are
 * answered from (`API_ROUTES`, the limits in force, Query's caps), so the page cannot state a
 * route, a limit or a list the app does not have. The examples use a Series of the Release
 * being served: one that would be handed out here where there is one.
 */
import { TRANSFORMS, type RightsGate, type Surface } from "@macro-atlas/core";
import { EVENT_CATEGORIES } from "../events";
import { AGGREGATIONS, askGate, MAX_BYTES, MAX_MS, MAX_ROWS, MAX_VINTAGE_ROWS, TARGET_FREQUENCIES } from "../query";
import { LIMITS } from "../rate-limit";
import type { OpenedRelease } from "../release/reader";
import { API_ROUTES, VERSIONS_PER_PAGE } from "./index";

export type ApiDocsView = {
  /** The API's own address, with the base path. */
  root: string;
  routes: { path: string; about: string; parameters: string; example: string }[];
  seriesParameters: [string, string][];
  otherParameters: [string, string][];
  fields: [string, string][];
  errors: [string, string][];
  limits: [string, string][];
  /** A Series to try the examples on, and whether its values are handed out on this build. */
  example: { key: string; name: string; given: boolean } | null;
  curl: string[];
};

const perMinute = (perSecond: number): string => `${Math.round(perSecond * 60).toLocaleString("en-US")} a minute`;
const n = (value: number): string => value.toLocaleString("en-US");

export function apiDocsView(release: OpenedRelease, surface: Surface, address: string, gate?: Pick<RightsGate, "permits">): ApiDocsView {
  const given = release.catalog.series.find((entry) => askGate(release, surface, [entry.key], "redistribute", { gate }).ok);
  const entry = given ?? release.catalog.series[0];
  const key = entry?.key ?? "{key}";
  const fill = (path: string): string => `${address}${path.replace("{key}", key)}`;
  const examples: Record<string, string> = {
    "/api/v1/series/{key}": "?transform=pc1&start=2020-01-01",
    "/api/v1/series/{key}/vintages": "",
  };
  return {
    root: `${address}/api/v1`,
    routes: API_ROUTES.map((r) => ({ path: r.path, about: r.about, parameters: r.parameters.length > 0 ? r.parameters.join(", ") : "None", example: `${fill(r.path)}${examples[r.path] ?? ""}` })),
    seriesParameters: [
      ["transform", `One of ${TRANSFORMS.join(", ")}. Left out, the values as they are (lin).`],
      ["freq", `A slower frequency to bring the series to first: one of ${TARGET_FREQUENCIES.join(", ").replaceAll("_", " ")} (written with an underscore: business_daily).`],
      ["agg", `How to combine periods, in place of the rule the series declares: one of ${AGGREGATIONS.join(", ")}. Only one its kind of measure allows.`],
      ["start, end", "Calendar dates, written YYYY-MM-DD. Both are inclusive."],
      ["as_of", "What was known before this date (00:00 in New York), or before an instant written YYYY-MM-DDTHH:MM:SSZ."],
    ],
    otherParameters: [
      ["period", "On vintages: one period, written as the series writes it (2025-11, 2025-Q3, 2025). The answer is the history of that period."],
      ["page", `On vintages: a history is given ${n(VERSIONS_PER_PAGE)} versions at a time. The answer says how many pages there are and gives the address of the next.`],
      ["cat", `On events.json: one category. One of ${EVENT_CATEGORIES.join(", ")}.`],
      ["person, party, topic", "On claims.json: narrow the list. The values a release holds are in the answer under options."],
    ],
    fields: [
      ["release_id", "The release the answer was made from. Every answer to one request comes from one release."],
      ["semantics_version", "The version of the rules the engine computed by: what a transform, an aggregation and an as-of answer mean."],
      ["provenance", "Where the values came from. For a series: the origin that produced it, the channel it was fetched through, and when. For a list: the release, and every source it was made from."],
      ["rights", "The permission that was asked for and whether it was given, with the rights status of the series and every origin and channel the answer rests on. A list that holds no value asks for none, and says so; that is not a statement about the series it names."],
      ["basis", "On an as-of answer: the kind of evidence that the values were public by then. The weakest among the periods the answer used."],
      ["capture_gap", "On an as-of answer: days before the date on which Macro Atlas took no copy, where there were any, and whether the value changed across them."],
      ["same_day_release", "On an as-of answer: whether the origin published on the day asked about, so that the answer depends on the time of day."],
    ],
    errors: [
      ["400", "The question cannot be answered as asked: a parameter the route does not take, a value outside its list, a parameter given twice, or a series key the release does not hold. The answer lists what may be asked, under error.allowed."],
      ["403", "The series may not be handed out here. Its page may still show it; the answer gives the reason. No value is in it."],
      ["404", "There is no route at that address. The answer lists the routes."],
      ["422", `The answer would be larger than ${n(MAX_BYTES / 1024 / 1024)} MiB or ${n(MAX_ROWS)} observations. Ask for a shorter window.`],
      ["429", "Too many requests in a short time. The Retry-After header and error.retry_after_seconds say how many seconds to wait."],
      ["503", `An answer took longer than ${n(MAX_MS / 1000)} seconds to make and is not given; or there is no release that may be served, which is said as a line of text. Nothing is served in its place.`],
    ],
    limits: [
      ["Each address", `${n(LIMITS.address.burst)} requests at once, then ${perMinute(LIMITS.address.perSecond)}. An IPv6 address is counted with its /64 network.`],
      ["Every address together", `${n(LIMITS.global.burst)} requests at once, then ${perMinute(LIMITS.global.perSecond)}.`],
      ["What is counted", "Every request to /api/v1, every file of a page (.csv, .json, .md, .metadata.json, a claim's evidence and lock), every bulk file and every export from the Explorer. Pages are not counted."],
      ["One answer", `At most ${n(MAX_ROWS)} observations, ${n(MAX_BYTES / 1024 / 1024)} MiB, and ${n(MAX_MS / 1000)} seconds. An as-of answer or a history reads at most ${n(MAX_VINTAGE_ROWS)} versions.`],
    ],
    example: entry ? { key: entry.key, name: entry.name, given: given !== undefined } : null,
    curl: [`curl -s '${address}/api/v1/catalog.json'`, `curl -s '${fill("/api/v1/series/{key}")}?transform=pc1&start=2020-01-01'`, `curl -s '${fill("/api/v1/series/{key}")}?as_of=2025-12-13'`, `curl -s '${fill("/api/v1/series/{key}/vintages")}?period=2025-11'`],
  };
}
