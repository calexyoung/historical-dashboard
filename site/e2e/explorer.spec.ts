import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./site";

/**
 * The Explorer in a real browser, on a production build under the enforced CSP, serving the
 * synthetic fixture release (PLAN section 3 and 8; M4's acceptance criteria). What v1's presets
 * and links open is tested on v1's data in Vitest (src/lib/legacy/explorer.test.tsx); here it is
 * the page itself: the address, the controls, the pin, the sheet, and what must not move.
 */
const TWO = "/explore?s=fx_price_index,fx_output_quarterly";
const shown = (page: Page) => page.locator("[data-plot] > svg[role=img]").locator("visible=true");
const drawing = (page: Page) => page.evaluate(() => [...document.querySelectorAll<SVGElement>("[data-plot] > svg[role=img]")].filter((s) => s.getClientRects().length > 0).map((s) => s.innerHTML).join("\n"));
const readoutDate = (page: Page) => page.locator("[data-readout-date]");
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

test.describe("the Explorer", () => {
  test("is the door a series page opens: the series is drawn, named and read out", async ({ page, atlas }) => {
    const problems = watch(page);
    await page.goto(atlas.url("/data/fx_price_index"));
    await page.getByRole("link", { name: "Open in Explorer →" }).click();
    await expect(page).toHaveURL(atlas.url("/explore?s=fx_price_index"));
    await expect(page.getByRole("heading", { level: 1, name: "Explore" })).toBeVisible();
    await expect(shown(page)).toHaveCount(1);
    await expect(page.locator("[data-selected=fx_price_index]")).toContainText("Fixture price index");
    await expect(readoutDate(page)).toHaveText("Dec 2025");
    await expect(page.locator("[data-readout-row=fx_price_index]")).toContainText("109.9");
    expect(problems).toEqual([]);
  });

  test("with nothing asked, says how to begin", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore"));
    await expect(page.locator("[data-empty]")).toContainText("No series is selected");
    await expect(page.getByRole("link", { name: /Choose series/ })).toBeVisible();
  });

  test("mixed units are small multiples on one time axis, each plot named", async ({ page, atlas }) => {
    await page.goto(atlas.url(TWO));
    await expect(shown(page)).toHaveCount(2);
    const axes = await page.evaluate(() => [...document.querySelectorAll<SVGSVGElement>("[data-plot] > svg[role=img]")].filter((s) => s.getClientRects().length > 0).map((s) => [s.dataset.t0, s.dataset.t1, s.dataset.x0, s.dataset.x1].join()));
    expect(new Set(axes).size).toBe(1);
    await expect(page.locator("[data-plot] [data-legend]")).toHaveCount(2);
    await page.getByLabel("Show as").selectOption("z");
    await expect(shown(page)).toHaveCount(1);
  });

  test("a change of mode is applied at once, written into the address, and undone by Back, without leaving the page", async ({ page, atlas }) => {
    await page.goto(atlas.url(TWO));
    await page.evaluate(() => ((window as unknown as { __same: boolean }).__same = true));
    const before = await drawing(page);
    await page.getByLabel("Show as").focus();
    await page.getByLabel("Show as").selectOption("rebase");
    await expect(page).toHaveURL(/mode=rebase/);
    await expect.poll(() => drawing(page)).not.toBe(before);
    await expect(page.getByLabel("Show as")).toBeFocused(); // focus stays in the field that was changed
    expect(await page.evaluate(() => (window as unknown as { __same?: boolean }).__same)).toBe(true); // no reload
    await page.goBack();
    await expect(page).toHaveURL(atlas.url(TWO));
    await expect.poll(() => drawing(page)).toBe(before);
    await expect(page.getByLabel("Show as")).toHaveValue("lin");
  });

  test("a series that does not offer the mode stays selected and is said not to be drawn, with the reason", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index,fx_price_index_yoy&mode=rebase"));
    await expect(page.locator("[data-selected=fx_price_index_yoy]")).toHaveAttribute("data-state", "not_drawn");
    await expect(page.locator("[data-not-drawn]")).toContainText("Not drawn · Fixture price index, change from a year earlier");
    await expect(page.locator("[data-not-drawn]")).toContainText("does not offer");
    await expect(page.getByLabel("Show as").locator("option[value=rebase]")).toHaveText(/1 of 2 series/);
  });

  test("the window is two month fields; a narrower window redraws the time axis", async ({ page, atlas }) => {
    await page.goto(atlas.url(TWO));
    await page.locator("input[name=from]").fill("2024-01");
    await expect(page).toHaveURL(/from=2024-01/);
    await page.locator("input[name=to]").fill("2025-06");
    await expect(page).toHaveURL(/from=2024-01&to=2025-06/);
    await expect(page.locator("#chart")).toContainText("Jan 2024 to Jun 2025");
    await expect(readoutDate(page)).toHaveText("Jun 2025");
  });
});

