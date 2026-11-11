/** What a build may be, and what it may contain (PLAN 6.1 points 1 and 5; ADRs 0013, 0014). */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_ID, FIXTURE_ROOT } from "@/lib/release/testing";
import { JS_BUDGET, measureJs } from "../../scripts/measure-js.mjs";
import { distDir, nextBuild, SITE, startVariant, VARIANTS, type Running, type VariantName } from "./builds";

describe("a build with no Surface, or one that does not match its base path, fails", () => {
  it.each([
    [{}, /ATLAS_SURFACE is not set/],
    [{ BASE_PATH: "/macro-atlas" }, /ATLAS_SURFACE is not set/],
    [{ ATLAS_SURFACE: "production" }, /BASE_PATH is not set/],
    [{ ATLAS_SURFACE: "production", BASE_PATH: "/macro-atlas-staging" }, /production surface is served at \/macro-atlas/],
    [{ ATLAS_SURFACE: "staging", BASE_PATH: "/macro-atlas" }, /staging surface is served at \/macro-atlas-staging/],
    [{ ATLAS_SURFACE: "public", BASE_PATH: "/macro-atlas" }, /unknown surface/],
  ])("next build with %j exits non-zero", (config, message) => {
    const result = nextBuild({ ...config, ATLAS_DIST_DIR: ".builds/refused" });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(message);
  });
});

function* filesUnder(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* filesUnder(full);
    else if (entry.isFile()) yield full;
  }
}

describe("nothing from a Release is in the build output", () => {
  // Builds are given no release root, and every page renders at request time. The needles are a
  // release id and values that exist only inside the fixture's files.
  const series = readFileSync(join(FIXTURE_ROOT, "releases", FIXTURE_ID, "catalog.json"), "utf8");
  const needles = [FIXTURE_ID, "Fixture price index", "fx_price_index"];

  it("the needles are really in the fixture", () => {
    for (const needle of needles.slice(1)) expect(series).toContain(needle);
  });

  it.each(Object.keys(VARIANTS) as VariantName[])("%s", (name) => {
    let scanned = 0;
    for (const file of filesUnder(join(SITE, distDir(name)))) {
      if (file.includes("/node_modules/") || file.includes("/cache/")) continue;
      const text = readFileSync(file, "latin1");
      for (const needle of needles) expect(text.includes(needle), `${needle} in ${file}`).toBe(false);
      scanned++;
    }
    expect(scanned).toBeGreaterThan(20);
  });
});

describe("the Content Security Policy is enforced with a nonce (ADR 0013)", () => {
  let server: Running;
  beforeAll(async () => {
    server = await startVariant("production", { root: FIXTURE_ROOT });
  });
  afterAll(() => server.stop());

  it("every script on the page carries this response's nonce, and no policy allows inline script", async () => {
    const response = await fetch(server.url("/explore"));
    expect(response.headers.get("content-security-policy-report-only")).toBeNull();
    const policy = response.headers.get("content-security-policy")!;
    const nonce = /'nonce-([^']+)'/.exec(policy)![1]!;
    const scriptSrc = policy.split("; ").find((d) => d.startsWith("script-src "))!;
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
    const html = await response.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
    expect(html).not.toMatch(/<style\b/); // no inline style elements at all
    expect(html).not.toMatch(/\son[a-z]+="/); // no inline event handlers
    expect(html).not.toMatch(/https?:\/\/(?!mydashboards\.co\/)[a-z0-9.-]+\//); // nothing from another origin
  });

  it("the nonce is new for every response", async () => {
    const nonces = await Promise.all(
      [1, 2, 3].map(async () => /'nonce-([^']+)'/.exec((await fetch(server.url("/explore"))).headers.get("content-security-policy")!)![1]),
    );
    expect(new Set(nonces).size).toBe(3);
  });

  it("static assets and the 404 page carry the policy too", async () => {
    for (const path of ["/icon.svg", "/nowhere"]) {
      expect((await fetch(server.url(path))).headers.get("content-security-policy")).toContain("script-src 'self' 'nonce-");
    }
  });

  it("a series page and the glossary are reading pages: within the same budget, and they add no script of their own (ADR 0014)", async () => {
    const shell = await measureJs(server.url("/explore"));
    for (const path of ["/data/fx_price_index", "/docs/glossary"]) {
      const measured = await measureJs(server.url(path));
      expect(measured.gzipBytes, path).toBeLessThanOrEqual(JS_BUDGET.budgetBytes);
      expect(measured.gzipBytes, path).toBeLessThanOrEqual(shell.gzipBytes);
    }
  });

  it("the JavaScript a reading page loads is within the budget (ADR 0014)", async () => {
    const measured = await measureJs(server.url("/explore"));
    expect(measured.scripts).toBeGreaterThan(0);
    expect(measured.gzipBytes).toBeLessThanOrEqual(JS_BUDGET.budgetBytes);
    // The budget is the floor plus 15 KB, and the floor is still about what Next ships.
    expect(JS_BUDGET.budgetBytes).toBe(JS_BUDGET.floorBytes + 15 * 1024);
    expect(Math.abs(measured.frameworkGzipBytes - JS_BUDGET.floorBytes)).toBeLessThan(0.1 * JS_BUDGET.floorBytes);
  });
});
