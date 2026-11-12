/**
 * The read API (PLAN section 7 and M24; docs/method/api.md): a contract test for each route of
 * `/api/v1`, through the functions the route handlers copy out, on the synthetic fixture release.
 *
 * M24's criteria, as tests: every route has its contract; invalid input gets 400 with the
 * allowlist; every body carries `provenance`, `rights`, `release_id` and `semantics_version`,
 * and an as-of answer `basis`, `capture_gap` and `same_day_release`. (Over the limit is 429:
 * `gate.test.ts`, and over HTTP in `tests/built/served.test.ts`.)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createRightsGate, SEMANTICS_VERSION, TRANSFORMS } from "@macro-atlas/core";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { addRelease, FIXTURE_ID, FIXTURE_ROOT, fixtureRegister, promote, tempRoot } from "../release/testing";
import { seriesTwin } from "../twin";
import { apiDocsView } from "./docs";
import { API_ROUTES, apiCatalog, apiClaims, apiEvents, apiIndex, apiNotFound, apiSeries, apiStatus, apiVintages, VERSIONS_PER_PAGE, type ApiResponse } from "./index";

let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});

const ADDRESS = "http://localhost:3000/macro-atlas";
const CLAIM = "2025-12-11-a-fixture-official-on-fixture-prices";
const EVENT = "2024-09-18-fixture-rate-decision";
type Gate = ReturnType<typeof createRightsGate>;
type Surface = "local" | "staging" | "production";
const o = (gate?: Gate) => ({ address: ADDRESS, gate });
const q = (search = "") => new URLSearchParams(search);
const read = (answer: ApiResponse) => JSON.parse(answer.body);
const signed = () => createRightsGate(fixtureRegister({ display: true, redistribute: true }));
const displayOnly = () => createRightsGate(fixtureRegister({ display: true, redistribute: false }));

/** Every route, asked a question it answers and one it refuses, so the fields can be checked on all of them. */
const everyBody = (surface: Surface = "local", gate?: Gate): [string, ApiResponse][] => [
  ["index", apiIndex(release, surface, q(), o(gate))],
  ["catalog.json", apiCatalog(release, surface, q(), o(gate))],
  ["series/{key}", apiSeries(release, surface, "fx_price_index", q(), o(gate))],
  ["series/{key} as of a date", apiSeries(release, surface, "fx_price_index", q("as_of=2025-12-13"), o(gate))],
  ["series/{key}/vintages", apiVintages(release, surface, "fx_price_index", q(), o(gate))],
  ["series/{key}/vintages for one period", apiVintages(release, surface, "fx_price_index", q("period=2025-11"), o(gate))],
  ["events.json", apiEvents(release, surface, q(), o(gate))],
  ["claims.json", apiClaims(release, surface, q(), o(gate))],
  ["status", apiStatus(release, surface, q(), { refreshFailed: null, now: Date.parse("2026-01-01T06:00:00Z"), lastRun: null, gate })],
  ["400: a parameter that does not exist", apiCatalog(release, surface, q("nope=1"), o(gate))],
  ["400: a transform that does not exist", apiSeries(release, surface, "fx_price_index", q("transform=cube"), o(gate))],
  ["400: a key that does not exist", apiSeries(release, surface, "fx_nothing", q(), o(gate))],
  ["400: a period that is not one", apiVintages(release, surface, "fx_price_index", q("period=%3Cscript%3E"), o(gate))],
  ["400: a category that does not exist", apiEvents(release, surface, q("cat=weather"), o(gate))],
  ["400: a party no claim has", apiClaims(release, surface, q("party=whig"), o(gate))],
  ["400: status takes no parameter", apiStatus(release, surface, q("x=1"), { refreshFailed: null, now: 0, lastRun: null, gate })],
  ["403: a withheld series", apiSeries(release, surface, "fx_exchange_index", q(), o(gate))],
  ["403: a withheld series' history", apiVintages(release, surface, "fx_exchange_index", q(), o(gate))],
  ["404: no such route", apiNotFound(release, surface, "/api/v1/nothing", o(gate))],
];

