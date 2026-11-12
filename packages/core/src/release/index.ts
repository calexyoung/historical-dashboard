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
import { releaseSchema, SCHEMA_VERSION, SCHEMA_VERSIONS } from "./schema.generated";
import type { Anchor, CatalogEntry, Claim, Event, Release, SearchEntry, SearchFile, SeriesFile, VintageRow } from "./types.generated";

export type * from "./types.generated";
export { SCHEMA_VERSION, SCHEMA_VERSIONS };

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
  | "duplicate_event_id"
  | "bad_event_date"
  | "event_projection"
  | "duplicate_claim_id"
  | "claim_lock"
  | "claim_evidence"
  | "highlights"
  | "search_projection"
  | "duplicate_topic"
  | "topic"
  | "unsigned_register"
  | "legacy_in_public"
  | "draft_in_public"
  | "bulk_files";

/** One way a Release breaks the contract. */
export type Issue = { code: IssueCode; path: string; message: string };

const MANIFEST = "manifest.json";
const CATALOG = "catalog.json";
const ANNOTATIONS = "content/annotations.json";
const EVENTS = "content/events.json";
const CLAIMS = "content/claims.json";
const LATEST = "evidence/latest.json";
const HIGHLIGHTS = "content/highlights.json";
const SEARCH = "search.json";
const TOPICS = "content/topics.json";
const DATAPACKAGE = "downloads/datapackage.json";
const OPTIONAL_FILES: readonly string[] = [EVENTS, CLAIMS, LATEST, HIGHLIGHTS, SEARCH, TOPICS, DATAPACKAGE];
/** The versions that have no bulk files; from 0.7.0 (M25) a public-profile Release may have them. */
const BEFORE_BULK: readonly unknown[] = ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0"];
const LICENCE = "public_domain|cc_by|citation_required|permission_required|no_redistribution|unknown";
/** A bulk data file (ADR 0039): the Observations in three formats, the versions in one, each whole or for one licence class. */
const BULK_FILE = new RegExp(`^downloads/(?:observations(?:\\.(${LICENCE}))?\\.(?:parquet|csv\\.gz|ndjson\\.gz)|vintages(?:\\.(${LICENCE}))?\\.parquet)$`);
/**
 * A bulk data file a reader did not hold in memory: its size and SHA-256, worked out as it was
 * read. Its path is in the files with any value; a path with no digest is hashed here.
 */
export type BulkDigests = Record<string, { bytes: number; sha256: string }>;
/** The versions that have no headline Series and no search index; from 0.5.0 (M22) a Release must have both files. */
const BEFORE_SEARCH: readonly unknown[] = ["0.1.0", "0.2.0", "0.3.0", "0.4.0"];
/** The versions that have no Topics; from 0.6.0 (M23) a Release must have content/topics.json. */
const BEFORE_TOPICS: readonly unknown[] = [...BEFORE_SEARCH, "0.5.0"];
/** The six Segments, in the order of the Overview (CONTEXT.md, Segment). */
export const SEGMENTS = ["economy_jobs", "markets_money", "infrastructure", "governance_politics", "disasters_health", "us_in_the_world"] as const;
/** The versions that have no Claims, locks or latest Evidence rows; from 0.4.0 (M20) a Release must have content/claims.json. */
const BEFORE_CLAIMS: readonly unknown[] = ["0.1.0", "0.2.0", "0.3.0"];
/** The fields of a Claim its lock freezes (atlas/content/claims.py, RECORD_FIELDS). */
const CLAIM_RECORD = ["claimant", "said_on", "said_at", "venue", "sources", "quote", "readings", "readings_not_measured", "selection_note", "checked_on"] as const;
/** Compared as values, whatever order a writer put an object's names in (as Python's == does). */
function sameValue(a: unknown, b: unknown): boolean {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => [k, sorted(v)]))
        : value;
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}
const LOCK_FILE = /^locks\/([0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.v[1-9][0-9]{0,3})\.lock\.json$/;
const REQUIRED_FILES = [MANIFEST, CATALOG, ANNOTATIONS] as const;
/** The versions that have no content/events.json; from 0.3.0 (M19) a Release must have it. */
const BEFORE_EVENTS: readonly unknown[] = ["0.1.0", "0.2.0"];
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
  if (head === "locks" && rest.length > 0) return [`locks/${rest[0]}.lock.json`, "/" + rest.slice(1).join("/")];
  const named: Record<string, string> = { manifest: MANIFEST, catalog: CATALOG, annotations: ANNOTATIONS, events: EVENTS, claims: CLAIMS, latest: LATEST, highlights: HIGHLIGHTS, search: SEARCH, topics: TOPICS, datapackage: DATAPACKAGE };
  const file = named[head ?? ""] ?? MANIFEST;
  return [file, "/" + rest.join("/")];
}

