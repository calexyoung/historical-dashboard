// Does a Series fetched from its Origin say what v1 said? (PLAN M13: "each matches v1's value
// for the overlap within a stated tolerance or the difference is explained"; M16: "the
// comparison table is attached with every difference explained", for every live v1 series.)
//
//   make v2-legacy-release                                   v1's values, as a local release
//   node scripts/v1-overlap.mjs --native ROOT --legacy var/local
//   node scripts/v1-overlap.mjs --native ROOT --legacy var/local --markdown   the table as Markdown
//
// ROOT is a release root built by `atlas release` from a capture store. The statement of how
// each Series is brought to v1's shape, how far it may be from v1 and why is checks/v1-overlap.json.
// This script reads two releases and that file; it fetches nothing and writes nothing. Bringing
// a daily Series to months is the engine's aggregate() (ADR 0003), run here as the publisher's
// Node step runs it: Node 22.18 or later, no node_modules.
//
// Exit status: 0 when every Series is within its tolerance or is one the statement says has no
// counterpart; 1 when a Series is off, overlaps too little or is missing from a release.
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`v1-overlap needs Node 22.18 or later; this is ${process.versions.node}`);
  process.exit(2);
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      if (error?.code === "ERR_MODULE_NOT_FOUND" && relative && !/\.[cm]?[jt]s$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
const { aggregate } = await import("../packages/core/src/aggregate.ts");

const repo = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  if (at >= 0) args.splice(at, 1);
  return at >= 0;
};
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args.splice(at, 2)[1];
};
const markdown = flag("--markdown");
const nativeRoot = option("--native", null);
const legacyRoot = option("--legacy", join(repo, "var", "local"));
const statementPath = resolve(option("--statement", join(repo, "checks", "v1-overlap.json")));
if (!nativeRoot || args.length) {
  console.error("usage: node scripts/v1-overlap.mjs --native ROOT [--legacy ROOT] [--statement FILE] [--markdown]");
  process.exit(2);
}

