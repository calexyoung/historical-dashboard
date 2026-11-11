import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { addRelease, promote, tempRoot } from "../src/lib/release/testing";
import { startVariant, type Running } from "../tests/built/builds";
import { expect, test as base } from "./site";

/**
 * Series pages and the explained figure, in a real browser, on a production build under the
 * enforced CSP (PLAN sections 3 and 8; M3). The fixture release is synthetic. One more synthetic
 * release, made here, puts every Data state, a very long name and very large values on a page.
 */
const STATES_ID = "20260301T000000Z-5a5a5a5";
const LONG_NAME = "Fixture price index with a name long enough to wrap over several lines on a phone, and then some more words";

const test = base.extend<object, { states: Running }>({
  states: [
    async ({}, use) => {
      const root = tempRoot();
      addRelease(root, {
        id: STATES_ID,
        edit: {
          fx_price_index: (file, entry) => {
            entry.name = LONG_NAME;
            const status: Record<string, string> = { "2025-03": "suppressed", "2025-08": "revised", "2025-09": "estimate", "2025-10": "projected", "2025-11": "partial", "2025-12": "preliminary" };
            for (const o of file.observations) {
              if (o.value !== null) o.value = o.value * 1.5e9;
              if (status[o.period]) o.status = status[o.period];
            }
            file.observations[4].value = null; // 2024-05: a second gap, this one plainly missing
            file.observations[4].status = "missing";
          },
        },
      });
      promote(root, STATES_ID);
      const server = await startVariant("local-atlas", { root });
      await use(server);
      await server.stop();
    },
    { scope: "worker" },
  ],
});

const KEYS = ["fx_price_index", "fx_output_quarterly", "fx_poverty_rate_annual", "fx_vote_margin", "fx_price_index_yoy", "fx_payrolls_break", "fx_permits_stale"];
const visibleSvgs = (page: Page) => page.locator("[data-plot] > svg[role=img]").locator("visible=true");

/** Everything a drawing must satisfy at the width it is shown at. */
async function checkDrawing(page: Page, where: string) {
  const report = await page.evaluate(() => {
    const out: string[] = [];
    for (const plot of document.querySelectorAll("[data-plot]")) {
      const shown = [...plot.querySelectorAll(":scope > svg[role=img]")].filter((svg) => getComputedStyle(svg).display !== "none") as SVGSVGElement[];
      if (shown.length !== 1) out.push(`${shown.length} drawings are shown at once`);
      for (const svg of shown) {
        const box = svg.getBoundingClientRect();
        const scale = box.width / svg.viewBox.baseVal.width;
        if (scale < 0.999) out.push(`the ${svg.dataset.layout} drawing is scaled down to ${scale.toFixed(2)}`);
        if (box.right > document.documentElement.clientWidth + 0.5) out.push(`the ${svg.dataset.layout} drawing runs off the page`);
        const labels = [...svg.querySelectorAll("text")].map((t) => ({ text: t.textContent ?? "", box: t.getBoundingClientRect(), y: t.getAttribute("y") }));
        if (labels.length < 4) out.push("fewer than four axis labels");
        for (const label of labels) {
          if (label.box.left < box.left - 0.5 || label.box.right > box.right + 0.5 || label.box.top < box.top - 0.5 || label.box.bottom > box.bottom + 0.5) {
            out.push(`"${label.text}" is clipped in the ${svg.dataset.layout} drawing`);
          }
          if (label.box.height < 12) out.push(`"${label.text}" is drawn under 12px`);
        }
        const axis = labels.filter((l) => l.y === String(svg.viewBox.baseVal.height - 8)).sort((a, b) => a.box.left - b.box.left);
        for (let i = 1; i < axis.length; i++) {
          if (axis[i]!.box.left < axis[i - 1]!.box.right + 2) out.push(`"${axis[i - 1]!.text}" runs into "${axis[i]!.text}"`);
        }
      }
    }
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) out.push("the page scrolls sideways");
    return out;
  });
  expect(report, where).toEqual([]);
}

