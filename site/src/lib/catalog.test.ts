/**
 * The /data catalog page's logic (PLAN section 3, M2): search and filters over the Catalog of
 * the Release being served, with values only where the rights gate allows. Fixture release.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { catalogView, formatValue, parseCatalogFilters, releaseHoldsLegacy } from "./catalog";
import { createReleaseReader, type OpenedRelease } from "./release/reader";
import { addRelease, FIXTURE_ROOT, promote, tempRoot } from "./release/testing";

let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});

const view = (params: Record<string, string | string[] | undefined> = {}, surface: "local" | "production" = "local") =>
  catalogView(release, surface, parseCatalogFilters(params));
const keys = (v: ReturnType<typeof view>) => v.rows.map((row) => row.key);

describe("the catalog lists every series the release knows", () => {
  it("in catalog order, with name, unit, frequency, span, source and rights", () => {
    const all = view();
    expect(all.total).toBe(11);
    expect(all.rows).toHaveLength(11);
    expect(all.rows[0]).toMatchObject({
      key: "fx_price_index",
      name: "Fixture price index",
      unit: "index, 2024-01 = 100",
      frequency: "Monthly",
      first: "2024-01",
      origin: "Macro Atlas fixture (synthetic)",
      via: "fixture",
      rights: "Public domain",
      legacy: false,
      state: "shown",
    });
    expect(all.rows[0]!.latest).toMatchObject({ period: expect.stringMatching(/^2025-/), text: expect.stringMatching(/^[0-9.,]+$/) });
  });

  it("names a withheld series with the reason and gives no value or span for it", () => {
    const row = view().rows.find((r) => r.key === "fx_exchange_index")!;
    expect(row).toMatchObject({ state: "withheld", reason: "The licence does not allow redistribution.", latest: null, first: null, last: null });
    expect(row.name).toBe("Fixture exchange index");
  });

  it("where the surface is not permitted, lists names and spans' absence but no values", () => {
    const refused = view({}, "production");
    expect(refused.rows).toHaveLength(11);
    for (const row of refused.rows) {
      expect(row.latest).toBeNull();
      expect(row.state === "withheld" || row.state === "not_permitted").toBe(true);
    }
  });
});

describe("search", () => {
  it("matches words in the name, the key, the description and the origin's identifier, in any case", () => {
    expect(keys(view({ q: "PRICE" }))).toEqual(["fx_price_index", "fx_price_index_yoy"]);
    expect(keys(view({ q: "fx_vote" }))).toEqual(["fx_vote_margin"]);
    expect(keys(view({ q: "FX-VOTE" }))).toEqual(["fx_vote_margin"]);
    expect(keys(view({ q: "election" }))).toEqual(["fx_vote_margin"]);
  });

  it("needs every word to match, in any order", () => {
    expect(keys(view({ q: "index price year" }))).toEqual(["fx_price_index_yoy"]);
    expect(keys(view({ q: "price nonsense" }))).toEqual([]);
  });

  it("ignores surrounding space and an over-long query does no harm", () => {
    expect(keys(view({ q: "  price  " }))).toHaveLength(2);
    expect(parseCatalogFilters({ q: "x".repeat(500) }).q).toHaveLength(100);
  });
});

describe("filters", () => {
  it("narrow by segment, frequency, how a series was obtained, and rights", () => {
    expect(keys(view({ segment: "governance_politics" }))).toEqual(["fx_vote_margin"]);
    expect(keys(view({ freq: "quarterly" }))).toEqual(["fx_output_quarterly"]);
    expect(keys(view({ via: "fixture_vendor" }))).toEqual(["fx_exchange_index"]);
    expect(keys(view({ rights: "citation_required" }))).toEqual(["fx_poverty_rate_annual"]);
  });

  it("combine with each other and with search", () => {
    expect(keys(view({ segment: "economy_jobs", freq: "monthly", q: "payrolls" }))).toEqual(["fx_payrolls_break"]);
    expect(keys(view({ segment: "infrastructure", freq: "annual" }))).toEqual([]);
  });

  it("offer only values that occur in this release, each with its count and a plain label", () => {
    const { facets } = view();
    expect(facets.segment).toEqual([
      { value: "economy_jobs", label: "Economy & jobs", count: 5 },
      { value: "markets_money", label: "Markets & money", count: 1 },
      { value: "infrastructure", label: "Infrastructure", count: 1 },
      { value: "governance_politics", label: "Governance & politics", count: 1 },
      { value: "us_in_the_world", label: "The US in the world", count: 3 },
    ]);
    expect(facets.freq.map((f) => f.label)).toEqual(["Monthly", "Quarterly", "Annual", "Irregular"]);
    expect(facets.rights.find((f) => f.value === "no_redistribution")).toEqual({ value: "no_redistribution", label: "No redistribution", count: 1 });
  });

  it("a value that does not occur, or is sent twice, is no filter at all", () => {
    expect(view({ segment: "no_such_segment" }).rows).toHaveLength(11);
    expect(view({ segment: "no_such_segment" }).filters.segment).toBeNull();
    expect(view({ freq: ["monthly", "annual"] }).filters.freq).toBe("monthly");
  });

  it("says whether anything is narrowing the list", () => {
    expect(view().active).toBe(false);
    expect(view({ q: "price" }).active).toBe(true);
    expect(view({ freq: "annual" }).active).toBe(true);
    expect(view({ freq: "fortnightly" }).active).toBe(false);
  });
});

describe("values are rounded only for display", () => {
  it.each([
    [3.14159, "3.14"],
    [4.3, "4.3"],
    [100, "100"],
    [152.36, "152.4"],
    [12345.678, "12,346"],
    [-0.456, "-0.46"],
    [21000000, "21,000,000"],
  ])("%d reads %s", (value, text) => {
    expect(formatValue(value)).toBe(text);
  });
});

describe("whether a release holds v1's legacy data (for the strip)", () => {
  it("the fixture does not; a release with one legacy series does", async () => {
    expect(releaseHoldsLegacy(release)).toBe(false);
    const root = tempRoot();
    const id = "20260301T000000Z-1e9ac11";
    addRelease(root, { id, profile: "local", signed: false, legacy: "fx_price_index" });
    promote(root, id);
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    expect(releaseHoldsLegacy(opened.release)).toBe(true);
    const row = catalogView(opened.release, "local", parseCatalogFilters({})).rows.find((r) => r.key === "fx_price_index")!;
    expect(row.legacy).toBe(true);
  });
});