test.describe("a copied link reproduces the view in a fresh session", () => {
  test("Copy link gives an address that says everything outright, and it draws the same view elsewhere", async ({ page, atlas, browser }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(atlas.url(`${TWO}&mode=z&layers=rec,gov&at=2024-05-01`));
    await page.locator("[data-copy-link]").click();
    await expect(page.locator("[data-copy-link]")).toContainText("Copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(atlas.url("/explore?s=fx_price_index,fx_output_quarterly&mode=z&from=2022-01&to=2025-12&layers=rec,gov&at=2024-05-01"));
    const first = await drawing(page);
    const readout = await page.locator("[data-readout]").innerText();

    const fresh = await browser.newContext({ viewport: page.viewportSize()! }); // no cookies, no storage, no history
    const other = await fresh.newPage();
    await other.goto(copied);
    expect(await drawing(other)).toBe(first);
    expect(await other.locator("[data-readout]").innerText()).toBe(readout);
    await expect(other.getByLabel("Show as")).toHaveValue("z");
    await expect(other.getByLabel("Bands")).toHaveValue("gov");
    await fresh.close();
  });

  test("the address the page writes itself reproduces the view too", async ({ page, atlas, browser }) => {
    await page.goto(atlas.url(TWO));
    await page.getByLabel("Show as").selectOption("drawdown");
    await page.getByLabel("Recessions").uncheck();
    await expect(page).toHaveURL(/layers=ev\.policy/);
    const first = await drawing(page);
    const fresh = await browser.newContext({ viewport: page.viewportSize()! });
    const other = await fresh.newPage();
    await other.goto(page.url());
    expect(await drawing(other)).toBe(first);
    await fresh.close();
  });
});

test.describe("annotation layers", () => {
  const layer = (page: Page, name: string) => shown(page).locator(`[data-layer="${name}"]`);

  test("recessions, an event category and a set of bands each switch off and on", async ({ page, atlas }) => {
    await page.goto(atlas.url(TWO));
    await expect(layer(page, "recession")).toHaveCount(2); // one in each plot
    await expect(layer(page, "events")).toHaveCount(2);
    await expect(layer(page, "band")).toHaveCount(0);

    await page.getByLabel("Recessions").uncheck();
    await expect(layer(page, "recession")).toHaveCount(0);
    await expect(page.locator("[data-recessions]")).toHaveCount(0);

    await page.getByLabel("Economic policy").uncheck();
    await expect(layer(page, "events")).toHaveCount(0);
    await expect(page.locator("#events")).toContainText("No events in this window");
    expect(search(page).get("layers")).toBe("none"); // every box cleared stays cleared

    await page.getByLabel("Bands").selectOption("gov");
    await expect(layer(page, "band")).toHaveCount(4);
    await expect(page.locator("[data-bands]")).toContainText("Fixture head of government, first term (Fixture Party A)");

    await page.getByLabel("Recessions").check();
    await page.getByLabel("Economic policy").check();
    await expect(layer(page, "recession")).toHaveCount(2);
    await expect(layer(page, "events")).toHaveCount(2);
    await page.getByLabel("Bands").selectOption("");
    await expect(layer(page, "band")).toHaveCount(0);
    await expect(page.locator("[data-recessions]")).toContainText("1 Jul 2022 to 31 Mar 2023");
  });

  test("an event is chosen from the list, marked on the chart with its name, and let go the same way", async ({ page, atlas }) => {
    await page.goto(atlas.url(TWO));
    const event = page.getByRole("link", { name: "Fixture central bank changes its rate", exact: true });
    await event.click();
    await expect(page).toHaveURL(/event=event-2024-09-18-fixture-rate-decision/);
    await expect(layer(page, "chosen-event")).toHaveCount(2);
    await expect(event).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-event-row]")).toContainText("marked on the chart");
    await event.click();
    await expect(layer(page, "chosen-event")).toHaveCount(0);
    expect(search(page).has("event")).toBe(false);
  });
});

