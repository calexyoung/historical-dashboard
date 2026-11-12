import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { FIXTURE_ID } from "../src/lib/release/testing";
import { expect, test } from "./site";

/**
 * The Explorer's M18 controls in a real browser: as of a date, a common frequency, a pinned
 * link, on a production build under the enforced CSP, serving the synthetic fixture release.
 * What the figures are is tested in Vitest (src/lib/explorer/view.test.ts, agency.test.ts,
 * pin.test.ts); here it is the page.
 */
const search = (page: Page) => new URL(page.url()).searchParams;
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shown = (page: Page) => page.locator("[data-plot] > svg[role=img]").locator("visible=true");

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || /content security policy/i.test(message.text())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));
  return problems;
}

test.describe("as of a date", () => {
  test("a date is asked for in a field, the Basis is said in a mark and a word, and one link returns to today", async ({ page, atlas }) => {
    const problems = watch(page);
    await page.goto(atlas.url("/explore?s=fx_price_index,fx_output_quarterly"));
    await expect(page.locator("[data-as-of]")).toHaveCount(0);
    await page.getByLabel("As known before").fill("2025-12-13");
    await expect(page).toHaveURL(/as_of=2025-12-13/);
    const block = page.locator("[data-as-of]");
    await expect(block).toHaveAttribute("data-as-of", "uncertain");
    await expect(block).toContainText("As known before 13 December 2025");
    await expect(block.locator("[data-basis=uncertain]").first()).toContainText("Uncertain");
    await expect(block.locator("[data-basis-mark]").first()).toBeVisible();
    await expect(page.locator("[data-as-of-series] li")).toHaveCount(2);
    await expect(page.getByLabel("As known before")).toBeFocused(); // the reader stays in the field they changed
    // Changing something else keeps the question.
    await page.getByLabel("Show as").selectOption("z");
    await expect(page).toHaveURL(/mode=z.*as_of=2025-12-13/);
    await page.locator("[data-as-of-off]").click();
    await expect.poll(() => search(page).get("as_of")).toBeNull();
    await expect(page.locator("[data-as-of]")).toHaveCount(0);
    await expect(page.getByLabel("As known before")).toHaveValue("");
    expect(problems).toEqual([]);
  });

  test("a date with no answer draws nothing for the series and says why", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index&as_of=2025-01-01"));
    await expect(shown(page)).toHaveCount(0);
    await expect(page.locator("[data-not-drawn]")).toContainText("Nothing is shown as of then");
    await expect(page.locator("[data-readout-row]")).toHaveCount(0);
  });
});

test.describe("a common frequency", () => {
  test("finer series are combined on request, and the page says how", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index,fx_poverty_rate_annual"));
    await page.getByLabel("Frequency").selectOption("quarterly");
    await expect(page).toHaveURL(/freq=quarterly/);
    await expect(page.locator("[data-notes]")).toContainText("Fixture price index is monthly; its values are averaged over each quarter.");
    await expect(page.locator("[data-notes]")).toContainText("is annual and is drawn as it is");
    await page.getByLabel("Frequency").selectOption("");
    await expect.poll(() => search(page).get("freq")).toBeNull();
  });
});

test.describe("a pinned link", () => {
  test("says which release it is pinned to, stays pinned as the view changes, and lets go by one link", async ({ page, atlas }) => {
    const problems = watch(page);
    await page.goto(atlas.url(`/explore?s=fx_price_index&pin=${FIXTURE_ID}`));
    const note = page.locator("[data-pinned]");
    await expect(note).toContainText(`Pinned to release ${FIXTURE_ID}`);
    await expect(note).toContainText("drawn by today’s engine");
    await page.getByLabel("Show as").selectOption("rebase");
    await expect(page).toHaveURL(new RegExp(`mode=rebase.*pin=${FIXTURE_ID}`));
    await expect(note).toBeVisible();
    await page.locator("[data-unpin]").click();
    await expect.poll(() => search(page).get("pin")).toBeNull();
    await expect(page.locator("[data-pinned]")).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("a release that is not kept is a plain 410 page with the way to the current one", async ({ page, atlas }) => {
    const response = await page.goto(atlas.url("/explore?s=fx_price_index&pin=20200101T000000Z-fffffff"));
    expect(response!.status()).toBe(410);
    await expect(page.getByRole("heading")).toHaveText("This release is no longer kept");
    await page.getByRole("link", { name: "Open the same view on the current release" }).click();
    await expect(page).toHaveURL(/\/explore\?s=fx_price_index$/);
    await expect(shown(page).first()).toBeVisible();
  });
});

test.describe("a series the release does not hold", () => {
  test("is named with the Catalog's reason and can be taken out of the address", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index,spx"));
    const line = page.locator("[data-absent=spx]");
    await expect(line).toContainText("Not in this release · S&P 500");
    await line.getByRole("link", { name: "Remove S&P 500 from the address" }).click();
    await expect.poll(() => search(page).get("s")).toBe("fx_price_index");
    await expect(page.locator("[data-absent]")).toHaveCount(0);
  });
});

test.describe("the picker and a series the release does not hold", () => {
  test("choosing another series keeps the named one in the address, and it counts toward the eight", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index,spx"));
    await page.getByRole("link", { name: /Choose series/ }).click();
    const sheet = page.locator("dialog#series-picker");
    await expect(sheet).toContainText("2 of 8 selected");
    await sheet.getByLabel("Fixture output", { exact: false }).check();
    await expect.poll(() => search(page).get("s")).toBe("fx_price_index,spx,fx_output_quarterly");
    await expect(page.locator("[data-absent=spx]")).toBeVisible();
  });
});

