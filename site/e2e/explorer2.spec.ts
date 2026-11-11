import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expect, test } from "./site";

/**
 * Explorer II in a real browser (PLAN M5): compare ranges, marks at the extremes, the snapshot
 * table, relationships, and export, on a production build under the enforced CSP, serving the
 * synthetic fixture release. That the numbers are v1's is tested on v1's data in Vitest
 * (src/lib/legacy/explorer2.test.ts); here it is the page.
 */
const PAIR = "/explore?s=fx_price_index,fx_payrolls_break";
const shown = (page: Page) => page.locator("[data-plot] > svg[role=img]").locator("visible=true");
const search = (page: Page) => new URL(page.url()).searchParams;
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || /content security policy/i.test(message.text())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));
  return problems;
}

test.describe("compare ranges and the marks at the extremes", () => {
  test("a second range is asked for by its first month, drawn pale and wide over the same axis, and let go by a link", async ({ page, atlas }) => {
    const problems = watch(page);
    await page.goto(atlas.url("/explore?s=fx_price_index&mode=rebase&from=2024-01&to=2024-06"));
    await expect(shown(page).locator("[data-run=comparison]")).toHaveCount(0);
    await page.getByLabel("Compare with the range from").fill("2025-04");
    await expect(page).toHaveURL(/cmp=2025-04/);
    await expect(shown(page).locator("[data-run=comparison]").first()).toBeAttached();
    await expect(page.locator("[data-compare]")).toContainText("Jan 2024 to Jun 2024 with Apr 2025 to Sep 2025");
    // The readout names the second run's own period, not the place it is drawn.
    await expect(page.locator('[data-readout-row="fx_price_index.compared"]')).toContainText("Sep 2025");
    await expect(page.locator("[data-plot] [data-legend]")).toContainText("Fixture price index, from Apr 2025");
    await page.locator("[data-compare-off]").click();
    await expect.poll(() => search(page).get("cmp")).toBeNull();
    await expect(shown(page).locator("[data-run=comparison]")).toHaveCount(0);
    await expect(page.getByLabel("Compare with the range from")).toHaveValue("");
    expect(problems).toEqual([]);
  });

  test("the highest and lowest value are marked on request, with the series' own value and period", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index"));
    await expect(shown(page).locator("[data-extreme]")).toHaveCount(0);
    await page.getByLabel("Mark highest and lowest").check();
    await expect(page).toHaveURL(/ext=1/);
    await expect(shown(page).locator("[data-extreme=max]")).toHaveText("max 109.9 · Dec 2025");
    await expect(shown(page).locator("[data-extreme=min]")).toHaveText("min 100.0 · Jan 2024");
    await page.getByLabel("Mark highest and lowest").uncheck();
    await expect.poll(() => search(page).get("ext")).toBeNull();
    await expect(shown(page).locator("[data-extreme]")).toHaveCount(0);
  });
});

test.describe("the snapshot table", () => {
  test("gives each series' first and latest value, the change, the low and the high, with their periods", async ({ page, atlas }) => {
    await page.goto(atlas.url(`${PAIR},fx_exchange_index&mode=z`));
    const row = page.locator("[data-snapshot-row=fx_price_index]");
    await expect(row).toContainText("100.0 Jan 2024");
    await expect(row).toContainText("109.9 Dec 2025");
    await expect(row).toContainText("+9.9%");
    await expect(page.locator("[data-snapshot-row=fx_exchange_index]")).toContainText("Withheld");
    // A rise or a fall is a number here, never a colour.
    const colours = await page.locator("[data-snapshot] td.n").evaluateAll((cells) => [...new Set(cells.map((c) => getComputedStyle(c).color))]);
    expect(colours).toHaveLength(1);
  });
});

