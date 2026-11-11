import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReleaseReader, refusal } from "./reader";
import { addRelease, FIXTURE_ID, FIXTURE_ROOT, promote, tempRoot } from "./testing";

const A = "20260201T000000Z-aaaaaaa";
const B = "20260202T000000Z-bbbbbbb";

describe("ReleaseReader.current: the promoted Release, validated on open", () => {
  it("opens the fixture release named by CURRENT", async () => {
    const reader = createReleaseReader({ root: FIXTURE_ROOT, surface: "local" });
    const opened = await reader.current();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.release.id).toBe(FIXTURE_ID);
    expect(opened.release.manifest.profile).toBe("public");
    expect(opened.release.catalog.series.map((s) => s.key)).toContain("fx_price_index");
    expect(opened.release.series.fx_price_index?.observations.length).toBeGreaterThan(0);
    expect(opened.release.derived.fx_price_index_yoy).toBeDefined();
    expect(opened.refreshFailed).toBeNull();
  });

  it("follows CURRENT when it is rewritten, with no restart", async () => {
    const root = tempRoot();
    addRelease(root, { id: A });
    addRelease(root, { id: B });
    promote(root, A);
    const reader = createReleaseReader({ root, surface: "local" });
    expect(await reader.current()).toMatchObject({ ok: true, release: { id: A } });
    promote(root, B);
    expect(await reader.current()).toMatchObject({ ok: true, release: { id: B } });
  });

  it("caches by release id: an immutable release is read and validated once", async () => {
    const root = tempRoot();
    const dir = addRelease(root, { id: A });
    promote(root, A);
    const reader = createReleaseReader({ root, surface: "local" });
    const first = await reader.current();
    rmSync(dir, { recursive: true }); // gone from disk; the opened release is still served
    const second = await reader.current();
    expect(second.ok && first.ok && second.release).toBe(first.ok && first.release);
  });

  it("is unavailable when there is no CURRENT", async () => {
    const reader = createReleaseReader({ root: tempRoot(), surface: "local" });
    expect(await reader.current()).toMatchObject({ ok: false, kind: "unavailable", id: null });
  });

  it("does not follow a CURRENT that is not a release id", async () => {
    const root = tempRoot();
    addRelease(root, { id: A });
    writeFileSync(join(root, "CURRENT"), "../../etc\n");
    const reader = createReleaseReader({ root, surface: "local" });
    expect(await reader.current()).toMatchObject({ ok: false, kind: "unavailable" });
  });

  it("refuses a release that breaks the contract, naming the first issue", async () => {
    const root = tempRoot();
    const dir = addRelease(root, { id: A });
    writeFileSync(join(dir, "series", "fx_price_index.json"), "{}");
    promote(root, A);
    const reader = createReleaseReader({ root, surface: "local" });
    const opened = await reader.current();
    expect(opened).toMatchObject({ ok: false, kind: "invalid", id: A });
    expect(!opened.ok && opened.reason).toMatch(/series\/fx_price_index\.json/);
  });
});

describe("ReleaseReader: the failed-refresh state", () => {
  it("keeps serving the last good release when CURRENT moves to a broken one, and says so", async () => {
    const root = tempRoot();
    addRelease(root, { id: A });
    const broken = addRelease(root, { id: B });
    writeFileSync(join(broken, "catalog.json"), "not json");
    promote(root, A);
    const reader = createReleaseReader({ root, surface: "local" });
    await reader.current();
    promote(root, B);
    const opened = await reader.current();
    expect(opened).toMatchObject({ ok: true, release: { id: A }, refreshFailed: { id: B, kind: "invalid" } });
  });

  it("keeps serving the last good release when CURRENT disappears", async () => {
    const root = tempRoot();
    addRelease(root, { id: A });
    promote(root, A);
    const reader = createReleaseReader({ root, surface: "local" });
    await reader.current();
    rmSync(join(root, "CURRENT"));
    expect(await reader.current()).toMatchObject({ ok: true, release: { id: A }, refreshFailed: { kind: "unavailable" } });
  });
});

