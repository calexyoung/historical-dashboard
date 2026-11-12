/**
 * A Release directory as the claim engine reads it (Node only): its Catalog, its stored Series
 * and, where it holds them, their vintage files. Reads; writes nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaimSource } from "../claim";
import type { RecipeSeries } from "../recipe";
import type { VintageFile } from "../release/types.generated";
import type { ResolveSeries } from "../vintage";

const KEY = /^[a-z][a-z0-9_]{0,63}$/;

export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

export function releaseSource(root: string, releaseId: string): ClaimSource {
  const entries = (readJson(join(root, "catalog.json")) as { series: (RecipeSeries & { allowed_transforms?: string[] })[] }).series;
  const files = new Map<string, ResolveSeries | null>();
  const load = (key: string): ResolveSeries | null => {
    if (!files.has(key)) {
      const path = join(root, "series", `${key}.json`);
      let found: ResolveSeries | null = null;
      if (KEY.test(key) && existsSync(path)) {
        const file = readJson(path) as Pick<ResolveSeries, "freq" | "representation" | "observations">;
        const history = join(root, "vintages", `${key}.json`);
        found = {
          key, freq: file.freq, representation: file.representation, observations: file.observations,
          vintages: existsSync(history) ? (readJson(history) as VintageFile) : null,
        };
      }
      files.set(key, found);
    }
    return files.get(key)!;
  };
  return { catalog: new Map(entries.map((entry) => [entry.key, entry])), load, releaseId };
}
