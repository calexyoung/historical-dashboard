/**
 * ReleaseReader v0 (PLAN 4.2): the only way the site reads a Release.
 *
 * `current()` reads `{root}/CURRENT` and opens the Release it names; `open(id)` opens one by id
 * (a pinned or rolled-back Release, later). Opening reads every file of the Release, checks it
 * against the contract (`validateRelease`) and then applies the Surface guard. Hidden here: the
 * file layout, validation on open, caching by release id, and the failed-refresh state.
 *
 * The Surface guard is the reader's part of the interim data rule (PLAN 6.1 point 5): a build for
 * a public Surface refuses every Release that is not public-profile, names an unsigned rights
 * register or holds a legacy Series, and never stands an earlier Release in for one it cannot
 * open: the caller answers 503. Staging is held to production's rule until it has a password
 * that the deploy step can prove (ADR 0015). Only the local Surface has the failed-refresh state.
 *
 * Node only. A Release is immutable once promoted, so a good one is read and validated once,
 * and served from memory for as long as it is still in the root.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open as openFile, readdir, readFile, stat, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { Surface } from "@macro-atlas/core";
import {
  searchDocument,
  SEGMENTS,
  validateRelease,
  type AnnotationsFile,
  type BulkDigests,
  type Datapackage,
  type Catalog,
  type ClaimLock,
  type ClaimsFile,
  type EventsFile,
  type HighlightsFile,
  type LatestFile,
  type Manifest,
  type Release,
  type ReleaseFiles,
  type SearchFile,
  type SeriesFile,
  type TopicsFile,
  type VintageFile,
} from "@macro-atlas/core/release";

/** A Release that passed validation and the Surface guard. Treat as immutable. */
export type OpenedRelease = {
  id: string;
  manifest: Manifest;
  catalog: Catalog;
  annotations: AnnotationsFile;
  /** `content/events.json`: the Events, whole. A Release written before there were any (0.2.0) has none. */
  events: EventsFile;
  /** `content/claims.json`: the Claims, each with its locks by name. A Release written before 0.4.0 has none. */
  claims: ClaimsFile;
  /**
   * `locks/{claim id}.v{n}.lock.json`, by `{claim id}.v{n}`: each lock that is in the Release,
   * read, and as the text that was written (a reader who downloads it can check its hash).
   */
  locks: Record<string, { parsed: ClaimLock; text: string }>;
  /** `evidence/latest.json`: the latest Evidence rows, computed when the Release was written. Null: no lock has one. */
  latest: LatestFile | null;
  /**
   * `content/highlights.json`: the headline Series of each Segment, in the order of the
   * Overview. A Release written before 0.5.0 names none: six Segments, each empty.
   */
  highlights: HighlightsFile;
  /**
   * `search.json`: what a reader can search for, as words. For a Release written before 0.5.0
   * it is the same projection of the Release's own files, made when the Release is opened.
   */
  search: SearchFile;
  /** `content/topics.json`: the Topics, by slug. A Release written before 0.6.0 has none. */
  topics: TopicsFile;
  series: Record<string, SeriesFile>;
  derived: Record<string, SeriesFile>;
  /** `vintages/{key}.json`: what was held for a stored Series over time. Not every Series has one. */
  vintages: Record<string, VintageFile>;
  /**
   * `downloads/datapackage.json` (0.7.0, M25): the bulk files of the Release, each with its
   * size, hash, rows, Series and licence. Null when the Release has none: they are optional,
   * and only a public-profile Release may hold them. The files themselves are never held in
   * memory; `ReleaseReader.download` hands one out.
   */
  downloads: Datapackage | null;
};

/** One bulk file of a Release, to be sent as it is on disk. */
export type DownloadFile = { name: string; bytes: number; sha256: string; /** A new stream of the file's bytes, each time it is called. */ stream(): ReadableStream<Uint8Array> };

export type FailureKind =
  /** No CURRENT, CURRENT is not a release id, or the release directory cannot be read. */
  | "unavailable"
  /** The Release breaks the contract. */
  | "invalid"
  /** The Release is valid but may not be served on this Surface. */
  | "refused"
  /** A pinned Release that retention no longer keeps in this root (`pinned()` only). */
  | "gone";

export type Failure = { ok: false; kind: FailureKind; id: string | null; reason: string };