describe("every body of the read API carries the four fields (M24's last criterion)", () => {
  it.each(["local", "staging", "production"] as const)("on the %s surface: release_id, semantics_version, provenance and rights, on answers and refusals alike", (surface) => {
    for (const [name, answer] of everyBody(surface)) {
      const body = read(answer);
      expect(body.release_id, name).toBe(FIXTURE_ID);
      expect(body.semantics_version, name).toBe(SEMANTICS_VERSION);
      expect(body.provenance, name).toBeTypeOf("object");
      expect(body.provenance, name).not.toBeNull();
      expect(body.rights, name).toBeTypeOf("object");
      expect(typeof body.rights.permission, name).toBe("string");
      expect(typeof body.rights.permitted, name).toBe("boolean");
      // A refusal is an error with a status that matches the answer's, and is never kept.
      if (answer.status >= 400) {
        expect(body.error, name).toMatchObject({ status: answer.status });
        expect(typeof body.error.code, name).toBe("string");
        expect(typeof body.error.message, name).toBe("string");
        expect(answer.cacheable, name).toBe(false);
      } else expect(body.error, name).toBeUndefined();
    }
  });

  it("the statuses are the ones the names say", () => {
    for (const [name, answer] of everyBody()) expect(answer.status, name).toBe(/^(\d{3}):/.test(name) ? Number(name.slice(0, 3)) : 200);
  });

  it("an as-of answer also carries basis, capture_gap and same_day_release; an answer about today does not claim a basis", () => {
    const then = read(apiSeries(release, "local", "fx_price_index", q("as_of=2025-12-13"), o()));
    // A day with no Capture lies before the Cutoff, and the value changed across it (docs/method/vintage-resolution.md).
    expect(then).toMatchObject({ as_of: "2025-12-13", basis: "uncertain", same_day_release: false, capture_gap: { from: "2025-12-11T15:45:00Z", to: "2025-12-15T15:45:00Z", missed_days: 1, changed_across: true } });
    expect(then.observations.at(-1)).toMatchObject({ period: "2025-11", value: 109.5, status: "preliminary" });
    const today = read(apiSeries(release, "local", "fx_price_index", q(), o()));
    expect(today).toMatchObject({ as_of: null, basis: null });
    expect(today.observations.at(-1)).toMatchObject({ period: "2025-12", value: 109.9 });
  });

  it("an unavailable as-of answer is an answer: 200, the basis says unavailable, and it holds no observation", () => {
    const body = read(apiSeries(release, "local", "fx_price_index", q("as_of=2020-01-01"), o()));
    expect(body).toMatchObject({ basis: "unavailable", observations: [] });
    expect(typeof body.reason).toBe("string");
  });
});

describe("GET /api/v1", () => {
  it("lists every route with what it takes, and where the documentation is", () => {
    const body = read(apiIndex(release, "local", q(), o()));
    expect(body.routes.map((r: { path: string }) => r.path)).toEqual(["/api/v1/catalog.json", "/api/v1/series/{key}", "/api/v1/series/{key}/vintages", "/api/v1/events.json", "/api/v1/claims.json", "/api/v1/status"]);
    expect(body.routes.map((r: { path: string }) => r.path)).toEqual(API_ROUTES.map((r) => r.path));
    expect(body.routes[1]).toMatchObject({ parameters: ["transform", "freq", "agg", "start", "end", "as_of"], address: `${ADDRESS}/api/v1/series/{key}` });
    expect(body.documentation).toBe(`${ADDRESS}/docs/api`);
  });
});