test.describe("relationships", () => {
  test("every pair has its r; a cell chooses the pair, and the page says what the answer rests on", async ({ page, atlas }) => {
    const problems = watch(page);
    await page.goto(atlas.url(`${PAIR},fx_permits_stale`));
    await expect(page.locator("[data-matrix] tbody tr")).toHaveCount(3);
    await expect(page.locator("[data-pair-answer]")).toContainText(/r = −?[01]\.\d{3}\s+r² = 0\.\d{3}\s+n = 20/);
    await expect(page.locator("[data-pair-facts]")).toContainText("20 of 24 months have a value for both; 4 do not.");
    await page.locator('[data-cell="fx_payrolls_break fx_price_index"]').click();
    await expect(page).toHaveURL(/sx=fx_payrolls_break&sy=fx_price_index/);
    await expect(page.getByLabel("X", { exact: true })).toHaveValue("fx_payrolls_break");
    await expect(page.locator('[data-cell="fx_payrolls_break fx_price_index"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-guard]")).toContainText("do not say that one moved the other");
    await expect(page.locator("[data-guard]")).toContainText("no significance test is shown");
    await expect(page.locator("#relationships")).not.toContainText(/p\s*<\s*0\.05/);
    expect(problems).toEqual([]);
  });

  test("the pair, the basis, the lag and the rolling window are chosen in place and written into the address", async ({ page, atlas }) => {
    await page.goto(atlas.url(PAIR));
    await page.evaluate(() => ((window as unknown as { __same: boolean }).__same = true));
    await page.getByLabel("Compared on").selectOption("lvl");
    await expect(page).toHaveURL(/basis=lvl/);
    await expect(page.locator("[data-pair-facts]")).toContainText("Compared on levels, monthly.");
    await expect(page.locator("[data-guard]")).toContainText("both rise or both fall");
    await page.getByLabel("Rolling window").selectOption("24");
    await expect(page).toHaveURL(/roll=24/);
    await expect(page.locator("[data-relationship=rolling] svg[data-drawing=rolling]")).toBeVisible();
    const lag = page.getByLabel(/^Lag, in months/);
    await lag.fill("3");
    await lag.press("Enter");
    await expect(page).toHaveURL(/lag=3/);
    await expect(page.locator("[data-pair-facts]")).toContainText("Lag +3: each month of Fixture price index is paired with Fixture payrolls 3 months later.");
    await expect(page.locator("[data-current-lag]").locator("visible=true")).toHaveAttribute("data-current-lag", "3");
    // Every lag is also a link, in the table behind the drawing.
    await page.locator("[data-relationship=lags] summary").click();
    await page.locator("[data-lags]").getByRole("link", { name: "−2 months" }).click();
    await expect(page).toHaveURL(/lag=-2/);
    await expect(lag).toHaveValue("-2");
    expect(await page.evaluate(() => (window as unknown as { __same?: boolean }).__same)).toBe(true); // no reload
    await page.goBack();
    await expect(page).toHaveURL(/lag=3/);
  });

  test("too few pairs, a held series and a window that does not fit are said in words, not left blank", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index,fx_output_quarterly,fx_vote_margin"));
    await expect(page.locator("[data-pair-answer]")).toHaveText("No answer: 5 pairs, and fewer than 8 is too few.");
    await expect(page.locator("[data-pair-facts]")).toContainText("quarterly (Fixture price index is monthly, averaged over each quarter)");
    await expect(page.locator('[data-cell="fx_price_index fx_vote_margin"]')).toHaveText("no answer");
    await expect(page.locator('[data-cell="fx_price_index fx_vote_margin"]')).toHaveAttribute("aria-label", /stand until the next one/);
    await expect(page.locator("[data-rolling-note]")).toContainText("window of 12 quarters");
  });

  test("with one series there is nothing to relate, and the page says what to do", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index"));
    await expect(page.locator("[data-relationships-empty]")).toContainText("Select at least two series");
    await expect(page.locator("[data-guard]")).toBeVisible();
  });
});

