import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./site";

/** `/docs/api` on the synthetic fixture release (PLAN section 8, M24): a reading page, and every route it names answers. */
const overflow = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("the read API's page", () => {
  test("is reached from the footer of any page, on both base paths, and names every route as a link to a real answer", async ({ page, atlas, staging }) => {
    for (const site of [atlas, staging]) {
      await page.goto(site.url("/data"));
      await page.getByRole("contentinfo").getByRole("link", { name: "API" }).click();
      await expect(page).toHaveURL(site.url("/docs/api"));
      await expect(page.getByRole("heading", { level: 1, name: "Read API" })).toBeVisible();
      await expect(page).toHaveTitle(/Read API/);
      const routes = page.locator("[data-api-route]");
      await expect(routes).toHaveText(["/api/v1/catalog.json", "/api/v1/series/{key}", "/api/v1/series/{key}/vintages", "/api/v1/events.json", "/api/v1/claims.json", "/api/v1/status"]);
      for (const href of await routes.evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href))) {
        expect(href.startsWith(site.url("/api/v1/")), href).toBe(true);
        const response = await page.request.get(href);
        expect(response.status(), href).toBe(200);
        expect(await response.json(), href).toHaveProperty("release_id");
      }
    }
  });

  test("states the limits the app enforces, and its examples are commands that work", async ({ page, atlas }) => {
    await page.goto(atlas.url("/docs/api"));
    await expect(page.locator("#limits")).toContainText("120 requests at once, then 120 a minute");
    await expect(page.locator("#limits")).toContainText("600 requests at once, then 1,200 a minute");
    const examples = (await page.locator("[data-api-examples]").innerText()).split("\n");
    expect(examples).toHaveLength(4);
    for (const line of examples) {
      const url = /^curl -s '([^']+)'$/.exec(line)?.[1];
      expect(url, line).toBeTruthy();
      expect((await page.request.get(url!)).status(), line).toBe(200);
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds nothing in the ${scheme} theme`, async ({ page, atlas }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(atlas.url("/docs/api"));
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
    });
  }

  test("no horizontal page scroll at 320px, nothing under 12px, and every link can be pressed", async ({ browser, atlas }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(atlas.url("/docs/api"));
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const smallest = await page.evaluate(() => {
      let min = Infinity;
      for (const el of document.querySelectorAll("body *")) {
        if (!el.textContent?.trim() || el.children.length > 0) continue;
        min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
      }
      return min;
    });
    expect(smallest).toBeGreaterThanOrEqual(12);
    const controls = page.locator("main a[href]");
    const count = await controls.count();
    for (let i = 0; i < count; i++) {
      const control = controls.nth(i);
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox())!;
      expect(box.height, await control.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(24);
    }
    await context.close();
  });

  test.describe("with no JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    test("the page is complete", async ({ page, atlas }) => {
      await page.goto(atlas.url("/docs/api"));
      await expect(page.locator("[data-api-route]")).toHaveCount(6);
      await expect(page.locator("#errors")).toContainText("429");
      await expect(page.locator("[data-api-examples]")).toContainText("curl -s");
    });
  });
});