describe("GET /api/v1/catalog.json", () => {
  it("names every Series of the Release with its definition, source and rights, and no value", () => {
    const body = read(apiCatalog(release, "local", q(), o()));
    expect(body.count).toBe(11);
    expect(body.series.map((s: { key: string }) => s.key)).toEqual(release.catalog.series.map((e) => e.key));
    const price = body.series.find((s: { key: string }) => s.key === "fx_price_index");
    expect(price).toMatchObject({
      name: "Fixture price index",
      frequency: "monthly",
      state: "shown",
      source: { origin: { producer: "Macro Atlas fixture (synthetic)" }, channel: { via: "fixture" } },
      rights: { status: "public_domain" },
      downloads: { permitted: true, reason: null },
      coverage: { last_period: "2025-12" },
      address: `${ADDRESS}/data/fx_price_index`,
      api: `${ADDRESS}/api/v1/series/fx_price_index`,
    });
    // No value of any Series: the newest values of the fixture's price index are not in it.
    expect(JSON.stringify(body)).not.toMatch(/109\.9|109\.5|109\.3/);
    expect(body.rights).toMatchObject({ permission: "none", permitted: true });
    expect(body.provenance).toMatchObject({ publisher: "Macro Atlas", release: { id: FIXTURE_ID, profile: "public" }, release_sources: [{ producer: "Macro Atlas fixture (synthetic)", via: "fixture", outcome: "ok" }] });
  });

  it("names a Withheld Series with the reason, and says nothing of how far its values run", () => {
    const body = read(apiCatalog(release, "local", q(), o()));
    expect(body.series.find((s: { key: string }) => s.key === "fx_exchange_index")).toMatchObject({ state: "withheld", reason: "The licence does not allow redistribution.", coverage: null, downloads: { permitted: false } });
  });

  it("on a public surface, where no row is signed for the fixture's Origin, every Series is named and none says its coverage", () => {
    for (const surface of ["staging", "production"] as const) {
      const body = read(apiCatalog(release, surface, q(), o()));
      expect(body.count).toBe(11);
      for (const s of body.series) {
        expect(s.state === "shown", s.key).toBe(false);
        expect(s.coverage, s.key).toBeNull();
        expect(s.downloads.permitted, s.key).toBe(false);
      }
      expect(JSON.stringify(body)).not.toMatch(/2025-12/);
    }
  });

  it("a Series that may be shown and not handed out says so, series by series", () => {
    const body = read(apiCatalog(release, "production", q(), o(displayOnly())));
    expect(body.series.find((s: { key: string }) => s.key === "fx_price_index")).toMatchObject({ state: "shown", downloads: { permitted: false }, coverage: { last_period: "2025-12" } });
  });

  it("takes no parameter: one is refused with 400 and the list, which is empty", () => {
    const answer = apiCatalog(release, "local", q("segment=prices"), o());
    expect(answer.status).toBe(400);
    expect(read(answer).error).toMatchObject({ code: "bad_request", allowed: { parameters: [] } });
    expect(read(answer).error.message).toMatch(/no parameter called "segment"/);
  });

  it("may be kept by a cache on production only", () => {
    expect(apiCatalog(release, "production", q(), o()).cacheable).toBe(true);
    expect(apiCatalog(release, "staging", q(), o()).cacheable).toBe(false);
    expect(apiCatalog(release, "local", q(), o()).cacheable).toBe(false);
  });
});

