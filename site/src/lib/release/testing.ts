/**
 * Test support: make variants of the committed fixture release in a temporary release root.
 * Used by unit tests, the built-server suite and Playwright. Never imported by the app.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { searchDocument } from "@macro-atlas/core/release";

export const FIXTURE_ROOT = fileURLToPath(new URL("../../../../fixtures/public", import.meta.url));
export const FIXTURE_ID = readFileSync(join(FIXTURE_ROOT, "CURRENT"), "utf8").trim();

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Variant = {
  /** The new release id (and directory name). */
  id: string;
  profile?: "public" | "local";
  signed?: boolean;
  /**
   * Write it as a Release of an earlier contract. "0.2.0": before Events (M19), so no
   * content/events.json, Claims, locks or latest rows. "0.4.0": before headline Series and the
   * search index (M22), so neither file.
   */
  schema?: "0.2.0" | "0.4.0";
  /** The headline Series of these Segments, in place of the fixture's. */
  highlights?: Record<string, string[]>;
  /** Change the Events in place (content/events.json and its Annotations are the caller's to keep in step). */
  events?: (events: Json[]) => void;
  /** Mark this stored series as v1's legacy representation, consistently in every file. */
  legacy?: string;
  /** Rename this series (catalog `name` only), so two releases can be told apart on a page. */
  rename?: { key: string; name: string };
  /**
   * Change stored series: each function gets the series file and its catalog entry and edits
   * them in place. The manifest's hash is brought up to date; keeping the result valid is the
   * caller's business.
   */
  edit?: Record<string, (file: Json, entry: Json) => void>;
};

export function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "atlas-releases-"));
}

const readJson = (path: string): Json => JSON.parse(readFileSync(path, "utf8")) as Json;
const writeJson = (path: string, doc: Json): void => writeFileSync(path, JSON.stringify(doc, null, 1) + "\n");

/** Copy the fixture release into `root` under a new id, changed as `variant` says. Still valid. */
export function addRelease(root: string, variant: Variant): string {
  const dir = join(root, "releases", variant.id);
  mkdirSync(join(root, "releases"), { recursive: true });
  cpSync(join(FIXTURE_ROOT, "releases", FIXTURE_ID), dir, { recursive: true });
  const manifest = readJson(join(dir, "manifest.json"));
  const catalog = readJson(join(dir, "catalog.json"));
  manifest.release_id = variant.id;
  if (variant.profile) manifest.profile = variant.profile;
  if (variant.signed !== undefined) manifest.rights_register.signed = variant.signed;
  if (variant.schema) {
    manifest.schema_version = variant.schema;
    rmSync(join(dir, "content", "highlights.json"), { force: true });
    rmSync(join(dir, "search.json"), { force: true });
  }
  if (variant.schema === "0.2.0") {
    rmSync(join(dir, "content", "events.json"), { force: true });
    // A Release written before 0.4.0 holds no Claim, lock or latest Evidence row either.
    rmSync(join(dir, "content", "claims.json"), { force: true });
    rmSync(join(dir, "locks"), { recursive: true, force: true });
    rmSync(join(dir, "evidence"), { recursive: true, force: true });
  }
  // A Series whose file is changed here no longer has the history the fixture wrote for it,
  // and a legacy Series never has one: its vintage file goes.
  for (const key of [...(variant.legacy ? [variant.legacy] : []), ...Object.keys(variant.edit ?? {})]) {
    rmSync(join(dir, "vintages", `${key}.json`), { force: true });
    delete manifest.series[key].vintages_sha256;
  }
  if (variant.legacy) {
    const key = variant.legacy;
    const path = join(dir, "series", `${key}.json`);
    const series = readJson(path);
    series.representation = "legacy_monthly_rounded";
    writeJson(path, series);
    manifest.series[key].representation = "legacy_monthly_rounded";
    manifest.series[key].sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
    catalog.series.find((e: Json) => e.key === key).representation = "legacy_monthly_rounded";
  }
  for (const [key, change] of Object.entries(variant.edit ?? {})) {
    const path = join(dir, "series", `${key}.json`);
    const file = readJson(path);
    change(file, catalog.series.find((e: Json) => e.key === key));
    writeJson(path, file);
    manifest.series[key].sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  }
  if (variant.rename) {
    const { key, name } = variant.rename;
    catalog.series.find((e: Json) => e.key === key).name = name;
  }
  writeJson(join(dir, "manifest.json"), manifest);
  writeJson(join(dir, "catalog.json"), catalog);
  if (!variant.schema) {
    if (variant.highlights) {
      const held = readJson(join(dir, "content", "highlights.json"));
      for (const row of held.segments) if (variant.highlights[row.segment]) row.series = variant.highlights[row.segment];
      writeJson(join(dir, "content", "highlights.json"), held);
    }
    const events = readJson(join(dir, "content", "events.json"));
    if (variant.events) {
      variant.events(events.events);
      writeJson(join(dir, "content", "events.json"), events);
    }
    // The search index is a projection of the files above: written again, as a writer would.
    const claims = readJson(join(dir, "content", "claims.json"));
    writeJson(join(dir, "search.json"), searchDocument({ catalog, manifest, events, claims } as Parameters<typeof searchDocument>[0]));
  }
  return dir;
}

/** Promote a release the way the publisher does: write beside CURRENT, then rename over it. */
export function promote(root: string, id: string): void {
  const tmp = join(root, `CURRENT.tmp-${process.pid}`);
  writeFileSync(tmp, id + "\n");
  renameSync(tmp, join(root, "CURRENT"));
}

/**
 * A rights register for tests only: the fixture Origin with a signed decision. It exists so a
 * test can ask a gate that answers differently per Permission (a display-only Series). The
 * committed register (`schema/rights-register.json`) holds no signed row, and nothing the app
 * runs can be handed this table: a gate is passed in as an argument, by a test.
 */
export function fixtureRegister(decision: { display: boolean; redistribute: boolean }): unknown {
  return {
    format: 1,
    version: "test-only",
    cleared_intermediaries: [],
    rows: [
      {
        id: "macro-atlas-fixture",
        kind: "origin",
        origins: ["Macro Atlas fixture (synthetic)"],
        datasets: "*",
        decision: { ...decision, store: false, ml_use: false, signed_by: "Alex", signed_on: "2026-01-01" },
      },
    ],
  };
}