/**
 * The ways a Release breaks the contract. Empty means valid.
 *
 * Checks run in stages and stop at the first stage that finds something, so a reader is never
 * shown consequences of a problem instead of the problem: files present and named by the
 * contract, JSON, schema version, schema, the cross-file rules, then the vintage files.
 */
export function validateRelease(releaseId: string, files: ReleaseFiles, digests: BulkDigests = {}): Issue[] {
  const issues: Issue[] = [];
  const has = (code: IssueCode): boolean => issues.some((i) => i.code === code);
  const seriesPaths: Record<Folder, Map<string, string>> = { series: new Map(), derived: new Map() };
  const vintagePaths = new Map<string, string>();
  const lockPaths = new Map<string, string>();
  const bulkPaths: string[] = []; // bulk data files; they are not JSON and are never parsed here

  for (const path of Object.keys(files).sort()) {
    const match = SERIES_FILE.exec(path);
    const lock = LOCK_FILE.exec(path);
    if (match && match[1] === "vintages") vintagePaths.set(match[2]!, path);
    else if (match) seriesPaths[match[1] as Folder].set(match[2]!, path);
    else if (lock) lockPaths.set(lock[1]!, path);
    else if (BULK_FILE.test(path)) bulkPaths.push(path);
    else if (!(REQUIRED_FILES as readonly string[]).includes(path) && !OPTIONAL_FILES.includes(path)) {
      issues.push({ code: "unknown_file", path, message: "the release contract does not name this file" });
    }
  }
  for (const path of REQUIRED_FILES) {
    if (!files[path]) issues.push({ code: "missing_file", path, message: "a release must have this file" });
  }
  if (has("missing_file")) return issues;

  const parsed = new Map<string, unknown>();
  const known = [
    ...REQUIRED_FILES, ...FOLDERS.flatMap((f) => [...seriesPaths[f].values()]), ...vintagePaths.values(),
    ...OPTIONAL_FILES.filter((path) => files[path]), ...lockPaths.values(),
  ];
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
  if (version !== undefined && version !== null && !SCHEMA_VERSIONS.includes(version as string)) {
    issues.push({
      code: "unsupported_schema_version",
      path: MANIFEST,
      message: `this reader knows schema_version ${SCHEMA_VERSIONS.join(" and ")}, not ${quote(version)}`,
    });
    return issues;
  }
  if (version === "0.1.0") {
    for (const path of [...vintagePaths.values()].sort()) {
      issues.push({ code: "unknown_file", path, message: "schema_version 0.1.0 does not name this file" });
    }
  }
  if (BEFORE_EVENTS.includes(version) && files[EVENTS]) {
    issues.push({ code: "unknown_file", path: EVENTS, message: `schema_version ${String(version)} does not name this file` });
  }
  if (version !== undefined && !BEFORE_EVENTS.includes(version) && !files[EVENTS]) {
    issues.push({ code: "missing_file", path: EVENTS, message: "a release must have this file" });
  }
  if (BEFORE_CLAIMS.includes(version)) {
    for (const path of [CLAIMS, LATEST, ...lockPaths.values()].filter((p) => files[p]).sort()) {
      issues.push({ code: "unknown_file", path, message: `schema_version ${String(version)} does not name this file` });
    }
  } else if (version !== undefined && !files[CLAIMS]) {
    issues.push({ code: "missing_file", path: CLAIMS, message: "a release must have this file" });
  }
  for (const path of [HIGHLIGHTS, SEARCH]) {
    if (BEFORE_SEARCH.includes(version) && files[path]) {
      issues.push({ code: "unknown_file", path, message: `schema_version ${String(version)} does not name this file` });
    } else if (version !== undefined && !BEFORE_SEARCH.includes(version) && !files[path]) {
      issues.push({ code: "missing_file", path, message: "a release must have this file" });
    }
  }
  if (BEFORE_TOPICS.includes(version) && files[TOPICS]) {
    issues.push({ code: "unknown_file", path: TOPICS, message: `schema_version ${String(version)} does not name this file` });
  } else if (version !== undefined && !BEFORE_TOPICS.includes(version) && !files[TOPICS]) {
    issues.push({ code: "missing_file", path: TOPICS, message: "a release must have this file" });
  }
  if (BEFORE_BULK.includes(version)) {
    for (const path of [DATAPACKAGE, ...bulkPaths].filter((p) => files[p]).sort()) {
      issues.push({ code: "unknown_file", path, message: `schema_version ${String(version)} does not name this file` });
    }
  }
  if (issues.length > 0) return issues;

  const collect = (folder: Folder): Record<string, unknown> =>
    Object.fromEntries([...seriesPaths[folder]].map(([key, path]) => [key, parsed.get(path)]));
  const bundle = {
    manifest: manifestDoc,
    catalog: parsed.get(CATALOG),
    series: collect("series"),
    derived: collect("derived"),
    vintages: Object.fromEntries([...vintagePaths].map(([key, path]) => [key, parsed.get(path)])),
    annotations: parsed.get(ANNOTATIONS),
    ...(parsed.has(EVENTS) ? { events: parsed.get(EVENTS) } : {}),
    ...(parsed.has(CLAIMS) ? { claims: parsed.get(CLAIMS), locks: Object.fromEntries([...lockPaths].map(([name, path]) => [name, parsed.get(path)])) } : {}),
    ...(parsed.has(LATEST) ? { latest: parsed.get(LATEST) } : {}),
    ...(parsed.has(HIGHLIGHTS) ? { highlights: parsed.get(HIGHLIGHTS) } : {}),
    ...(parsed.has(SEARCH) ? { search: parsed.get(SEARCH) } : {}),
    ...(parsed.has(TOPICS) ? { topics: parsed.get(TOPICS) } : {}),
    ...(parsed.has(DATAPACKAGE) ? { datapackage: parsed.get(DATAPACKAGE) } : {}),
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
  issues.push(...claimRules(bundle as Release, files, lockPaths));
  // A last stage: a vintage file is judged against Series files that are sound, and the headline
  // Series and the search index against a Catalog and content that are.
  if (issues.length === 0) issues.push(...vintageRules(bundle as Release, files, vintagePaths));
  if (issues.length === 0) issues.push(...readingRules(bundle as Release));
  // Last of all: the bulk files, against a Release that is otherwise sound.
  if (issues.length === 0) issues.push(...bulkRules(bundle as Release, files, bulkPaths, digests));
  return issues;
}

/**
 * 0.7.0 (M25; ADR 0039): bulk files are a public-profile Release's alone; the datapackage names
 * every data file once, with its size and hash, and no file it does not name is there; it is
 * this Release's; and a Series it lists is one this Release publishes, natively, under the
 * licence class a file for one class says. What a table's rows are cannot be read here (the
 * validators read no Parquet): that is the writer's own check.
 */
function bulkRules(release: Release, files: ReleaseFiles, bulkPaths: string[], digests: BulkDigests): Issue[] {
  const issues: Issue[] = [];
  const pack = release.datapackage;
  if (pack === undefined && bulkPaths.length === 0) return issues;
  const { manifest } = release;
  const add = (path: string, message: string, code: IssueCode = "bulk_files"): void => void issues.push({ code, path, message });
  if (manifest.profile !== "public") add(pack !== undefined ? DATAPACKAGE : bulkPaths[0]!, "bulk files are written only for a public-profile release");
  if (pack === undefined) {
    for (const path of bulkPaths) add(path, "there is no downloads/datapackage.json to name it");
    return issues;
  }
  if (pack.release_id !== manifest.release_id) add(DATAPACKAGE, `it is release ${pack.release_id}'s, not this one's`);
  // Its licence statements rest on a rights register: the one this Release was decided by.
  if (pack.rights_register.version !== manifest.rights_register.version || (pack.rights_register.sha256 ?? null) !== (manifest.rights_register.sha256 ?? null)) {
    add(DATAPACKAGE, "its rights register is not the one the manifest names");
  }
  const statuses = new Map(release.catalog.series.map((entry) => [entry.key, entry.rights.status as string]));
  const named = new Set<string>();
  const names = new Set<string>();
  for (const resource of pack.resources) {
    const path = `downloads/${resource.path}`;
    const match = BULK_FILE.exec(path);
    // A Data Package tells its resources apart by name.
    if (names.has(resource.name)) add(DATAPACKAGE, `the name ${resource.name} is given to two resources`);
    names.add(resource.name);
    if (named.has(path)) {
      add(DATAPACKAGE, `${resource.path} is named twice`);
      continue;
    }
    named.add(path);
    if (match === null || !Object.hasOwn(files, path)) {
      add(DATAPACKAGE, `${resource.path} is not a bulk file of this release`);
      continue;
    }
    const digest = Object.hasOwn(digests, path) ? digests[path]! : { bytes: files[path]!.length, sha256: sha256(files[path]!) };
    if (resource.bytes !== digest.bytes || resource.hash !== `sha256:${digest.sha256}`) add(path, "the file's bytes do not match the datapackage's bytes and hash", "hash_mismatch");
    const licence = match[1] ?? match[2];
    if (resource.licence !== licence) add(DATAPACKAGE, `${resource.path}: its licence is not the one its name says`);
    for (const key of resource.series) {
      const row = Object.hasOwn(manifest.series, key) ? manifest.series[key] : undefined;
      if (row === undefined || row.representation !== "native") add(DATAPACKAGE, `${resource.path} lists ${key}, which this release does not publish natively`);
      else if (licence !== undefined && path.startsWith("downloads/observations") && statuses.get(key) !== licence) add(DATAPACKAGE, `${resource.path} lists ${key}, whose licence class is not ${licence}`);
    }
  }
  for (const path of bulkPaths) if (!named.has(path)) add(path, "the datapackage does not name this file");
  return issues;
}

/**
 * `search.json` (0.5.0, M22; ADR 0036): what a reader can search for in a Release, as words. One
 * entry for every Series of `catalog.json`, then every Event, then every Claim, then (0.6.0,
 * M23) every Topic, each in its
 * file's order. It is a projection of those files and of the manifest's withheld list,
 * and of nothing else: no Observation, lock or Evidence row is read to make it, so no value can
 * enter it from data (a description or a quote is content a person wrote, public on its own page). The Python twin (`atlas.release.search_document`) is what writers write.
 */
export function searchDocument(release: Pick<Release, "catalog" | "manifest" | "events" | "claims" | "topics">): SearchFile {
  const words = (...values: unknown[]): string[] => values.filter((value): value is string => typeof value === "string" && value !== "");
  const gone = new Set(release.manifest.withheld.map((row) => row.key));
  const entries: SearchEntry[] = [];
  for (const entry of release.catalog.series) {
    const origin = entry.source?.origin;
    entries.push({
      kind: "series", id: entry.key, title: entry.name, text: entry.description || "",
      keywords: words(entry.unit, origin?.producer, origin?.dataset, origin?.origin_id, entry.country, ...(entry.topics ?? [])),
      ...(gone.has(entry.key) ? { withheld: true as const } : {}),
    });
  }
  for (const event of release.events?.events ?? []) {
    entries.push({ kind: "event", id: event.id, title: event.title, text: event.description, keywords: words(event.category, event.date, ...(event.topics ?? [])) });
  }
  for (const claim of release.claims?.claims ?? []) {
    const who = claim.claimant;
    entries.push({ kind: "claim", id: claim.id, title: `${who.name}, ${claim.said_on}`, text: claim.quote, keywords: words(who.name, who.role, who.party, ...(claim.topics ?? [])) });
  }
  for (const topic of release.topics?.topics ?? []) {
    // The text is the definition the Topic quotes: a cited source's words, public on its page.
    entries.push({ kind: "topic", id: topic.slug, title: topic.title, text: topic.definition.quote, keywords: words(topic.definition.source.name, topic.main) });
  }
  return { entries };
}

/**
 * 0.6.0 (M23; ADR 0037): a Topic is listed once; its main Series is one of its member Series; a
 * Companion is not the main Series and is listed once; a range has each member once; and every
 * Event it lists is an Event of this Release. A Series is named by key whether or not the
 * Release holds it, as an Event's related Series are. A public-profile Release holds no draft
 * Topic.
 */
function topicRules(bundle: Release): Issue[] {
  const issues: Issue[] = [];
  const held = bundle.topics;
  if (!held) return issues;
  const add = (code: IssueCode, message: string) => issues.push({ code, path: TOPICS, message });
  const events = new Set((bundle.events?.events ?? []).map((event) => event.id));
  const seen = new Set<string>();
  for (const topic of held.topics) {
    const slug = topic.slug;
    if (seen.has(slug)) add("duplicate_topic", `${slug} appears more than once`);
    seen.add(slug);
    if (!topic.series.includes(topic.main)) add("topic", `${slug}: its main Series ${topic.main} is not one of its member Series`);
    const companions = topic.companions.map((companion) => companion.series);
    if (companions.includes(topic.main)) add("topic", `${slug}: its main Series is listed as its own Companion`);
    if (new Set(companions).size !== companions.length) add("topic", `${slug}: a Companion is listed twice`);
    const members = (topic.range?.members ?? []).map((member) => member.key);
    if (new Set(members).size !== members.length) add("topic", `${slug}: a member of its range is listed twice`);
    for (const event of topic.events) {
      if (!events.has(event)) add("topic", `${slug}: it lists the Event ${event}, which is not an Event of this release`);
    }
    if (bundle.manifest.profile === "public" && topic.status === "draft") add("draft_in_public", `${slug} is a draft`);
  }
  return issues;
}

/**
 * 0.5.0 (M22; ADR 0036): the headline Series are Series of this Release, each under its own
 * Segment, and the search index is the projection of the Release's own files and no more.
 */
function readingRules(bundle: Release): Issue[] {
  const issues: Issue[] = [];
  const held = bundle.highlights;
  if (held) {
    const segmentOf = new Map(bundle.catalog.series.map((entry) => [entry.key, entry.segment as string | undefined]));
    if (held.segments.map((row) => row.segment).join() !== SEGMENTS.join()) {
      issues.push({ code: "highlights", path: HIGHLIGHTS, message: "it does not list the six Segments once each, in the order of the Overview" });
    }
    const seen = new Set<string>();
    for (const row of held.segments) {
      for (const key of row.series) {
        if (!segmentOf.has(key)) issues.push({ code: "highlights", path: HIGHLIGHTS, message: `${key} is not a Series of this release's catalog` });
        else if (segmentOf.get(key) !== row.segment) {
          issues.push({ code: "highlights", path: HIGHLIGHTS, message: `${key} is listed under ${row.segment} and the catalog puts it in ${String(segmentOf.get(key))}` });
        }
        if (seen.has(key)) issues.push({ code: "highlights", path: HIGHLIGHTS, message: `${key} is listed more than once` });
        seen.add(key);
      }
    }
  }
  issues.push(...topicRules(bundle));
  const index = bundle.search;
  if (index) {
    const expected = searchDocument(bundle).entries;
    if (index.entries.length !== expected.length) {
      issues.push({ code: "search_projection", path: SEARCH, message: `it holds ${index.entries.length} entries and the release's Series, Events, Claims and Topics are ${expected.length}` });
    }
    for (let i = 0; i < Math.min(index.entries.length, expected.length); i++) {
      const want = expected[i]!;
      if (!sameValue(index.entries[i], want)) {
        issues.push({ code: "search_projection", path: SEARCH, message: `the entry for ${want.kind} ${want.id} is not the projection of the release's own files` });
      }
    }
  }
  return issues;
}

/**
 * 0.4.0 (M20; ADR 0034): Claims, their locks and the latest Evidence rows agree. A lock file is
 * the lock of a Claim in the Release, listed there with the hash of its bytes; a Claim's locks
 * are listed whole, 1 to the newest, each in the Release or named without its numbers; and
 * there is a latest row for the newest lock of exactly the Claims whose newest lock is in the
 * Release. A public-profile Release holds no draft Claim, no public Claim without a lock, and
 * no lock computed on a local-profile Release.
 */
function claimRules(bundle: Release, files: ReleaseFiles, lockPaths: Map<string, string>): Issue[] {
  if (!bundle.claims) return [];
  const issues: Issue[] = [];
  const add = (code: IssueCode, path: string, message: string): void => void issues.push({ code, path, message });
  const isPublic = bundle.manifest.profile === "public";
  const claims = new Map<string, Claim>();
  for (const claim of bundle.claims.claims) {
    if (claims.has(claim.id)) add("duplicate_claim_id", CLAIMS, `${claim.id} appears more than once`);
    claims.set(claim.id, claim);
    if (isPublic && claim.status === "draft") add("draft_in_public", CLAIMS, `${claim.id} is a draft`);
    if (isPublic && claim.locks.length === 0) add("claim_lock", CLAIMS, `${claim.id} is public and has no lock`);
    claim.locks.forEach((row, index) => {
      const name = `${claim.id}.v${row.version}`;
      if (row.version !== index + 1) add("claim_lock", CLAIMS, `${claim.id}: its locks are not listed whole, 1 to the newest`);
      if (row.state === "in_release") {
        if (row.sha256 === undefined || row.why !== undefined) add("claim_lock", CLAIMS, `${name} is in the release and is not listed with its hash alone`);
        else if (!lockPaths.has(name)) add("claim_lock", CLAIMS, `${name} is listed as in the release and its file is not`);
      } else if (row.sha256 !== undefined || row.why === undefined) {
        add("claim_lock", CLAIMS, `${name} is not in the release and is not listed with the reason alone`);
      }
    });
  }
  const need = new Map<string, number>();
  for (const [name, path] of [...lockPaths].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const lock = bundle.locks![name]!;
    const claim = claims.get(lock.claim_id);
    if (name !== `${lock.claim_id}.v${lock.version}`) {
      add("claim_lock", path, "the file is not named for the Claim and version it holds");
      continue;
    }
    const row = claim?.locks.find((one) => one.version === lock.version);
    if (!claim || !row) {
      add("claim_lock", path, "no Claim of the release lists this lock");
      continue;
    }
    if (row.state !== "in_release" || row.sha256 !== sha256(files[path]!)) add("claim_lock", path, "it is not the file the Claim lists (state and sha256)");
    if (row.record_sha256 !== lock.record_sha256) add("claim_lock", path, "its record_sha256 is not the one the Claim lists");
    if (isPublic && lock.release.profile !== "public") add("claim_lock", path, "it was computed on a local-profile Release, which is never public");
    if (lock.version === claim.locks.length) {
      need.set(claim.id, lock.version);
      // The statement shown is the one the evidence was frozen for.
      const changed = CLAIM_RECORD.filter((name) => !sameValue(claim[name], lock.record[name]));
      if (changed.length > 0) add("claim_lock", CLAIMS, `${claim.id}: its ${changed.join(", ")} is not what its newest lock froze`);
    }
  }
  const missing = (ids: string[]): void => {
    for (const id of ids.sort()) add("claim_evidence", LATEST, `${id} v${need.get(id)} is in the release and has no latest row`);
  };
  const held = bundle.latest;
  if (!held) {
    missing([...need.keys()]);
    return issues;
  }
  const seen = new Set<string>();
  for (const entry of held.claims) {
    if (seen.has(entry.claim_id) || need.get(entry.claim_id) !== entry.lock_version) {
      add("claim_evidence", LATEST, `${entry.claim_id} v${entry.lock_version} is not the newest lock, in the release, of a Claim of the release, named once`);
      continue;
    }
    seen.add(entry.claim_id);
    const lock = bundle.locks![`${entry.claim_id}.v${entry.lock_version}`]!;
    if (JSON.stringify(entry.readings.map((r) => r.id)) !== JSON.stringify(lock.record.readings.map((r) => r.id))) {
      add("claim_evidence", LATEST, `${entry.claim_id}: its latest rows are not the lock's readings, in order`);
    }
  }
  missing([...need.keys()].filter((id) => !seen.has(id)));
  if (held.claims.length === 0) add("claim_evidence", LATEST, "the file is there only when a lock has a latest row");
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
  issues.push(...eventRules(bundle));

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
    for (const event of bundle.events?.events ?? []) {
      if (event.status === "draft") add("draft_in_public", EVENTS, `${event.id} is a draft`);
    }
    for (const annotation of bundle.annotations.annotations) {
      if (annotation.provenance?.representation === LEGACY) {
        add("legacy_in_public", ANNOTATIONS, `${annotation.id} is v1's, which is never public`);
      }
    }
  }
  return issues;
}