describe("GET /api/v1/series/{key}", () => {
  it("answers with the same document as the page's .json twin: one Query, one set of values", () => {
    for (const search of ["", "transform=pc1&start=2025-01-01", "freq=quarterly&agg=last", "as_of=2025-12-13"]) {
      const api = read(apiSeries(release, "local", "fx_price_index", q(search), o()));
      const twin = JSON.parse(seriesTwin(release, "local", "fx_price_index", "json", q(search), { address: ADDRESS }).body);
      expect(api.observations, search).toEqual(twin.observations);
      expect(api.observations.length, search).toBeGreaterThan(0);
      for (const field of ["key", "name", "unit", "frequency", "request", "transform", "as_of", "basis", "provenance", "citation", "release_id", "semantics_version"]) expect(api[field], `${search} ${field}`).toEqual(twin[field]);
    }
  });

  it("carries the Series' own provenance and rights, with the lineage the gate was asked about", () => {
    const body = read(apiSeries(release, "local", "fx_price_index_yoy", q(), o()));
    expect(body.provenance).toMatchObject({ origin: { producer: "Macro Atlas fixture (synthetic)" }, channel: { via: "fixture" }, representation: "native", recipe: { inputs: ["fx_price_index"] } });
    expect(body.rights).toMatchObject({ status: "public_domain", permission: "redistribute", permitted: true });
    expect(body.rights.lineage.length).toBeGreaterThan(0);
    expect(body.links).toMatchObject({ self: `${ADDRESS}/api/v1/series/fx_price_index_yoy`, page: `${ADDRESS}/data/fx_price_index_yoy`, vintages: `${ADDRESS}/api/v1/series/fx_price_index_yoy/vintages`, csv: `${ADDRESS}/data/fx_price_index_yoy.csv` });
  });

  it("an invalid transform gets 400 with the allowlist, as a list and in words", () => {
    const answer = apiSeries(release, "local", "fx_price_index", q("transform=cube"), o());
    expect(answer.status).toBe(400);
    const { error } = read(answer);
    expect(error.code).toBe("bad_request");
    expect(error.allowed).toEqual({
      parameters: ["transform", "freq", "agg", "start", "end", "as_of"],
      transform: [...TRANSFORMS],
      freq: ["daily", "business_daily", "weekly", "monthly", "quarterly", "annual"],
      agg: ["mean", "last", "sum"],
      start: "a calendar date, written YYYY-MM-DD",
      end: "a calendar date, written YYYY-MM-DD",
      as_of: "a calendar date, or an instant written YYYY-MM-DDTHH:MM:SSZ",
    });
    expect(error.message).toMatch(/transform: one of lin, chg/);
  });

  it.each(["freq=hourly", "agg=median", "start=yesterday", "end=2025-13-01", "as_of=soon", "nope=1", "transform=lin&transform=pc1", "pin=20260101T000000Z-0000000", "start=2025-06-01&end=2025-01-01"])("?%s gets 400 with the allowlist", (search) => {
    const answer = apiSeries(release, "local", "fx_price_index", q(search), o());
    expect(answer.status).toBe(400);
    expect(read(answer).error.allowed.transform).toEqual([...TRANSFORMS]);
    expect(read(answer).observations).toBeUndefined();
  });

  it("a Transform this Series does not allow gets 400 with the ones it does", () => {
    const answer = apiSeries(release, "local", "fx_price_index_yoy", q("transform=pc1"), o());
    expect(answer.status).toBe(400);
    expect(read(answer).error.allowed.transform).toEqual(["lin", "z"]);
  });

  it.each(["fx_nothing", "FX_PRICE_INDEX", "fx-price", "../catalog", "", "a".repeat(200), "__proto__", "constructor"])("an unknown key, %j, gets 400 with the keys this Release holds", (key) => {
    const answer = apiSeries(release, "local", key, q(), o());
    expect(answer.status).toBe(400);
    const { error } = read(answer);
    expect(error.code).toBe("unknown_series");
    expect(error.allowed.series).toEqual(release.catalog.series.map((e) => e.key));
    expect(error.allowed.catalog).toBe(`${ADDRESS}/api/v1/catalog.json`);
    expect(error.message.length).toBeLessThan(300);
  });

  it("a Withheld Series is 403 with the reason and no value", () => {
    const answer = apiSeries(release, "local", "fx_exchange_index", q(), o());
    expect(answer.status).toBe(403);
    const body = read(answer);
    expect(body.error).toMatchObject({ code: "withheld" });
    expect(body.rights).toMatchObject({ permission: "redistribute", permitted: false });
    expect(body.rights.reason).toMatch(/redistribution/);
    expect(body.observations).toBeUndefined();
  });

  it("a Series that may be displayed and not redistributed is 403 with the gate's reason (PLAN section 7)", () => {
    const answer = apiSeries(release, "production", "fx_price_index", q(), o(displayOnly()));
    expect(answer.status).toBe(403);
    const body = read(answer);
    expect(body.error.code).toBe("not_permitted");
    expect(body.rights).toMatchObject({ permission: "redistribute", permitted: false, reason: body.error.message });
    expect(answer.body).not.toMatch(/109\.9/);
    expect(answer.cacheable).toBe(false);
  });

  it("on a public surface nothing is handed out until a row is signed; once one is, the answer may be kept on production only", () => {
    for (const surface of ["staging", "production"] as const) {
      const refused = apiSeries(release, surface, "fx_price_index", q(), o());
      expect(refused.status).toBe(403);
      expect(refused.body).not.toMatch(/109\.9/);
      const given = apiSeries(release, surface, "fx_price_index", q(), o(signed()));
      expect(given.status).toBe(200);
      expect(read(given).notice).toBeUndefined();
      expect(given.cacheable).toBe(surface === "production");
    }
  });

  it("on a local build the body says it is not for publication", () => {
    expect(read(apiSeries(release, "local", "fx_price_index", q(), o())).notice).toMatch(/NOT FOR PUBLICATION/);
  });

  it("a renamed key answers 308 to the permanent one, question and all", async () => {
    const root = tempRoot();
    addRelease(root, { id: "20260201T000000Z-2222222", edit: { fx_permits_stale: (_, entry) => (entry.aliases = ["fx_old_permits"]) } });
    promote(root, "20260201T000000Z-2222222");
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    expect(apiSeries(opened.release, "local", "fx_old_permits", q("start=2024-01-01"), o())).toMatchObject({ status: 308, location: "/api/v1/series/fx_permits_stale?start=2024-01-01" });
    // The history keeps its own address.
    expect(apiVintages(opened.release, "local", "fx_old_permits", q("period=2024-06"), o())).toMatchObject({ status: 308, location: "/api/v1/series/fx_permits_stale/vintages?period=2024-06" });
    // A question that would be refused is refused, not sent on.
    expect(apiSeries(opened.release, "local", "fx_old_permits", q("transform=cube"), o()).status).toBe(400);
  });

  it("an answer too large to send is 422, and says to narrow it", () => {
    const answer = apiSeries(release, "local", "fx_price_index", q(), { address: ADDRESS, maxBytes: 500 });
    expect(answer.status).toBe(422);
    expect(read(answer).error).toMatchObject({ code: "too_large" });
    expect(Buffer.byteLength(answer.body)).toBeLessThan(2000);
  });
});

