/**
 * Topic pages as views of a Release (PLAN section 3, M23; ADR 0037), on the fixture release.
 * Every expected figure is worked out by hand from the fixture's values
 * (fixtures/make_fixture.py); none comes from the code under test.
 */
import { createRightsGate } from "@macro-atlas/core";
import { beforeAll, describe, expect, it } from "vitest";
import { svgString } from "./figure";
import { createReleaseReader, type OpenedRelease } from "./release/reader";
import { addRelease, fixtureRegister, FIXTURE_ROOT, promote, tempRoot } from "./release/testing";
import { search } from "./search";
import { RELATION_WORDS, topicLinks, topicPageView, topicsIndexView, type TopicPageView } from "./topics";

const open = async (root: string, surface: "local" | "production" = "local"): Promise<OpenedRelease> => {
  const opened = await createReleaseReader({ root, surface }).current();
  if (!opened.ok) throw new Error(opened.reason);
  return opened.release;
};
let release: OpenedRelease;
beforeAll(async () => {
  release = await open(FIXTURE_ROOT);
});

const page = (slug = "inflation", surface: "local" | "production" = "local", from: OpenedRelease = release): TopicPageView => {
  const view = topicPageView(from, surface, slug);
  if (!view) throw new Error(`no Topic ${slug}`);
  return view;
};
/** Every drawing and every word of a view, as one text. */
const everything = (view: unknown): string => JSON.stringify(view, (_key, value: unknown) => (value && typeof value === "object" && "tag" in value && "children" in value ? svgString(value as Parameters<typeof svgString>[0]) : value));

describe("the index of Topics", () => {
  it("lists the Release's Topics, each with the definition it quotes and its main Series", () => {
    const view = topicsIndexView(release, "local");
    expect(view.topics.map((t) => [t.slug, t.title, t.href, t.segment, t.draft])).toEqual([
      ["inflation", "Inflation", "/topics/inflation", "Economy & jobs", false],
      ["jobs", "Jobs", "/topics/jobs", "Economy & jobs", false],
    ]);
    expect(view.topics[0]).toMatchObject({ quote: "The fixture price index measures the average change in the prices that synthetic households pay.", source: "Fixture statistics office (synthetic), Handbook", main: { key: "fx_price_index_yoy", state: "shown", href: "/data/fx_price_index_yoy" } });
    expect(topicLinks(release)).toEqual([{ slug: "inflation", title: "Inflation", href: "/topics/inflation" }, { slug: "jobs", title: "Jobs", href: "/topics/jobs" }]);
  });

  it("is empty for a Release written before there were Topics, and such a Release still opens", async () => {
    const root = tempRoot();
    const id = "20260301T000000Z-abcdef5";
    addRelease(root, { id, schema: "0.5.0" });
    promote(root, id);
    const old = await open(root);
    expect(old.topics.topics).toEqual([]);
    expect(topicsIndexView(old, "local").topics).toEqual([]);
    expect(topicPageView(old, "local", "inflation")).toBeNull();
    expect(search(old, "local", "inflation").groups.map((g) => g.kind)).not.toContain("topic");
  });
});

