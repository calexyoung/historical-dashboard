import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./site";

/** The Events index and an Event's page on the synthetic fixture release (PLAN section 3 and 8, M19). */
const RATE = "2024-09-18-fixture-rate-decision";
const overflow = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("events", () => {
  test("the index is reached from the Events tab and each event is a door to its page", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore"));
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Events" }).click();
    await expect(page).toHaveURL(atlas.url("/events"));
    await expect(page.getByRole("heading", { level: 1, name: "Events" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Events" })).toHaveAttribute("aria-current", "page");
    const row = page.locator("[data-event]");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("18 Sep 2024");
    await expect(row).toContainText("Economic policy");
    await row.getByRole("link", { name: "Fixture central bank changes its rate" }).click();
    await expect(page).toHaveURL(atlas.url(`/events/${RATE}`));
    await expect(page.getByRole("heading", { level: 1, name: "Fixture central bank changes its rate" })).toBeVisible();
  });

  test("the category in the address narrows the list, on both base paths", async ({ page, atlas, staging }) => {
    for (const site of [atlas, staging]) {
      await page.goto(site.url("/events?cat=policy"));
      await expect(page.locator("[data-event]")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: /Economic policy/ })).toHaveAttribute("aria-current", "true");
      await page.goto(site.url("/events?cat=nonsense"));
      await expect(page.getByText("not a category of events")).toBeVisible();
      await expect(page.locator("[data-event]")).toHaveCount(1);
    }
  });

  test("an event's page states what happened, when, where it can be checked, and what to set beside it", async ({ page, atlas }) => {
    await page.goto(atlas.url(`/events/${RATE}`));
    const main = page.getByRole("main");
    await expect(main).toContainText("18 September 2024");
    await expect(main).toContainText("The fixture central bank announced a new policy rate on 18 September 2024.");
    await expect(main.getByRole("link", { name: "Fixture gazette (synthetic)", exact: true })).toHaveAttribute("href", "https://example.org/fixture-gazette");
    await expect(main.getByRole("link", { name: /archived copy/ })).toHaveAttribute("href", "https://example.org/archive/2026/fixture-gazette");
    await expect(main).toContainText("No archived copy: The fixture harbour board's pages cannot be archived (synthetic reason).");
    await expect(page.locator('[data-related="fx_exchange_index"]')).toContainText("Withheld: The licence does not allow redistribution.");
    await expect(page.locator('[data-related="fx_not_in_this_release"]')).toContainText("Not in this release.");
    await page.locator('[data-related="fx_price_index"]').getByRole("link").click();
    await expect(page).toHaveURL(atlas.url("/data/fx_price_index"));
    // ...and the Series' own page leads back.
    await page.locator(`[data-series-event="${RATE}"]`).getByRole("link").click();
    await expect(page).toHaveURL(atlas.url(`/events/${RATE}`));
  });

  test("the page opens the Explorer on its series with itself marked, and the Explorer leads back", async ({ page, atlas }) => {
    await page.goto(atlas.url(`/events/${RATE}`));
    await page.getByRole("link", { name: "Open in Explorer" }).click();
    await expect(page).toHaveURL(/\/explore\?s=fx_price_index&from=2022-09&to=2026-09&layers=ev\.policy&event=event-2024-09-18-fixture-rate-decision/);
    const row = page.locator(`[data-event-row="event-${RATE}"]`);
    await expect(row).toContainText("marked on the chart");
    await row.getByRole("link", { name: /^page/ }).click();
    await expect(page).toHaveURL(atlas.url(`/events/${RATE}`));
  });

  test("an event the release does not hold is not found", async ({ page, atlas }) => {
    const response = await page.goto(atlas.url("/events/2020-01-01-no-such-event"));
    expect(response!.status()).toBe(404);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds nothing in the ${scheme} theme`, async ({ page, atlas }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of ["/events", `/events/${RATE}`]) {
        await page.goto(atlas.url(path));
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
        expect(results.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
      }
    });
  }

  test("no horizontal page scroll at 320px, nothing under 12px, and every link can be pressed", async ({ browser, atlas }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    for (const path of ["/events", `/events/${RATE}`]) {
      await page.goto(atlas.url(path));
      expect(await overflow(page), path).toBeLessThanOrEqual(0);
      const smallest = await page.evaluate(() => {
        let min = Infinity;
        for (const el of document.querySelectorAll("body *")) {
          if (!el.textContent?.trim() || el.children.length > 0) continue;
          min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
        }
        return min;
      });
      expect(smallest, path).toBeGreaterThanOrEqual(12);
      const controls = page.locator("main a[href]");
      const count = await controls.count();
      for (let i = 0; i < count; i++) {
        const control = controls.nth(i);
        await control.scrollIntoViewIfNeeded();
        const box = (await control.boundingBox())!;
        expect(box.height, await control.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(24);
      }
    }
    await context.close();
  });

  test.describe("with JavaScript off", () => {
    test.use({ javaScriptEnabled: false });
    test("both pages are complete", async ({ page, atlas }) => {
      await page.goto(atlas.url("/events"));
      await expect(page.locator("[data-event]")).toHaveCount(1);
      await page.getByRole("link", { name: "Fixture central bank changes its rate" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fixture central bank changes its rate");
      await expect(page.getByRole("main")).toContainText("The announcement was published in the fixture gazette the same day.");
    });
  });

  test("the pages animate nothing", async ({ page, atlas }) => {
    await page.goto(atlas.url(`/events/${RATE}`));
    const animated = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => getComputedStyle(el).animationName !== "none").length);
    expect(animated).toBe(0);
  });
});