describe("GET /api/v1/series/{key}/vintages", () => {
  it("lists every version the Release holds, by Period and oldest first, with both clocks", () => {
    const body = read(apiVintages(release, "local", "fx_price_index", q(), o()));
    expect(body).toMatchObject({ key: "fx_price_index", held: true, period: null, versions_total: 26, page: 1, pages: 1, per_page: VERSIONS_PER_PAGE, next: null });
    expect(body.versions).toHaveLength(26);
    expect(body.versions.at(-1)).toEqual({
      period: "2025-12", period_start: "2025-12-01", period_end: "2025-12-31", value: 109.9, status: "preliminary", withdrawn: false,
      held_from: "2025-12-15T15:45:00Z", held_to: null, published: null, published_precision: null, superseded: null, current: true,
    });
    expect(body.revised_periods).toContain("2025-11");
    expect(body.captures).toMatchObject({ first: "2025-12-08T15:45:00Z" });
    expect(VERSIONS_PER_PAGE).toBe(5000);
  });

  it("with period=, gives the history of one Period (PLAN section 7)", () => {
    const body = read(apiVintages(release, "local", "fx_price_index", q("period=2025-11"), o()));
    expect(body.period).toBe("2025-11");
    expect(body.versions.map((v: { value: number; status: string; current: boolean }) => [v.value, v.status, v.current])).toEqual([[109.5, "preliminary", false], [109.3, "final", true]]);
    expect(body.versions_total).toBe(2);
  });

  it("a Period the Release holds nothing for is an empty history, not an error", () => {
    const body = read(apiVintages(release, "local", "fx_price_index", q("period=1999-01"), o()));
    expect(body).toMatchObject({ held: true, versions: [], versions_total: 0, page: 1, pages: 1 });
  });

  it("carries the rights of the Series' whole past, and where its history came through", () => {
    const body = read(apiVintages(release, "local", "fx_price_index", q(), o()));
    expect(body.rights).toMatchObject({ status: "public_domain", permission: "redistribute", permitted: true });
    expect(body.rights.lineage).toEqual([expect.objectContaining({ origin: "Macro Atlas fixture (synthetic)", channel: "fixture" })]);
    expect(body.provenance).toMatchObject({ current: { origin: { producer: "Macro Atlas fixture (synthetic)" } }, captures: { first: "2025-12-08T15:45:00Z" } });
    expect(body.notice).toMatch(/NOT FOR PUBLICATION/);
    expect(body.links).toMatchObject({ self: `${ADDRESS}/api/v1/series/fx_price_index/vintages`, series: `${ADDRESS}/api/v1/series/fx_price_index` });
  });

  it("a Derived series holds no versions of its own, and says why", () => {
    const body = read(apiVintages(release, "local", "fx_price_index_yoy", q(), o()));
    expect(body).toMatchObject({ key: "fx_price_index_yoy", held: false, why: "derived", versions: [], versions_total: 0 });
    expect(body.why_words).toMatch(/computed/);
  });

  it("is split into pages: page= moves through them, and a page that does not exist is 400 with the pages that do", () => {
    const two = read(apiVintages(release, "local", "fx_price_index", q("page=2"), { ...o(), perPage: 10 }));
    expect(two).toMatchObject({ page: 2, pages: 3, per_page: 10, versions_total: 26, next: `${ADDRESS}/api/v1/series/fx_price_index/vintages?page=3` });
    expect(two.versions).toHaveLength(10);
    const one = read(apiVintages(release, "local", "fx_price_index", q(), { ...o(), perPage: 10 }));
    const three = read(apiVintages(release, "local", "fx_price_index", q("page=3"), { ...o(), perPage: 10 }));
    expect([...one.versions, ...two.versions, ...three.versions]).toEqual(read(apiVintages(release, "local", "fx_price_index", q(), o())).versions);
    expect(three.next).toBeNull();
    for (const page of ["4", "0", "-1", "1.5", "two", "1e3", "9".repeat(30)]) {
      const answer = apiVintages(release, "local", "fx_price_index", q(`page=${page}`), { ...o(), perPage: 10 });
      expect(answer.status, page).toBe(400);
      expect(read(answer).error.allowed, page).toMatchObject({ parameters: ["period", "page"], page: "a whole number from 1 to 3" });
    }
  });

  it("refuses what it does not take, with 400 and the list", () => {
    for (const search of ["as_of=2025-12-13", "period=2025-11&period=2025-12", "period=%3Cscript%3E", "transform=pc1"]) {
      const answer = apiVintages(release, "local", "fx_price_index", q(search), o());
      expect(answer.status, search).toBe(400);
      expect(read(answer).error.allowed.parameters, search).toEqual(["period", "page"]);
    }
    expect(apiVintages(release, "local", "fx_nothing", q(), o()).status).toBe(400);
    expect(read(apiVintages(release, "local", "fx_nothing", q(), o())).error.code).toBe("unknown_series");
  });

  it("is refused with 403 where the Series' past may not be handed out, and holds no version", () => {
    for (const [surface, gate] of [["production", undefined], ["staging", undefined], ["production", displayOnly()]] as const) {
      const answer = apiVintages(release, surface, "fx_price_index", q(), o(gate));
      expect(answer.status).toBe(403);
      expect(read(answer).rights).toMatchObject({ permission: "redistribute", permitted: false });
      expect(answer.body).not.toMatch(/109\.[359]/);
    }
    expect(apiVintages(release, "production", "fx_price_index", q(), o(signed())).status).toBe(200);
  });
});

