/**
 * The Release contract, TypeScript side: is this a valid Release? (PLAN 4.2, 4.3; ADR 0004)
 *
 * A Release is the seam between the writer and every reader. `validateRelease(id, files)` returns
 * the ways a Release breaks the contract; an empty list means it is valid. The contract is
 * `schema/release.schema.json` plus the cross-file rules in `schema/README.md`. The Python twin
 * is `atlas/release.py`; both run `checks/release-cases.json` and report the same issue codes.
 *
 * Pure: the caller reads the files (the ReleaseReader, from M1). This entry point is for Node
 * only; it is kept out of the package's main entry so the schema compiler never reaches a browser.
 *
 * Structural validity is not authorisation. Whether a Series may appear on a Surface is decided
 * by `permits()` over the rights register. The profile rules here are a second,
 * independent line of defence for the interim data rule (PLAN 6.1).
 */
import { createHash } from "node:crypto";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { nextPeriod, periodBounds } from "../period";
import { releaseSchema, SCHEMA_VERSION } from "./schema.generated";
import type { CatalogEntry, Release, SeriesFile, VintageRow } from "./types.generated";

export type * from "./types.generated";
export { SCHEMA_VERSION };

/** A Release read into memory: each file's bytes by its path relative to the release directory. */
export type ReleaseFiles = Record<string, Uint8Array>;

export type IssueCode =
  | "unknown_file"
  | "missing_file"
  | "invalid_json"
  | "unsupported_schema_version"
  | "schema"
  | "release_id_mismatch"
  | "duplicate_key"
  | "withheld_unknown"
  | "withheld_present"
  | "orphan_series_file"
  | "misplaced_series_file"
  | "missing_series_file"
  | "missing_manifest_row"
  | "orphan_manifest_row"
  | "hash_mismatch"
  | "manifest_mismatch"
  | "series_mismatch"
  | "orphan_vintage_file"
  | "vintage_mismatch"
  | "bad_period"
  | "unordered_periods"
  | "implicit_gap"
  | "bounds_mismatch"
  | "unknown_recipe_input"
  | "recipe_cycle"
  | "withheld_input"
  | "duplicate_annotation_id"
  | "unknown_series_ref"
  | "bad_anchor"
  | "unsigned_register"
  | "legacy_in_public"
  | "draft_in_public";

/** One way a Release breaks the contract. */
export type Issue = { code: IssueCode; path: string; message: string };

const MANIFEST = "manifest.json";
const CATALOG = "catalog.json";
const ANNOTATIONS = "content/annotations.json";
const REQUIRED_FILES = [MANIFEST, CATALOG, ANNOTATIONS] as const;
const SERIES_FILE = /^(series|derived|vintages)\/([a-z][a-z0-9_]{0,63})\.json$/;
const FOLDERS = ["series", "derived"] as const;
type Folder = (typeof FOLDERS)[number];
const KIND_OF_FOLDER = { series: "stored", derived: "derived" } as const;
const LEGACY = "legacy_monthly_rounded";

let compiled: ValidateFunction | undefined;
function schemaValidator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, allowUnionTypes: true });
    (addFormats as unknown as (a: Ajv2020) => void)(ajv);
    compiled = ajv.compile(releaseSchema);
  }
  return compiled;
}

// ignoreBOM: true keeps a byte order mark in the text, so JSON.parse refuses it as Python does.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");
const quote = (value: unknown): string => JSON.stringify(value);

/**
 * JSON, read strictly, so that this reader and the Python twin accept and refuse the same bytes
 * (they may still hold a number differently: Python keeps integers past 2^53 exact): every number is a finite double (JSON.parse reads 1e400 as Infinity without
 * complaint) and no object names a key twice (JSON.parse silently keeps the last).
 *
 * JSON.parse decides whether the text is JSON at all; the scan below then walks the same text,
 * which it can trust to be well formed, looking only at number tokens and object keys.
 */
function parseStrictJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  let i = 0;
  const skipSpace = (): void => {
    while (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t") i++;
  };
  const string = (): string => {
    const start = i++;
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const scan = (): void => {
    skipSpace();
    const c = text[i];
    if (c === '"') {
      string();
    } else if (c === "{") {
      i++;
      const keys = new Set<string>();
      for (skipSpace(); text[i] !== "}"; skipSpace()) {
        if (text[i] === ",") i++;
        skipSpace();
        const key = string();
        if (keys.has(key)) throw new SyntaxError(`an object names the key ${JSON.stringify(key)} twice`);
        keys.add(key);
        skipSpace();
        i++; // the colon
        scan();
      }
      i++;
    } else if (c === "[") {
      i++;
      for (skipSpace(); text[i] !== "]"; skipSpace()) {
        if (text[i] === ",") i++;
        scan();
      }
      i++;
    } else {
      const start = i;
      while (i < text.length && !',]} \n\r\t'.includes(text[i]!)) i++;
      const token = text.slice(start, i);
      if (token !== "true" && token !== "false" && token !== "null" && !Number.isFinite(Number(token))) {
        throw new SyntaxError(`${token.slice(0, 24)} is too large to be a number`);
      }
    }
  };
  scan();
  return value;
}

/** Turn a path inside the bundle into [file, JSON pointer inside that file]. */
function locate(instancePath: string): [string, string] {
  const parts = instancePath.split("/").slice(1);
  const [head, ...rest] = parts;
  if ((head === "series" || head === "derived" || head === "vintages") && rest.length > 0) {
    return [`${head}/${rest[0]}.json`, "/" + rest.slice(1).join("/")];
  }
  const file =
    head === "manifest" ? MANIFEST : head === "catalog" ? CATALOG : head === "annotations" ? ANNOTATIONS : MANIFEST;
  return [file, "/" + rest.join("/")];
}

/**
 * The ways a Release breaks the contract. Empty means valid.
 *
 * Checks run in stages and stop at the first stage that finds something, so a reader is never
 * shown consequences of a problem instead of the problem: files present and named by the
 * contract, JSON, schema version, schema, the cross-file rules, then the vintage files.
 */
export function validateRelease(releaseId: string, files: ReleaseFiles): Issue[] {
  const issues: Issue[] = [];
  const has = (code: IssueCode): boolean => issues.some((i) => i.code === code);
  const seriesPaths: Record<Folder, Map<string, string>> = { series: new Map(), derived: new Map() };
  const vintagePaths = new Map<string, string>();

  for (const path of Object.keys(files).sort()) {
    const match = SERIES_FILE.exec(path);
    if (match && match[1] === "vintages") vintagePaths.set(match[2]!, path);
    else if (match) seriesPaths[match[1] as Folder].set(match[2]!, path);
    else if (!(REQUIRED_FILES as readonly string[]).includes(path)) {
      issues.push({ code: "unknown_file", path, message: "the release contract does not name this file" });
    }
  }
  for (const path of REQUIRED_FILES) {
    if (!files[path]) issues.push({ code: "missing_file", path, message: "a release must have this file" });
  }
  if (has("missing_file")) return issues;

  const parsed = new Map<string, unknown>();
  const known = [...REQUIRED_FILES, ...FOLDERS.flatMap((f) => [...seriesPaths[f].values()]), ...vintagePaths.values()];
  for (const path of known) {
    try {
      parsed.set(path, parseStrictJson(decoder.decode(files[path]!)));
    } catch (error) {
      issues.push({ code: "invalid_json", path, message: String((error as Error).message) });
    }
  }
  if (has("invalid_json")) return issues;

  const manifestDoc = parsed.get(MANIFEST);
  const version =
    typeof manifestDoc === "object" && manifestDoc !== null && !Array.isArray(manifestDoc)
      ? (manifestDoc as Record<string, unknown>).schema_version
      : undefined;
  if (version !== undefined && version !== null && version !== SCHEMA_VERSION) {
    issues.push({
      code: "unsupported_schema_version",
      path: MANIFEST,
      message: `this reader knows schema_version ${SCHEMA_VERSION}, not ${quote(version)}`,
    });
    return issues;
  }

  const collect = (folder: Folder): Record<string, unknown> =>
    Object.fromEntries([...seriesPaths[folder]].map(([key, path]) => [key, parsed.get(path)]));
  const bundle = {
    manifest: manifestDoc,
    catalog: parsed.get(CATALOG),
    series: collect("series"),
    derived: collect("derived"),
    vintages: Object.fromEntries([...vintagePaths].map(([key, path]) => [key, parsed.get(path)])),
    annotations: parsed.get(ANNOTATIONS),
  };
  const validate = schemaValidator();
  if (!validate(bundle)) {
    for (const error of (validate.errors ?? []) as ErrorObject[]) {
      const [path, pointer] = locate(error.instancePath);
      issues.push({ code: "schema", path, message: `${pointer}: ${error.message ?? "invalid"}`.slice(0, 400) });
    }
    return issues;
  }

  issues.push(...crossFileRules(releaseId, bundle as Release, files, seriesPaths));
  // A last stage: a vintage file is judged against Series files that are sound.
  if (issues.length === 0) issues.push(...vintageRules(bundle as Release, files, vintagePaths));
  return issues;
}

function crossFileRules(
  releaseId: string,
  bundle: Release,
  files: ReleaseFiles,
  seriesPaths: Record<Folder, Map<string, string>>,
): Issue[] {
  const issues: Issue[] = [];
  const add = (code: IssueCode, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  const { manifest, catalog } = bundle;

  if (manifest.release_id !== releaseId) {
    add(
      "release_id_mismatch",
      MANIFEST,
      `release_id ${quote(manifest.release_id)} is not the directory name ${quote(releaseId)}`,
    );
  }

  const entries = new Map<string, CatalogEntry>();
  for (const entry of catalog.series) {
    if (entries.has(entry.key)) add("duplicate_key", CATALOG, `${entry.key} appears more than once`);
    else entries.set(entry.key, entry);
  }

  const withheld = new Set<string>();
  for (const row of manifest.withheld) {
    withheld.add(row.key);
    if (!entries.has(row.key)) {
      add("withheld_unknown", MANIFEST, `withheld series ${row.key} is not in the catalog`);
    }
  }

  // Files against the catalog.
  const present = new Map<string, Folder[]>();
  for (const folder of FOLDERS) {
    for (const [key, path] of seriesPaths[folder]) {
      present.set(key, [...(present.get(key) ?? []), folder]);
      const entry = entries.get(key);
      if (!entry) add("orphan_series_file", path, `${key} is not in the catalog`);
      else if (withheld.has(key)) {
        add("withheld_present", path, `${key} is withheld, so the release may not hold its values`);
      } else if ((entry.recipe !== undefined) !== (folder === "derived")) {
        add("misplaced_series_file", path, `${key} belongs in ${entry.recipe ? "derived/" : "series/"}`);
      }
    }
  }
  for (const key of entries.keys()) {
    if (!withheld.has(key) && !present.has(key)) {
      add("missing_series_file", CATALOG, `${key} is not withheld but has no file`);
    }
  }

  // Manifest rows against the files and the catalog.
  const rows = manifest.series;
  for (const key of [...present.keys()].sort()) {
    if (!Object.hasOwn(rows, key)) add("missing_manifest_row", MANIFEST, `${key} has a file but no manifest row`);
  }
  for (const [key, row] of Object.entries(rows)) {
    const folders = present.get(key);
    if (!folders) {
      const code = withheld.has(key) ? "withheld_present" : "orphan_manifest_row";
      add(code, MANIFEST, `${key} has a manifest row but no file`);
      continue;
    }
    for (const folder of folders) {
      const path = seriesPaths[folder].get(key)!;
      if (sha256(files[path]!) !== row.sha256) {
        add("hash_mismatch", path, "the file's bytes do not match the manifest's sha256");
      }
      if (KIND_OF_FOLDER[folder] !== row.kind) {
        add("manifest_mismatch", MANIFEST, `${key} is recorded as ${row.kind} but is in ${folder}/`);
      }
    }
    const entry = entries.get(key);
    if (entry) {
      const expected = {
        channel: entry.source.channel.via,
        rights_status: entry.rights.status,
        representation: entry.representation,
      } as const;
      for (const field of ["channel", "rights_status", "representation"] as const) {
        if (row[field] !== expected[field]) {
          add(
            "manifest_mismatch",
            MANIFEST,
            `${key}: manifest ${field} ${quote(row[field])} is not the catalog's ${quote(expected[field])}`,
          );
        }
      }
    }
  }

  // Each file against its catalog entry, then its Periods.
  for (const folder of FOLDERS) {
    for (const [key, path] of seriesPaths[folder]) {
      const doc = bundle[folder][key]!;
      const entry = entries.get(key);
      if (doc.key !== key) add("series_mismatch", path, `key ${quote(doc.key)} is not the file name`);
      if (!entry) continue;
      if (doc.representation !== entry.representation) {
        add("series_mismatch", path, "representation is not the catalog's");
      }
      if (doc.freq !== entry.freq) {
        add("series_mismatch", path, `freq ${quote(doc.freq)} is not the catalog's ${quote(entry.freq)}`);
        continue;
      }
      issues.push(...periodRules(path, doc));
    }
  }

  issues.push(...recipeRules(entries, withheld));

  // Annotations.
  const seen = new Set<string>();
  for (const annotation of bundle.annotations.annotations) {
    if (seen.has(annotation.id)) {
      add("duplicate_annotation_id", ANNOTATIONS, `${annotation.id} appears more than once`);
    }
    seen.add(annotation.id);
    for (const key of annotation.series ?? []) {
      if (!entries.has(key)) {
        add("unknown_series_ref", ANNOTATIONS, `${annotation.id} names ${key}, which is not in the catalog`);
      }
    }
    const anchor = annotation.anchor;
    if (anchor.type === "span" && anchor.end !== null && anchor.end < anchor.start) {
      add("bad_anchor", ANNOTATIONS, `${annotation.id} ends before it starts`);
    }
  }

  // Profile rules (PLAN 6.1): a second line of defence, not the rights gate.
  if (manifest.profile === "public") {
    if (!manifest.rights_register.signed) {
      add("unsigned_register", MANIFEST, "a public release must name a signed rights register");
    }
    const legacy = new Set<string>();
    for (const [key, entry] of entries) if (entry.representation === LEGACY) legacy.add(key);
    for (const [key, row] of Object.entries(rows)) if (row.representation === LEGACY) legacy.add(key);
    for (const folder of FOLDERS) {
      for (const [key, doc] of Object.entries(bundle[folder])) if (doc.representation === LEGACY) legacy.add(key);
    }
    for (const key of [...legacy].sort()) {
      add("legacy_in_public", CATALOG, `${key} is in v1's legacy representation, which is never public`);
    }
    for (const [key, entry] of entries) {
      if (entry.status === "draft") add("draft_in_public", CATALOG, `${key} is a draft`);
    }
  }
  return issues;
}

function periodRules(path: string, doc: SeriesFile): Issue[] {
  const issues: Issue[] = [];
  const { freq, observations } = doc;
  const good = observations.map((obs) => {
    const bounds = periodBounds(freq, obs.period);
    const ok = bounds !== null && bounds.start === obs.period_start && bounds.end === obs.period_end;
    if (!ok) {
      const want = bounds ? `${bounds.start} to ${bounds.end}` : `no ${freq} period has that label`;
      issues.push({
        code: "bad_period",
        path,
        message: `${obs.period}: says ${obs.period_start} to ${obs.period_end}; expected ${want}`,
      });
    }
    return ok;
  });
  for (let i = 1; i < observations.length; i++) {
    if (!(good[i - 1] && good[i])) continue;
    const before = observations[i - 1]!;
    const after = observations[i]!;
    if (after.period_start <= before.period_start) {
      issues.push({
        code: "unordered_periods",
        path,
        message: `${after.period} does not come after ${before.period}`,
      });
    } else if (freq !== "irregular") {
      const expected = nextPeriod(freq, before.period);
      if (after.period !== expected) {
        issues.push({
          code: "implicit_gap",
          path,
          message:
            `${expected} is left out between ${before.period} and ${after.period}; ` +
            "a gap must be an explicit missing observation",
        });
      }
    }
  }
  const first = observations[0]!;
  const last = observations[observations.length - 1]!;
  if (doc.period_start !== first.period_start || doc.period_end !== last.period_end) {
    issues.push({
      code: "bounds_mismatch",
      path,
      message: "period_start and period_end are not the first and last observation's",
    });
  }
  return issues;
}

/**
 * Structure only: inputs exist, no cycles, nothing shown that rests on a withheld input.
 * Computing a Recipe is the engine's job (ADR 0003), not the validator's.
 */
function recipeRules(entries: Map<string, CatalogEntry>, withheld: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const inputsOf = (key: string): string[] => entries.get(key)?.recipe?.inputs ?? [];
  const closure = (key: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [...inputsOf(key)];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (!seen.has(current)) {
        seen.add(current);
        stack.push(...inputsOf(current));
      }
    }
    return seen;
  };
  for (const [key, entry] of entries) {
    if (!entry.recipe) continue;
    for (const name of entry.recipe.inputs) {
      if (!entries.has(name)) {
        issues.push({
          code: "unknown_recipe_input",
          path: CATALOG,
          message: `${key} takes ${name}, which is not in the catalog`,
        });
      }
    }
    const reach = closure(key);
    if (reach.has(key)) issues.push({ code: "recipe_cycle", path: CATALOG, message: `${key} depends on itself` });
    const blocked = [...reach].filter((k) => withheld.has(k)).sort();
    if (blocked.length > 0 && !withheld.has(key)) {
      issues.push({
        code: "withheld_input",
        path: CATALOG,
        message: `${key} is derived from withheld ${blocked.join(", ")}`,
      });
    }
  }
  return issues;
}

/**
 * An Instant as text that sorts in time order: the fraction, if any, padded to nine digits.
 * (`...:00Z` and `...:00.5Z` do not sort as written.)
 */
export function instantKey(text: string): string {
  const [whole, fraction = ""] = text.slice(0, -1).split(".");
  return `${whole}.${fraction.padEnd(9, "0")}`;
}

/**
 * vintages/{key}.json against the manifest, the catalog and the Series' own file, then its own
 * order in time (schema/README.md). Resolving an as-of question from the file is the engine's
 * job (`resolve`, ADR 0003), not the validator's.
 */
function vintageRules(bundle: Release, files: ReleaseFiles, vintagePaths: Map<string, string>): Issue[] {
  const issues: Issue[] = [];
  const { manifest } = bundle;
  const entries = new Map(bundle.catalog.series.map((entry) => [entry.key, entry]));
  const withheld = new Set(manifest.withheld.map((row) => row.key));
  const sorted = (times: string[]): boolean => times.every((time, i) => i === 0 || times[i - 1]! <= time);

  for (const [key, row] of Object.entries(manifest.series)) {
    if (row.vintages_sha256 !== undefined && !vintagePaths.has(key)) {
      issues.push({ code: "manifest_mismatch", path: MANIFEST, message: `${key}: the manifest names a vintage file the release does not hold` });
    }
  }
  for (const [key, path] of vintagePaths) {
    const bad = (message: string): void => {
      issues.push({ code: "vintage_mismatch", path, message });
    };
    if (withheld.has(key)) {
      issues.push({ code: "withheld_present", path, message: `${key} is withheld, so the release may not hold its past values` });
      continue;
    }
    const series = Object.hasOwn(bundle.series, key) ? bundle.series[key] : undefined;
    const entry = entries.get(key);
    if (!series || !entry) {
      issues.push({ code: "orphan_vintage_file", path, message: `${key} has no file under series/` });
      continue;
    }
    const row = Object.hasOwn(manifest.series, key) ? manifest.series[key] : undefined;
    if (row?.vintages_sha256 === undefined) {
      issues.push({ code: "manifest_mismatch", path: MANIFEST, message: `${key}: the manifest has no vintages_sha256` });
    } else if (sha256(files[path]!) !== row.vintages_sha256) {
      issues.push({ code: "hash_mismatch", path, message: "the file's bytes do not match the manifest's vintages_sha256" });
    }
    const doc = bundle.vintages[key]!;
    if (doc.key !== key) {
      bad(`key ${quote(doc.key)} is not the file name`);
      continue;
    }
    if (doc.freq !== entry.freq) {
      bad(`freq ${quote(doc.freq)} is not the catalog's ${quote(entry.freq)}`);
      continue;
    }
    if (series.representation !== doc.representation) {
      bad(`series/${key}.json is not in the native representation, so it has no vintages`);
      continue;
    }

    const coverage = doc.provider_coverage;
    if (coverage && instantKey(coverage.from) > instantKey(coverage.to)) bad("provider_coverage ends before it begins");
    if (!sorted(doc.captures.map((capture) => instantKey(capture.retrieved_at)))) bad("captures are not oldest first");
    for (const capture of doc.captures) {
      const [first, last] = capture.scope;
      if (typeof first === "string" && typeof last === "string" && first > last) {
        bad(`the scope of the capture at ${capture.retrieved_at} ends before it begins`);
      }
    }
    if (!sorted(doc.metadata.map((line) => instantKey(line.recorded_from)))) bad("the metadata history is not oldest first");
    const channelOf = new Map(doc.metadata.map((line) => [line.hash, line.metadata.source.channel.via]));

    const current = new Map<string, VintageRow>();
    const seen = new Set<string>();
    let before: VintageRow | null = null;
    for (const version of doc.rows) {
      const { period } = version;
      const bounds = periodBounds(doc.freq, period);
      if (!bounds || bounds.start !== version.period_start || bounds.end !== version.period_end) {
        bad(`${period}: its dates are not that Period's`);
      }
      const start = instantKey(version.recorded_from);
      if (version.recorded_to !== null && instantKey(version.recorded_to) < start) {
        bad(`${period}: a version is replaced before it was first held`);
      }
      if (version.provider_from === null) {
        if (version.provider_to !== null || version.provider_precision !== null) {
          bad(`${period}: a version the Origin did not date carries a provider time`);
        }
      } else if (version.provider_precision === null) {
        bad(`${period}: a version the Origin dated does not say how precisely`);
      } else if (version.provider_to !== null && instantKey(version.provider_to) < instantKey(version.provider_from)) {
        bad(`${period}: a version is superseded before the Origin published it`);
      }
      const channel = channelOf.get(version.metadata);
      if (channel === undefined) bad(`${period}: a version names metadata the file does not hold`);
      else if (channel !== version.channel) bad(`${period}: a version's Channel is not the one its metadata names`);
      if (before !== null && before.period === period) {
        if (before.recorded_to === null) bad(`${period}: more than one version is current`);
        else if (instantKey(before.recorded_to) > start) bad(`${period}: two versions were held at once`);
      } else if (before !== null && (seen.has(period) || version.period_start < before.period_start)) {
        bad(`${period}: versions are not in Period order`);
      }
      seen.add(period);
      before = version;
      if (version.recorded_to === null && !version.deleted) current.set(period, version);
    }

    // The versions current now are the Series' own file, once its gaps are written out.
    const listed = new Set<string>();
    for (const observation of series.observations) {
      const { period } = observation;
      listed.add(period);
      const version = current.get(period);
      if (!version) {
        if (observation.value !== null || observation.status !== "missing") {
          bad(`${period}: series/${key}.json has a value that no current version holds`);
        }
      } else if (version.value !== observation.value || version.status !== observation.status) {
        bad(`${period}: the current version is not what series/${key}.json holds`);
      }
    }
    for (const period of [...current.keys()].filter((p) => !listed.has(p)).sort()) {
      bad(`${period}: a current version is not in series/${key}.json`);
    }
  }
  return issues;
}