describe("a Topic page", () => {
  it("answers nothing for a slug that is not a Topic of the Release, or is not a slug", () => {
    expect(topicPageView(release, "local", "no-such-topic")).toBeNull();
    expect(topicPageView(release, "local", "../inflation")).toBeNull();
    expect(topicPageView(release, "local", "Inflation")).toBeNull();
  });

  it("opens with the definition, quoted and cited, with its archived copy or the reason there is none", () => {
    expect(page().definition).toEqual({
      quote: "The fixture price index measures the average change in the prices that synthetic households pay.",
      source: { name: "Fixture statistics office (synthetic), Handbook", url: "https://example.org/fixture-handbook", archive: "https://example.org/archive/2026/fixture-handbook", noArchive: null },
    });
    expect(page("jobs").definition.source).toMatchObject({ archive: null, noArchive: "The publisher does not allow its pages to be archived." });
    expect(page()).toMatchObject({ title: "Inflation", draft: false, segment: { label: "Economy & jobs", href: "/data?segment=economy_jobs" } });
  });

  it("gives the main Series its change strip and its explained figure over one window, each a door", () => {
    const view = page();
    if (view.main.state !== "shown") throw new Error(view.main.state);
    // (109.9 / 104.5 - 1) x 100 = 5.167: the price index's change in December 2025.
    expect(view.main.latest).toMatchObject({ value: "5.17", when: "December 2025" });
    expect(view.main.cells).toHaveLength(3);
    expect(view.window).toBe("1 Dec 2015 to 31 Dec 2025");
    expect(view.explorer).toBe("/explore?s=fx_price_index_yoy&from=2015-12&to=2025-12");
    expect(view.figure!.plots).toHaveLength(1);
    expect(view.figure!.takeaway).toContain("was 5.17 in December 2025");
    expect(view.figure!.tables[0]!.rows.map((r) => r.period)).toEqual(release.derived.fx_price_index_yoy!.observations.map((o) => o.period));
  });

  it("shows what else moved: each Companion in a plot of its own, on the main Series' time axis", () => {
    const { companions } = page();
    expect(companions.items.map((c) => [c.key, c.state, c.relation])).toEqual([
      ["fx_price_index", "shown", "The main series is computed from it"],
      ["fx_payrolls_break", "shown", "From the same survey as the main series"],
      ["fx_poverty_rate_annual", "shown", "Measures what the main series measures, with some parts left out"],
      ["fx_exchange_index", "withheld", "Measures a part of what the main series measures"],
    ]);
    expect(companions.items[3]!.note).toBe("Withheld: The licence does not allow redistribution.");
    const figure = companions.figure!;
    // The main Series first, then the three that can be shown: four plots, one Series each.
    expect(figure.plots.map((p) => p.series.map((s) => s.key))).toEqual([["fx_price_index_yoy"], ["fx_price_index"], ["fx_payrolls_break"], ["fx_poverty_rate_annual"]]);
    expect(figure.takeaway).toBeNull();
    // One time axis: every drawing of a layout has the same first and last instant and the same left edge.
    for (const layout of ["narrow", "medium", "wide"] as const) {
      const axes = figure.plots.map((p) => {
        const svg = svgString(p.layouts[layout]);
        return [/data-t0="(\d+)"/.exec(svg)![1], /data-t1="(\d+)"/.exec(svg)![1], /data-x0="([\d.]+)"/.exec(svg)![1], /data-x1="([\d.]+)"/.exec(svg)![1]].join(" ");
      });
      expect(new Set(axes).size).toBe(1);
      expect(axes[0]!.startsWith(`${Date.UTC(2015, 11, 1)} ${Date.UTC(2025, 11, 31)}`)).toBe(true);
    }
    // Lower than a figure on its own: several are stacked.
    expect(svgString(figure.plots[0]!.layouts.narrow)).toContain('viewBox="0 0 256 150"');
    expect(companions.explorer).toBe("/explore?s=fx_price_index_yoy,fx_price_index,fx_payrolls_break,fx_poverty_rate_annual&from=2015-12&to=2025-12");
  });

  it("every relation of the contract has its fixed words, and none says one thing moved another", () => {
    expect(Object.keys(RELATION_WORDS).sort()).toEqual(["component", "excludes_components", "input", "same_release", "same_survey"]);
    for (const words of Object.values(RELATION_WORDS)) expect(words).not.toMatch(/because|cause|drive|led to|explain|due to|result/i);
  });

  it("lists the Topic's Claims, Events and member Series, each a door, and names what the Release does not hold", () => {
    const view = page();
    expect(view.claims).toEqual([{ id: "2025-12-11-a-fixture-official-on-fixture-prices", href: "/claims/2025-12-11-a-fixture-official-on-fixture-prices", title: "A. Fixture, 11 December 2025", quote: "The fixture price index stood at 109.5 in November, up about five percent since January.", draft: false }]);
    expect(view.events).toEqual([{ id: "2024-09-18-fixture-rate-decision", href: "/events/2024-09-18-fixture-rate-decision", title: "Fixture central bank changes its rate", when: "18 September 2024", draft: false }]);
    expect(view.series.map((s) => [s.key, s.state, s.href])).toEqual([
      ["fx_price_index_yoy", "shown", "/data/fx_price_index_yoy"],
      ["fx_price_index", "shown", "/data/fx_price_index"],
      ["fx_exchange_index", "withheld", "/data/fx_exchange_index"],
      ["fx_infl_b", "shown", "/data/fx_infl_b"],
      ["fx_not_in_this_release", "not_in_release", null],
    ]);
    expect(view.series[4]).toMatchObject({ name: "fx_not_in_this_release", note: "Not in this release." });
    const jobs = page("jobs");
    expect(jobs.claims).toEqual([]);
    expect(jobs.events).toEqual([]);
    expect(jobs.range).toBeNull();
    expect(jobs.companions.figure!.plots).toHaveLength(2);
  });
});

