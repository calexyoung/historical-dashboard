import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./site";

/** Bulk files, the method pages and the rights page on the synthetic fixture release (PLAN sections 3, 7 and 8; M25). */
const overflow = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const PATHS = ["/downloads", "/docs/method", "/docs/method/claims", "/docs/method/bulk-files", "/docs/method/transforms", "/docs/rights"];

test.describe("bulk files and the documents", () => {
  test("the footer of every page leads to the bulk files, the method and the rights register", async ({ page, atlas }) => {
    await page.goto(atlas.url("/"));
    const footer = page.getByRole("contentinfo");
    await footer.getByRole("link", { name: "Downloads" }).click();
    await expect(page).toHaveURL(atlas.url("/downloads"));
    await expect(page.getByRole("heading", { level: 1, name: "Bulk files" })).toBeVisible();
    await page.getByRole("contentinfo").getByRole("link", { name: "Method" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Method" })).toBeVisible();
    await page.getByRole("contentinfo").getByRole("link", { name: "Rights" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Rights" })).toBeVisible();
  });

  test("a bulk file downloads under a name that says which release it is of", async ({ page, atlas, staging }) => {
    for (const site of [atlas, staging]) {
      await page.goto(site.url("/downloads"));
      await expect(page.locator('[data-file="observations.parquet"]')).toHaveCount(1);
      await expect(page.locator("#withheld")).toContainText("Fixture exchange index");
      const waiting = page.waitForEvent("download");
      await page.locator('[data-file="observations.csv.gz"]').getByRole("link").click();
      const download = await waiting;
      expect(download.suggestedFilename()).toMatch(/^macro-atlas_[0-9]{8}T[0-9]{6}Z-[0-9a-f]+_observations\.csv\.gz$/);
      await download.cancel();
    }
  });

  test("a method page is the document, drawn: one title, its sections, and links to the other method pages", async ({ page, atlas }) => {
    await page.goto(atlas.url("/docs/method"));
    await page.getByRole("main").getByRole("link", { name: "How a claim record is built" }).click();
    await expect(page).toHaveURL(atlas.url("/docs/method/claims"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How a claim record is built");
    await expect(page.getByRole("heading", { level: 2, name: "The lock" })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "basis", exact: true }).click();
    await expect(page).toHaveURL(atlas.url("/docs/glossary/basis"));
    await page.goto(atlas.url("/docs/method/bulk-files"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bulk files and discovery");
    await page.getByRole("main").getByRole("link", { name: "vintage-resolution.md" }).first().click();
    await expect(page).toHaveURL(atlas.url("/docs/method/vintage-resolution"));
  });

  test("the rights page says of every row whether it is signed, in words", async ({ page, atlas }) => {
    await page.goto(atlas.url("/docs/rights"));
    const bls = page.locator('[data-row="bls"]');
    await expect(bls).toContainText("All four");
    await expect(bls).toContainText("Signed 12 November 2026");
    await expect(page.locator('[data-row="fred"]')).toContainText("Not decided");
    expect(await page.locator("[data-row]").count()).toBeGreaterThan(20);
  });

  test("no script of the page is refused by the policy, and the series page's JSON-LD is read as data", async ({ page, atlas }) => {
    const refused: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy/i.test(message.text())) refused.push(message.text());
    });
    await page.goto(atlas.url("/data/fx_price_index"));
    const doc = await page.evaluate(() => JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!) as { "@type": string });
    expect(doc["@type"]).toBe("Dataset");
    expect(await page.locator('link[rel="alternate"][type="text/markdown"]').getAttribute("href")).toBe(`${atlas.base}/data/fx_price_index.md`);
    expect(refused).toEqual([]);
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
      const controls = page.locator("main a[href]");
      const count = await controls.count();
      for (let i = 0; i < count; i++) {
        const control = controls.nth(i);
        if (!(await control.isVisible())) continue;
        await control.scrollIntoViewIfNeeded();
        const box = (await control.boundingBox())!;
        expect(box.height, `${path} ${await control.evaluate((el) => el.outerHTML.slice(0, 80))}`).toBeGreaterThanOrEqual(24);
      }
    }
    await context.close();
  });

  test.describe("with JavaScript off", () => {
    test.use({ javaScriptEnabled: false });
    test("the pages are complete", async ({ page, atlas }) => {
      await page.goto(atlas.url("/downloads"));
      await expect(page.locator("[data-file]")).toHaveCount(12);
      await page.goto(atlas.url("/docs/method/bulk-files"));
      await expect(page.getByRole("heading", { level: 2, name: "The files" })).toBeVisible();
      await page.goto(atlas.url("/docs/rights"));
      await expect(page.locator('[data-row="bls"]')).toBeVisible();
    });
  });
});