test.describe("the pinned readout: nothing is hover-only", () => {
  const at = async (page: Page, fraction: number) => {
    await shown(page).first().scrollIntoViewIfNeeded();
    const box = (await shown(page).first().boundingBox())!;
    return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
  };

  test("the pointer previews; a click pins, writes the date into the address, and a click in the same place lets go", async ({ page, atlas }) => {
    await page.goto(atlas.url(TWO));
    await expect(page.locator("[data-explorer-chart][data-live]")).toBeVisible();
    const height = (await page.locator("[data-readout]").boundingBox())!.height;
    const spot = await at(page, 0.5);
    await page.mouse.move(spot.x, spot.y);
    await expect(page.locator("[data-readout-status]")).toHaveText("under the pointer");
    await expect(page.locator("[data-hover-line]")).toHaveCount(2);
    expect(search(page).has("at")).toBe(false); // a preview is not state
    expect((await page.locator("[data-readout]").boundingBox())!.height).toBe(height); // the strip never changes height

    await page.mouse.click(spot.x, spot.y);
    await expect(page.locator("[data-readout-status]")).toHaveText("pinned");
    await expect(page).toHaveURL(/at=20\d\d-\d\d-\d\d/);
    const pinned = search(page).get("at")!;
    await expect(page.locator("[data-pin-line]")).toHaveCount(2);
    await page.mouse.move(0, 0);
    await expect(page.locator("[data-readout-status]")).toHaveText("pinned"); // it stays when the pointer leaves
    const words = await readoutDate(page).innerText();

    await page.reload();
    await expect(readoutDate(page)).toHaveText(words); // the pin is in the address
    expect(search(page).get("at")).toBe(pinned);

    const again = await at(page, 0.5);
    await page.mouse.click(again.x, again.y);
    await expect(page.locator("[data-readout-status]")).not.toHaveText("pinned");
    await expect.poll(() => search(page).has("at")).toBe(false);
  });

  test("from the keyboard: arrows move the pin a period at a time, Escape lets go, and focus stays on the chart", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index"));
    const chart = page.locator("[data-explorer-chart][data-live]");
    await chart.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(readoutDate(page)).toHaveText("Nov 2025");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(readoutDate(page)).toHaveText("Sep 2025");
    await expect(page.locator("[data-readout-row=fx_price_index]")).toContainText("108.4");
    await expect(page).toHaveURL(/at=2025-09-01/); // only the last of a run of keys asks the server
    await expect(chart).toBeFocused();
    await page.keyboard.press("Home");
    await expect(readoutDate(page)).toHaveText("Jan 2024");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-readout-status]")).toHaveText("latest in the window");
    await expect.poll(() => search(page).has("at")).toBe(false);
    await expect(chart).toBeFocused();
  });

  test("a tap pins too", async ({ browser, atlas }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(atlas.url("/explore?s=fx_price_index"));
    await expect(page.locator("[data-explorer-chart][data-live]")).toBeVisible();
    const spot = await at(page, 0.4);
    await page.touchscreen.tap(spot.x, spot.y);
    await expect(page.locator("[data-readout-status]")).toHaveText("pinned");
    await expect(page).toHaveURL(/at=/);
    await context.close();
  });
});

test.describe("no animation on data", () => {
  test("nothing in a drawing, the readout or the lists of layers and events has a transition or an animation, before or after a change", async ({ page, atlas }) => {
    await page.goto(atlas.url(`${TWO}&layers=rec,ev.policy,gov&at=2024-05-01`));
    const moving = () =>
      page.evaluate(() => {
        const out: string[] = [];
        const zero = (v: string) => v.split(",").every((part) => parseFloat(part) === 0);
        for (const el of document.querySelectorAll("[data-explorer-chart], [data-explorer-chart] *, [data-readout], [data-readout] *, [data-events] *, [data-bands] *, [data-recessions] *, [data-not-drawn] *")) {
          if (el.matches("a, a *")) continue; // a link answers a press (120 ms); it is a control, not data
          const style = getComputedStyle(el);
          if (!zero(style.transitionDuration) || style.animationName !== "none") out.push(`${el.tagName}.${el.getAttribute("class") ?? ""}`);
        }
        for (const animation of document.getAnimations()) {
          const target = (animation.effect as KeyframeEffect | null)?.target;
          if (target?.closest("[data-explorer-chart], [data-readout]")) out.push(`running: ${target.tagName}`);
        }
        return out;
      });
    expect(await moving()).toEqual([]);
    await page.getByLabel("Show as").selectOption("z");
    await expect(page).toHaveURL(/mode=z/);
    expect(await moving()).toEqual([]);
    await page.getByLabel("Recessions").uncheck();
    expect(await moving()).toEqual([]);
  });
});