/**
 * Where an Event sits on a time axis: a day is a date, a month or a year is that Period, and an
 * Event with an end is a span of whole days. Null when its dates are not ones a calendar has, or
 * are not as precise as it says.
 */
export function eventAnchor(event: Pick<Event, "date" | "end" | "date_precision">): Anchor | null {
  const freq = { year: "annual", month: "monthly", day: "daily" }[event.date_precision];
  const start = periodBounds(freq, event.date);
  if (!start) return null;
  if (event.end !== undefined) {
    const end = periodBounds(freq, event.end);
    return end ? { type: "span", start: start.start, end: end.end } : null;
  }
  return event.date_precision === "day" ? { type: "date", date: event.date } : { type: "period", period: event.date };
}

/**
 * 0.3.0: every Event is drawn as exactly one Annotation that says what the Event says, and every
 * Annotation of kind `event` is the projection of an Event.
 */
function eventRules(bundle: Release): Issue[] {
  if (!bundle.events) return [];
  const issues: Issue[] = [];
  const events = new Map<string, Event>();
  for (const event of bundle.events.events) {
    if (events.has(event.id)) issues.push({ code: "duplicate_event_id", path: EVENTS, message: `${event.id} appears more than once` });
    events.set(event.id, event);
    const anchor = eventAnchor(event);
    if (anchor === null) {
      issues.push({ code: "bad_event_date", path: EVENTS, message: `${event.id}: its date or end is not a ${event.date_precision} of the calendar` });
    } else if (anchor.type === "span" && anchor.end !== null && anchor.end < anchor.start) {
      issues.push({ code: "bad_event_date", path: EVENTS, message: `${event.id} ends before it starts` });
    }
  }
  const same = (a: unknown, b: unknown): boolean => {
    // Compared as values, whatever order a writer put an object's names in (as Python's == does).
    const sorted = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(sorted)
        : value !== null && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => [k, sorted(v)]))
          : value;
    return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  };
  const projected = new Set<string>();
  for (const annotation of bundle.annotations.annotations) {
    if (annotation.kind !== "event") continue;
    const ref = annotation.ref ?? "";
    const id = ref.startsWith("content/events/") && ref.endsWith(".md") ? ref.slice("content/events/".length, -".md".length) : null;
    const event = id === null ? undefined : events.get(id);
    if (!event || annotation.id !== `event-${id}`) {
      issues.push({ code: "event_projection", path: ANNOTATIONS, message: `${annotation.id} is not the Annotation of an Event in ${EVENTS}` });
      continue;
    }
    projected.add(event.id);
    const first = event.sources[0]!;
    const source = Object.fromEntries((["name", "url", "archive_url"] as const).filter((n) => first[n] !== undefined).map((n) => [n, first[n]]));
    if (!same([annotation.label, annotation.category ?? null, annotation.anchor, annotation.source], [event.title, event.category, eventAnchor(event), source])) {
      issues.push({ code: "event_projection", path: ANNOTATIONS, message: `${annotation.id} does not say what its Event says (title, category, date or first citation)` });
    }
  }
  for (const id of events.keys()) {
    if (!projected.has(id)) issues.push({ code: "event_projection", path: EVENTS, message: `${id} has no Annotation` });
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

/** JSON with every object's keys in order, so two values are the same text exactly when equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
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
    const captured = new Set(doc.captures.map((capture) => instantKey(capture.retrieved_at)));
    const channelOf = new Map<string, string>();
    const since = new Map<string, string>(); // metadata hash -> when it was first recorded
    const said = new Map<string, string>();
    for (const line of doc.metadata) {
      if (!since.has(line.hash)) since.set(line.hash, instantKey(line.recorded_from));
      const text = canonical(line.metadata);
      if (!said.has(line.hash)) said.set(line.hash, text);
      else if (said.get(line.hash) !== text) bad(`two different metadata share the hash ${line.hash.slice(0, 12)}`);
      channelOf.set(line.hash, line.metadata.source.channel.via);
    }

    const current = new Map<string, VintageRow>();
    const seen = new Set<string>();
    let before: VintageRow | null = null;
    let dated: VintageRow | null = null; // the last version of this Period that the Origin dated
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
      if (!captured.has(start) || (version.recorded_to !== null && !captured.has(instantKey(version.recorded_to)))) {
        bad(`${period}: a version is held from or to a time that is no Capture's`);
      }
      const recorded = since.get(version.metadata);
      if (recorded !== undefined && start < recorded) {
        bad(`${period}: a version is held before the metadata it names was recorded`);
      }
      if (before === null || before.period !== period) dated = null;
      if (version.provider_from !== null) {
        if (dated !== null && (dated.provider_to === null || instantKey(dated.provider_to) > instantKey(version.provider_from))) {
          bad(`${period}: two versions the Origin dated were in force at once`);
        }
        dated = version;
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