describe("a Series against the range of a group", () => {
  it("AC: the band matches a minimum, median and maximum worked out by hand for a fixture month", () => {
    const range = page().range!;
    // November 2025 (fixtures/make_fixture.py): the index's change is (109.3 / 104.1 - 1) x 100 = 4.995;
    // B is 2.0, C is 7.5, D is 3.1. Lowest 2.0, highest 7.5, median (3.1 + 4.995) / 2 = 4.048.
    expect(range.rows.find((r) => r.period === "2025-11")).toEqual({ period: "2025-11", label: "Nov 2025", n: 4, minimum: "2.00", median: "4.05", maximum: "7.50" });
    const table = (key: string) => range.figure!.tables.find((t) => t.key === key)!.rows.find((r) => r.period === "2025-11")!;
    expect(table("inflation_range_minimum").exact).toBe("2");
    expect(table("inflation_range_maximum").exact).toBe("7.5");
    expect(Number(table("inflation_range_median").exact)).toBeCloseTo(4.0475985, 6);
    expect(Number(table("fx_price_index_yoy").exact)).toBeCloseTo(4.995197, 5);
  });

  it("names every declared member and says which it can show: the denominator stays the declared count", () => {
    const range = page().range!;
    expect(range).toMatchObject({ label: "Fixture five", indicator: "Inflation (y/y)", of: 5, shown: 4, least: 3, reason: null });
    expect(range.members.map((m) => [m.country, m.key, m.state, m.counted])).toEqual([
      ["USA", "fx_price_index_yoy", "shown", true],
      ["FXB", "fx_infl_b", "shown", true],
      ["FXC", "fx_infl_c", "shown", true],
      ["FXD", "fx_infl_d", "shown", true],
      ["FXE", "fx_infl_e", "not_in_release", false],
    ]);
    expect(range.caption[0]).toBe("The band runs from the lowest to the highest value of Inflation (y/y) among the Fixture five members that can be shown here: 4 of 5.");
    expect(range.caption.join(" ")).toContain("The median is unweighted");
    expect(range.caption.at(-1)).toBe("Fixture price index, change from a year earlier is one of the members.");
    expect(range.explorer).toBe("/explore?s=fx_price_index_yoy&from=2015-12&to=2025-12");
  });

  it("states no range for a Period too few members have a value in, and counts no estimate", () => {
    const range = page().range!;
    // March 2025: the index has a gap and C has not begun. Two of five.
    expect(range.rows.find((r) => r.period === "2025-03")).toEqual({ period: "2025-03", label: "Mar 2025", n: 2, minimum: null, median: null, maximum: null });
    // December 2025: D is an estimate. The index (5.167), B (2.2) and C (7.2) count.
    expect(range.rows.find((r) => r.period === "2025-12")).toEqual({ period: "2025-12", label: "Dec 2025", n: 3, minimum: "2.20", median: "5.17", maximum: "7.20" });
    expect(range.sentence).toBe(
      "In December 2025, Fixture price index, change from a year earlier was 5.17. Among 3 of the 5 Fixture five members the lowest value was 2.20, the median 5.17 and the highest 7.20 (percent change from a year earlier).",
    );
  });

  it("draws the Series, the median and a band, with a gap where there is no range", () => {
    const figure = page().range!.figure!;
    expect(figure.plots).toHaveLength(1);
    expect(figure.plots[0]!.series.map((s) => s.name)).toEqual(["Fixture price index, change from a year earlier", "Fixture five median"]);
    expect(figure.plots[0]!.band).toBe("Fixture five: lowest to highest");
    const svg = svgString(figure.plots[0]!.layouts.wide);
    // January and February; then April to December: two shapes, and March between them.
    expect([...svg.matchAll(/data-band="" data-periods="(\d+)"/g)].map((m) => m[1])).toEqual(["2", "9"]);
    expect(svg).not.toContain('data-series="inflation_range_minimum"');
    expect(svg).toContain("with a band from Fixture five lowest to Fixture five highest");
    expect(figure.howToRead.map((l) => l.text).join(" ")).toContain("The pale band runs from the lowest to the highest value in each period.");
    expect(figure.tables.map((t) => t.name)).toEqual(["Fixture price index, change from a year earlier", "Fixture five median", "Fixture five lowest", "Fixture five highest"]);
    expect(figure.tables[1]!.rows.find((r) => r.period === "2025-03")).toMatchObject({ value: null, states: [] });
  });

  it("draws no range when too few members can be shown, and says how many", async () => {
    const root = tempRoot();
    const id = "20260301T000000Z-abcdef6";
    addRelease(root, { id, topics: (topics) => (topics[0]!.range.members = [...topics[0]!.range.members, { key: "fx_infl_f", country: "FXF" }, { key: "fx_infl_g", country: "FXG" }, { key: "fx_infl_h", country: "FXH" }]) });
    promote(root, id);
    const range = page("inflation", "local", await open(root)).range!;
    expect(range).toMatchObject({ of: 8, shown: 4, least: 5, figure: null, sentence: null, rows: [], reason: "No range is drawn: this page can show 4 of the 8 Fixture five members, and a range is stated only for at least 5." });
  });

  it("leaves out a member whose unit is not the Series' own, and says so", async () => {
    const root = tempRoot();
    const id = "20260301T000000Z-abcdef7";
    addRelease(root, { id, edit: { fx_infl_d: (_file, entry) => (entry.unit = "percent, annual rate") } });
    promote(root, id);
    const range = page("inflation", "local", await open(root)).range!;
    expect(range.shown).toBe(3);
    expect(range.members.find((m) => m.key === "fx_infl_d")).toMatchObject({ counted: false, note: "Not counted: its unit is not that of Fixture price index, change from a year earlier." });
    // November 2025 without D: 2.0, 4.995, 7.5.
    expect(range.rows.find((r) => r.period === "2025-11")).toMatchObject({ n: 3, minimum: "2.00", median: "5.00", maximum: "7.50" });
  });
});