describe("GET /api/v1/events.json", () => {
  it("lists the Events of the Release, each with its sources, and the categories they fall in", () => {
    const body = read(apiEvents(release, "local", q(), o()));
    expect(body).toMatchObject({ count: 1, total: 1, category: null, categories: [{ value: "policy", label: "Economic policy", count: 1 }] });
    expect(body.events).toEqual([
      {
        id: EVENT,
        date: "2024-09-18",
        end: null,
        date_precision: "day",
        title: "Fixture central bank changes its rate",
        category: "policy",
        status: "public",
        topics: ["inflation"],
        related_series: ["fx_price_index", "fx_exchange_index", "fx_not_in_this_release"],
        sources: [
          { name: "Fixture gazette (synthetic)", url: "https://example.org/fixture-gazette", archive_url: "https://example.org/archive/2026/fixture-gazette", no_archive: null },
          { name: "Fixture harbour board (synthetic)", url: "https://example.org/fixture-harbour", archive_url: null, no_archive: "The fixture harbour board's pages cannot be archived (synthetic reason)." },
        ],
        description: "The fixture central bank announced a new policy rate on 18 September 2024.\n\nThe announcement was published in the fixture gazette the same day.",
        address: `${ADDRESS}/events/${EVENT}`,
      },
    ]);
    expect(body.rights).toMatchObject({ permission: "none", permitted: true });
  });

  it("cat= narrows to one category; a category of events the Release has none of is an empty list", () => {
    expect(read(apiEvents(release, "local", q("cat=policy"), o()))).toMatchObject({ count: 1, total: 1, category: "policy" });
    expect(read(apiEvents(release, "local", q("cat=health"), o()))).toMatchObject({ count: 0, total: 1, category: "health", events: [] });
  });

  it("a category that does not exist gets 400 with the ones that do", () => {
    const answer = apiEvents(release, "local", q("cat=weather"), o());
    expect(answer.status).toBe(400);
    expect(read(answer).error.allowed).toEqual({ parameters: ["cat"], cat: ["political", "financial", "geopolitical", "health", "policy", "disaster", "infrastructure", "legislation"] });
    expect(apiEvents(release, "local", q("category=policy"), o()).status).toBe(400);
    expect(apiEvents(release, "local", q("cat=policy&cat=health"), o()).status).toBe(400);
  });
});

