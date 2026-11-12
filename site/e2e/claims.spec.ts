import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./site";

/** The Claims index, a Claim's page and the method page on the synthetic fixture release (PLAN section 3 and 8, M21). */
const CLAIM = "2025-12-11-a-fixture-official-on-fixture-prices";
const PATHS = ["/claims", `/claims/${CLAIM}`, "/docs/method/claims"];
const overflow = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("claims", () => {
  test("the index is reached from the Claims tab, counts by party, and each claim is a door to its page", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore"));
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Claims" }).click();
    await expect(page).toHaveURL(atlas.url("/claims"));
    await expect(page.getByRole("heading", { level: 1, name: "Claims" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Claims" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-by-party]")).toContainText("No party 1");
    const row = page.locator("[data-claim]");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("11 Dec 2025");
    await expect(row).toContainText("A. Fixture");
    await expect(page.locator("#corrections [data-correction]")).toContainText("The venue was first entered without its city (synthetic).");
    await row.getByRole("link").click();
    await expect(page).toHaveURL(atlas.url(`/claims/${CLAIM}`));
    await expect(page.getByRole("heading", { level: 1, name: "A. Fixture, 11 December 2025" })).toBeVisible();
  });

  test("the filters are a form: the address says what is listed, on both base paths", async ({ page, atlas, staging }) => {
    for (const site of [atlas, staging]) {
      await page.goto(site.url("/claims"));
      await page.getByLabel("Topic", { exact: true }).selectOption("inflation");
      await page.getByRole("button", { name: "Show" }).click();
      await expect(page).toHaveURL(/\/claims\?person=&party=&topic=inflation$/);
      await expect(page.locator("[data-claim]")).toHaveCount(1);
      await page.goto(site.url("/claims?party=nonsense"));
      await expect(page.getByText("holds no claim for the party in the address")).toBeVisible();
      await expect(page.locator("[data-claim]")).toHaveCount(1);
    }
  });

  test("AC: the quote, the sources and the then and now figures are above the fold at 360×740", async ({ browser, atlas }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    await page.goto(atlas.url(`/claims/${CLAIM}`));
    const first = page.locator(`[data-evidence="index-in-november"]`);
    for (const [name, locator] of [
      ["quote", page.locator("[data-quote]")],
      ["sources", page.locator("[data-sources-line]")],
      ["then", first.locator('[data-cell="then"] data').first()],
      ["now when checked", first.locator('[data-cell="now"] data').first()],
    ] as const) {
      const box = (await locator.boundingBox())!;
      expect(box.y, name).toBeGreaterThanOrEqual(0);
      // Fonts differ between machines (CI's are wider): the figures must clear the fold with room to spare.
      expect(box.y + box.height, name).toBeLessThanOrEqual(740 - 48);
      expect(box.x + box.width, name).toBeLessThanOrEqual(360);
    }
    await expect(first.locator('[data-cell="then"]').first()).toContainText("109.5");
    await expect(first.locator('[data-cell="now"]').first()).toContainText("109.3");
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await context.close();
  });

  test("a claim's page: the three states side by side, the basis as a mark and a word, the drawing, and doors to the series", async ({ page, atlas }) => {
    await page.goto(atlas.url(`/claims/${CLAIM}`));
    const main = page.getByRole("main");
    await expect(main.locator('[data-origin="then"] [data-basis="atlas_observed"] svg')).toHaveCount(3);
    await expect(main.locator('[data-origin="latest"]').first()).toContainText("It is not part of the lock.");
    await expect(main.locator('[data-cell="then"] [data-state="preliminary"] svg').first()).toBeVisible();
    await expect(main.locator("[data-claim-drawing]")).toHaveCount(3);
    await expect(main.locator('[data-sensitivity="rise-since-january"] tbody tr')).toHaveCount(15);
    await expect(main.getByRole("link", { name: /^recording ?: Fixture broadcaster/ })).toHaveAttribute("href", "https://video.example.org/fixture-briefing");
    await expect(main.getByRole("link", { name: /archived/ }).first()).toHaveAttribute("href", "https://example.org/archive/2026/fixture-briefing");
    await main.getByRole("link", { name: "Fixture price index", exact: true }).first().click();
    await expect(page).toHaveURL(atlas.url("/data/fx_price_index"));
    await page.goBack();
    await main.getByRole("link", { name: "As known before the statement" }).first().click();
    await expect(page).toHaveURL(/\/explore\?s=fx_price_index&from=2024-11&to=2026-11&as_of=2025-12-11$/);
    await page.goBack();
    await main.getByRole("link", { name: "How a claim record is built" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "How a claim record is built" })).toBeVisible();
  });

  test("the evidence downloads are the page's own figures", async ({ page, atlas }) => {
    await page.goto(atlas.url(`/claims/${CLAIM}`));
    const links = page.locator("[data-downloads] a");
    await expect(links).toHaveText(["Evidence CSV", "Markdown", "JSON", "Lock file"]);
    const csv = await page.request.get(atlas.url(`/claims/${CLAIM}/evidence.csv`));
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-disposition"]).toContain("not-for-publication");
    expect(await csv.text()).toContain(`${CLAIM},1,index-in-november,fx_price_index,monthly,lin,value_at,then,2025-12-11,atlas_observed,`);
    const json = await (await page.request.get(atlas.url(`/claims/${CLAIM}.json`))).json();
    expect(json.evidence.readings[0].then.figures[0].value).toBe(109.5);
    expect((await page.request.get(atlas.url(`/claims/${CLAIM}/twin/json`))).status()).toBe(404);
  });

  test("a claim the release does not hold is not found", async ({ page, atlas }) => {
    expect((await page.goto(atlas.url("/claims/2020-01-01-no-such-claim")))!.status()).toBe(404);
    expect((await page.request.get(atlas.url("/claims/2020-01-01-no-such-claim.json"))).status()).toBe(404);
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
          if (!el.textContent?.trim() || el.children.length > 0) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          // Text in a drawing is laid out in the drawing's own units and scaled with it.
          const svg = el.closest("svg");
          const scale = svg && svg.viewBox.baseVal.width > 0 ? svg.getBoundingClientRect().width / svg.viewBox.baseVal.width : 1;
          min = Math.min(min, size * scale);
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
    test("the pages are complete, and the filter form works", async ({ page, atlas }) => {
      await page.goto(atlas.url("/claims"));
      await expect(page.locator("[data-claim]")).toHaveCount(1);
      await page.getByLabel("Party").selectOption("none");
      await page.getByRole("button", { name: "Show" }).click();
      await expect(page.locator("[data-claim]")).toHaveCount(1);
      await page.locator("[data-claim]").getByRole("link").click();
      await expect(page.locator('[data-evidence="rise-since-january"] [data-figure="change"] [data-cell="then"]')).toContainText("4.5");
      await expect(page.locator("[data-claim-drawing]")).toHaveCount(3);
      await expect(page.locator("main script")).toHaveCount(0);
    });
  });
});
