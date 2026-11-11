import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./site";

/** The catalog page on the synthetic fixture release (PLAN section 3 and 8, M2). */
const rows = (page: import("@playwright/test").Page) => page.locator("[data-series-key]");

test.describe("the catalog page", () => {
  test("is reached from the Data tab and lists the release's series", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore"));
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Data" }).click();
    await expect(page).toHaveURL(atlas.url("/data"));
    await expect(page.getByRole("heading", { level: 1, name: "Data" })).toBeVisible();
    await expect(rows(page)).toHaveCount(8);
    await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Data" })).toHaveAttribute("aria-current", "page");
  });

  test("search and filters narrow the list, and the address says what is shown", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data"));
    await page.getByRole("searchbox", { name: "Search" }).fill("price");
    await page.getByRole("searchbox", { name: "Search" }).press("Enter");
    await expect(rows(page)).toHaveCount(2);
    expect(new URL(page.url()).searchParams.get("q")).toBe("price");
    await page.getByLabel("Frequency").selectOption("monthly");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(rows(page)).toHaveCount(2);
    await page.getByLabel("Rights").selectOption("no_redistribution");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText("No series match")).toBeVisible();
    await page.getByRole("link", { name: "Clear" }).first().click();
    await expect(page).toHaveURL(atlas.url("/data"));
    await expect(rows(page)).toHaveCount(8);
  });

  test("a copied address reproduces the list in a fresh session", async ({ browser, staging }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(staging.url("/data?segment=governance_politics"));
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByLabel("Segment")).toHaveValue("governance_politics");
    await context.close();
  });

  test("a withheld series is named with its reason and no value", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data?q=exchange"));
    const row = rows(page);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Fixture exchange index");
    await expect(row).toContainText("Withheld");
    await expect(row).toContainText("The licence does not allow redistribution.");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds nothing in the ${scheme} theme`, async ({ page, atlas }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(atlas.url("/data"));
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
    });
  }

  test("no horizontal page scroll at 320px, nothing under 12px, and every control can be used", async ({ browser, atlas }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    for (const path of ["/data", "/data?q=zzzz"]) {
      await page.goto(atlas.url(path));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
    await page.goto(atlas.url("/data"));
    const smallest = await page.evaluate(() => {
      let min = Infinity;
      for (const el of document.querySelectorAll("body *")) {
        if (!el.textContent?.trim() || el.children.length > 0 || el.tagName === "OPTION") continue;
        min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
      }
      return min;
    });
    expect(smallest).toBeGreaterThanOrEqual(12);
    const controls = page.locator("main input, main select, main button, main a[href]");
    const count = await controls.count();
    expect(count).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < count; i++) {
      const control = controls.nth(i);
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport({ ratio: 1 });
      const box = (await control.boundingBox())!;
      expect(Math.min(box.width, box.height), await control.evaluate((el) => el.outerHTML.slice(0, 60))).toBeGreaterThanOrEqual(24);
    }
    await context.close();
  });

  test("every value on a phone is still there: the folded lines carry what the hidden columns hold", async ({ page, atlas }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(atlas.url("/data?q=quarterly"));
    const row = rows(page);
    await expect(row).toHaveCount(1);
    for (const text of ["Fixture output", "fx_output_quarterly", "Quarterly", "billions of fixture dollars", "Public domain"]) {
      await expect(row.getByText(text, { exact: false }).locator("visible=true").first()).toBeVisible();
    }
  });

  test.describe("with JavaScript off", () => {
    test.use({ javaScriptEnabled: false });
    test("the page is complete and the form works", async ({ page, atlas }) => {
      await page.goto(atlas.url("/data"));
      await expect(rows(page)).toHaveCount(8);
      await page.getByRole("searchbox", { name: "Search" }).fill("vote");
      await page.getByRole("button", { name: "Show" }).click();
      await expect(page).toHaveURL(/\/data\?q=vote/);
      await expect(rows(page)).toHaveCount(1);
    });
  });

  test("nothing on the page animates data, and the page adds no script of its own", async ({ page, atlas }) => {
    const scripts: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname);
    });
    await page.goto(atlas.url("/explore"));
    const onExplore = scripts.length;
    scripts.length = 0;
    await page.goto(atlas.url("/data"));
    expect(scripts.length).toBeLessThanOrEqual(onExplore); // a reading page: within the M1 budget
    const animated = await page.evaluate(() =>
      // Since M3 each name is a link to its series page. A link answers a press like every other
      // pressable (DESIGN.md, Motion); the data around it still never moves.
      [...document.querySelectorAll("main table *:not(a)")].filter((el) => {
        const style = getComputedStyle(el);
        return style.animationName !== "none" || parseFloat(style.transitionDuration) > 0;
      }).length,
    );
    expect(animated).toBe(0);
  });
});
