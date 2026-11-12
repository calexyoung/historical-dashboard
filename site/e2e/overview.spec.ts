import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./site";

/**
 * M22 in a real browser, on the fixture release: the Overview, Highlights, the search sheet and
 * `/search` (PLAN sections 3 and 8). Nothing here touches the network.
 */
const PAGES = ["/", "/highlights", "/search?q=change"];
const axe = async (page: Page) => {
  // A first visit to the Overview fades its rows in: judge the page as it stands, not mid-fade.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`);
};

/** The page has taken over the server's markup: the "/" key and the sheet are live. */
const ready = (page: Page) => expect(page.locator("[data-open-search][data-ready]")).toBeVisible();

test.describe("with JavaScript off (AC: the Overview renders complete)", () => {
  test.use({ javaScriptEnabled: false });

  test("the Overview shows six rows, each Segment's Series with its value, change and drawing", async ({ page, atlas }) => {
    await page.goto(atlas.url("/"));
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    const rows = page.locator(".overview-rows > li");
    await expect(rows).toHaveCount(6);
    for (let i = 0; i < 6; i++) await expect(rows.nth(i)).toBeVisible();
    await expect(rows.nth(0)).toContainText("Economy & jobs");
    await expect(rows.nth(0)).toContainText("109.9 in December 2025");
    await expect(rows.nth(0)).toContainText("5.2% higher than a year earlier");
    await expect(rows.nth(0).getByRole("img", { name: "Fixture price index, January 2024 to December 2025" })).toBeVisible();
    await expect(rows.nth(1)).toContainText("Withheld");
    await expect(rows.nth(5)).toContainText("No headline series in this release.");
  });

  test("search is a form that answers on a page, grouped by kind", async ({ page, atlas }) => {
    await page.goto(atlas.url("/"));
    await page.getByRole("link", { name: "Search" }).first().click(); // the top bar's door is a plain link
    await expect(page).toHaveURL(atlas.url("/search"));
    await page.getByRole("searchbox").fill("change");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(atlas.url("/search?q=change"));
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Series", "Events", "Glossary"]);
    await expect(page.locator("[data-group=series] [data-hit]")).toContainText(["Fixture price index, change from a year earlier"]);
  });

  test("a Highlights cell is a link to the Explorer at its window", async ({ page, atlas }) => {
    await page.goto(atlas.url("/highlights"));
    await page.locator("tr[data-series-key=fx_poverty_rate_annual] a[data-years='5']").click();
    await expect(page).toHaveURL(atlas.url("/explore?s=fx_poverty_rate_annual&from=2020-01&to=2025-12"));
    await expect(page.locator("input[type=month][name=from]")).toHaveValue("2020-01");
    await expect(page.locator("input[type=month][name=to]")).toHaveValue("2025-12");
  });
});