test.describe("with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the as-of date, the frequency and a pin travel with the form", async ({ page, atlas }) => {
    await page.goto(atlas.url(`/explore?s=fx_price_index&pin=${FIXTURE_ID}`));
    await page.getByLabel("As known before").fill("2025-12-10");
    await page.getByLabel("Frequency").selectOption("quarterly");
    await page.getByRole("button", { name: "Show", exact: true }).click();
    const params = search(page);
    expect([params.get("as_of"), params.get("freq"), params.get("pin")]).toEqual(["2025-12-10", "quarterly", FIXTURE_ID]);
    await expect(page.locator("[data-as-of]")).toHaveAttribute("data-as-of", "atlas_observed");
    await expect(page.locator("[data-pinned]")).toBeVisible();
  });

  test("the picker's plain form carries a series the release does not hold", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index,spx&pick=1"));
    await page.locator("dialog#series-picker").getByRole("button", { name: "Show these series" }).click();
    // A plain form sends the field once per box; the page reads them as one list.
    expect(search(page).getAll("s").flatMap((v) => v.split(",")).filter(Boolean).sort()).toEqual(["fx_price_index", "spx"]);
    await expect(page.locator("[data-absent=spx]")).toBeVisible();
    await expect(page.locator("[data-selected=fx_price_index]")).toBeVisible();
  });
});

test.describe("the page itself", () => {
  const FULL = `/explore?s=fx_price_index,fx_output_quarterly,spx&freq=quarterly&as_of=2025-12-13&pin=${FIXTURE_ID}`;

  for (const scheme of ["light", "dark"] as const) {
    test(`has no accessibility violations in the ${scheme} theme`, async ({ browser, atlas }) => {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await page.goto(atlas.url(FULL));
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      await context.close();
    });
  }

  test("at 360px nothing overflows and every new control can be reached and pressed", async ({ browser, atlas }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    await page.goto(atlas.url(FULL));
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const controls = page.locator("[data-pinned] a, [data-as-of] a, [data-absent] a, #explorer-view select, #explorer-view input:not([type=hidden])").locator("visible=true");
    const count = await controls.count();
    expect(count).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < count; i++) {
      const control = controls.nth(i);
      await control.scrollIntoViewIfNeeded();
      await control.click({ trial: true, timeout: 2000 });
      const target = (await control.getAttribute("type")) === "checkbox" ? control.locator("xpath=ancestor::label") : control;
      const box = (await target.boundingBox())!;
      expect(Math.min(box.width, box.height), await control.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(24);
    }
    await context.close();
  });

  test("the notes that are there on every load do not move", async ({ page, atlas }) => {
    await page.goto(atlas.url(FULL));
    const moving = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll("[data-pinned], [data-as-of], [data-as-of] *, [data-not-drawn], [data-notes]")) {
        if (el.closest("a")) continue;
        const style = getComputedStyle(el);
        const durations = [...style.transitionDuration.split(","), ...style.animationDuration.split(",")].map((d) => parseFloat(d));
        if (durations.some((d) => d > 0) || style.animationName !== "none") out.push(el.tagName);
      }
      return out;
    });
    expect(moving).toEqual([]);
  });
});