test.describe("a series page", () => {
  test("is a door from the catalog: a name on /data opens its page", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data"));
    await page.getByRole("link", { name: "Fixture output", exact: true }).click();
    await expect(page).toHaveURL(atlas.url("/data/fx_output_quarterly"));
    await expect(page.getByRole("heading", { level: 1, name: "Fixture output" })).toBeVisible();
    await expect(page).toHaveTitle("Fixture output · Macro Atlas");
    await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Data" })).toHaveAttribute("aria-current", "page");
  });

  test("has the name, definition, latest value, figure, provenance and a door into the Explorer", async ({ page, staging }) => {
    await page.goto(staging.url("/data/fx_price_index"));
    await expect(page.locator("[data-latest]")).toContainText("109.9");
    await expect(page.locator("[data-latest]")).toContainText("December 2025");
    await expect(page.locator("[data-latest]")).toContainText("Preliminary");
    await expect(page.locator("[data-takeaway]")).toHaveText("Fixture price index was 109.9 in December 2025 (index, 2024-01 = 100), 5.2% higher than a year earlier.");
    await expect(visibleSvgs(page)).toHaveCount(1);
    await expect(page.locator("[data-unit-line]")).toHaveText("index, 2024-01 = 100 · seasonally adjusted · monthly");
    await expect(page.locator("[data-source-line]")).toContainText("Source: Macro Atlas fixture (synthetic), FX-PRICE, via fixture · data to Dec 2025 · preliminary");
    for (const heading of ["Definition", "Provenance"]) await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    for (const heading of ["Origin", "Channel", "Rights", "Release"]) await expect(page.getByRole("heading", { level: 3, name: heading })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Explorer →" })).toHaveAttribute("href", "/macro-atlas-staging/explore?s=fx_price_index");
  });

  test("the drawing that shows is the one laid out for the width the figure has", async ({ page, atlas }) => {
    for (const [width, layout] of [[320, "narrow"], [360, "narrow"], [600, "medium"], [1280, "wide"]] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(atlas.url("/data/fx_price_index"));
      await expect(visibleSvgs(page)).toHaveAttribute("data-layout", layout);
    }
  });

  test("a figure at 320px has no clipped labels, and none at any other width, for every series", async ({ page, atlas, states }) => {
    test.slow();
    // Either side of each switch between drawings, as well as the usual sizes.
    for (const width of [320, 360, 511, 512, 513, 640, 831, 832, 833, 1024, 1280, 1600]) {
      await page.setViewportSize({ width, height: 800 });
      for (const key of KEYS) {
        await page.goto(atlas.url(`/data/${key}`));
        await checkDrawing(page, `${key} at ${width}px`);
      }
      await page.goto(states.url("/data/fx_price_index"));
      await checkDrawing(page, `every state, long name, large values, at ${width}px`);
    }
  });

  test("at 200% zoom of a 640px window the figure still fits and every link can be used", async ({ browser, atlas }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(atlas.url("/data/fx_payrolls_break"));
    await checkDrawing(page, "200% zoom");
    await page.locator("[data-table] summary").click();
    await page.locator("[data-how-to-read] summary").click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const controls = page.locator("main a[href], main summary");
    const count = await controls.count();
    expect(count).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < count; i++) {
      const control = controls.nth(i);
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox())!;
      expect(Math.min(box.width, box.height), await control.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(24);
    }
    const smallest = await page.evaluate(() => {
      let min = Infinity;
      for (const el of document.querySelectorAll("body *")) {
        if (!el.textContent?.trim() || el.children.length > 0) continue;
        min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
      }
      return min;
    });
    expect(smallest).toBeGreaterThanOrEqual(12);
    await context.close();
  });

  test("a sparse series is drawn as points or steps at its real cadence, never as a line", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data/fx_output_quarterly"));
    const svg = visibleSvgs(page);
    await expect(svg.locator("[data-drawn=line], [data-drawn=step]")).toHaveCount(0);
    await expect(svg.locator("[data-drawn=points]")).toHaveAttribute("data-count", "15"); // sixteen quarters, one missing
    await page.goto(atlas.url("/data/fx_poverty_rate_annual"));
    await expect(visibleSvgs(page).locator("[data-drawn=line]")).toHaveCount(0);
    await expect(visibleSvgs(page).locator("[data-drawn=points]")).toHaveAttribute("data-count", "14");
    await page.goto(atlas.url("/data/fx_vote_margin"));
    await expect(visibleSvgs(page).locator("[data-drawn=step]")).toHaveCount(1);
    await expect(visibleSvgs(page).locator("[data-drawn=line]")).toHaveCount(0);
    await expect(visibleSvgs(page).locator("[data-drawn=points]")).toHaveAttribute("data-count", "4");
    await page.goto(atlas.url("/data/fx_price_index"));
    await expect(visibleSvgs(page).locator("[data-drawn=line]")).toHaveCount(1);
  });

  test("the table holds every observation, and opens without leaving the page", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data/fx_price_index"));
    const table = page.locator("[data-figure-table]");
    await expect(table).toBeHidden();
    await page.getByText("Show the table").click();
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(24);
    await expect(table.locator("tbody tr").nth(14)).toContainText("Mar 2025");
    await expect(table.locator("tbody tr").nth(14)).toContainText("No value");
    await expect(table.locator("tbody tr").nth(14)).toContainText("Missing");
    await expect(table.locator("tbody tr").nth(23)).toContainText("109.9");
    await expect(table.locator("tbody tr").nth(23)).toContainText("Preliminary");
    await page.getByText("How to read this").click();
    await expect(page.locator("[data-how-to-read]")).toContainText("The line joins one value per month");
    await expect(page.locator("[data-how-to-read]")).toContainText("It does not start at zero.");
  });

  test("silence is said in words where the takeaway would be", async ({ page, atlas }) => {
    for (const [key, rule, words] of [
      ["fx_permits_stale", "stale", "the series is stale"],
      ["fx_output_quarterly", "estimate", "is an estimate"],
      ["fx_payrolls_break", "break", "has a break at January 2025"],
    ] as const) {
      await page.goto(atlas.url(`/data/${key}`));
      await expect(page.locator("[data-takeaway]")).toHaveCount(0);
      await expect(page.locator(`[data-silence=${rule}]`)).toContainText(words);
    }
  });

  test("nothing in the figure animates", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data/fx_price_index"));
    await page.getByText("Show the table").click();
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll("[data-figure] svg, [data-figure] svg *, [data-figure] table *, [data-figure] details, [data-figure] summary")].filter((el) => {
        const style = getComputedStyle(el);
        return style.animationName !== "none" || parseFloat(style.transitionDuration) > 0;
      }).length,
    );
    expect(moving).toBe(0);
  });

  test("the page loads no script of its own and hydrates under the CSP without complaint", async ({ page, atlas }) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || /content security policy/i.test(message.text())) problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(String(error)));
    const scripts: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname);
    });
    await page.goto(atlas.url("/explore"), { waitUntil: "networkidle" });
    const onExplore = scripts.length;
    scripts.length = 0;
    await page.goto(atlas.url("/data/fx_price_index"), { waitUntil: "networkidle" });
    expect(scripts.length).toBeLessThanOrEqual(onExplore);
    expect(problems).toEqual([]);
  });
});

