import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./site";

/**
 * Series pages II in a real browser (PLAN M17 and section 8): the as-of question, revisions,
 * citation and downloads, on a production build under the enforced CSP, serving the synthetic
 * fixture release.
 */
const sideways = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("what a series said before a date", () => {
  test("the form asks with a plain GET: the address is the question, and it needs no script", async ({ browser, atlas }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(atlas.url("/data/fx_price_index"));
    await page.getByLabel("What it said before a date").fill("2025-12-13");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(atlas.url("/data/fx_price_index?as_of=2025-12-13"));
    await expect(page.locator("[data-as-of]")).toContainText("As known before 13 December 2025");
    await expect(page.locator("[data-as-of] [data-basis=uncertain]")).toHaveText("Uncertain");
    await expect(page.locator("[data-latest]")).toContainText("109.5");
    await expect(page.locator("[data-latest]")).toContainText("Latest value known then");
    await expect(page.locator("[data-takeaway]")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("109.9");
    await page.getByRole("link", { name: "Show it as it is now" }).click();
    await expect(page).toHaveURL(atlas.url("/data/fx_price_index"));
    await expect(page.locator("[data-latest]")).toContainText("109.9");
    await context.close();
  });

  test("a date without coverage shows the unavailable state, with its mark and word, and no value", async ({ page, staging }) => {
    await page.goto(staging.url("/data/fx_price_index?as_of=2025-12-01"));
    await expect(page.locator("[data-as-of=unavailable] [data-basis=unavailable]")).toHaveText("Unavailable");
    await expect(page.locator("[data-as-of] svg[data-basis-mark=unavailable]")).toHaveCount(1);
    await expect(page.locator("[data-unavailable]")).toContainText("before Macro Atlas first fetched this series");
    await expect(page.locator("[data-plot], [data-figure-table], [data-latest], [data-revisions]")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/109\.\d/);
    await expect(page.getByLabel("What it said before a date")).toBeVisible();
    await page.locator("[data-as-of]").getByRole("link", { name: "Unavailable" }).click();
    await expect(page).toHaveURL(staging.url("/docs/glossary/unavailable"));
    await expect(page.locator("main svg[data-basis-mark=unavailable]")).toHaveCount(1);
  });

  test("each Basis is a mark of its own shape and a word, in ink, in both themes", async ({ page, atlas }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const shapes = new Set<string>();
      for (const [path, basis, word] of [
        ["/data/fx_output_quarterly?as_of=2025-11-20", "provider", "Provider vintage"],
        ["/data/fx_price_index?as_of=2025-12-11", "atlas_observed", "Atlas-observed"],
        ["/data/fx_price_index?as_of=2025-12-13", "uncertain", "Uncertain"],
        ["/data/fx_vote_margin?as_of=2025-12-20", "unavailable", "Unavailable"],
      ] as const) {
        await page.goto(atlas.url(path));
        const badge = page.locator(`[data-as-of] [data-basis=${basis}]`);
        await expect(badge).toHaveText(word);
        const ink = await page.evaluate(() => getComputedStyle(document.body).color);
        const drawn = await badge.locator("svg > *").evaluateAll((els) => els.map((el) => ({ html: el.outerHTML, stroke: getComputedStyle(el).stroke, fill: getComputedStyle(el).fill })));
        expect(drawn.length).toBeGreaterThan(0);
        for (const shape of drawn) expect([shape.stroke, shape.fill]).toContain(ink);
        shapes.add(drawn.map((d) => d.html).join(""));
      }
      expect(shapes.size).toBe(4);
    }
  });
});