test.describe("export", () => {
  const body = (text: string) => text.split("\n").filter((line) => line !== "" && !line.startsWith("#"));

  test("Download CSV saves a stamped file that holds the values on screen", async ({ page, atlas }) => {
    await page.goto(atlas.url(`${PAIR}&mode=rebase&table=1`));
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-export=csv]").click()]);
    expect(download.suggestedFilename()).toBe("macro-atlas_rebase_2024-01_2025-12_not-for-publication.csv");
    const text = readFileSync(await download.path(), "utf8");
    expect(text.split("\n")[0]).toBe("# Macro Atlas · NOT FOR PUBLICATION");
    const rows = body(text).slice(1).map((line) => line.split(","));
    // The table on the page, row for row: the value as drawn, exactly.
    const onScreen = await page.locator("[data-figure-table] tbody tr").evaluateAll((trs) =>
      trs.map((tr) => {
        const cell = tr.querySelector("td")!;
        return cell.querySelector("data")?.getAttribute("value") ?? (cell.querySelector("i") ? "" : cell.textContent!.replace(/,/g, ""));
      }),
    );
    expect(rows).toHaveLength(onScreen.length);
    expect(rows.length).toBe(48);
    rows.forEach((row, i) => expect(onScreen[i] === "" ? row.at(-3) : Number(row.at(-3)), `row ${i}`).toBe(onScreen[i] === "" ? "" : Number(onScreen[i])));
  });

  test("Copy CSV puts the same file on the clipboard and says so", async ({ page, atlas, context }) => {
    const problems = watch(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(atlas.url(PAIR));
    await page.locator("[data-export=copy]").click();
    await expect(page.locator("[data-export=copy]").getByRole("status")).toHaveText("Copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.split("\n")[0]).toBe("# Macro Atlas · NOT FOR PUBLICATION");
    expect(body(copied)).toHaveLength(49);
    expect(problems).toEqual([]);
  });

  test("Save chart as PNG saves a picture made from the stamped drawing, under the enforced policy", async ({ page, atlas }) => {
    const problems = watch(page);
    await page.goto(atlas.url(`${PAIR}&ext=1`));
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-export=png]").click()]);
    expect(download.suggestedFilename()).toBe("macro-atlas_lin_2024-01_2025-12_not-for-publication.png");
    const bytes = readFileSync(await download.path());
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.readUInt32BE(16)).toBe(1600); // twice the drawing's 800 units
    expect(bytes.length).toBeGreaterThan(10_000);
    await expect(page.locator("[data-export=png]").getByRole("status")).toHaveText("Saved");
    expect(problems).toEqual([]);
  });

  test("the picture is the chart: its series in their colours on an opaque ground, and the stamp", async ({ page, atlas }) => {
    // Draw the file the server makes the way the button does, and look at the pixels.
    await page.goto(atlas.url(PAIR));
    const href = await page.locator("[data-export=png]").getAttribute("href");
    const seen = await page.evaluate(async (url) => {
      const svg = await (await fetch(url)).text();
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = [image.naturalWidth, image.naturalHeight];
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const colours = new Set<string>();
      let transparent = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3]! < 255) transparent++;
        colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
      return { stamped: svg.includes("NOT FOR PUBLICATION"), transparent, corner: `${data[0]},${data[1]},${data[2]}`, first: colours.has("213,94,0"), second: colours.has("0,122,90") };
    }, href!);
    expect(seen).toEqual({ stamped: true, transparent: 0, corner: "255,255,255", first: true, second: true });
  });

  test("every series of the release is one more link", async ({ page, atlas }) => {
    await page.goto(atlas.url(PAIR));
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-export=all]").click()]);
    expect(download.suggestedFilename()).toMatch(/^macro-atlas_all_.+_not-for-publication\.csv$/);
    await expect(page.locator("[data-export-note]")).toContainText("stamped “not for publication”");
  });

  test("with nothing drawn there is nothing to export, and no link offers it", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore"));
    await expect(page.locator("[data-export]")).toHaveCount(0);
  });
});

test.describe("Explorer II with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the snapshot, the relationships and their tables are in the page, and the forms and links change the view", async ({ page, atlas }) => {
    await page.goto(atlas.url(`${PAIR}&roll=24`));
    await expect(page.locator("[data-snapshot-row=fx_price_index]")).toContainText("+9.9%");
    await expect(page.locator("[data-pair-answer]")).toContainText("n = 20");
    await expect(page.locator("svg[data-drawing=scatter]")).toBeVisible();
    await expect(page.locator("svg[data-drawing=lag-profile]")).toBeVisible();
    await expect(page.locator("svg[data-drawing=rolling]")).toBeVisible();
    const form = page.locator("[data-relationship-form]");
    await form.getByLabel("Compared on").selectOption("lvl");
    await form.getByLabel(/^Lag, in months/).fill("2");
    await form.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(/basis=lvl/);
    await expect(page).toHaveURL(/lag=2/);
    expect(search(page).get("s")).toBe("fx_price_index,fx_payrolls_break");
    expect(search(page).get("roll")).toBe("24");
    await expect(page.locator("[data-pair-facts]")).toContainText("Compared on levels, monthly.");
  });

  test("a second range and the marks are fields of the view form, and survive a change of pair", async ({ page, atlas }) => {
    await page.goto(atlas.url(`${PAIR}&mode=rebase&from=2024-01&to=2024-06`));
    const form = page.locator("form#explorer-view");
    await form.getByLabel("Compare with the range from").fill("2025-04");
    await form.getByLabel("Mark highest and lowest").check();
    await form.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(/cmp=2025-04/);
    await expect(page).toHaveURL(/ext=1/);
    await expect(shown(page).locator("[data-run=comparison]").first()).toBeAttached();
    await page.locator('[data-cell="fx_payrolls_break fx_price_index"]').click();
    await expect(page).toHaveURL(/sx=fx_payrolls_break/);
    expect(search(page).get("cmp")).toBe("2025-04");
    expect(search(page).get("ext")).toBe("1");
  });

  test("the export links are plain links to files", async ({ page, atlas }) => {
    await page.goto(atlas.url(PAIR));
    const csv = await page.request.get(new URL((await page.locator("[data-export=csv]").getAttribute("href"))!, atlas.origin).toString());
    expect(csv.headers()["content-disposition"]).toContain("not-for-publication.csv");
    const picture = await page.request.get(new URL((await page.locator("[data-export=png]").getAttribute("href"))!, atlas.origin).toString());
    expect(picture.headers()["content-type"]).toBe("image/svg+xml; charset=utf-8");
    expect(await picture.text()).toContain("NOT FOR PUBLICATION");
  });
});