describe("ReleaseReader on a public Surface fails closed (PLAN 6.1 point 5, reader)", () => {
  const cases = [
    ["a local-profile release", { profile: "local" }, /profile is "local"/],
    ["an unsigned rights register", { profile: "local", signed: false }, /profile is "local"/],
    ["a legacy series", { profile: "local", legacy: "fx_price_index" }, /profile is "local"/],
  ] as const;

  for (const surface of ["production", "staging"] as const) {
    it.each(cases)(`${surface} refuses %s`, async (_name, variant, reason) => {
      const root = tempRoot();
      addRelease(root, { id: A, ...variant });
      promote(root, A);
      const opened = await createReleaseReader({ root, surface }).current();
      expect(opened).toMatchObject({ ok: false, kind: "refused", id: A });
      expect(!opened.ok && opened.reason).toMatch(reason);
    });

    it(`${surface} serves the public-profile fixture`, async () => {
      const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface }).current();
      expect(opened.ok).toBe(true);
    });

    it(`${surface} never falls back from a refused release to an earlier good one`, async () => {
      const root = tempRoot();
      addRelease(root, { id: A });
      addRelease(root, { id: B, profile: "local" });
      promote(root, A);
      const reader = createReleaseReader({ root, surface });
      expect((await reader.current()).ok).toBe(true);
      promote(root, B);
      expect(await reader.current()).toMatchObject({ ok: false, kind: "refused", id: B });
    });
  }

  it("the local surface serves a local-profile release with a legacy series", async () => {
    const root = tempRoot();
    addRelease(root, { id: A, profile: "local", signed: false, legacy: "fx_price_index" });
    promote(root, A);
    expect((await createReleaseReader({ root, surface: "local" }).current()).ok).toBe(true);
  });
});

describe("ReleaseReader.open: a release by id (pinned or rolled back)", () => {
  it("applies the same guard to any release it opens", async () => {
    const root = tempRoot();
    addRelease(root, { id: A });
    addRelease(root, { id: B, profile: "local" });
    promote(root, A);
    const reader = createReleaseReader({ root, surface: "production" });
    expect((await reader.open(A)).ok).toBe(true);
    expect(await reader.open(B)).toMatchObject({ ok: false, kind: "refused" });
  });

  it("does not touch the filesystem for something that is not a release id", async () => {
    const reader = createReleaseReader({ root: FIXTURE_ROOT, surface: "local" });
    expect(await reader.open("../public")).toMatchObject({ ok: false, kind: "unavailable" });
    expect(await reader.open("20260101T000000Z-0000000/../x")).toMatchObject({ ok: false, kind: "unavailable" });
  });
});

describe("refusal: each condition of the Surface guard on its own", () => {
  const load = async (variant: Omit<Parameters<typeof addRelease>[1], "id">) => {
    const root = tempRoot();
    addRelease(root, { id: A, profile: "local", ...variant });
    promote(root, A);
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    // What the validator would never pass: the same content claiming to be public.
    return { ...opened.release, manifest: { ...opened.release.manifest, profile: "public" as const } };
  };

  it("refuses an unsigned rights register on a public surface", async () => {
    const release = await load({ signed: false });
    expect(refusal(release, "production")).toMatch(/signed rights register/);
    expect(refusal(release, "staging")).toMatch(/signed rights register/);
    expect(refusal(release, "local")).toBeNull();
  });

  it("refuses a legacy series on a public surface, naming it", async () => {
    const release = await load({ legacy: "fx_price_index" });
    expect(refusal(release, "production")).toMatch(/legacy representation \(fx_price_index\)/);
    expect(refusal(release, "local")).toBeNull();
  });

  it("allows a signed, native, public-profile release", async () => {
    expect(refusal(await load({}), "production")).toBeNull();
  });
});

describe("ReleaseReader: a release that breaks the interim data rule is refused, never 'merely invalid'", () => {
  // The validator reports these as contract issues. If the reader called them "invalid" it would
  // fall back to the last good release and keep answering 200 (Codex, M1 plan review).
  const mislabelled = [
    ["public profile, unsigned register", { signed: false }],
    ["public profile, a legacy series", { legacy: "fx_price_index" }],
  ] as const;

  it.each(mislabelled)("production: %s is refused even after a good release was served", async (_n, variant) => {
    const root = tempRoot();
    addRelease(root, { id: A });
    addRelease(root, { id: B, ...variant });
    promote(root, A);
    const reader = createReleaseReader({ root, surface: "production" });
    expect((await reader.current()).ok).toBe(true);
    promote(root, B);
    expect(await reader.current()).toMatchObject({ ok: false, kind: "refused", id: B });
  });

  it("production: a local-profile release that is also broken is refused, not treated as a failed refresh", async () => {
    const root = tempRoot();
    addRelease(root, { id: A });
    const dir = addRelease(root, { id: B, profile: "local" });
    writeFileSync(join(dir, "series", "fx_price_index.json"), "{}");
    promote(root, A);
    const reader = createReleaseReader({ root, surface: "production" });
    await reader.current();
    promote(root, B);
    expect(await reader.current()).toMatchObject({ ok: false, kind: "refused", id: B });
  });
});
