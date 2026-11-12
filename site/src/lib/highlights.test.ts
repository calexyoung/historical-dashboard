/**
 * The Overview and Highlights as views of a Release (PLAN section 3, M22; ADR 0036), on the
 * fixture release. Values reach a row only through Query, so the rights gate decides; every
 * expected figure is worked out by hand from the fixture's values.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { parseExplorerParams } from "./explorer/state";
import { svgString } from "./figure";
import { highlightsView, overviewView, type HeadlineRow } from "./highlights";
import { createReleaseReader, type OpenedRelease } from "./release/reader";
import { addRelease, FIXTURE_ROOT, promote, tempRoot } from "./release/testing";

let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});

type Shown = Extract<HeadlineRow, { state: "shown" }>;
const rows = (surface: "local" | "production" = "local") => new Map(highlightsView(release, surface).segments.flatMap((s) => s.rows.map((row) => [row.key, row] as const)));
const shown = (key: string): Shown => {
  const row = rows().get(key);
  if (row?.state !== "shown") throw new Error(`${key}: ${row?.state}`);
  return row;
};
const windowOf = (href: string) => {
  const [path, query] = href.split("?");
  const state = parseExplorerParams(new URLSearchParams(query));
  return { path, series: state.series, from: state.from, to: state.to, freq: state.freq, notes: state.notes };
};

describe("Highlights: every headline Series with its change over one, five and ten years", () => {
  it("lists the six Segments in the order of the Overview, each with its headline Series in the editor's order", () => {
    const view = highlightsView(release, "local");
    expect(view.segments.map((s) => s.label)).toEqual(["Economy & jobs", "Markets & money", "Infrastructure", "Governance & politics", "Disasters & health", "The US in the world"]);
    expect(view.segments[0]!.rows.map((row) => row.key)).toEqual(["fx_price_index", "fx_poverty_rate_annual", "fx_output_quarterly", "fx_price_index_yoy", "fx_payrolls_break"]);
    expect(view.segments[4]!.rows).toEqual([]);
    expect(view.total).toBe(8);
  });

  it("states a level's latest value and its percent change, and says which cells have nothing to compare", () => {
    const row = shown("fx_price_index");
    expect(row).toMatchObject({ name: "Fixture price index", href: "/data/fx_price_index", unit: "index, 2024-01 = 100", explorer: "/explore?s=fx_price_index" });
    expect(row.latest).toMatchObject({ value: "109.9", when: "December 2025" });
    expect(row.marks).toEqual([{ mark: "preliminary", word: "Preliminary" }]);
    // 109.9 against 104.5 in December 2024: 5.4 / 104.5 = 5.167…%
    expect(row.cells!.map((c) => [c.years, c.figure?.text ?? null, c.reason])).toEqual([
      [1, "+5.2%", null],
      [5, null, "The series does not go back to Dec 2020"],
      [10, null, "The series does not go back to Dec 2015"],
    ]);
  });

  it("gives a rate its change in percentage points over all three spans", () => {
    // 10.4 in 2025; 10.6 in 2024, 11.5 in 2020, 13.5 in 2015.
    expect(shown("fx_poverty_rate_annual").cells!.map((c) => c.figure?.text)).toEqual(["−0.2 pts", "−1.1 pts", "−3.1 pts"]);
  });

  it("every cell of a shown Series is a door to the Explorer at that window, figure or none", () => {
    for (const row of rows().values()) {
      if (row.state !== "shown" || !row.cells) continue;
      for (const cell of row.cells) {
        const door = windowOf(cell.href);
        expect(door.path).toBe("/explore");
        expect(door.series).toEqual([row.key]);
        expect(door.notes).toEqual([]);
        expect(door.from).toBe(cell.periodStart!.slice(0, 7));
        expect(door.to).toBe(row.latest!.period_end.slice(0, 7));
      }
    }
    expect(shown("fx_price_index").cells![0]!.href).toBe("/explore?s=fx_price_index&from=2024-12&to=2025-12");
    expect(shown("fx_price_index").cells![2]!.href).toBe("/explore?s=fx_price_index&from=2015-12&to=2025-12");
    // An annual Period is a whole year, and a quarter three months: the window holds both whole.
    expect(shown("fx_poverty_rate_annual").cells![1]!.href).toBe("/explore?s=fx_poverty_rate_annual&from=2020-01&to=2025-12");
    expect(shown("fx_output_quarterly").cells![0]!.href).toBe("/explore?s=fx_output_quarterly&from=2024-10&to=2025-12");
  });

  it("names the Data state in place of a figure: an estimate, a break", () => {
    const output = shown("fx_output_quarterly");
    expect(output.latest!.value).toBe("566.4");
    expect(output.marks).toEqual([{ mark: "estimate", word: "Estimate" }]);
    expect(output.cells!.map((c) => [c.figure, c.state?.word])).toEqual([[null, "Estimate"], [null, "Estimate"], [null, "Estimate"]]);
    expect(shown("fx_payrolls_break").cells![0]).toMatchObject({ figure: null, state: { mark: "break", word: "Break" }, reason: "The series has a break at January 2025" });
  });

  it("keeps a stale Series' figures and marks its latest value Stale", () => {
    const row = shown("fx_permits_stale");
    expect(row.marks).toEqual([{ mark: "stale", word: "Stale" }]);
    // 108 in June 2024 against 97 in June 2023: 11 / 97 = 11.34…%
    expect(row.cells![0]!.figure!.text).toBe("+11.3%");
  });

  it("gives an irregular Series its latest value, the reason it has no cells, and a door to the Explorer", () => {
    const row = shown("fx_vote_margin");
    expect(row.cells).toBeNull();
    expect(row.latest!.value).toBe("−1.5");
    expect(row.reason).toMatch(/no fixed cadence/);
    expect(row.explorer).toBe("/explore?s=fx_vote_margin");
  });

  it("lists a Withheld Series by name with the reason, and nothing that is or dates a value", () => {
    const row = rows("production").get("fx_exchange_index")!;
    expect(row).toEqual({ state: "withheld", key: "fx_exchange_index", name: "Fixture exchange index", href: "/data/fx_exchange_index", reason: "The licence does not allow redistribution." });
  });

  it("asks the gate on the Surface it is for: what a public Surface may not show is named and no more", () => {
    // The fixture's register row is not signed, so the production gate permits nothing.
    for (const row of rows("production").values()) {
      expect(row.state === "withheld" || row.state === "not_permitted").toBe(true);
      expect(Object.keys(row).sort()).toEqual(["href", "key", "name", "reason", "state"]);
    }
  });
});

describe("the Overview: one row per Segment", () => {
  it("has six rows in order, each the Segment's first headline Series, and says how many more there are", () => {
    const view = overviewView(release, "local");
    expect(view.segments.map((s) => [s.segment, s.row?.key ?? null, s.more])).toEqual([
      ["economy_jobs", "fx_price_index", 4],
      ["markets_money", "fx_exchange_index", 0],
      ["infrastructure", "fx_permits_stale", 0],
      ["governance_politics", "fx_vote_margin", 0],
      ["disasters_health", null, 0],
      ["us_in_the_world", null, 0],
    ]);
    expect(view.segments[0]).toMatchObject({ label: "Economy & jobs", href: "/data?segment=economy_jobs" });
    expect(view.release).toBe("1 January 2026");
  });

  it("states the latest value in words, the one-year change, and draws the Series small", () => {
    const row = overviewView(release, "local").segments[0]!.row as Shown;
    expect(row.latest!.words).toBe("109.9 in December 2025 (index, 2024-01 = 100)");
    expect(row.cells![0]!.figure!.words).toBe("5.2% higher than a year earlier");
    const markup = svgString(row.spark!);
    expect(markup).toContain('aria-label="Fixture price index, January 2024 to December 2025"');
    expect(markup).not.toContain("109.9");
  });

  it("draws nothing for a Series it may not show", () => {
    const row = overviewView(release, "local").segments[1]!.row!;
    expect(row.state).toBe("withheld");
    expect("spark" in row).toBe(false);
  });
});

describe("a Release that names other headline Series, or was written before there were any", () => {
  it("follows the Release's own content/highlights.json", async () => {
    const root = tempRoot();
    const id = "20260301T000000Z-abcdef0";
    addRelease(root, { id, highlights: { economy_jobs: ["fx_payrolls_break"], infrastructure: [] } });
    promote(root, id);
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    const view = overviewView(opened.release, "local");
    expect(view.segments.map((s) => s.row?.key ?? null)).toEqual(["fx_payrolls_break", "fx_exchange_index", null, "fx_vote_margin", null, null]);
  });

  it("has six empty Segments for a Release of the contract before 0.5.0", async () => {
    const root = tempRoot();
    const id = "20260301T000000Z-abcdef1";
    addRelease(root, { id, schema: "0.4.0" });
    promote(root, id);
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    expect(overviewView(opened.release, "local").segments.map((s) => s.row)).toEqual([null, null, null, null, null, null]);
    expect(highlightsView(opened.release, "local").total).toBe(0);
  });
});