export type Opened =
  | {
      ok: true;
      release: OpenedRelease;
      /** Local Surface only: CURRENT could not be opened and an earlier good Release is being served. */
      refreshFailed: Omit<Failure, "ok"> | null;
    }
  | Failure;

export type ReleaseReader = {
  /** The promoted Release. Reads CURRENT each time it is called: call it once per request. */
  current(): Promise<Opened>;
  /** One Release by id, under the same validation and the same guard. */
  open(id: string): Promise<Opened>;
  /**
   * The Release a `pin=` names (PLAN 4.5, M18), under the same validation and the same guard as
   * any other. A pin is honoured only while retention keeps the Release: it must be a real
   * directory under `releases/`. Once pruned it is `gone`, even while a copy is still in this
   * process's memory or in the trash, and whatever CURRENT names is never served in its place.
   */
  pinned?(id: string): Promise<Opened>;
  /**
   * The text of the root's `saved.json` (saved queries, a local root only), or null when there
   * is none that can be read. The caller reads it as a fixed selection (lib/explorer/saved.ts).
   */
  savedText?(): Promise<string | null>;
  /**
   * How the writer's last run in this root ended (`STATUS.json`), as a fixed selection; null
   * when there is no record, or none that can be read. It may name a Release other than the
   * one being served: a run that was rejected leaves CURRENT as it was.
   */
  lastRun?(): Promise<LastRun | null>;
  /**
   * One bulk file of a Release this reader may serve (`downloads/{name}`, or the datapackage),
   * or null: the Release cannot be opened here, it names no such file, or the file on disk is
   * no longer the size that was checked when the Release was opened. Only a name the
   * datapackage lists is ever looked for, so no path can be made from the name.
   */
  download?(id: string, name: string): Promise<DownloadFile | null>;
};

export type LastRun = { started: string | null; finished: string | null; outcome: string; release_id: string | null; failed_checks: number };

export const RELEASE_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const LEGACY = "legacy_monthly_rounded";
const KEEP = 4; // opened Releases held in memory
const RETRY_MS = 5_000; // how long a failure to open is remembered before the disk is read again

/**
 * Why `release` may not be served on `surface`, or null if it may. Each condition is checked on
 * its own, whatever the validator already promised about public-profile Releases.
 */
export function refusal(release: Pick<Release, "manifest" | "catalog" | "series" | "derived"> & Partial<Pick<Release, "annotations">>, surface: Surface): string | null {
  if (surface === "local") return null;
  const { manifest, catalog } = release;
  if (manifest.profile !== "public") {
    return `the ${surface} surface serves only public-profile releases; this one's profile is ${JSON.stringify(manifest.profile)}`;
  }
  if (manifest.rights_register?.signed !== true) {
    return `the ${surface} surface serves only releases built against a signed rights register`;
  }
  const legacy = new Set<string>();
  for (const entry of catalog.series) if (entry.representation === LEGACY) legacy.add(entry.key);
  for (const [key, row] of Object.entries(manifest.series)) if (row.representation === LEGACY) legacy.add(key);
  for (const folder of [release.series, release.derived]) {
    for (const [key, doc] of Object.entries(folder)) if (doc.representation === LEGACY) legacy.add(key);
  }
  if (legacy.size > 0) {
    return `the ${surface} surface never serves v1's legacy representation (${[...legacy].sort().slice(0, 3).join(", ")})`;
  }
  // v1's own bands and recessions (M19): a local-profile Release may carry them, no other may.
  const v1 = (release.annotations?.annotations ?? []).filter((a) => a.provenance?.representation === LEGACY).map((a) => a.id);
  if (v1.length > 0) {
    return `the ${surface} surface never serves an Annotation that is v1's (${v1.slice(0, 3).join(", ")})`;
  }
  return null;
}

const POLICY_CODES: ReadonlySet<string> = new Set(["unsigned_register", "legacy_in_public", "draft_in_public"]);

/** The manifest's profile, read leniently from bytes that have not been validated yet. */
function manifestRefusal(bytes: Uint8Array | undefined, surface: Surface): string | null {
  let profile: unknown;
  try {
    profile = (JSON.parse(new TextDecoder().decode(bytes)) as { profile?: unknown } | null)?.profile;
  } catch {
    return null; // not readable as a manifest at all: the validator says how
  }
  if (profile === "public") return null;
  return `the ${surface} surface serves only public-profile releases; this one's profile is ${JSON.stringify(profile) ?? "not given"}`;
}