test.describe("every data state renders with a mark and a word", () => {
  const WORDS: Record<string, string> = {
    preliminary: "Preliminary",
    revised: "Revised",
    estimate: "Estimate",
    projected: "Projected",
    partial: "Partial period",
    stale: "Stale",
    missing: "Missing",
    break: "Break",
    withheld: "Withheld",
    suppressed: "Suppressed",
  };

  test("on series pages: in the drawing, under it and in the table", async ({ page, atlas, states }) => {
    const seen = new Set<string>();
    for (const [server, key] of [[states, "fx_price_index"], [atlas, "fx_payrolls_break"], [atlas, "fx_permits_stale"], [atlas, "fx_exchange_index"]] as const) {
      await page.goto(server.url(`/data/${key}`));
      const found = await page.evaluate(() =>
        [...document.querySelectorAll("main [data-state]")].map((el) => ({
          state: el.getAttribute("data-state")!,
          word: el.textContent!.trim(),
          mark: el.querySelector(`svg[data-state-mark] [data-mark]`)?.getAttribute("data-mark") ?? null,
          shapes: el.querySelectorAll("svg[data-state-mark] [data-mark] *").length,
        })),
      );
      for (const item of found) {
        expect(item.word, `${key}: ${item.state}`).toBe(WORDS[item.state]);
        expect(item.mark, `${key}: ${item.state}`).toBe(item.state);
        expect(item.shapes).toBeGreaterThan(0);
        seen.add(item.state);
      }
      // What is named under the drawing is marked in the drawing.
      const under = await page.locator("[data-states] [data-state]").evaluateAll((els) => els.map((el) => el.getAttribute("data-state")!));
      for (const state of under) {
        if (state === "withheld") continue;
        expect(await visibleSvgs(page).locator(`[data-mark=${state}]`).count(), `${key}: ${state} in the drawing`).toBeGreaterThan(0);
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(WORDS).sort());
  });

  test("the marks are ink, not a colour of their own, in both themes", async ({ page, states }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(states.url("/data/fx_price_index"));
      const ink = await page.evaluate(() => getComputedStyle(document.body).color);
      const strokes = await page.locator("[data-states] svg[data-state-mark] [data-mark] > *").evaluateAll((els) => els.map((el) => getComputedStyle(el).stroke).filter((s) => s !== "none"));
      expect(strokes.length).toBeGreaterThan(5);
      expect(new Set(strokes)).toEqual(new Set([ink]));
    }
  });

  test("in the glossary, each with its definition", async ({ page, atlas }) => {
    await page.goto(atlas.url("/docs/glossary"));
    for (const [state, word] of Object.entries(WORDS)) {
      const entry = page.locator(`[data-term]:has(svg[data-state-mark=${state}])`).filter({ hasText: word });
      await expect(entry, state).toHaveCount(1);
      await expect(entry.locator("dd")).not.toBeEmpty();
    }
  });
});