describe("the rights gate decides what a Topic page may say (PLAN 6.1)", () => {
  // Values of the fixture that a page built from it would print.
  const SEEDED = ["109.9", "5.17", "5.2%", "9.4", "1651", "4.0476"];

  it("on a public Surface, while no row is signed, names every Series with the reason and holds no value, Period or drawing", () => {
    for (const slug of ["inflation", "jobs"]) {
      const view = page(slug, "production");
      expect(view.main.state).toBe("not_permitted");
      expect(view.figure).toBeNull();
      expect(view.window).toBeNull();
      expect(view.explorer).toBeNull();
      expect(view.companions.figure).toBeNull();
      expect(view.companions.items.every((c) => c.state !== "shown" && c.note !== null)).toBe(true);
      expect(view.series.every((s) => s.state !== "shown")).toBe(true);
      // A Claim's own day and quote are content, shown on its own page; they are not this page's figures.
      const text = everything({ ...view, claims: [] });
      for (const value of SEEDED) expect(text).not.toContain(value);
      expect(text).not.toMatch(/2025-1[0-2]|Dec(ember)? 2025/);
    }
    const range = page("inflation", "production").range!;
    expect(range).toMatchObject({ figure: null, sentence: null, rows: [], caption: [], shown: 0, explorer: null });
    expect(range.reason).toContain("cannot be shown here, so no range is drawn beside it");
    expect(range.members.every((m) => m.state !== "shown" && !m.counted)).toBe(true);
    // The definition is a cited source's words and is shown: it is content, not a Series' value.
    expect(page("inflation", "production").definition.quote).toContain("fixture price index");
  });

  it("a refused member is not in the range: changing its values changes nothing on the page", async () => {
    // Two Releases that differ only in the values of one member, whose dataset no row is signed for.
    const build = async (id: string, values: number[]) => {
      const root = tempRoot();
      addRelease(root, {
        id,
        signed: true,
        edit: {
          fx_infl_c: (file, entry) => {
            entry.source.origin.dataset = "a dataset no row is signed for";
            file.observations.forEach((o: { value: number }, i: number) => (o.value = values[i]!));
          },
        },
      });
      promote(root, id);
      return open(root, "production");
    };
    const gate = createRightsGate({ ...(fixtureRegister({ display: true, redistribute: true }) as object), rows: [{ ...(fixtureRegister({ display: true, redistribute: true }) as { rows: object[] }).rows[0]!, datasets: ["fixture"] }] });
    const one = await build("20260301T000000Z-abcdef8", [9.4, 9.1, 8.8, 8.6, 8.2, 7.9, 7.7, 7.5, 7.2]);
    const two = await build("20260301T000000Z-abcdef8", [81.25, 82.25, 83.25, 84.25, 85.25, 86.25, 87.25, 88.25, 89.25]);
    const [a, b] = [topicPageView(one, "production", "inflation", { gate })!, topicPageView(two, "production", "inflation", { gate })!];
    expect(a.range!.members.find((m) => m.key === "fx_infl_c")).toMatchObject({ state: "not_permitted", counted: false });
    expect(a.range!.shown).toBe(3);
    // November 2025 without C: 2.0, 3.1, 4.995. The highest value is the index's own, not C's 7.5.
    expect(a.range!.rows.find((r) => r.period === "2025-11")).toMatchObject({ n: 3, minimum: "2.00", median: "3.10", maximum: "5.00" });
    expect(everything(a)).toBe(everything(b));
    const figures = JSON.stringify([b.range!.rows, b.range!.sentence, b.range!.figure!.tables]);
    expect(figures).not.toMatch(/"(7\.50?|9\.40?|81\.25|88\.25)"/);
    for (const value of ["81.25", "88.25"]) expect(everything(b)).not.toContain(value);
  });
});

describe("search returns the Topics (M23)", () => {
  it("finds each of the two by its name, first among the groups", () => {
    const inflation = search(release, "local", "inflation");
    expect(inflation.groups[0]).toMatchObject({ kind: "topic", label: "Topics", total: 1 });
    expect(inflation.groups[0]!.hits).toEqual([{ kind: "topic", id: "inflation", title: "Inflation", href: "/topics/inflation", detail: "The fixture price index measures the average change in the prices that synthetic households pay." }]);
    expect(search(release, "local", "jobs").groups[0]!.hits.map((h) => [h.kind, h.id, h.href])).toEqual([["topic", "jobs", "/topics/jobs"]]);
  });

  it("finds a Topic by a word of the definition it quotes, beside Series, Events and the glossary", () => {
    const answer = search(release, "local", "change");
    expect(answer.groups.map((g) => g.kind)).toEqual(["topic", "series", "event", "glossary"]);
    expect(answer.groups[0]!.hits.map((h) => h.id)).toEqual(["inflation"]);
  });
});
