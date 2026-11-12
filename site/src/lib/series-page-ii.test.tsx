/**
 * Series pages II (PLAN M17): the as-of question, the revisions a Release holds, the citation and
 * the downloads, on the fixture release, through the view and the HTML the component makes of it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { SeriesPage } from "@/components/SeriesPage";
import { GLOSSARY, glossaryEntry } from "./glossary";
import { createReleaseReader, type OpenedRelease } from "./release/reader";
import { FIXTURE_ID, FIXTURE_ROOT } from "./release/testing";
import { seriesPageView, type SeriesPageView } from "./series-page";
import { BASIS_INFO } from "./series-words";

let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});

const ADDRESS = "http://localhost:3000/macro-atlas";
function page(key: string, search = "", surface: "local" | "production" = "local"): { view: SeriesPageView; html: string } {
  const answer = seriesPageView(release, surface, key, { search: new URLSearchParams(search), address: ADDRESS });
  if (answer.kind !== "page") throw new Error(`${key}: ${answer.kind}`);
  return { view: answer.view, html: renderToStaticMarkup(<SeriesPage view={answer.view} basePath="/macro-atlas" />) };
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const VALUES = ["109.9", "109.5", "109.3", "104.5", "100.4"];

describe("what a series said before a date", () => {
  it("shows the values known then, with the Basis as a mark and a word, the Capture gap and no Takeaway", () => {
    const { view, html } = page("fx_price_index", "as_of=2025-12-13");
    expect(view.state).toBe("shown");
    expect(view.asOf).toMatchObject({ date: "2025-12-13", words: "13 December 2025", basis: "uncertain", word: "Uncertain" });
    expect(view.latest).toMatchObject({ label: "Latest value known then", value: "109.5", period: "November 2025" });
    expect(view.figure.takeaway).toBeNull();
    expect(view.figure.tables[0]!.rows.at(-1)).toMatchObject({ period: "2025-11", exact: "109.5" });
    expect(html).toMatch(/data-basis="uncertain"[^>]*>\s*<svg/);
    expect(html).toContain('href="/macro-atlas/docs/glossary/uncertain"');
    expect(text(html)).toContain("1 whole day went unseen between it and that time.");
    expect(text(html)).toContain("found a change");
    // December's first figure and November's revision came after the Cutoff.
    expect(html).not.toContain("109.9");
    expect(html).not.toContain("109.3");
    // Downloads and the form carry the question.
    expect(html).toContain('href="/macro-atlas/data/fx_price_index.csv?as_of=2025-12-13"');
    expect(html).toMatch(/<input[^>]*type="date"[^>]*name="as_of"[^>]*value="2025-12-13"/);
    expect(view.downloads.citation).toContain("as known before 2025-12-13");
  });

  it("a date without coverage shows the unavailable state and no value anywhere (M17's third criterion)", () => {
    for (const [key, search] of [["fx_price_index", "as_of=2025-12-01"], ["fx_vote_margin", "as_of=2025-12-20"], ["fx_price_index_yoy", "as_of=2025-12-01"]] as const) {
      const { view, html } = page(key, search);
      expect(view.state, key).toBe("unavailable");
      expect(view.asOf).toMatchObject({ basis: "unavailable", word: "Unavailable" });
      expect(view.latest).toBeNull();
      expect(view.figure.plots).toEqual([]);
      expect(view.figure.tables).toEqual([]);
      expect(view.revisions).toBeNull();
      expect(html).toContain('data-basis="unavailable"');
      expect(html).toContain("data-unavailable");
      expect(html).not.toContain("data-figure-table");
      expect(html).not.toContain("data-revisions");
      expect(html).not.toContain("data-latest");
      for (const value of VALUES) expect(html, `${key} ${value}`).not.toContain(value);
      // The form is still there, to ask another date.
      expect(html).toContain("data-as-of-form");
    }
    expect(text(page("fx_price_index", "as_of=2025-12-01").html)).toContain("before Macro Atlas first fetched this series");
  });

  it("every Basis has a mark of its own shape, a word and a glossary entry", () => {
    for (const info of Object.values(BASIS_INFO)) expect(glossaryEntry(info.slug)?.term).toBe(info.word);
    for (const slug of ["as-of", "basis", "vintage", "revision", "capture", "twin"]) expect(GLOSSARY.some((e) => e.slug === slug), slug).toBe(true);
    const provider = page("fx_output_quarterly", "as_of=2025-11-20");
    expect(provider.view.asOf?.basis).toBe("provider");
    expect(provider.html).toContain('data-basis="provider"');
  });

  it("an address that asks for what cannot be given holds no value and says why", () => {
    for (const search of ["as_of=yesterday", "transform=sqrt", "start=2025-13-01", "pin=20260101T000000Z-0000000"]) {
      const { view, html } = page("fx_price_index", search);
      expect(view.state, search).toBe("no_answer");
      expect(html).toContain("data-no-answer");
      for (const value of VALUES) expect(html).not.toContain(value);
    }
    expect(page("fx_price_index_yoy", "transform=rebase").view).toMatchObject({ state: "no_answer", latest: null });
    // A parameter the page does not know is let pass: links arrive with things appended.
    expect(page("fx_price_index", "utm_source=x").view.state).toBe("shown");
  });
});

describe("a transform or a slower frequency, from the address", () => {
  it("re-expresses the figure, the latest value and the table, says so, and gives no Takeaway", () => {
    const { view, html } = page("fx_price_index", "transform=pc1&freq=quarterly");
    expect(view.request.shownAs).toBe("percent change from a year earlier · brought from monthly to quarterly by mean");
    expect(view.latest?.unit).toBe("percent change from a year earlier");
    expect(view.figure.takeaway).toBeNull();
    expect(view.figure.tables[0]!.rows.at(-1)!.period).toBe("2025-Q4");
    expect(text(html)).toContain("Shown as : percent change from a year earlier");
    expect(html).toContain('href="/macro-atlas/data/fx_price_index.json?transform=pc1&amp;freq=quarterly"');
    expect(html).toMatch(/<input type="hidden" name="transform" value="pc1"/);
  });
});

describe("revisions: every version held of the periods that changed", () => {
  it("lists them with the two clocks in separate columns, and says when Macro Atlas looked", () => {
    const { view, html } = page("fx_price_index");
    if (!view.revisions?.held) throw new Error("no revisions");
    expect(view.revisions.rows.map((r) => [r.period, r.value, r.current])).toEqual([
      ["Oct 2025", "109.2", false],
      ["Oct 2025", "109", true],
      ["Nov 2025", "109.5", false],
      ["Nov 2025", "109.3", true],
    ]);
    expect(view.revisions.rows[2]).toMatchObject({ published: null, held: { from: "10 Dec 2025, 15:45 UTC", until: "15 Dec 2025, 15:45 UTC" }, status: "preliminary" });
    expect(view.revisions.lines[0]).toBe("Macro Atlas fetched this series 21 times, from 8 Dec 2025, 15:45 UTC to 31 Dec 2025, 15:45 UTC.");
    expect(view.revisions.lines[1]).toBe("Days in between with no Capture: 12 Dec 2025, 13 Dec 2025, 14 Dec 2025.");
    expect(html).toContain("data-revisions");
    expect(text(html)).toContain("Published by the origin");
    expect(text(html)).toContain("First held by Macro Atlas");
  });

  it("a version from the Origin's own record is dated by the Origin, to the day or the minute", () => {
    const { view } = page("fx_output_quarterly");
    if (!view.revisions?.held) throw new Error("no revisions");
    expect(view.revisions.lines.some((line) => line.startsWith("The origin's own record of its releases is held from 1 Apr 2022 to 8 Dec 2025"))).toBe(true);
    const q3 = view.revisions.rows.filter((r) => r.period === "2025 Q3");
    expect(q3.map((r) => [r.value, r.published, r.held === null])).toEqual([["560.2", "28 Oct 2025", true], ["561", "28 Nov 2025", false]]);
  });

  it("lists the latest versions first, never part of one period's history, and all of them on request", () => {
    const of = (search: string, revisionRows: number) => {
      const answer = seriesPageView(release, "local", "fx_price_index", { search: new URLSearchParams(search), address: ADDRESS, revisionRows });
      if (answer.kind !== "page" || !answer.view.revisions?.held) throw new Error("no revisions");
      return { revisions: answer.view.revisions, html: renderToStaticMarkup(<SeriesPage view={answer.view} basePath="/macro-atlas" />) };
    };
    const two = of("", 2);
    expect(two.revisions).toMatchObject({ more: 2, all: false });
    expect(two.revisions.rows.map((r) => r.period)).toEqual(["Nov 2025", "Nov 2025"]);
    expect(two.html).toContain('href="/macro-atlas/data/fx_price_index?revisions=all#revisions"');
    // Three would cut October's history in two: the cut moves to the next period.
    expect(of("", 3).revisions.rows.map((r) => r.period)).toEqual(["Nov 2025", "Nov 2025"]);
    const all = of("revisions=all", 2);
    expect(all.revisions).toMatchObject({ more: 0, all: true, page: 1, pages: 1 });
    expect(all.revisions.rows).toHaveLength(4);
    expect(all.html).not.toContain("data-revisions-more");
    // A list shorter than one Period's history is cut where it must be, never left empty.
    expect(of("", 1).revisions.rows.map((r) => r.value)).toEqual(["109.3"]);
  });

  it("says so when a Release holds no history, and is left off an as-of view", () => {
    expect(page("fx_vote_margin").view.revisions).toMatchObject({ held: false });
    expect(page("fx_price_index_yoy").view.revisions).toMatchObject({ held: false });
    const then = page("fx_price_index", "as_of=2025-12-13");
    expect(then.view.revisions).toBeNull();
    expect(then.html).not.toContain("data-revisions");
    expect(then.html).toContain('href="/macro-atlas/data/fx_price_index#revisions"');
  });
});

describe("cite and download", () => {
  it("gives a citation from a template, the four twins and a way to fetch the same values again", () => {
    const { view, html } = page("fx_price_index");
    expect(view.downloads.citation).toBe(
      `Macro Atlas fixture (synthetic). Fixture price index (fixture, FX-PRICE). Obtained through fixture. Macro Atlas, series fx_price_index, release ${FIXTURE_ID} of 1 Jan 2026. ${ADDRESS}/data/fx_price_index`,
    );
    expect(view.downloads).toMatchObject({ permitted: true, reason: null });
    for (const suffix of ["csv", "json", "md", "metadata.json"]) expect(html).toContain(`href="/macro-atlas/data/fx_price_index.${suffix}"`);
    expect(view.downloads.reproduce?.map((r) => r.code)).toEqual([
      `curl -sL '${ADDRESS}/data/fx_price_index.csv'`,
      `import pandas as pd\ndf = pd.read_csv("${ADDRESS}/data/fx_price_index.csv", comment="#")`,
    ]);
  });

  it("the withheld Series shows by name with the reason and no values, and only its metadata twin (M17's fourth criterion)", () => {
    const { view, html } = page("fx_exchange_index");
    expect(view).toMatchObject({ name: "Fixture exchange index", state: "withheld", reason: "The licence does not allow redistribution.", latest: null, revisions: null });
    expect(view.downloads).toMatchObject({ permitted: false, twins: [], reproduce: null });
    expect(html).toContain("Fixture exchange index");
    expect(html).toContain("The licence does not allow redistribution.");
    expect(html).not.toContain("data-figure-table");
    expect(html).not.toContain("data-as-of-form");
    expect(html).not.toMatch(/fx_exchange_index\.(csv|json|md)"/);
    expect(html).toContain('href="/macro-atlas/data/fx_exchange_index.metadata.json"');
    // Asking a date changes nothing: still by name, still no value.
    expect(page("fx_exchange_index", "as_of=2025-12-20").view).toMatchObject({ state: "withheld", latest: null, asOf: null });
  });

  it("on a public surface, where no register row is signed, nothing of the Series' past or present is on the page", () => {
    const { view, html } = page("fx_price_index", "", "production");
    expect(view).toMatchObject({ state: "not_permitted", revisions: null, downloads: { permitted: false } });
    for (const value of VALUES) expect(html).not.toContain(value);
    expect(page("fx_price_index", "as_of=2025-12-13", "production").view.state).toBe("not_permitted");
  });
});