test.describe("the search sheet", () => {
  test("opens from the top bar with the field focused, lists grouped hits as the reader types, and Escape gives focus back", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore"));
    await ready(page);
    const opener = page.locator("[data-open-search]");
    await opener.click();
    const sheet = page.getByRole("dialog", { name: "Search" });
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(atlas.url("/explore")); // in place: no navigation
    await expect(sheet.getByRole("searchbox")).toBeFocused();
    await page.keyboard.type("change");
    await expect(sheet.getByRole("heading")).toHaveText([/^Series/, /^Events/, /^Glossary/]);
    await expect(sheet.locator("[data-group=event] a")).toHaveAttribute("href", "/macro-atlas/events/2024-09-18-fixture-rate-decision");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("the / key opens it, the arrow keys reach a hit, and Enter on the field lists every result on a page", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data"));
    await ready(page);
    await page.keyboard.press("/");
    const sheet = page.getByRole("dialog", { name: "Search" });
    await expect(sheet).toBeVisible();
    const field = sheet.getByRole("searchbox");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(""); // the key opened the sheet; it was not typed into it
    await page.keyboard.type("poverty");
    const hit = sheet.locator("a[data-hit=fx_poverty_rate_annual]");
    await expect(hit).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(hit).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(field).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(atlas.url("/search?q=poverty"));
    await expect(page.locator("[data-group=series] [data-hit=fx_poverty_rate_annual]")).toBeVisible();
  });

  test("opened with the / key from a place in the page, it gives focus back to that place", async ({ page, atlas }) => {
    await page.goto(atlas.url("/"));
    await ready(page);
    const place = page.locator("li[data-segment=infrastructure]").getByRole("link", { name: "Fixture building permits", exact: true });
    await place.focus();
    await page.keyboard.press("/");
    const sheet = page.getByRole("dialog", { name: "Search" });
    await expect(sheet.getByRole("searchbox")).toBeFocused();
    await page.keyboard.type("price");
    await expect(sheet.locator("a[data-hit=fx_price_index]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(place).toBeFocused();
  });

  test("the / key is the reader's own while they type in a field", async ({ page, atlas }) => {
    await page.goto(atlas.url("/"));
    await ready(page);
    const field = page.locator("#overview-q");
    await field.focus();
    await page.keyboard.type("a/b");
    await expect(field).toHaveValue("a/b");
    await expect(page.getByRole("dialog", { name: "Search" })).toBeHidden();
  });

  test("never animates, and a Withheld Series is found by name and marked", async ({ page, atlas }) => {
    await page.goto(atlas.url("/"));
    await ready(page);
    await page.keyboard.press("/");
    const sheet = page.getByRole("dialog", { name: "Search" });
    expect(await sheet.evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(/^0s(, 0s)*$/);
    expect(await sheet.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await page.keyboard.type("exchange");
    await expect(sheet.locator("a[data-hit=fx_exchange_index]")).toContainText("Withheld");
    expect(await axe(page)).toEqual([]);
  });

  test("says so when nothing matches", async ({ page, atlas }) => {
    await page.goto(atlas.url("/"));
    await ready(page);
    await page.locator("[data-open-search]").click();
    await page.keyboard.type("zzzz");
    await expect(page.getByRole("dialog", { name: "Search" }).locator("[data-no-results]")).toContainText("Nothing matches");
  });
});

test.describe("the Overview's first visit (PLAN section 8)", () => {
  test("the rows are marked for the flourish once, and can be used at once", async ({ page, atlas }) => {
    await page.goto(atlas.url("/"));
    await expect(page.locator(".overview-rows")).toHaveAttribute("data-first-visit", "");
    await page.locator(".overview-rows > li").nth(0).getByRole("link", { name: "Fixture price index", exact: true }).click({ timeout: 2000 });
    await expect(page).toHaveURL(atlas.url("/data/fx_price_index"));
    await page.goto(atlas.url("/"));
    await expect(page.locator(".overview-rows")).not.toHaveAttribute("data-first-visit");
  });

  test("with reduced motion the rows do not move", async ({ page, atlas }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(atlas.url("/"));
    const row = page.locator(".overview-rows > li").nth(3);
    expect(await row.evaluate((el) => getComputedStyle(el).transitionProperty)).toBe("opacity");
    await expect(row).toHaveCSS("opacity", "1");
  });
});

test.describe("every figure is a door", () => {
  test("the Overview's change opens the Explorer at that window, and the drawing opens the Series there", async ({ page, atlas }) => {
    await page.goto(atlas.url("/"));
    const row = page.locator("li[data-segment=economy_jobs]");
    await expect(row.locator("a[data-door=spark]")).toHaveAttribute("href", "/macro-atlas/explore?s=fx_price_index");
    await row.locator("a[data-door=year]").click();
    await expect(page).toHaveURL(atlas.url("/explore?s=fx_price_index&from=2024-12&to=2025-12"));
    await expect(page.locator("[data-selected=fx_price_index]")).toBeVisible();
  });
});

test.describe("accessibility and layout of the reading pages", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds nothing in the ${scheme} theme`, async ({ page, atlas }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of PAGES) {
        await page.goto(atlas.url(path));
        expect(await axe(page), path).toEqual([]);
      }
    });
  }

  test("no horizontal page scroll at 320px, nothing under 12px, and every door at least 24px", async ({ page, atlas }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of PAGES) {
      await page.goto(atlas.url(path));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
      const smallest = await page.evaluate(() => {
        let min = Infinity;
        for (const el of document.querySelectorAll("main *")) {
          if (!el.textContent?.trim() || el.children.length > 0) continue;
          min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
        }
        return min;
      });
      expect(smallest, path).toBeGreaterThanOrEqual(12);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("main a[href]")]
          .map((a) => ({ text: a.textContent?.trim().slice(0, 40), box: a.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0 && (box.height < 24 || box.width < 24))
          .map(({ text }) => text),
      );
      expect(small, path).toEqual([]);
    }
    // The Highlights table fits a phone: it does not scroll inside its panel either.
    await page.goto(atlas.url("/highlights"));
    expect(await page.locator("table[data-segment=economy_jobs]").evaluate((el) => el.parentElement!.scrollWidth - el.parentElement!.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("the Overview paints quickly: its largest content is in the HTML", async ({ page, atlas }) => {
    await page.goto(atlas.url("/"));
    const lcp = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          new PerformanceObserver((list) => resolve(list.getEntries().at(-1)!.startTime)).observe({ type: "largest-contentful-paint", buffered: true });
        }),
    );
    expect(lcp).toBeLessThan(2500);
  });
});
