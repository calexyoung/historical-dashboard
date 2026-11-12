// What did a Series say as of a date? (PLAN M10; docs/method/vintage-resolution.md)
//
//   node scripts/as-of.mjs fx_price_index 2025-12-13            the committed fixture release
//   node scripts/as-of.mjs unrate 2026-11-20 --root var/local   v1's data, after `make v2`
//   node scripts/as-of.mjs fx_output_quarterly 2025-11-28T18:00:00Z --tail 4
//
// Opens the root's current Release with the site's own reader (local Surface) and asks the
// engine's resolve(). It bundles the TypeScript in memory; nothing is written or fetched.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as path } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rolldown } from "rolldown";

const repo = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args.splice(at, 2)[1];
};
const root = path(option("--root", join(repo, "fixtures", "public")));
const tail = Number(option("--tail", "8"));
const [key, date] = args;
if (!key) {
  console.error("usage: node scripts/as-of.mjs <series-key> [YYYY-MM-DD | instant] [--root DIR] [--tail N]");
  process.exit(2);
}

const lib = join(repo, "site", "src", "lib", "release");
const bundle = await rolldown({
  input: join(lib, "as-of-entry.ts"),
  platform: "node",
  logLevel: "silent",
  plugins: [{
    name: "entry",
    resolveId: (id) => (id.endsWith("as-of-entry.ts") ? id : null),
    load: (id) => (id.endsWith("as-of-entry.ts") ? 'export { asOf, derivedAsOf } from "./as-of";\nexport { createReleaseReader } from "./reader";\n' : null),
  }],
});
const { output } = await bundle.generate({ format: "esm" });
await bundle.close();
const scratch = mkdtempSync(join(tmpdir(), "atlas-as-of-"));
let lib_;
try {
  const file = join(scratch, "as-of.mjs");
  writeFileSync(file, output[0].code);
  lib_ = await import(pathToFileURL(file).href);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const opened = await lib_.createReleaseReader({ root, surface: "local" }).current();
if (!opened.ok) {
  console.error(`no release could be opened in ${root}: ${opened.reason}`);
  process.exit(1);
}
const say = (label, value) => console.log(`${label.padEnd(18)}${value}`);
const computed = lib_.derivedAsOf(opened.release, key, date ?? null);
if (computed) {
  // A Derived series the engine computes: its Recipe over each input's own Vintage (M11).
  say("series", `${key}  (release ${computed.release_id}, semantics ${computed.semantics_version})`);
  say("derived from", computed.inputs.map((input) => input.key).join(", "));
  say("as of", computed.as_of ?? "not asked: the release's own state");
  say("basis", computed.basis ? `${computed.basis}  (the weakest among its inputs)` : "none (not an as-of answer)");
  for (const input of computed.inputs) {
    const gap = input.capture_gap ? `, last capture ${input.capture_gap.from}, ${input.capture_gap.missed_days} day(s) not seen` : "";
    say(`  ${input.key}`.slice(0, 17), ` ${input.basis ?? "the release's own state"}${input.reason ? ` (${input.reason})` : ""}${gap}`);
    if (input.left_out_periods.length) say("", `  left out, held under other metadata: ${input.left_out_periods.join(", ")}`);
  }
  say("rights", `${computed.rights_status}  (the most restrictive among its inputs)`);
  if (computed.unavailable) say("no answer", computed.unavailable.message);
  const shown = tail > 0 ? computed.observations.slice(-tail) : [];
  if (shown.length < computed.observations.length) console.log(`  ... ${computed.observations.length - shown.length} earlier Period(s)`);
  for (const o of shown) console.log(`  ${o.period.padEnd(11)}${String(o.value ?? "").padStart(22)}  ${o.status}`);
  if (computed.observations.length === 0) console.log("  (no Observation)");
  process.exit(0);
}
const answer = lib_.asOf(opened.release, key, date ?? null);
if (!answer) {
  console.error(`release ${opened.release.id} holds no values for ${key} (unknown, or withheld)`);
  process.exit(1);
}
say("series", `${key}  (release ${answer.release_id}, semantics ${answer.semantics_version})`);
say("as of", answer.as_of ?? "not asked: the release's own state");
if (answer.cutoff) say("cutoff", `before ${answer.cutoff.instant}  (${answer.cutoff.precision === "date" ? "00:00" : "that instant"} in New York, ${answer.cutoff.day})`);
say("basis", answer.basis ?? "none (not an as-of answer)");
if (answer.reason) say("reason", answer.reason);
if (answer.capture_gap) {
  const gap = answer.capture_gap;
  say("last capture", gap.from);
  say("next capture", gap.to ? `${gap.to}${gap.changed_across ? "  (it found a change)" : "  (it found nothing changed)"}` : "none yet");
  say("days not seen", String(gap.missed_days));
}
if (answer.as_of) say("same-day release", answer.same_day_release ? "yes: a version is dated to the cutoff's own day" : "no");
if (answer.metadata) {
  const m = answer.metadata;
  say("unit then", `${m.metadata.unit}${m.differs_from_current ? "  (changed since)" : ""}`);
  if (m.other_metadata_periods.length) say("held under other", m.other_metadata_periods.join(", "));
}
const rows = tail > 0 ? answer.observations.slice(-tail) : [];
if (rows.length < answer.observations.length) console.log(`  ... ${answer.observations.length - rows.length} earlier Period(s)`);
for (const o of rows) {
  const known = o.known_by === "provider" ? `published ${o.known_from}` : o.known_by === "atlas" ? `first held ${o.known_from}` : o.known_by === "legacy" ? "v1's output" : "";
  console.log(`  ${o.period.padEnd(11)}${String(o.value ?? "").padStart(12)}  ${o.status.padEnd(12)}${(o.basis ?? "").padEnd(15)}${known}`);
}
if (answer.observations.length === 0) console.log("  (no Observation)");
