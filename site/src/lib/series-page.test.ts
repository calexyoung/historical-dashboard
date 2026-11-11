/**
 * The series page's view of a Release (PLAN section 3, `/data/{key}`; M3), on the fixture
 * release. Values reach the page only through Query, so the rights gate decides.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Surface } from "@macro-atlas/core";
import { createReleaseReader, type OpenedRelease } from "./release/reader";
import { FIXTURE_ROOT } from "./release/testing";
import { seriesPageView, type SeriesPageView } from "./series-page";

let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});

function page(key: string, surface: Surface = "local"): SeriesPageView {
  const answer = seriesPageView(release, surface, key);
  if (answer.kind !== "page") throw new Error(`${key}: ${answer.kind}`);
  return answer.view;
}
const fact = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label)?.value;

describe("a series page", () => {
  it("names the series and defines it from the catalog, saying what is not recorded", () => {
    const v = page("fx_price_index");
    expect(v).toMatchObject({ key: "fx_price_index", name: "Fixture price index", state: "shown", reason: null });
    expect(v.description).toBe("Synthetic monthly index with one missing month and a preliminary latest value.");
    expect(fact(v.facts, "Unit")).toBe("index, 2024-01 = 100");
    expect(fact(v.facts, "Frequency")).toBe("Monthly");
    expect(fact(v.facts, "Seasonal adjustment")).toBe("Seasonally adjusted");
    expect(fact(v.facts, "Population")).toBe("All synthetic households");
    expect(fact(v.facts, "Geography")).toBe("Fixtureland");
    expect(fact(v.facts, "Base period")).toBe("2024-01");
    expect(fact(page("fx_vote_margin").facts, "Seasonal adjustment")).toBe("Not recorded");
    expect(fact(page("fx_vote_margin").facts, "Prices")).toBe("Not recorded");
    expect(fact(page("fx_vote_margin").facts, "How values stand")).toBe("Each value stands until the next one");
  });

  it("gives the latest value with its Period, in words, and its state", () => {
    const v = page("fx_price_index");
    expect(v.latest).toEqual({ value: "109.9", unit: "index, 2024-01 = 100", period: "December 2025", states: [{ mark: "preliminary", word: "Preliminary" }], newerGap: null });
    expect(page("fx_poverty_rate_annual").latest).toMatchObject({ value: "10.4", period: "2025", states: [] });
    expect(page("fx_permits_stale").latest).toMatchObject({ period: "June 2024", states: [{ mark: "stale", word: "Stale" }] });
  });

  it("carries the explained figure: takeaway or silence, a drawing, and every Observation in the table", () => {
    const v = page("fx_price_index");
    // 109.9 against 104.5 a year earlier: 5.167...%
    expect(v.figure.takeaway).toBe("Fixture price index was 109.9 in December 2025 (index, 2024-01 = 100), 5.2% higher than a year earlier.");
    expect(v.figure.plots).toHaveLength(1);
    expect(v.figure.tables[0]!.rows).toHaveLength(24);
    expect(v.figure.sourceLine).toBe("Source: Macro Atlas fixture (synthetic), FX-PRICE, via fixture · data to Dec 2025 · preliminary");
    expect(page("fx_permits_stale").figure.silence?.rule).toBe("stale");
    expect(page("fx_output_quarterly").figure.silence?.rule).toBe("estimate");
    expect(page("fx_payrolls_break").figure.silence?.rule).toBe("break");
    expect(page("fx_vote_margin").figure.plots[0]!.series[0]!.drawnAs).toBe("step");
    expect(page("fx_output_quarterly").figure.plots[0]!.series[0]!.drawnAs).toBe("points");
  });

  it("keeps Origin and Channel apart in the provenance block, and names the Release", () => {
    const v = page("fx_poverty_rate_annual");
    expect(v.provenance.origin).toEqual([
      { label: "Produced by", value: "Macro Atlas fixture (synthetic)" },
      { label: "Dataset", value: "fixture" },
      { label: "Identifier", value: "FX-POVERTY" },
    ]);
    expect(v.provenance.channel).toEqual([
      { label: "Obtained", value: "fixture" },
      { label: "Adapter", value: "hand_written" },
    ]);
    expect(fact(v.provenance.rights, "Status")).toBe("Citation required");
    expect(fact(v.provenance.rights, "Terms read")).toBe("1 January 2026");
    expect(fact(v.provenance.rights, "Attribution")).toBe("Synthetic test data, Macro Atlas project");
    expect(fact(v.provenance.release, "Release")).toBe("20260101T000000Z-0000000");
    expect(fact(v.provenance.release, "Values held as")).toBe("Unrounded, at the series' own frequency");
  });

  it("a derived series names its recipe and links its inputs", () => {
    const v = page("fx_price_index_yoy");
    expect(v.provenance.lineage).toEqual({
      text: "Computed by Macro Atlas: the percent change of one series from 12 periods earlier.",
      inputs: [{ key: "fx_price_index", name: "Fixture price index" }],
    });
    expect(page("fx_price_index").provenance.lineage).toBeNull();
  });

  it("lists breaks and data notes", () => {
    expect(page("fx_payrolls_break").notes).toEqual([
      { period: "Jan 2025", kind: "Break", text: "New population controls from January 2025; earlier months are not comparable." },
      { period: "Jan 2025", kind: "Data note", text: "New population controls; earlier months are not comparable" },
    ]);
    expect(page("fx_price_index").notes).toEqual([]);
  });

  it("opens in the Explorer on that series", () => {
    expect(page("fx_price_index").explorerPath).toBe("/explore?s=fx_price_index");
  });
});

describe("a series whose values may not be shown", () => {
  it("withheld: the page exists, names the series and the reason, and holds no value", () => {
    const v = page("fx_exchange_index");
    expect(v).toMatchObject({ state: "withheld", reason: "The licence does not allow redistribution.", latest: null });
    expect(v.figure.plots).toEqual([]);
    expect(v.figure.tables).toEqual([]);
    expect(v.figure.states).toEqual([{ mark: "withheld", word: "Withheld", series: "Fixture exchange index", text: "The licence does not allow redistribution." }]);
    expect(fact(v.provenance.rights, "Status")).toBe("No redistribution");
  });

  it("not permitted on this Surface: the same page with no value anywhere in it", () => {
    const v = page("fx_price_index", "production");
    expect(v.state).toBe("not_permitted");
    expect(v.reason).toMatch(/rights register is not in force/);
    expect(v.latest).toBeNull();
    expect(v.figure.plots).toEqual([]);
    expect(v.figure.tables).toEqual([]);
    expect(v.figure.takeaway).toBeNull();
    const text = JSON.stringify(v);
    for (const value of ["109.9", "104.5", "100.4"]) expect(text).not.toContain(value);
    expect(v.name).toBe("Fixture price index"); // withheld is visible
  });
});

describe("addresses", () => {
  it("an unknown key, or something that is not a key, is not found", () => {
    for (const key of ["nope", "FX_PRICE_INDEX", "../manifest", "", "fx_price_index.json", "constructor"]) {
      expect(seriesPageView(release, "local", key), key).toEqual({ kind: "not_found" });
    }
  });

  it("an alias moves to the permanent key", () => {
    const aliased = { ...release, catalog: { series: release.catalog.series.map((e) => (e.key === "fx_price_index" ? { ...e, aliases: ["fx_cpi"] } : e)) } };
    expect(seriesPageView(aliased, "local", "fx_cpi")).toEqual({ kind: "moved", key: "fx_price_index" });
  });
});