const DATAPACKAGE = "downloads/datapackage.json";
const NOT_READ = new Uint8Array(0);
/** How much of a bulk file is read for each chunk a response asks for. */
const CHUNK = 64 * 1024;

/** The size and SHA-256 of a file, read as a stream: a bulk file is never held whole in memory. */
async function digestOf(path: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function readFiles(dir: string, digests: BulkDigests): Promise<ReleaseFiles | string> {
  const files: ReleaseFiles = {};
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const full = join(entry.parentPath, entry.name);
    const relative = full.slice(dir.length + 1).split("\\").join("/");
    // A link could point outside the Release; the contract is plain files only.
    if (!entry.isFile()) return `${relative} is not a regular file`;
    if (relative.startsWith("downloads/") && relative !== DATAPACKAGE) {
      // A bulk data file: hashed as it is read, and named to the validator with its digest.
      digests[relative] = await digestOf(full);
      files[relative] = NOT_READ;
      continue;
    }
    files[relative] = await readFile(full);
  }
  return files;
}

export function createReleaseReader(options: {
  /** The release root: holds CURRENT and releases/{id}/. */
  root: string;
  surface: Surface;
  now?: () => number;
}): ReleaseReader {
  const { root, surface } = options;
  const now = options.now ?? Date.now;
  const good = new Map<string, OpenedRelease>(); // insertion order = least recently used first
  const failed = new Map<string, { failure: Failure; until: number }>();
  const opening = new Map<string, Promise<Opened>>();
  let lastGood: OpenedRelease | null = null;
  /** The datapackage's own size and hash, by release id, as read when the Release was opened. */
  const packages = new Map<string, { bytes: number; sha256: string }>();

  const fail = (kind: FailureKind, id: string | null, reason: string): Failure => ({ ok: false, kind, id, reason });

  async function load(id: string): Promise<Opened> {
    let files: ReleaseFiles | string;
    const digests: BulkDigests = {};
    try {
      files = await readFiles(join(root, "releases", id), digests);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "error";
      return fail("unavailable", id, `release ${id} cannot be read (${code})`);
    }
    if (typeof files === "string") return fail("invalid", id, files);
    // Before anything else on a public Surface: what the manifest says of itself. A Release that
    // is not public-profile is refused whether or not the rest of it is well formed.
    const early = surface === "local" ? null : manifestRefusal(files["manifest.json"], surface);
    if (early) return fail("refused", id, early);
    const issues = validateRelease(id, files, digests);
    if (issues.length > 0) {
      // The contract's own profile rules are the same rule seen from the writer's side: a breach
      // is a refusal (503, no fallback), not a failed refresh.
      const breach = issues.find((issue) => POLICY_CODES.has(issue.code));
      if (breach) return fail("refused", id, `${breach.code}: ${breach.message}`);
      const first = issues[0]!;
      const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : "";
      return fail("invalid", id, `${first.code} in ${first.path}: ${first.message}${more}`);
    }
    const decoder = new TextDecoder();
    const parse = <T>(path: string): T => JSON.parse(decoder.decode(files[path])) as T;
    const folder = <T = SeriesFile>(name: "series" | "derived" | "vintages"): Record<string, T> =>
      Object.fromEntries(
        Object.keys(files)
          .filter((path) => path.startsWith(`${name}/`))
          .map((path) => [path.slice(name.length + 1, -".json".length), parse<T>(path)]),
      );
    const release: OpenedRelease = {
      id,
      manifest: parse<Manifest>("manifest.json"),
      catalog: parse<Catalog>("catalog.json"),
      annotations: parse<AnnotationsFile>("content/annotations.json"),
      events: files["content/events.json"] ? parse<EventsFile>("content/events.json") : { events: [] },
      claims: files["content/claims.json"] ? parse<ClaimsFile>("content/claims.json") : { claims: [] },
      locks: Object.fromEntries(
        Object.keys(files)
          .filter((path) => path.startsWith("locks/") && path.endsWith(".lock.json"))
          .map((path) => [path.slice("locks/".length, -".lock.json".length), { parsed: parse<ClaimLock>(path), text: decoder.decode(files[path]) }]),
      ),
      latest: files["evidence/latest.json"] ? parse<LatestFile>("evidence/latest.json") : null,
      highlights: files["content/highlights.json"]
        ? parse<HighlightsFile>("content/highlights.json")
        : ({ segments: SEGMENTS.map((segment) => ({ segment, series: [] })) } as unknown as HighlightsFile),
      search: { entries: [] },
      topics: files["content/topics.json"] ? parse<TopicsFile>("content/topics.json") : { topics: [] },
      series: folder("series"),
      derived: folder("derived"),
      vintages: folder<VintageFile>("vintages"),
      downloads: files[DATAPACKAGE] ? parse<Datapackage>(DATAPACKAGE) : null,
    };
    if (files[DATAPACKAGE]) packages.set(id, { bytes: files[DATAPACKAGE].length, sha256: createHash("sha256").update(files[DATAPACKAGE]).digest("hex") });
    release.search = files["search.json"] ? parse<SearchFile>("search.json") : searchDocument(release);
    const refused = refusal(release, surface);
    if (refused) return fail("refused", id, refused);
    return { ok: true, release, refreshFailed: null };
  }

  /**
   * Whether a Release this process has in memory may still be served from there. The writer
   * takes a Release out of `releases/` by one rename. Retention moves it to `trash/`, where it
   * stays a day: a request that was given its id a moment ago must still be able to finish.
   * A withdrawal moves it out of the root altogether (ADR 0023), and then a copy in memory
   * must not outlive it, or a withdrawn value would be served until the process restarts.
   * Only what is already in memory is served from the trash; nothing is opened from there.
   */
  async function stillThere(id: string): Promise<boolean> {
    for (const folder of ["releases", "trash"]) {
      try {
        if ((await stat(join(root, folder, id, "manifest.json"))).isFile()) return true;
      } catch {
        // not in this folder
      }
    }
    return false;
  }

  async function open(id: string): Promise<Opened> {
    if (typeof id !== "string" || !RELEASE_ID.test(id)) {
      return fail("unavailable", null, "that is not a release id");
    }
    const held = good.get(id) ?? (lastGood?.id === id ? lastGood : undefined);
    if (held) {
      if (await stillThere(id)) {
        good.delete(id);
        good.set(id, held);
        return { ok: true, release: held, refreshFailed: null };
      }
      good.delete(id);
      if (lastGood?.id === id) lastGood = null;
    }
    const remembered = failed.get(id);
    if (remembered && remembered.until > now()) return Promise.resolve(remembered.failure);
    const pending = opening.get(id);
    if (pending) return pending;
    const promise = load(id)
      .then((opened) => {
        if (opened.ok) {
          failed.delete(id);
          good.set(id, opened.release);
          while (good.size > KEEP) {
            const oldest = good.keys().next().value!;
            good.delete(oldest);
            packages.delete(oldest);
          }
        } else {
          failed.set(id, { failure: opened, until: now() + RETRY_MS });
          while (failed.size > 4 * KEEP) failed.delete(failed.keys().next().value!);
        }
        return opened;
      })
      .finally(() => opening.delete(id));
    opening.set(id, promise);
    return promise;
  }

  async function promoted(): Promise<Opened> {
    let id: string;
    try {
      id = (await readFile(join(root, "CURRENT"), "utf8")).trim();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "error";
      return fail("unavailable", null, `CURRENT cannot be read (${code})`);
    }
    if (!RELEASE_ID.test(id)) return fail("unavailable", null, "CURRENT does not hold a release id");
    return open(id);
  }

  async function current(): Promise<Opened> {
    const opened = await promoted();
    if (opened.ok) {
      lastGood = opened.release;
      return opened;
    }
    // Fail closed. On a public Surface there is no fallback at all: an earlier Release is only a
    // safe stand-in when the one CURRENT names would itself have been allowed, and when that one
    // cannot be read or parsed, nobody knows. (ADR 0015.)
    if (surface !== "local" || opened.kind === "refused") {
      lastGood = null;
      return opened;
    }
    const standIn = lastGood; // held here: another request may clear lastGood while this one waits
    if (standIn && (await stillThere(standIn.id))) {
      const { kind, id, reason } = opened;
      return { ok: true, release: standIn, refreshFailed: { kind, id, reason } };
    }
    return opened;
  }

  async function pinned(id: string): Promise<Opened> {
    if (typeof id !== "string" || !RELEASE_ID.test(id)) return fail("unavailable", null, "that is not a release id");
    try {
      // lstat: a link is not a Release of this root (the writer refuses one too).
      if (!(await lstat(join(root, "releases", id))).isDirectory()) return fail("unavailable", id, `release ${id} is not a directory of this root`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "error";
      if (code === "ENOENT" || code === "ENOTDIR") return fail("gone", id, `release ${id} is no longer kept`);
      return fail("unavailable", id, `release ${id} cannot be read (${code})`);
    }
    return open(id);
  }

  async function savedText(): Promise<string | null> {
    try {
      const path = join(root, "saved.json");
      const info = await lstat(path);
      if (!info.isFile() || info.size > 1_000_000) return null;
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  }

  async function lastRun(): Promise<LastRun | null> {
    try {
      const doc = JSON.parse(await readFile(join(root, "STATUS.json"), "utf8")) as Record<string, unknown> | null;
      if (typeof doc !== "object" || doc === null || typeof doc.outcome !== "string" || !/^[a-z_]{1,40}$/.test(doc.outcome)) return null;
      const instant = (value: unknown): string | null => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[0-9:.]{8,18}Z$/.test(value) ? value : null);
      return {
        started: instant(doc.started),
        finished: instant(doc.finished),
        outcome: doc.outcome,
        release_id: typeof doc.release_id === "string" && RELEASE_ID.test(doc.release_id) ? doc.release_id : null,
        // How many, not which: a check's own words are the writer's, and stay with it.
        failed_checks: Array.isArray(doc.failed_checks) ? doc.failed_checks.length : 0,
      };
    } catch {
      return null;
    }
  }

  async function download(id: string, name: string): Promise<DownloadFile | null> {
    // Only a Release kept in `releases/` and opened under the validation and the guard.
    const opened = await pinned(id);
    if (!opened.ok || opened.release.downloads === null || typeof name !== "string") return null;
    let listed: { bytes: number; sha256: string } | undefined;
    if (name === "datapackage.json") listed = packages.get(id);
    else {
      const resource = opened.release.downloads.resources.find((r) => r.path === name);
      if (resource) listed = { bytes: resource.bytes, sha256: resource.hash.slice("sha256:".length) };
    }
    if (!listed) return null;
    // The name is one the datapackage lists, and the contract holds those to a fixed pattern.
    const path = join(root, "releases", id, "downloads", name);
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size !== listed.bytes) return null;
    } catch {
      return null;
    }
    const { bytes, sha256 } = listed;
    return {
      name,
      bytes,
      sha256,
      stream: () => {
        // One handle, opened when the first chunk is asked for and read to the end: a Release
        // renamed into the trash while it is being sent is still sent whole. A chunk is read
        // only when the reader of the response asks for one, so a slow reader holds one chunk
        // in memory and not the file; a reader that goes away closes the handle.
        let handle: FileHandle | null = null;
        let sent = 0;
        const close = async (): Promise<void> => {
          const held = handle;
          handle = null;
          await held?.close().catch(() => undefined);
        };
        return new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              try {
                handle ??= await openFile(path, "r");
                const want = Math.min(CHUNK, bytes - sent);
                const { bytesRead, buffer } = want > 0 ? await handle.read(Buffer.allocUnsafe(want), 0, want, sent) : { bytesRead: 0, buffer: Buffer.alloc(0) };
                if (bytesRead === 0) {
                  await close();
                  // Shorter than the size that was checked: an error, never a file cut short in silence.
                  if (sent !== bytes) controller.error(new Error(`${name} ended after ${sent} of ${bytes} bytes`));
                  else controller.close();
                  return;
                }
                sent += bytesRead;
                controller.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead));
                if (sent === bytes) {
                  await close();
                  controller.close();
                }
              } catch (error) {
                await close();
                controller.error(error);
              }
            },
            cancel: close,
          },
          { highWaterMark: 0 },
        );
      },
    };
  }

  return { current, open, pinned, savedText, lastRun, download };
}
