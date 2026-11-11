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
import { REPO } from "../legacy/testing";
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
    expect(release.catalog.series.map((entry) => entry.representation)).toEqual(["native", "native"]);
  });

  it("passes the reader's own guard for a public Surface: public profile, signed reference, nothing legacy", async () => {
    const opened = await createReleaseReader({ root, surface: "production" }).current();
    expect(opened.ok).toBe(true);
  });

  it("goes on being served to a request that opened it before retention moved it to the trash", async () => {
    const reader = createReleaseReader({ root, surface: "local" });
    const before = await reader.open(id);
    expect(before.ok).toBe(true);
    // What the writer's retention does: one rename into trash/, never a delete in place.
    mkdirSync(join(root, "trash"), { recursive: true });
    renameSync(join(root, "releases", id), join(root, "trash", id));
    const after = await reader.open(id);
    expect(after.ok && after.release.series.fx_jobs!.observations.length).toBe(3);
    renameSync(join(root, "trash", id), join(root, "releases", id));
  });
});
