/**
 * Test support: v1's committed output as a local-profile Release, made by the real converter
 * (`python -m atlas legacy-release`) in a temporary directory. Never imported by the app.
 *
 * These tests read v1's real values (PLAN section 9). They upload nothing, and their failure
 * messages name Series, Transforms and Periods but never print a value (PLAN 6.1).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../../../..", import.meta.url));

/** The project's Python: $ATLAS_PYTHON, else the uv environment, else whatever python3 is. */
function python(): string {
  if (process.env.ATLAS_PYTHON) return process.env.ATLAS_PYTHON;
  const venv = join(REPO, ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}

function run(args: string[], env: Record<string, string>): void {
  try {
    execFileSync(python(), args, { cwd: REPO, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const detail = (error as { stderr?: Buffer }).stderr?.toString().split("\n").slice(-6).join("\n") ?? String(error);
    throw new Error(`could not run the legacy converter (${python()} ${args.slice(0, 3).join(" ")}). Is the Python environment set up (make v2-setup)?\n${detail}`);
  }
}

export type LegacyFixture = {
  /** A release root ($ATLAS_LOCAL) holding one promoted legacy Release. */
  root: string;
  /** v1's own dataset as its page received it: atlas.json plus approval and election margins. */
  v1: V1Data;
};

export type V1Data = {
  first_month: string;
  last_month: string;
  series: Record<string, { d: string[]; v: number[] }>;
  meta: Record<string, { name: string; unit: string; freq: string; cat: string }>;
};

/** Convert v1's committed output into a fresh temporary release root. Takes a few seconds. */
export function buildLegacyRelease(): LegacyFixture {
  const dir = mkdtempSync(join(tmpdir(), "atlas-legacy-"));
  const env = { ATLAS_LOCAL: join(dir, "local"), ATLAS_PUBLIC: join(dir, "public"), ATLAS_STORE: join(dir, "store") };
  run(["-m", "atlas", "legacy-release"], env);
  // The other side of every comparison: what v1's own build step hands to v1's page.
  const v1Path = join(dir, "v1-full.json");
  run(
    [
      "-c",
      "import json, sys\n" +
        "from atlas import build as B\n" +
        "data = json.loads(B.DATA_JSON.read_text())\n" +
        "full = B.with_politics(B.with_approval(data, B.load_approval()), B.load_politics())\n" +
        "json.dump(full, open(sys.argv[1], 'w'))\n",
      v1Path,
    ],
    env,
  );
  return { root: env.ATLAS_LOCAL, v1: JSON.parse(readFileSync(v1Path, "utf8")) as V1Data };
}

export type V1Stats = {
  addM(month: string, n: number): string;
  fillSparse(a: (number | null)[], lastIdx: number, freq: string): (number | null)[];
  rebase(a: (number | null)[], i0: number, i1: number): (number | null)[];
  zscore(a: (number | null)[], i0: number, i1: number): (number | null)[];
  yoy(a: (number | null)[], i0: number, i1: number): (number | null)[];
  drawdown(a: (number | null)[], i0: number, i1: number): (number | null)[];
  window(a: (number | null)[], i0: number, i1: number): (number | null)[];
};

/** v1's shipped statistics module, web/stats.js, loaded as it is. */
export function v1Stats(): V1Stats {
  return createRequire(import.meta.url)(join(REPO, "web", "stats.js")) as V1Stats;
}
