/**
 * The Release contract across the two languages (PLAN section 9, "Release contract"): a Release
 * written by the Python release writer (M9) from the vintage fixture is opened by this reader.
 *
 * The values are invented and the Origin is made up (fixtures/vintage); the release is written
 * by the real commands into a temporary directory under the fixture's own test register.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { SEMANTICS_VERSION } from "@macro-atlas/core";
import { REPO } from "../legacy/testing";
import { asOf, derivedAsOf } from "./as-of";
import { createReleaseReader } from "./reader";

let root: string;
let id: string;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-python-release-"));
  const venv = join(REPO, ".venv", "bin", "python");
  const python = process.env.ATLAS_PYTHON ?? (existsSync(venv) ? venv : "python3");
  execFileSync(python, [join(REPO, "fixtures", "release", "demo.py"), "--out", dir, "--quiet"], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
  });
  root = join(dir, "public");
  id = readFileSync(join(root, "CURRENT"), "utf8").trim();
}, 60_000);

describe("a Release written by the Python release writer", () => {
  it("is opened by the TypeScript reader as the current Release", async () => {
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    const { release } = opened;
    expect(release.id).toBe(id);
    expect(release.manifest.profile).toBe("public");
    expect(Object.keys(release.series).sort()).toEqual(["fx_jobs", "fx_price"]);
    // The source stopped listing February: an explicit missing Observation, not a hole.
    expect(release.series.fx_price!.observations.map((o) => [o.period, o.value, o.status])).toEqual([
      ["2026-01", 100, "final"],
      ["2026-02", null, "missing"],
      ["2026-03", 100.9, "final"],
      ["2026-04", 101.3, "final"],
    ]);
    expect(release.catalog.series.map((entry) => entry.representation)).toEqual(["native", "native", "native", "native"]);
  });

  it("holds the Derived series the engine computed in the Node step, and answers as-of for them", async () => {
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    const { release } = opened;
    expect(Object.keys(release.derived).sort()).toEqual(["fx_jobs_per_price", "fx_price_change"]);
    expect(release.manifest.semantics_version).toBe(SEMANTICS_VERSION);
    // April on March, 101.3 against 100.9. The file is what the engine gives for the Release's own state.
    const file = release.derived.fx_price_change!.observations;
    expect(file.map((o) => o.period)).toEqual(["2026-04"]);
    expect(file[0]!.value).toBeCloseTo((101.3 / 100.9 - 1) * 100, 12);
    expect(derivedAsOf(release, "fx_price_change", null)!.observations).toEqual(file);
    // On 15 April February was still listed (100.4) and April was not: March on February.
    const april = derivedAsOf(release, "fx_price_change", "2026-04-15")!;
    expect(april.basis).toBe("uncertain");
    expect(april.observations.map((o) => o.period)).toEqual(["2026-02", "2026-03"]);
    expect(april.observations[1]!.value).toBeCloseTo((100.9 / 100.4 - 1) * 100, 12);
    // Before the first Capture there is no answer, and so no figure of today's.
    expect(derivedAsOf(release, "fx_jobs_per_price", "2026-03-10")).toMatchObject({ basis: "unavailable", observations: [] });
    expect(derivedAsOf(release, "fx_price", null)).toBeNull(); // a stored Series: asOf() answers
  });

  it("carries the store's history, and the engine answers as-of questions from it", async () => {
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    const { release } = opened;
    expect(Object.keys(release.vintages).sort()).toEqual(["fx_jobs", "fx_price"]);
    // fixtures/vintage: fetched 10 March, 10 April (March added) and 12 May (April added,
    // February withdrawn). Five days after the April fetch, with no Capture in between:
    const april = asOf(release, "fx_price", "2026-04-15")!;
    expect(april.observations.map((o) => [o.period, o.value, o.status])).toEqual([
      ["2026-01", 100, "final"],
      ["2026-02", 100.4, "final"],
      ["2026-03", 100.9, "final"],
    ]);
    expect([april.basis, april.capture_gap?.missed_days]).toEqual(["uncertain", 4]);
    // The morning after the May fetch: Atlas-observed, and that is the Release's own state.
    const may = asOf(release, "fx_price", "2026-05-13")!;
    expect(may.basis).toBe("atlas_observed");
    expect(may.observations.map((o) => [o.period, o.value, o.status])).toEqual(
      release.series.fx_price!.observations.map((o) => [o.period, o.value, o.status]),
    );
    // The first print of January's jobs figure, before April's revision.
    expect(asOf(release, "fx_jobs", "2026-03-11")!.observations[0]).toMatchObject({ value: 150000, status: "preliminary" });
    expect(asOf(release, "fx_jobs", "2026-03-10")).toMatchObject({ basis: "unavailable", observations: [] });
  });

  it("passes the reader's own guard for a public Surface: public profile, signed reference, nothing legacy", async () => {
    const opened = await createReleaseReader({ root, surface: "production" }).current();
    expect(opened.ok).toBe(true);
  });

  it("is let go by a running reader the moment a withdrawal retires it", async () => {
    const reader = createReleaseReader({ root, surface: "production" });
    const before = await reader.open(id);
    if (!before.ok) throw new Error(before.reason);
    // What `atlas withdraw` does to every Release that holds the Series: out of the root.
    const elsewhere = join(root, "..", "retired");
    mkdirSync(elsewhere, { recursive: true });
    renameSync(join(root, "releases", id), join(elsewhere, id));
    try {
      const after = await reader.open(id);
      expect(after.ok).toBe(false);
      expect(!after.ok && after.kind).toBe("unavailable");
      expect((await reader.current()).ok).toBe(false);
    } finally {
      renameSync(join(elsewhere, id), join(root, "releases", id));
    }
  });
});