const json = (path) => JSON.parse(readFileSync(path, "utf8"));
function open(root) {
  const directory = join(resolve(root), "releases", readFileSync(join(resolve(root), "CURRENT"), "utf8").trim());
  const catalog = new Map(json(join(directory, "catalog.json")).series.map((entry) => [entry.key, entry]));
  const series = (key) => {
    for (const folder of ["series", "derived"]) {
      try {
        return json(join(directory, folder, `${key}.json`));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return null;
  };
  return { catalog, series };
}

/** v1 averaged the weekly levels by the day they are dated. A weekly Observation here is the
 * ISO week of that day, and the engine files a week under the month its last day falls in, so
 * for this comparison alone the weeks are filed under the month of the day `offset` days after
 * the week begins (2 for a Wednesday). */
function meanByReferenceDay(observations, offset) {
  const months = new Map();
  for (const o of observations) {
    if (o.value === null) continue;
    const day = new Date(`${o.period_start}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    const label = day.toISOString().slice(0, 7);
    months.set(label, [...(months.get(label) ?? []), o.value]);
  }
  return [...months].map(([period, values]) => ({ period, value: values.reduce((a, b) => a + b, 0) / values.length, status: "final" }));
}

const statement = json(statementPath);
const native = open(nativeRoot);
const legacy = open(legacyRoot);
const rows = [];
let failed = false;

for (const item of statement.series) {
  const row = { key: item.key, compared: 0, verdict: "", note: item.why ?? "" };
  rows.push(row);
  if (item.v1 === null) {
    row.verdict = native.series(item.key) === null
      ? "FAILED: not in the native release"
      : legacy.series(item.key) === null ? "no v1 counterpart" : "FAILED: the statement says v1 had no such series, and it has";
    failed ||= row.verdict.startsWith("FAILED");
    continue;
  }
  const mine = native.series(item.key);
  const theirs = legacy.series(item.v1 ?? item.key);
  if (mine === null || theirs === null) {
    row.verdict = `FAILED: not in the ${mine === null ? "native" : "legacy"} release`;
    failed = true;
    continue;
  }
  if (theirs.representation !== "legacy_monthly_rounded") {
    row.verdict = "FAILED: the legacy release does not hold v1's values for it";
    failed = true;
    continue;
  }
  let observations = mine.observations;
  if (item.reference_day_offset !== undefined) {
    observations = meanByReferenceDay(observations, item.reference_day_offset);
  } else if (mine.freq !== theirs.freq) {
    const entry = native.catalog.get(item.key);
    const result = aggregate({ freq: mine.freq, continuity: entry.continuity ?? "discrete", measure_kind: entry.measure_kind, agg: entry.agg, observations }, theirs.freq);
    if (!result.ok) {
      row.verdict = `FAILED: ${result.message}`;
      failed = true;
      continue;
    }
    observations = result.observations;
  }
  const held = new Map(observations.map((o) => [o.period, o]));
  const factor = item.factor ?? 1;
  const explained = item.exceptions ?? {};
  let worst = 0;
  let over = 0;
  row.explained = 0;
  row.partial = 0;
  row.only_v1 = 0;
  row.only_native = 0;
  // v1 may begin earlier or end later than the Origin's file or the capture window: outside
  // the span the native Series covers nothing is compared. Inside it, a Period v1 holds and
  // the native Series does not is a value on one side only.
  const first = observations[0]?.period;
  const last = observations.at(-1)?.period;
  for (const old of theirs.observations) {
    const now = held.get(old.period);
    if (!now) {
      if (first !== undefined && old.period >= first && old.period <= last && old.value !== null) row.only_v1 += 1;
      continue;
    }
    if (now.status === "partial") row.partial += 1;
    else if (old.value === null && now.value === null) continue;
    else if (now.value === null) row.only_v1 += 1;
    else if (old.value === null) row.only_native += 1;
    else {
      const difference = Math.abs(now.value * factor - old.value);
      row.compared += 1;
      // The allowance is for a double's last bits and nothing else: a few units in the last
      // place of the larger figure (about 1e-8 on thirty million, 1e-15 on one).
      const ulps = 16 * Number.EPSILON * Math.max(1, Math.abs(old.value), Math.abs(now.value * factor));
      const within = difference <= (item.abs ?? 0) + (item.rel ?? 0) * Math.abs(old.value) + ulps;
      if (!within && old.period in explained) {
        row.explained += 1; // a Period the statement explains by name is counted, not hidden
        continue;
      }
      if (difference > worst) [worst, row.at] = [difference, old.period];
      if (!within) over += 1;
    }
  }
  row.max = worst;
  row.over = over;
  row.tolerance = [item.abs !== undefined ? `${item.abs}` : null, item.rel !== undefined ? `${Number((item.rel * 100).toPrecision(6))}%` : null].filter(Boolean).join(" + ") || "0";
  const stale = Object.keys(explained).filter((period) => !theirs.observations.some((o) => o.period === period));
  const gaps = row.only_v1 + row.only_native;
  if (stale.length) {
    row.verdict = `FAILED: the statement explains ${stale.join(", ")}, which v1 does not hold`;
  } else if (row.compared < (item.min_overlap ?? statement.min_overlap)) {
    row.verdict = `FAILED: only ${row.compared} Periods overlap`;
  } else if (gaps > (item.gaps_allowed ?? 0)) {
    row.verdict = `FAILED: ${gaps} Periods have a value on one side only`;
  } else if (over > (item.over_allowed ?? 0)) {
    row.verdict = `FAILED: ${over} Periods are further from v1 than the tolerance`;
  } else {
    row.verdict = item.different ? "different by design" : "matches";
  }
  failed ||= row.verdict.startsWith("FAILED");
}

const digits = (x) => (x === undefined ? "" : x === 0 ? "0" : x.toPrecision(3));
if (markdown) {
  console.log("| Series | Periods compared | Largest difference | At | Tolerance | Beyond it | Explained by name | One side only | Verdict |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(`| \`${r.key}\` | ${r.compared || "—"} | ${digits(r.max) || "—"} | ${r.at ?? "—"} | ${r.tolerance || "—"} | ${r.over ?? "—"} | ${r.explained ?? "—"} | ${r.only_v1 === undefined ? "—" : r.only_v1 + r.only_native} | ${r.verdict} |`);
  }
} else {
  for (const r of rows) {
    const detail = r.max === undefined ? "" : `  n=${r.compared} max=${digits(r.max)} at ${r.at ?? "-"} tolerance=${r.tolerance || "0"} beyond=${r.over} explained=${r.explained} v1-only=${r.only_v1} native-only=${r.only_native} partial=${r.partial}`;
    console.log(`${r.key.padEnd(14)} ${r.verdict}${detail}`);
  }
}
process.exitCode = failed ? 1 : 0;
