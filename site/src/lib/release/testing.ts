/**
 * Test support: make variants of the committed fixture release in a temporary release root.
 * Used by unit tests, the built-server suite and Playwright. Never imported by the app.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_ROOT = fileURLToPath(new URL("../../../../fixtures/public", import.meta.url));
export const FIXTURE_ID = readFileSync(join(FIXTURE_ROOT, "CURRENT"), "utf8").trim();

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Variant = {
  /** The new release id (and directory name). */
  id: string;
  profile?: "public" | "local";
  signed?: boolean;
  /** Mark this stored series as v1's legacy representation, consistently in every file. */
  legacy?: string;
  /** Rename this series (catalog `name` only), so two releases can be told apart on a page. */
  rename?: { key: string; name: string };
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
  if (variant.rename) {
    const { key, name } = variant.rename;
    catalog.series.find((e: Json) => e.key === key).name = name;
  }
  writeJson(join(dir, "manifest.json"), manifest);
  writeJson(join(dir, "catalog.json"), catalog);
  return dir;
}

/** Promote a release the way the publisher does: write beside CURRENT, then rename over it. */
export function promote(root: string, id: string): void {
  const tmp = join(root, `CURRENT.tmp-${process.pid}`);
  writeFileSync(tmp, id + "\n");
  renameSync(tmp, join(root, "CURRENT"));
}
