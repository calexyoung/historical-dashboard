import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./site";

/** The Topics index and a Topic's page on the synthetic fixture release (PLAN section 3 and 8, M23; ADR 0037). */
const overflow = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const PATHS = ["/topics", "/topics/inflation", "/topics/jobs"];

test.describe("topics", () => {
  test("the index is reached from the Topics tab and from the Overview, and each topic is a door to its page", async ({ page, atlas }) => {
    await page.goto(atlas.url("/"));
    await page.getByRole("region", { name: "Topics" }).getByRole("link", { name: "Jobs" }).click();
    await expect(page).toHaveURL(atlas.url("/topics/jobs"));
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Topics" }).click();
    await expect(page).toHaveURL(atlas.url("/topics"));
    await expect(page.getByRole("heading", { level: 1, name: "Topics" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Topics" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-topic]")).toHaveCount(2);
    await page.locator('[data-topic="inflation"]').getByRole("link", { name: "Inflation", exact: true }).click();
    await expect(page).toHaveURL(atlas.url("/topics/inflation"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inflation");
  });

  test("a topic opens with the definition, quoted and cited, and the main series' change strip", async ({ page, atlas, staging }) => {
    for (const site of [atlas, staging]) {
      await page.goto(site.url("/topics/inflation"));
      const main = page.getByRole("main");
      await expect(main.locator("blockquote[data-definition]")).toHaveText("The fixture price index measures the average change in the prices that synthetic households pay.");
      await expect(main.locator("[data-definition-source]").getByRole("link", { name: "Fixture statistics office (synthetic), Handbook", exact: true })).toHaveAttribute("href", "https://example.org/fixture-handbook");
      await expect(main.locator("[data-definition-source]").getByRole("link", { name: /archived copy/ })).toHaveAttribute("href", "https://example.org/archive/2026/fixture-handbook");
      await expect(main.locator("[data-change-strip]")).toContainText("5.17");
      await expect(main.locator("[data-change-strip] dl a")).toHaveCount(3);
    }
    await page.goto(atlas.url("/topics/jobs"));
    await expect(page.locator("[data-definition-source]")).toContainText("No archived copy: The publisher does not allow its pages to be archived.");
  });

  test("what else moved: each companion in a plot of its own, all on one time axis, each with its relation", async ({ page, atlas }) => {
    await page.goto(atlas.url("/topics/inflation"));
    const companions = page.locator("[data-companion]");
    await expect(companions).toHaveCount(4);
    await expect(page.locator('[data-companion="fx_price_index"]')).toContainText("The main series is computed from it");
    await expect(page.locator('[data-companion="fx_exchange_index"]')).toContainText("Withheld: The licence does not allow redistribution.");
    const plots = page.locator("[data-small-multiples] [data-plot]");
    await expect(plots).toHaveCount(4);
    // The drawing that is showing in each plot starts and ends at the same place on the page.
    const edges = await plots.evaluateAll((nodes) =>
      nodes.map((node) => {
        const svg = [...node.querySelectorAll<SVGSVGElement>("svg[data-layout]")].find((el) => el.getBoundingClientRect().width > 0)!;
        const area = svg.querySelector("[data-plot-area]")!.getBoundingClientRect();
        return `${svg.dataset.t0} ${svg.dataset.t1} ${Math.round(area.left)} ${Math.round(area.right)}`;
      }),
    );
    expect(new Set(edges).size).toBe(1);
  });

  test("the series against the range: a band, the median, the sentence and how many members were counted", async ({ page, atlas }) => {
    await page.goto(atlas.url("/topics/inflation"));
    const range = page.locator("#range");
    await expect(range.getByRole("heading", { level: 2 })).toHaveText("Against the Fixture five range");
    await expect(range.locator("[data-range-sentence]")).toHaveText(
      "In December 2025, Fixture price index, change from a year earlier was 5.17. Among 3 of the 5 Fixture five members the lowest value was 2.20, the median 5.17 and the highest 7.20 (percent change from a year earlier).",
    );
    const shown = range.locator("svg[data-layout]").filter({ visible: true });
    await expect(shown).toHaveCount(1);
    await expect(shown.locator("[data-band]")).toHaveCount(2);
    await expect(range.locator("[data-legend-band]")).toHaveText("Fixture five: lowest to highest");
    await range.locator("[data-range-counts] summary").click();
    // November 2025, worked out by hand in fixtures/make_fixture.py.
    await expect(range.locator("[data-range-counts] tr", { hasText: "Nov 2025" })).toHaveText(/Nov 2025\s*4 of 5\s*2\.00\s*4\.05\s*7\.50/);
    await expect(range.locator("[data-range-counts] tr", { hasText: "Mar 2025" })).toContainText("No range");
    await expect(range.locator('[data-member="fx_infl_e"]')).toContainText("Not in this release.");
    await expect(range.locator("[data-member]")).toHaveCount(5);
  });

  test("every figure is a door, and so are the claims, events and member series", async ({ page, atlas }) => {
    await page.goto(atlas.url("/topics/inflation"));
    await page.locator("#figure").getByRole("link", { name: "Open in Explorer" }).click();
    await expect(page).toHaveURL(/\/explore\?s=fx_price_index_yoy&from=2015-12&to=2025-12$/);
    await expect(page.locator("[data-figure] svg[data-layout]").first()).toBeAttached();
    await page.goto(atlas.url("/topics/inflation"));
    await page.locator("#claims").getByRole("link", { name: "A. Fixture, 11 December 2025" }).click();
    await expect(page).toHaveURL(atlas.url("/claims/2025-12-11-a-fixture-official-on-fixture-prices"));
    await page.goto(atlas.url("/topics/inflation"));
    await page.locator("#events").getByRole("link", { name: "Fixture central bank changes its rate" }).click();
    await expect(page).toHaveURL(atlas.url("/events/2024-09-18-fixture-rate-decision"));
    await page.goto(atlas.url("/topics/inflation"));
    await expect(page.locator('[data-series-ref="fx_not_in_this_release"]')).toContainText("Not in this release.");
    await page.locator('[data-series-ref="fx_infl_b"]').getByRole("link").click();
    await expect(page).toHaveURL(atlas.url("/data/fx_infl_b"));
  });

  test("the search sheet lists a topic first and its hit opens the topic's page", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore"));
    await expect(page.locator("[data-open-search][data-ready]")).toBeVisible();
    await page.locator("[data-open-search]").click();
    const sheet = page.getByRole("dialog", { name: "Search" });
    await expect(sheet).toBeVisible();
    await page.keyboard.type("jobs");
    await expect(sheet.getByRole("heading").first()).toHaveText(/^Topics/);
    await expect(sheet.locator("[data-group=topic] a")).toHaveAttribute("href", "/macro-atlas/topics/jobs");
    await sheet.locator("[data-group=topic] a").click();
    await expect(page).toHaveURL(atlas.url("/topics/jobs"));
  });

  test("search finds the two topics on its page", async ({ page, atlas }) => {
    await page.goto(atlas.url("/search?q=inflation"));
    await expect(page.locator('[data-group="topic"] a')).toHaveText(["Inflation"]);
    await page.goto(atlas.url("/search?q=jobs"));
    await page.locator('[data-group="topic"]').getByRole("link", { name: "Jobs" }).click();
    await expect(page).toHaveURL(atlas.url("/topics/jobs"));
  });

  test("a topic the release does not hold is not found", async ({ page, atlas }) => {
    expect((await page.goto(atlas.url("/topics/no-such-topic")))!.status()).toBe(404);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds nothing in the ${scheme} theme`, async ({ page, atlas }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of PATHS) {
        await page.goto(atlas.url(path));
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
        expect(results.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
      }
    });
  }

  test("no horizontal page scroll at 320px, nothing under 12px, and every link can be pressed", async ({ browser, atlas }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    for (const path of PATHS) {
      await page.goto(atlas.url(path));
      expect(await overflow(page), path).toBeLessThanOrEqual(0);
      const smallest = await page.evaluate(() => {
        let min = Infinity;
        for (const el of document.querySelectorAll("body *")) {
          if (!el.textContent?.trim() || el.children.length > 0 || el.closest("svg") || (el as HTMLElement).offsetParent === null) continue;
          min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
        }
        return min;
      });
      expect(smallest, path).toBeGreaterThanOrEqual(12);
      // Text in the drawing that is showing is never scaled below 12px either.
      const scale = await page.evaluate(() => Math.min(...[...document.querySelectorAll<SVGSVGElement>("svg[data-layout]")].filter((s) => s.getBoundingClientRect().width > 0).map((s) => s.getBoundingClientRect().width / s.viewBox.baseVal.width), 1));
      expect(scale, path).toBeGreaterThanOrEqual(1);
      const controls = page.locator("main a[href]");
      const count = await controls.count();
      for (let i = 0; i < count; i++) {
        const control = controls.nth(i);
        if (!(await control.isVisible())) continue;
        await control.scrollIntoViewIfNeeded();
        const box = (await control.boundingBox())!;
        expect(box.height, await control.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(24);
      }
    }
    await context.close();
  });

  test.describe("with JavaScript off", () => {
    test.use({ javaScriptEnabled: false });
    test("the pages are complete", async ({ page, atlas }) => {
      await page.goto(atlas.url("/topics"));
      await expect(page.locator("[data-topic]")).toHaveCount(2);
      await page.locator('[data-topic="inflation"]').getByRole("link", { name: "Inflation", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inflation");
      await expect(page.locator("blockquote[data-definition]")).toBeVisible();
      await expect(page.locator("[data-small-multiples] [data-plot]")).toHaveCount(4);
      await expect(page.locator("#range svg[data-layout]").filter({ visible: true })).toHaveCount(1);
      await expect(page.locator("#range [data-range-sentence]")).toContainText("the median 5.17");
      // The tables open with no script: a native disclosure.
      await page.locator("#range [data-range-counts] summary").click();
      await expect(page.locator("#range [data-range-counts] tr", { hasText: "Nov 2025" })).toBeVisible();
    });
  });

  test("the pages animate nothing", async ({ page, atlas }) => {
    for (const path of PATHS) {
      await page.goto(atlas.url(path));
      const moving = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => getComputedStyle(el).animationName !== "none").length);
      expect(moving, path).toBe(0);
    }
  });
});
