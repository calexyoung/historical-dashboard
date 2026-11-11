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
  /** v1's Events as its page received them, in v1's order. */
  events: { month: string; day?: number; title: string; cat: string; url?: string }[];
  /** v1's presidential terms and its other band sets: [from, to (exclusive), name, style]. */
  pres: [string, string, string, string][];
  bands: Record<string, { source?: string; rows: [string, string, string, string][] }>;
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
        // What v1's build step injects beside the data: EVENTS, PRES and BANDS (atlas/build.py).
        "full['events'] = B.load_events()\n" +
        "full['pres'] = B.load_approval()['terms']\n" +
        "full['bands'] = B.load_politics()['bands']\n" +
        "json.dump(full, open(sys.argv[1], 'w'), default=str)\n",
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
  changes(a: (number | null)[]): (number | null)[];
  pearson(x: (number | null)[], y: (number | null)[], i0: number, i1: number, lag?: number): { r: number | null; n: number };
  rollingCorr(x: (number | null)[], y: (number | null)[], i0: number, i1: number, w: number): (number | null)[];
};

/** v1's shipped statistics module, web/stats.js, loaded as it is. */
export function v1Stats(): V1Stats {
  return createRequire(import.meta.url)(join(REPO, "web", "stats.js")) as V1Stats;
}

type Arr = (number | null)[];

/** v1's page, as far as transforms go: web/app.js lines 19 to 39 and `transform()`, verbatim in substance. */
export function v1Page(DB: V1Data, Stats: V1Stats) {
  const MONTHS: string[] = [];
  for (let m = DB.first_month; m <= DB.last_month; m = Stats.addM(m, 1)) MONTHS.push(m);
  const MI: Record<string, number> = Object.fromEntries(MONTHS.map((m, i) => [m, i]));
  const series = (k: string): Arr => {
    const a: Arr = new Array<number | null>(MONTHS.length).fill(null);
    const s = DB.series[k]!;
    for (let i = 0; i < s.d.length; i++) {
      const j = MI[s.d[i]!];
      if (j !== undefined) a[j] = s.v[i]!;
    }
    return a;
  };
  const isSparse = (k: string) => DB.series[k]!.d.length < MONTHS.length * 0.5;
  const lastIdx = (k: string) => MI[DB.series[k]!.d.at(-1)!] ?? MONTHS.length - 1;
  const sparseFreq = (k: string) =>
    DB.meta[k]!.freq === "E" ? "E" : DB.meta[k]!.freq === "A" || DB.series[k]!.d.length < 40 ? "A" : "Q";
  const plotRaw = (k: string) => (isSparse(k) ? Stats.fillSparse(series(k), lastIdx(k), sparseFreq(k)) : series(k));
  function transformV1(k: string, mode: string, i0: number, i1: number): Arr {
    const a = mode === "raw" || mode === "log" || (isSparse(k) && sparseFreq(k) === "E") ? plotRaw(k) : series(k);
    let out: Arr;
    if (mode === "rebase") out = Stats.rebase(a, i0, i1);
    else if (mode === "z") out = Stats.zscore(a, i0, i1);
    else if (mode === "yoy") out = Stats.yoy(a, i0, i1);
    else if (mode === "dd") out = Stats.drawdown(a, i0, i1);
    else out = Stats.window(a, i0, i1);
    if (mode === "log") out = out.map((v) => (v != null && v > 0 ? v : null));
    if (mode !== "raw" && mode !== "log" && isSparse(k)) {
      out = Stats.fillSparse(out, Math.min(lastIdx(k), i1), sparseFreq(k));
      for (let i = i1 + 1; i < out.length; i++) out[i] = null;
    }
    return out;
  }
  return { MI, MONTHS, transformV1, observed: series, isSparse };
}