test.describe("the series picker", () => {
  const sheet = (page: Page) => page.locator("dialog#series-picker");

  test("opens as a modal sheet, applies a ticked box at once, narrows by a word, and returns focus when shut", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index"));
    const opener = page.getByRole("link", { name: /Choose series/ });
    await opener.click();
    await expect(sheet(page)).toBeVisible();
    expect(await sheet(page).evaluate((d) => d.matches(":modal"))).toBe(true);
    await expect(page.getByRole("link", { name: "Done" })).toBeFocused(); // not the field: a phone would raise its keyboard

    await page.getByLabel("Narrow the list").fill("quarterly");
    await expect(sheet(page).getByRole("checkbox")).toHaveCount(1);
    await sheet(page).getByLabel(/Fixture output/).check();
    await expect(page).toHaveURL(/s=fx_price_index,fx_output_quarterly/);
    await expect(shown(page)).toHaveCount(2); // the chart behind has changed
    await expect(sheet(page)).toBeVisible(); // and the sheet is still open
    await page.getByLabel("Narrow the list").fill("");
    await expect(sheet(page).getByLabel(/Fixture exchange index/)).toBeDisabled(); // withheld: named, not selectable
    await expect(sheet(page)).toContainText("Withheld");

    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(opener).toContainText("2 of 8");
  });

  test("on a phone it is a sheet across the bottom; from 1024px a drawer at the side", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index"));
    await page.getByRole("link", { name: /Choose series/ }).click();
    await expect(sheet(page)).toBeVisible();
    const viewport = page.viewportSize()!;
    await expect.poll(async () => Math.round((await sheet(page).boundingBox())!.y + (await sheet(page).boundingBox())!.height)).toBe(viewport.height);
    if (viewport.width >= 1024) await expect.poll(async () => (await sheet(page).boundingBox())!.x).toBe(0); // it has arrived
    const box = (await sheet(page).boundingBox())!;
    if (viewport.width < 1024) {
      expect(box.width).toBe(viewport.width);
      expect(box.y).toBeGreaterThan(0); // the page shows above it
    } else {
      expect(box.x).toBe(0);
      expect(box.width).toBeLessThan(viewport.width / 2);
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("opened by a pointer it slides; opened from the keyboard it does not move", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index"));
    const opener = page.getByRole("link", { name: /Choose series/ });
    const durations = () => sheet(page).evaluate((d) => getComputedStyle(d).transitionDuration);
    await opener.click();
    expect(await durations()).toContain("0.24s");
    expect(await sheet(page).evaluate((d) => getComputedStyle(d).transitionProperty)).not.toContain("all");
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    expect((await durations()).split(",").every((part) => parseFloat(part) === 0)).toBe(true);
  });

  test("under reduced motion the sheet does not travel", async ({ page, atlas }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(atlas.url("/explore?s=fx_price_index"));
    await page.getByRole("link", { name: /Choose series/ }).click();
    await expect(sheet(page)).toBeVisible();
    expect(await sheet(page).evaluate((d) => getComputedStyle(d).transitionProperty)).not.toContain("transform");
  });

  test("more than four series on a phone is said, not stopped", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index,fx_output_quarterly,fx_poverty_rate_annual,fx_vote_margin,fx_payrolls_break"));
    const note = page.locator("[data-soft-cap]");
    if (page.viewportSize()!.width < 640) await expect(note).toContainText("About 4 is what a phone shows clearly");
    else await expect(note).toBeHidden();
    await expect(page.locator("[data-selection] > li")).toHaveCount(5);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("v1's hash links", () => {
  const v1 = "#sel=fx_price_index,fx_output_quarterly&mode=yoy&from=2024-01&to=2025-06&shRec=0&ev=policy";
  const want = "/explore?s=fx_price_index,fx_output_quarterly&mode=pc1&from=2024-01&to=2025-06&layers=ev.policy";

  test("open at the same view's address, from the front door and from /explore, at both base paths", async ({ page, atlas, staging }) => {
    for (const server of [atlas, staging]) {
      for (const door of ["/", "/explore"]) {
        await page.goto("about:blank");
        await page.goto(server.url(door) + v1);
        await expect(page).toHaveURL(server.url(want));
        await expect(page.getByLabel("Show as")).toHaveValue("pc1");
        await expect(page.locator("[data-selection] > li")).toHaveCount(2);
        await expect(page.getByLabel("Recessions")).not.toBeChecked();
      }
    }
  });

  test("Back does not bounce through the old link", async ({ page, atlas }) => {
    await page.goto(atlas.url("/data"));
    await page.goto(atlas.url("/explore") + v1);
    await expect(page).toHaveURL(atlas.url(want));
    await page.goBack();
    await expect(page).toHaveURL(atlas.url("/data"));
  });

  test("an ordinary fragment is left alone", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index#chart"));
    await expect(page.locator("[data-explorer-chart][data-live]")).toBeVisible();
    expect(page.url()).toBe(atlas.url("/explore?s=fx_price_index#chart"));
  });
});

test.describe("with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the view is drawn, pinned and read out from the address alone", async ({ page, atlas }) => {
    await page.goto(atlas.url(`${TWO}&mode=z&layers=rec,gov&at=2024-05-01`));
    await expect(shown(page)).toHaveCount(1);
    await expect(shown(page).locator("[data-pin]")).toHaveCount(1);
    await expect(readoutDate(page)).toHaveText("May 2024");
    await expect(page.locator("[data-readout-status]")).toHaveText("pinned");
    await expect(page.locator("[data-readout-row=fx_output_quarterly]")).toContainText("543.6");
    await expect(page.locator("[data-readout-row=fx_output_quarterly]")).toContainText("2024 Q2");
  });

  test("the form changes mode and window, keeps the series, and a form with every layer cleared stays cleared", async ({ page, atlas }) => {
    await page.goto(atlas.url(TWO));
    await page.getByLabel("Show as").selectOption("rebase");
    await page.locator("input[name=from]").fill("2024-01");
    await page.getByLabel("Recessions").uncheck();
    await page.getByLabel("Economic policy").uncheck();
    await page.getByRole("button", { name: "Show" }).click();
    const params = search(page);
    expect(params.getAll("s").join()).toBe("fx_price_index,fx_output_quarterly");
    expect(params.get("mode")).toBe("rebase");
    expect(params.get("from")).toBe("2024-01");
    await expect(page.getByLabel("Recessions")).not.toBeChecked();
    await expect(page.getByLabel("Economic policy")).not.toBeChecked();
    await expect(shown(page).locator("[data-layer]")).toHaveCount(0);
    await expect(shown(page)).toHaveCount(1);
  });

  test("the picker opens by a link, adds a series by its form, and keeps mode, window, layers and pin", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index&mode=z&from=2024-01&layers=rec&at=2024-05-01"));
    await page.getByRole("link", { name: /Choose series/ }).click();
    await expect(page).toHaveURL(/pick=1/);
    const sheet = page.locator("dialog#series-picker");
    await expect(sheet).toBeVisible();
    await sheet.getByLabel(/Fixture payrolls/).check();
    await sheet.getByRole("button", { name: "Show these series" }).click();
    const params = search(page);
    expect(params.getAll("s").filter(Boolean).join()).toBe("fx_price_index,fx_payrolls_break");
    expect([params.get("mode"), params.get("from"), params.get("layers"), params.get("at")]).toEqual(["z", "2024-01", "rec", "2024-05-01"]);
    await expect(page.locator("dialog#series-picker")).toBeHidden();
    await expect(page.locator("[data-selection] > li")).toHaveCount(2);
  });

  test("a series is removed by its link, and the table is a link away", async ({ page, atlas }) => {
    await page.goto(atlas.url(TWO));
    await expect(page.locator("[data-figure-table]")).toHaveCount(0); // not sent until asked for
    await page.locator("[data-table-toggle]").click();
    await expect(page).toHaveURL(/table=1/);
    await expect(page.locator("[data-figure-table]")).toHaveCount(2);
    await page.getByRole("link", { name: "Remove Fixture output" }).click();
    await expect(page.locator("[data-selection] > li")).toHaveCount(1);
    await expect(page.locator("[data-figure-table]")).toHaveCount(1); // and stays asked for
  });
});