describe("GET /api/v1/claims.json", () => {
  it("lists the Claims of the Release as records, with where their evidence is, and no figure", () => {
    const body = read(apiClaims(release, "local", q(), o()));
    expect(body).toMatchObject({ count: 1, total: 1, filters: { person: null, party: null, topic: null } });
    const claim = body.claims[0];
    expect(claim).toMatchObject({
      id: CLAIM,
      status: "public",
      said_on: "2025-12-11",
      evidence_state: "held",
      address: `${ADDRESS}/claims/${CLAIM}`,
      twins: { json: `${ADDRESS}/claims/${CLAIM}.json`, markdown: `${ADDRESS}/claims/${CLAIM}.md`, evidence_csv: `${ADDRESS}/claims/${CLAIM}/evidence.csv`, lock: `${ADDRESS}/claims/${CLAIM}/lock.json` },
    });
    expect(claim.claimant.name).toBe(release.claims.claims[0]!.claimant.name);
    expect(claim.quote).toBe(release.claims.claims[0]!.quote);
    expect(claim.sources.length).toBeGreaterThanOrEqual(2);
    expect(claim.readings.length).toBeGreaterThan(0);
    // The record, and not the evidence: no row, no figure.
    expect(claim.evidence).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/"figures"|"then"|"now_when_checked"/);
    expect(body.rights).toMatchObject({ permission: "none", permitted: true });
    expect(body.options.party).toEqual([{ value: "none", label: "No party", count: 1 }]);
  });

  it("where the evidence may not be handed out, the record is still listed, says so, and names no file of figures", () => {
    for (const [surface, gate] of [["production", undefined], ["production", displayOnly()]] as const) {
      const claim = read(apiClaims(release, surface, q(), o(gate))).claims[0];
      expect(claim.evidence_state).toBe("not_permitted");
      expect(typeof claim.evidence_reason).toBe("string");
      expect(claim.twins).toEqual({});
    }
    expect(read(apiClaims(release, "production", q(), o(signed()))).claims[0]).toMatchObject({ evidence_state: "held", twins: { evidence_csv: `${ADDRESS}/claims/${CLAIM}/evidence.csv` } });
  });

  it("person=, party= and topic= narrow the list; a value no Claim has gets 400 with the ones there are", () => {
    expect(read(apiClaims(release, "local", q("party=none&topic=inflation"), o()))).toMatchObject({ count: 1, filters: { party: "none", topic: "inflation" } });
    const answer = apiClaims(release, "local", q("topic=trade"), o());
    expect(answer.status).toBe(400);
    expect(read(answer).error.allowed).toMatchObject({ parameters: ["person", "party", "topic"], topic: ["inflation"], party: ["none"] });
    expect(apiClaims(release, "local", q("claimant=x"), o()).status).toBe(400);
  });
});

