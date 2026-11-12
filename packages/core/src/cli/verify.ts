/**
 * `atlas-core verify --release STAGED`: the Node step of the publisher (PLAN 4.2, 4.4 step 4;
 * ADR 0002, ADR 0003, ADR 0025). Python stages a Release's Catalog and stored Series and says
 * which Derived series to compute (`engine-request.json`); this computes them with the one
 * engine and writes
 *
 *     STAGED/derived/{key}.json     one per Derived series that has a value
 *     STAGED/engine-report.json     what was written (with hashes), what came out empty, the checks
 *
 *     STAGED/evidence/latest.json   the latest Evidence row of every locked Reading, and the drift
 *
 * and nothing else, anywhere. The last is written when the request names Claim locks
 * (`claims`: paths of lock files in STAGED): for each Reading of each lock, the *latest* row on
 * this Release, and where it, or the *then* row computed again, is no longer the locked one
 * (ADR 0034). Drift fails nothing: only a person re-locks. Every file is created new: an existing file or a link in its
 * place is a failure, never something to write through. Python reads the result back, checks
 * it again and alone promotes.
 *
 * Node only (it reads and writes files), so it is no part of the package's main entry.
 * Exit status: 0 done; 1 a check failed (the report says which); 2 the command could not be
 * followed, and nothing was written.
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from "node:fs";
import { join } from "node:path";
import { claimDrift, evidenceRow, readingsLineage, resolveReading, type ClaimReading, type DriftEntry, type EvidenceRow, type LockedReading, type ResolvedReading } from "../claim";
import { evaluateRecipe, type RecipeSeries } from "../recipe";
import { releaseSource } from "./source";
import { SEMANTICS_VERSION } from "../transform";
import type { ResolveSeries } from "../vintage";

const USAGE = "usage: atlas-core verify --release STAGED [--spot FILE]";
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const REQUEST = "engine-request.json";
const REPORT = "engine-report.json";
const LATEST = "evidence/latest.json";
const LOCK = /^locks\/[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*\.v[1-9][0-9]{0,3}\.lock\.json$/;

type Lock = { claim_id: string; version: number; record: { said_on: string; said_at?: string; readings: ClaimReading[] }; readings: LockedReading[] };
type LatestReading = { id: string; latest: EvidenceRow | null; refused: { reason: string; message: string } | null; drift: DriftEntry[] };

/** The latest rows of one lock's Readings on the staged Release, and their drift. */
function latestOf(lock: Lock, root: string) {
  const source = releaseSource(root, "staged");
  const resolved: ResolvedReading[] = [];
  const readings: LatestReading[] = lock.record.readings.map((reading) => {
    const locked = lock.readings.find((one) => one.id === reading.id)!;
    const result = resolveReading(reading, source.catalog);
    if (!result.ok) {
      // This Release cannot measure the Reading at all (the Series is gone from it, or is v1's here).
      const refused = { reason: result.reason, message: result.message };
      const gone = (kind: DriftEntry["kind"], was: EvidenceRow): DriftEntry => ({ kind, window: null, figure: null, field: "availability", locked: was.unavailable?.reason ?? null, now: result.reason });
      return { id: reading.id, latest: null, refused, drift: [gone("latest_differs", locked.now_when_checked), gone("then_differs", locked.then)] };
    }
    resolved.push(result.resolved);
    const latest = evidenceRow(reading, source, { state: "latest", asOf: null });
    const thenAgain = evidenceRow(reading, source, { state: "then", asOf: lock.record.said_at ?? lock.record.said_on });
    return { id: reading.id, latest, refused: null, drift: claimDrift(locked, latest, thenAgain) };
  });
  return { claim_id: lock.claim_id, lock_version: lock.version, rights_used: readingsLineage(resolved, source), readings };
}

type Check = { check: string; outcome: "pass" | "fail" | "not_checked"; detail?: string; /** Why a spot was not checked. */ reason?: "no_series" | "no_value" };
type Spot = { key: string; period: string; value: number; tolerance: number; source?: string; url?: string };