test.describe("Explorer II: accessibility, small screens, and what must not move", () => {
  const FULL = `${PAIR},fx_output_quarterly,fx_vote_margin,fx_exchange_index&mode=rebase&from=2024-01&to=2024-12&cmp=2025-01&ext=1&roll=24&lag=2&table=1`;

  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds nothing in the ${scheme} theme with every Explorer II feature on`, async ({ page, atlas }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(atlas.url(FULL));
      await expect(page.locator("[data-guard]")).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
    });
  }

  test("at 320px nothing scrolls sideways, no drawing is shrunk and no text is under 12px", async ({ page, atlas }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(atlas.url(FULL));
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const report = await page.evaluate(() => {
      const out: string[] = [];
      for (const svg of document.querySelectorAll<SVGSVGElement>("main svg[role=img]")) {
        if (svg.getClientRects().length === 0) continue;
        const box = svg.getBoundingClientRect();
        const name = svg.dataset.drawing ?? svg.dataset.layout;
        if (box.width / svg.viewBox.baseVal.width < 0.999) out.push(`the ${name} drawing is scaled down`);
        for (const text of svg.querySelectorAll("text")) {
          const t = text.getBoundingClientRect();
          if (t.height < 12) out.push(`"${text.textContent}" is under 12px`);
          if (t.left < box.left - 0.5 || t.right > box.right + 0.5) out.push(`"${text.textContent}" in the ${name} drawing is clipped`);
        }
      }
      for (const el of document.querySelectorAll("main *")) {
        if (!el.textContent?.trim() || el.children.length > 0 || el.closest("svg")) continue;
        if (parseFloat(getComputedStyle(el).fontSize) < 12) out.push(`${el.tagName} "${el.textContent.trim().slice(0, 20)}" is under 12px`);
      }
      return out;
    });
    expect(report).toEqual([]);
  });

  test("at 360px every control of the new panels can be reached and pressed", async ({ browser, atlas }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, colorScheme: "light" });
    const page = await context.newPage();
    await page.goto(atlas.url(`${PAIR}&roll=24`));
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const controls = page.locator("#view, #snapshot, #relationships").locator("a[href], button, select, input:not([type=hidden]), summary").locator("visible=true");
    const count = await controls.count();
    expect(count).toBeGreaterThanOrEqual(20);
    for (let i = 0; i < count; i++) {
      const control = controls.nth(i);
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport({ ratio: 0.95 });
      await control.click({ trial: true, timeout: 2000 });
      const target = (await control.getAttribute("type")) === "checkbox" ? control.locator("xpath=ancestor::label") : control;
      const box = (await target.boundingBox())!;
      expect(Math.min(box.width, box.height), await control.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(24);
    }
    await context.close();
  });

  test("nothing in the snapshot, the relationships or their drawings has a transition or an animation", async ({ page, atlas }) => {
    await page.goto(atlas.url(FULL));
    const moving = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll("#snapshot table, #snapshot table *, #relationships table, #relationships table *, #relationships svg, #relationships svg *, [data-pair-answer], [data-pair-facts], [data-guard], [data-plot] [data-run], [data-plot] [data-extreme], [data-plot] [data-extreme] *")) {
        // A link in a table is a control: it may answer a press. Nothing else here may move.
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