describe("GET /api/v1/status", () => {
  const context = { refreshFailed: null, now: Date.parse("2026-01-01T06:00:00Z"), lastRun: null };
  it("is the status it always was, with the four fields beside it", () => {
    const body = read(apiStatus(release, "local", q(), context));
    expect(body).toMatchObject({ status: "stale_inputs", surface: "local", release_id: FIXTURE_ID, age_seconds: 21600, counts: { series: 11, shown: 10, withheld: 1, stale: 1 } });
    expect(body.series.find((s: { key: string }) => s.key === "fx_permits_stale")).toMatchObject({ stale: true, last_period: "2024-06" });
    expect(body.provenance).toMatchObject({ publisher: "Macro Atlas", release: { id: FIXTURE_ID } });
    expect(body.rights).toMatchObject({ permission: "none", permitted: true });
  });

  it("is never kept by a cache, on any surface: its clock moves on its own", () => {
    for (const surface of ["local", "staging", "production"] as const) expect(apiStatus(release, surface, q(), context).cacheable).toBe(false);
  });
});

describe("an address under /api/v1 that is no route", () => {
  it("is 404 as JSON, with the routes there are", () => {
    const answer = apiNotFound(release, "local", "/api/v1/series", o());
    expect(answer.status).toBe(404);
    const { error } = read(answer);
    expect(error).toMatchObject({ code: "unknown_route" });
    expect(error.allowed.routes).toEqual(API_ROUTES.map((r) => r.path));
    // What was asked for is not echoed at length, or as anything but text in JSON.
    const long = apiNotFound(release, "local", `/api/v1/${"x".repeat(5000)}`, o());
    expect(long.body.length).toBeLessThan(3000);
  });
});

describe("what a collection may cost", () => {
  it("an answer that took too long is not given: 503", () => {
    let t = 0;
    const clock = () => (t += 6_000);
    for (const answer of [apiCatalog(release, "local", q(), { ...o(), clock, maxMs: 5_000 }), apiEvents(release, "local", q(), { ...o(), clock, maxMs: 5_000 }), apiClaims(release, "local", q(), { ...o(), clock, maxMs: 5_000 })]) {
      expect(answer.status).toBe(503);
      expect(read(answer).error).toMatchObject({ code: "too_slow" });
      expect(read(answer).series ?? read(answer).events ?? read(answer).claims).toBeUndefined();
    }
  });

  it("a body over the cap on bytes is 422 on every route", () => {
    const small = { ...o(), maxBytes: 300 };
    for (const answer of [apiCatalog(release, "local", q(), small), apiEvents(release, "local", q(), small), apiClaims(release, "local", q(), small), apiVintages(release, "local", "fx_price_index", q(), small), apiIndex(release, "local", q(), small)]) {
      expect(answer.status).toBe(422);
      expect(read(answer).error.code).toBe("too_large");
    }
  });
});

describe("what /docs/api says", () => {
  it("is every route the API has, each with an address that answers, and the limits in force", () => {
    const view = apiDocsView(release, "local", ADDRESS);
    expect(view.routes.map((r) => r.path)).toEqual(API_ROUTES.map((r) => r.path));
    expect(view.routes.map((r) => r.example)).toEqual([
      `${ADDRESS}/api/v1/catalog.json`,
      `${ADDRESS}/api/v1/series/fx_price_index?transform=pc1&start=2020-01-01`,
      `${ADDRESS}/api/v1/series/fx_price_index/vintages`,
      `${ADDRESS}/api/v1/events.json`,
      `${ADDRESS}/api/v1/claims.json`,
      `${ADDRESS}/api/v1/status`,
    ]);
    expect(view.example).toEqual({ key: "fx_price_index", name: "Fixture price index", given: true });
    expect(Object.fromEntries(view.limits)["Each address"]).toBe("120 requests at once, then 120 a minute. An IPv6 address is counted with its /64 network.");
    expect(Object.fromEntries(view.limits)["Every address together"]).toBe("600 requests at once, then 1,200 a minute.");
    expect(Object.fromEntries(view.limits)["One answer"]).toBe("At most 50,000 observations, 8 MiB, and 5 seconds. An as-of answer or a history reads at most 250,000 versions.");
    expect(view.errors.map(([status]) => status)).toEqual(["400", "403", "404", "422", "429", "503"]);
  });

  it("where no Series may be handed out, says so and still names one to ask about", () => {
    expect(apiDocsView(release, "production", ADDRESS).example).toEqual({ key: "fx_price_index", name: "Fixture price index", given: false });
    expect(apiDocsView(release, "production", ADDRESS, signed()).example).toMatchObject({ given: true });
  });
});
