import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./site";

const ground = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT = "rgb(255, 255, 255)";
const DARK = "rgb(15, 19, 24)";

test.describe("the theme follows the OS, and the control overrides it and persists", () => {
  test("light OS gives the light theme; dark OS gives the dark theme", async ({ page, atlas }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(atlas.url("/explore"));
    expect(await ground(page)).toBe(LIGHT);
    await expect(page.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await ground(page)).toBe(DARK); // follows a change of the OS setting at once
  });

  test("Dark overrides a light OS, survives a reload and a new tab, and Auto hands back to the OS", async ({ page, context, atlas }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(atlas.url("/explore"));
    await page.getByRole("button", { name: "Dark" }).click();
    expect(await ground(page)).toBe(DARK);
    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(page.url()).toBe(atlas.url("/explore")); // applied in place, no navigation

    await page.reload();
    expect(await ground(page)).toBe(DARK);
    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");

    const second = await context.newPage();
    await second.emulateMedia({ colorScheme: "light" });
    await second.goto(atlas.url("/explore"));
    expect(await ground(second)).toBe(DARK);
    await second.close();

    await page.getByRole("button", { name: "Auto" }).click();
    expect(await ground(page)).toBe(LIGHT);
    await page.reload();
    expect(await ground(page)).toBe(LIGHT);
  });

  test("Light overrides a dark OS", async ({ page, atlas }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(atlas.url("/explore"));
    await page.getByRole("button", { name: "Light" }).click();
    expect(await ground(page)).toBe(LIGHT);
    await page.reload();
    expect(await ground(page)).toBe(LIGHT);
  });

  test("the override at one base path does not leak to the other", async ({ page, atlas, staging }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(atlas.url("/explore"));
    await page.getByRole("button", { name: "Dark" }).click();
    // Cookies ignore ports, so the two local builds share a cookie jar, as the two paths do on one domain.
    await page.goto(staging.url("/explore"));
    expect(await ground(page)).toBe(LIGHT);
  });
});

test.describe("with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("the page is complete and the theme control still works", async ({ page, atlas }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(atlas.url("/explore?x=1"));
    await expect(page.getByRole("heading", { level: 1, name: "Explore" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Fixture price index fx_price_index\b/ })).toBeVisible();
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page).toHaveURL(atlas.url("/explore?x=1"));
    expect(await ground(page)).toBe(DARK);
    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("the enforced Content Security Policy does not break the page (ADR 0013)", () => {
  test("the page hydrates and nothing is blocked, at both base paths", async ({ page, atlas, staging }) => {
    for (const server of [atlas, staging]) {
      const problems: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" || /content security policy/i.test(message.text())) problems.push(message.text());
      });
      page.on("pageerror", (error) => problems.push(String(error)));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
      });
      await page.goto(server.url("/"));
      await expect(page).toHaveURL(server.url("/explore"));
      // Hydrated: the control changes the theme without a navigation.
      await page.getByRole("button", { name: "Dark" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.getByRole("button", { name: "Auto" }).click();
      expect(problems).toEqual([]);
      page.removeAllListeners();
    }
  });

  test("markup injected into the page cannot run script", async ({ page, atlas }) => {
    // What the policy is for: text that reaches the page as HTML. (A script element built by an
    // already-trusted script is allowed by 'strict-dynamic'; that is not the attack.)
    await page.goto(atlas.url("/explore"));
    const ran = await page.evaluate(
      () =>
        new Promise<{ ran: boolean; blocked: string[] }>((resolve) => {
          const blocked: string[] = [];
          document.addEventListener("securitypolicyviolation", (e) => blocked.push(e.violatedDirective));
          const holder = document.createElement("div");
          holder.innerHTML = '<img src="data:image/gif;base64,AA" onerror="window.__injected = true"><a id="js-link" href="javascript:window.__injected = true">x</a>';
          document.body.appendChild(holder);
          (holder.querySelector("#js-link") as HTMLAnchorElement).click();
          setTimeout(() => resolve({ ran: (window as unknown as { __injected?: boolean }).__injected === true, blocked }), 300);
        }),
    );
    expect(ran.ran).toBe(false);
    expect(ran.blocked.length).toBeGreaterThan(0);
  });
});

test.describe("accessibility and layout", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds nothing in the ${scheme} theme`, async ({ page, atlas }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(atlas.url("/explore"));
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
    });
  }

  test("axe finds nothing on the 404 page", async ({ page, atlas }) => {
    await page.goto(atlas.url("/nowhere"));
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test("no horizontal page scroll at 320px, and nothing under 12px", async ({ page, atlas }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(atlas.url("/explore"));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const smallest = await page.evaluate(() => {
      let min = Infinity;
      for (const el of document.querySelectorAll("body *")) {
        if (!el.textContent?.trim() || el.children.length > 0) continue;
        min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
      }
      return min;
    });
    expect(smallest).toBeGreaterThanOrEqual(12);
  });

  test("keyboard order follows reading order, starting with the skip link", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore"));
    const stops: string[] = [];
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press("Tab");
      stops.push(await page.evaluate(() => (document.activeElement?.textContent ?? "").trim()));
    }
    expect(stops).toEqual(["Skip to content", "mydashboards", "Macro Atlas", "Explore", "Auto", "Light", "Dark"]);
    await page.keyboard.press("Shift+Tab");
    // The skip link is visible when focused and moves focus to the content.
    await page.goto(atlas.url("/explore"));
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });

  test("the freshness mark is a shape and a word, not colour alone", async ({ page, atlas }) => {
    await page.goto(atlas.url("/explore"));
    const mark = page.locator("[data-freshness]");
    await expect(mark).toHaveAttribute("data-freshness", "stale"); // the fixture release is from January 2026
    await expect(mark).toContainText("Stale");
    await expect(mark.locator("svg")).toHaveCount(1);
  });

  test("the phone layout keeps every control reachable at 200% zoom of a 640px window", async ({ page, atlas }) => {
    await page.setViewportSize({ width: 320, height: 480 }); // 640 CSS px at 200%
    await page.goto(atlas.url("/explore"));
    for (const name of ["Auto", "Light", "Dark"]) await expect(page.getByRole("button", { name })).toBeVisible();
    await expect(page.getByRole("link", { name: "Explore" }).first()).toBeVisible();
  });
});
