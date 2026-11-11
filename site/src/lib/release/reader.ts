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
 * register or holds a legacy Series. A refused Release is never replaced by an earlier one: the
 * caller answers 503. Staging is held to production's rule until it has a password that the
 * deploy step can prove (ADR 0015).
 *
 * Node only. A Release is immutable once promoted, so a good one is read and validated once.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Surface } from "@macro-atlas/core";
import {
  validateRelease,
  type AnnotationsFile,
  type Catalog,
  type Manifest,
  type Release,
  type ReleaseFiles,
  type SeriesFile,
} from "@macro-atlas/core/release";

/** A Release that passed validation and the Surface guard. Treat as immutable. */
export type OpenedRelease = {
  id: string;
  manifest: Manifest;
  catalog: Catalog;
  annotations: AnnotationsFile;
  series: Record<string, SeriesFile>;
  derived: Record<string, SeriesFile>;
};

export type FailureKind =
  /** No CURRENT, CURRENT is not a release id, or the release directory cannot be read. */
  | "unavailable"
  /** The Release breaks the contract. */
  | "invalid"
  /** The Release is valid but may not be served on this Surface. */
  | "refused";

export type Failure = { ok: false; kind: FailureKind; id: string | null; reason: string };

export type Opened =
  | {
      ok: true;
      release: OpenedRelease;
      /** Set when CURRENT could not be opened and an earlier good Release is being served. */
      refreshFailed: Omit<Failure, "ok"> | null;
    }
  | Failure;

export type ReleaseReader = {
  /** The promoted Release. Reads CURRENT each time it is called: call it once per request. */
  current(): Promise<Opened>;
  /** One Release by id, under the same validation and the same guard. */
  open(id: string): Promise<Opened>;
};

export const RELEASE_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$/;
const LEGACY = "legacy_monthly_rounded";
const KEEP = 4; // opened Releases held in memory
const RETRY_MS = 5_000; // how long a failure to open is remembered before the disk is read again

/**
 * Why `release` may not be served on `surface`, or null if it may. Each condition is checked on
 * its own, whatever the validator already promised about public-profile Releases.
 */
export function refusal(release: Pick<Release, "manifest" | "catalog" | "series" | "derived">, surface: Surface): string | null {
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

async function readFiles(dir: string): Promise<ReleaseFiles | string> {
  const files: ReleaseFiles = {};
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const full = join(entry.parentPath, entry.name);
    const relative = full.slice(dir.length + 1).split("\\").join("/");
    // A link could point outside the Release; the contract is plain files only.
    if (!entry.isFile()) return `${relative} is not a regular file`;
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

  const fail = (kind: FailureKind, id: string | null, reason: string): Failure => ({ ok: false, kind, id, reason });

  async function load(id: string): Promise<Opened> {
    let files: ReleaseFiles | string;
    try {
      files = await readFiles(join(root, "releases", id));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "error";
      return fail("unavailable", id, `release ${id} cannot be read (${code})`);
    }
    if (typeof files === "string") return fail("invalid", id, files);
    // Before anything else on a public Surface: what the manifest says of itself. A Release that
    // is not public-profile is refused whether or not the rest of it is well formed.
    const early = surface === "local" ? null : manifestRefusal(files["manifest.json"], surface);
    if (early) return fail("refused", id, early);
    const issues = validateRelease(id, files);
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
    const folder = (name: "series" | "derived"): Record<string, SeriesFile> =>
      Object.fromEntries(
        Object.keys(files)
          .filter((path) => path.startsWith(`${name}/`))
          .map((path) => [path.slice(name.length + 1, -".json".length), parse<SeriesFile>(path)]),
      );
    const release: OpenedRelease = {
      id,
      manifest: parse<Manifest>("manifest.json"),
      catalog: parse<Catalog>("catalog.json"),
      annotations: parse<AnnotationsFile>("content/annotations.json"),
      series: folder("series"),
      derived: folder("derived"),
    };
    const refused = refusal(release, surface);
    if (refused) return fail("refused", id, refused);
    return { ok: true, release, refreshFailed: null };
  }

  function open(id: string): Promise<Opened> {
    if (typeof id !== "string" || !RELEASE_ID.test(id)) {
      return Promise.resolve(fail("unavailable", null, "that is not a release id"));
    }
    const held = good.get(id) ?? (lastGood?.id === id ? lastGood : undefined);
    if (held) {
      good.delete(id);
      good.set(id, held);
      return Promise.resolve({ ok: true, release: held, refreshFailed: null });
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
          while (good.size > KEEP) good.delete(good.keys().next().value!);
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
    // Fail closed: a Release this Surface may not serve is never papered over with an older one.
    if (opened.kind === "refused") {
      lastGood = null;
      return opened;
    }
    if (lastGood) {
      const { kind, id, reason } = opened;
      return { ok: true, release: lastGood, refreshFailed: { kind, id, reason } };
    }
    return opened;
  }

  return { current, open };
}