class Refused extends Error {}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** A real directory at exactly this path: not a link, and not reached through one. */
function realDirectory(path: string, parent: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(path) !== join(parent, path.slice(parent.length + 1))) {
    throw new Refused(`${path} is a link or not a directory; nothing is written through it`);
  }
}

/** Create a file that does not exist yet. A file or link already there is refused (O_EXCL). */
function createNew(path: string, text: string): void {
  let handle: number;
  try {
    handle = openSync(path, "wx", 0o644);
  } catch (error) {
    throw new Refused(`${path} could not be created new (${(error as NodeJS.ErrnoException).code}); nothing is written over a file or through a link`);
  }
  try {
    writeSync(handle, text);
  } finally {
    closeSync(handle);
  }
}

function verify(release: string, spotPath: string | null): number {
  const root = realpathSync(release);
  const checks: Check[] = [];
  const derived: Record<string, { sha256: string; observations: number; period_start: string; period_end: string; rights_status: string }> = {};
  const empty: { key: string; message: string }[] = [];

  const request = readJson(join(root, REQUEST)) as { format?: unknown; materialise?: unknown; claims?: unknown };
  if (request.format !== 1 || !Array.isArray(request.materialise) || !request.materialise.every((key) => typeof key === "string" && KEY.test(key))) {
    throw new Refused(`${REQUEST} does not list the series to compute`);
  }
  const lockPaths = request.claims ?? [];
  if (!Array.isArray(lockPaths) || !lockPaths.every((path) => typeof path === "string" && LOCK.test(path))) {
    throw new Refused(`${REQUEST} does not name the claim locks to compute latest rows for`);
  }
  const asked = request.materialise as string[];
  const entries = (readJson(join(root, "catalog.json")) as { series: RecipeSeries[] }).series;
  const catalog = new Map(entries.map((entry) => [entry.key, entry]));
  const files = new Map<string, ResolveSeries | null>();
  const load = (key: string): ResolveSeries | null => {
    if (!files.has(key)) {
      const path = join(root, "series", `${key}.json`);
      let found: ResolveSeries | null = null;
      if (KEY.test(key) && existsSync(path)) {
        const file = readJson(path) as { freq: ResolveSeries["freq"]; representation: ResolveSeries["representation"]; observations: ResolveSeries["observations"] };
        found = { key, freq: file.freq, representation: file.representation, observations: file.observations };
      }
      files.set(key, found);
    }
    return files.get(key)!;
  };

  const outputs: { key: string; text: string }[] = [];
  const values = new Map<string, Map<string, number | null>>();
  for (const key of asked) {
    const entry = catalog.get(key);
    const name = `derived series: ${key}`;
    if (!entry?.recipe || entry.representation !== "native") {
      checks.push({ check: name, outcome: "fail", detail: `${key} is not a native recipe entry of the catalog` });
      continue;
    }
    const answer = evaluateRecipe(key, catalog, load, { releaseId: "staged" });
    if (answer.unavailable) {
      if (answer.unavailable.reason === "no_values") empty.push({ key, message: answer.unavailable.message });
      else checks.push({ check: name, outcome: "fail", detail: answer.unavailable.message });
      continue;
    }
    if (entry.rights.status !== answer.rights_status) {
      checks.push({
        check: name,
        outcome: "fail",
        detail: `the catalog gives ${key} the rights status ${entry.rights.status}, and the most restrictive of what it rests on is ${answer.rights_status}`,
      });
      continue;
    }
    const observations = answer.observations;
    const document = {
      key, freq: entry.freq, representation: "native",
      period_start: observations[0]!.period_start, period_end: observations.at(-1)!.period_end, observations,
    };
    const text = `${JSON.stringify(document)}\n`;
    outputs.push({ key, text });
    values.set(key, new Map(observations.map((o) => [o.period, o.value])));
    derived[key] = {
      sha256: createHash("sha256").update(text).digest("hex"), observations: observations.length,
      period_start: document.period_start, period_end: document.period_end, rights_status: answer.rights_status!,
    };
    checks.push({ check: name, outcome: "pass" });
  }

  if (spotPath !== null) {
    const spots = (readJson(spotPath) as { spots: Spot[] }).spots;
    for (const spot of spots) {
      const name = `spot value: ${spot.key} ${spot.period}`;
      let held = values.get(spot.key);
      if (!held && !catalog.get(spot.key)?.recipe) {
        const stored = load(spot.key);
        if (stored) held = new Map(stored.observations.map((o) => [o.period, o.value]));
      }
      const value = held?.get(spot.period);
      if (!held) {
        checks.push({ check: name, outcome: "not_checked", reason: "no_series", detail: "this release does not hold the series" });
      } else if (value === undefined || value === null) {
        checks.push({ check: name, outcome: "not_checked", reason: "no_value", detail: "this release holds no value for that period" });
      } else if (Math.abs(value - spot.value) <= spot.tolerance) {
        checks.push({ check: name, outcome: "pass" });
      } else {
        checks.push({ check: name, outcome: "fail", detail: `${spot.key} ${spot.period} is ${value}; ${spot.source ?? "the independent figure"} says ${spot.value} (within ${spot.tolerance})` });
      }
    }
  }

  // The latest row of every locked Reading, and the drift (ADR 0034).
  let latestText: string | null = null;
  const drifted: { claim_id: string; lock_version: number; differences: number }[] = [];
  if (lockPaths.length > 0) {
    const claims = (lockPaths as string[]).map((path) => latestOf(readJson(join(root, path)) as Lock, root));
    for (const claim of claims) {
      const differences = claim.readings.reduce((n, reading) => n + reading.drift.length, 0);
      if (differences > 0) drifted.push({ claim_id: claim.claim_id, lock_version: claim.lock_version, differences });
    }
    latestText = `${JSON.stringify({ semantics_version: SEMANTICS_VERSION, claims })}\n`;
  }

  // Everything is computed before anything is written.
  if (latestText !== null) {
    const folder = join(root, "evidence");
    if (!existsSync(folder) && !isLink(folder)) mkdirSync(folder);
    realDirectory(folder, root);
    createNew(join(root, LATEST), latestText);
  }
  if (outputs.length > 0) {
    const folder = join(root, "derived");
    if (!existsSync(folder) && !isLink(folder)) mkdirSync(folder);
    realDirectory(folder, root);
    for (const { key, text } of outputs) createNew(join(folder, `${key}.json`), text);
  }
  const failed = checks.filter((check) => check.outcome === "fail");
  createNew(join(root, REPORT), `${JSON.stringify({
    format: 1, semantics_version: SEMANTICS_VERSION, derived, empty, checks,
    ...(latestText === null ? {} : { latest: { sha256: createHash("sha256").update(latestText).digest("hex"), drift: drifted } }),
  })}\n`);
  for (const check of failed) console.error(`FAILED ${check.check}: ${check.detail ?? ""}`);
  return failed.length > 0 ? 1 : 0;
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function main(argv: readonly string[]): number {
  const args = [...argv];
  const option = (name: string): string | null | undefined => {
    const at = args.indexOf(name);
    if (at < 0) return null;
    const value = args[at + 1];
    args.splice(at, 2);
    return value; // undefined: the option was given without a value
  };
  const command = args.shift();
  const release = option("--release");
  const spot = option("--spot");
  if (command !== "verify" || !release || spot === undefined || args.length > 0) {
    console.error(USAGE);
    return 2;
  }
  try {
    if (!lstatSync(release).isDirectory()) throw new Error("not a directory");
  } catch {
    console.error(`${release} is not a staged release directory\n${USAGE}`);
    return 2;
  }
  try {
    return verify(release, spot);
  } catch (error) {
    console.error(`FAILED ${error instanceof Refused ? error.message : `the engine step could not finish: ${(error as Error).message}`}`);
    return 1;
  }
}