test.describe("accessibility and small screens", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds nothing in the ${scheme} theme, with the sheet shut and open`, async ({ page, atlas }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(atlas.url(`${TWO},fx_exchange_index,fx_vote_margin&layers=rec,ev.policy,gov&at=2024-05-01&event=event-2024-09-18-fixture-rate-decision&table=1`));
      const scan = async () => {
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
        return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`);
      };
      expect(await scan()).toEqual([]);
      await page.getByRole("link", { name: /Choose series/ }).click();
      await expect(page.locator("dialog#series-picker")).toBeVisible();
      expect(await scan()).toEqual([]);
    });
  }

  test("at 320px nothing scrolls sideways, no drawing is shrunk and no text is under 12px", async ({ page, atlas }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(atlas.url(`${TWO},fx_vote_margin&layers=rec,ev.policy,gov&at=2024-05-01&event=event-2024-09-18-fixture-rate-decision`));
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const report = await page.evaluate(() => {
      const out: string[] = [];
      for (const svg of document.querySelectorAll<SVGSVGElement>("[data-plot] > svg[role=img]")) {
        if (svg.getClientRects().length === 0) continue;
        const box = svg.getBoundingClientRect();
        if (box.width / svg.viewBox.baseVal.width < 0.999) out.push(`the ${svg.dataset.layout} drawing is scaled down`);
        for (const text of svg.querySelectorAll("text")) {
          const t = text.getBoundingClientRect();
          if (t.height < 12) out.push(`"${text.textContent}" is under 12px`);
          if (t.left < box.left - 0.5 || t.right > box.right + 0.5) out.push(`"${text.textContent}" is clipped`);
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

  test("at 360px and at 200% zoom of a 640px window, every control can be reached and pressed", async ({ browser, atlas }) => {
    for (const size of [{ viewport: { width: 360, height: 740 } }, { viewport: { width: 320, height: 480 }, deviceScaleFactor: 2 }]) {
      const context = await browser.newContext({ ...size, colorScheme: "light" });
      const page = await context.newPage();
      await page.goto(atlas.url(`${TWO}&layers=rec,ev.policy,gov&at=2024-05-01`));
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      const controls = page.locator("main").locator("a[href], button, select, input:not([type=hidden])").locator("visible=true");
      const count = await controls.count();
      expect(count).toBeGreaterThanOrEqual(12);
      for (let i = 0; i < count; i++) {
        const control = controls.nth(i);
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport({ ratio: 0.95 }); // whole, give or take a fraction of a pixel
        await control.click({ trial: true, timeout: 2000 }); // hit-tested: not clipped, not covered
        // A checkbox's target is the label that holds it.
        const target = (await control.getAttribute("type")) === "checkbox" ? control.locator("xpath=ancestor::label") : control;
        const box = (await target.boundingBox())!;
        expect(Math.min(box.width, box.height), await control.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(24);
      }
      // And the chart is usable at this size: a control changes it.
      await page.getByLabel("Show as").selectOption("z");
      await expect(page).toHaveURL(/mode=z/);
      await expect(shown(page)).toHaveCount(1);
      await context.close();
    }
  });

  test("keyboard order follows reading order through the view: picker, copy, series, mode, window, chart, layers", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index"));
    await page.getByRole("link", { name: /Choose series/ }).focus();
    const stops: string[] = [];
    for (let i = 0; i < 16 && stops.at(-1) !== "How to read this"; i++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const el = document.activeElement!;
        return el.getAttribute("aria-label")?.slice(0, 6) ?? el.getAttribute("name") ?? (el.textContent ?? "").trim().slice(0, 24);
      });
      if (stop !== stops.at(-1)) stops.push(stop); // a month field is several stops in some browsers
    }
    expect(stops).toEqual(["Copy linkCopied", "Fixture price index", "Remove", "mode", "from", "to", "Show", "Chart.", "Preliminary", "Missing", "How to read this"]);
  });

  test("the chart's focus ring is drawn inside it", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore?s=fx_price_index"));
    await page.getByRole("button", { name: "Show" }).focus();
    await page.keyboard.press("Tab");
    const chart = page.locator("[data-explorer-chart]");
    await expect(chart).toBeFocused();
    expect(await chart.evaluate((el) => [getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineOffset])).toEqual(["solid", "-2px"]);
  });

  test("the page with eight series paints within 2.5 s on a throttled phone", async ({ browser, atlas }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(atlas.url("/explore?s=fx_price_index,fx_output_quarterly,fx_poverty_rate_annual,fx_vote_margin,fx_price_index_yoy,fx_payrolls_break,fx_permits_stale"), { waitUntil: "load" });
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