test.describe("revisions, citation and downloads", () => {
  test("revisions list every version of the periods that changed, the two clocks in their own columns", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data/fx_price_index"));
    const table = page.locator("[data-revisions]");
    await expect(table.locator("thead th")).toHaveText(["Period", "Value", "Status", "Published by the origin", "First held by Macro Atlas", "Held until"]);
    await expect(table.locator("tbody tr")).toHaveCount(4);
    await expect(table.locator("tbody tr").nth(2)).toContainText("Nov 2025");
    await expect(table.locator("tbody tr").nth(2)).toContainText("109.5");
    await expect(table.locator("tbody tr").nth(2)).toContainText("10 Dec 2025, 15:45 UTC");
    await expect(table.locator("tbody tr").nth(3)).toContainText("Held now");
    await expect(page.locator("#revisions")).toContainText("Days in between with no Capture: 12 Dec 2025, 13 Dec 2025, 14 Dec 2025.");
    await page.goto(atlas.url("/data/fx_output_quarterly"));
    await expect(page.locator("[data-revisions] tbody tr").filter({ hasText: "560.2" })).toContainText("28 Oct 2025");
    await page.goto(atlas.url("/data/fx_vote_margin"));
    await expect(page.locator("[data-no-history]")).toContainText("holds no earlier versions");
  });

  test("the files behind the page are at the page's address with a suffix, and hold the page's values", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data/fx_price_index?as_of=2025-12-13"));
    const links = page.locator("[data-downloads] a");
    await expect(links).toHaveText(["CSV", "JSON", "Markdown", "Metadata (JSON)"]);
    await expect(links.nth(1)).toHaveAttribute("href", "/macro-atlas/data/fx_price_index.json?as_of=2025-12-13");
    const doc = await (await page.request.get(atlas.url("/data/fx_price_index.json?as_of=2025-12-13"))).json();
    expect(doc.basis).toBe("uncertain");
    await page.getByText("Show the table").click();
    const cells = await page.locator("[data-figure-table] tbody tr").evaluateAll((rows) =>
      rows.map((row) => {
        const cell = row.querySelector("td")!;
        const exact = cell.querySelector("data")?.getAttribute("value");
        return cell.textContent === "No value" ? null : Number(exact ?? cell.textContent);
      }),
    );
    expect(cells).toEqual(doc.observations.map((o: { value: number | null }) => o.value));
    await expect(page.locator("[data-citation]")).toContainText("as known before 2025-12-13");
    await expect(page.locator("[data-reproduce]").first()).toContainText(`curl -sL '${atlas.url("/data/fx_price_index.csv?as_of=2025-12-13")}'`);
    const download = page.waitForEvent("download");
    await links.first().click();
    expect((await download).suggestedFilename()).toBe("macro-atlas_fx_price_index_not-for-publication.csv");
  });

  test("the withheld series is named, with no value and no file of values on offer", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data/fx_exchange_index"));
    await expect(page.getByRole("heading", { level: 1, name: "Fixture exchange index" })).toBeVisible();
    await expect(page.locator("[data-downloads-refused]")).toContainText("is withheld");
    await expect(page.locator("[data-downloads] a")).toHaveText(["Metadata (JSON)"]);
    await expect(page.locator("[data-as-of-form], [data-revisions], [data-reproduce]")).toHaveCount(0);
    expect((await page.request.get(atlas.url("/data/fx_exchange_index.csv"))).status()).toBe(403);
  });
});

test.describe("the page holds together", () => {
  const PAGES = ["/data/fx_price_index", "/data/fx_price_index?as_of=2025-12-13", "/data/fx_price_index?as_of=2025-12-01", "/data/fx_output_quarterly", "/data/fx_price_index?transform=pc1&freq=quarterly", "/data/fx_exchange_index", "/data/fx_price_index?transform=sqrt"];

  test("nothing scrolls sideways from 320px up, and every control can be reached and pressed", async ({ page, atlas }) => {
    for (const width of [320, 360, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of PAGES) {
        await page.goto(atlas.url(path));
        expect(await sideways(page), `${path} at ${width}px`).toBeLessThanOrEqual(0);
        const small = await page.locator("main a[href], main button, main input:not([type=hidden]), main summary").evaluateAll((els) =>
          els.filter((el) => el.getClientRects().length > 0).map((el) => ({ box: el.getBoundingClientRect(), html: el.outerHTML.slice(0, 70) })).filter((c) => Math.min(c.box.width, c.box.height) < 24).map((c) => c.html),
        );
        expect(small, `${path} at ${width}px`).toEqual([]);
      }
    }
  });

  test("nothing on the new panels moves: no animation, and only the press of a control has a transition", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data/fx_price_index?as_of=2025-12-13"));
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll("[data-as-of], [data-as-of] *, #revisions *, #cite *")].filter((el) => {
        const style = getComputedStyle(el);
        const pressable = el.matches("a, button");
        return style.animationName !== "none" || (!pressable && parseFloat(style.transitionDuration) > 0);
      }).length,
    );
    expect(moving).toBe(0);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds nothing in the ${scheme} theme`, async ({ page, atlas }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of PAGES) {
        await page.goto(atlas.url(path));
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
        expect(results.violations.map((v) => `${path}: ${v.id} ${v.nodes[0]?.html.slice(0, 80)}`)).toEqual([]);
      }
    });
  }
});