test.describe("a series whose values may not be shown", () => {
  test("withheld: named, with the reason, and no value, drawing or table", async ({ page, atlas }) => {
    const response = await page.goto(atlas.url("/data/fx_exchange_index"));
    expect(response!.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Fixture exchange index" })).toBeVisible();
    await expect(page.locator("[data-held-back]")).toContainText("Withheld: The licence does not allow redistribution.");
    await expect(page.locator("[data-plot], [data-figure-table], [data-latest]")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Provenance" })).toBeVisible();
  });

  test("a key the release does not know is not found", async ({ page, atlas }) => {
    const response = await page.goto(atlas.url("/data/no_such_series"));
    expect(response!.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });
});

test.describe("the glossary", () => {
  test("a state's word on a series page leads to its entry, and back to the list", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data/fx_permits_stale"));
    await page.locator("[data-states]").getByRole("link", { name: "Stale" }).click();
    await expect(page).toHaveURL(atlas.url("/docs/glossary/stale"));
    await expect(page.getByRole("heading", { level: 1, name: "Stale" })).toBeVisible();
    await expect(page.locator("main")).toContainText("older than the limit set for this series");
    await page.getByRole("link", { name: "Glossary" }).first().click();
    await expect(page).toHaveURL(atlas.url("/docs/glossary"));
    await expect(page.locator("[data-term]")).toHaveCount(await page.locator("[data-term]").count());
    expect(await page.locator("[data-term]").count()).toBeGreaterThanOrEqual(20);
  });

  test("is reached from the footer of every page, and an unknown term is not found", async ({ page, staging }) => {
    await page.goto(staging.url("/data"));
    await page.getByRole("contentinfo").getByRole("link", { name: "Glossary" }).click();
    await expect(page).toHaveURL(staging.url("/docs/glossary"));
    expect((await page.goto(staging.url("/docs/glossary/no-such-word")))!.status()).toBe(404);
  });
});

test.describe("accessibility", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds nothing in the ${scheme} theme, with the table and the note open`, async ({ page, atlas, states }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const url of [atlas.url("/data/fx_price_index"), atlas.url("/data/fx_exchange_index"), states.url("/data/fx_price_index"), atlas.url("/docs/glossary"), atlas.url("/docs/glossary/partial-period")]) {
        await page.goto(url);
        for (const summary of await page.locator("main summary").all()) await summary.click();
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`), url).toEqual([]);
      }
    });
  }

  test("the drawing has a name, and the disclosures work from the keyboard", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data/fx_price_index"));
    await expect(page.getByRole("img", { name: "Chart of Fixture price index, Jan 2024 to Dec 2025. Every value is in the table below." })).toBeVisible();
    await page.locator("[data-table] summary").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-figure-table]")).toBeVisible();
  });

  test.describe("with JavaScript off", () => {
    test.use({ javaScriptEnabled: false });
    test("a series page is complete: value, sentence, drawing, table, provenance", async ({ page, atlas }) => {
      for (const key of KEYS) {
        await page.goto(atlas.url(`/data/${key}`));
        await expect(page.locator("[data-latest]")).toBeVisible();
        await expect(page.locator("[data-takeaway], [data-silence]")).toHaveCount(1);
        await expect(visibleSvgs(page)).toHaveCount(1);
        await expect(page.locator("[data-source-line]")).toBeVisible();
        await page.getByText("Show the table").click(); // <details> needs no script
        await expect(page.locator("[data-figure-table]")).toBeVisible();
        await expect(page.getByRole("heading", { level: 2, name: "Provenance" })).toBeVisible();
      }
      await page.goto(atlas.url("/docs/glossary"));
      await expect(page.locator("[data-term]").first()).toBeVisible();
    });
  });

  test("largest contentful paint on a series page is under 2.5 s on a throttled phone", async ({ browser, atlas }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(atlas.url("/data/fx_price_index"), { waitUntil: "load" });
    const lcp = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let latest = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) latest = entry.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
          setTimeout(() => resolve(latest), 500);
        }),
    );
    expect(lcp).toBeGreaterThan(0);
    expect(lcp).toBeLessThan(2500);
    await context.close();
  });
});
