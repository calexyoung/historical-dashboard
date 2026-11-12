// Generates, from the Catalog (catalog/series/*.json, PLAN M12):
//   site/src/lib/catalog-names.generated.ts   every Series' name, and for one with no Channel
//                                             the Catalog's own reason
// The site reads values only from a Release. This table holds no value: it lets a page name a
// Series that an address asks for and the Release being served does not hold (PLAN M18: a v1
// link "opens the same view or names the withheld series").
// `node scripts/gen-catalog-names.mjs --check` fails if the committed file is out of date (CI).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = `${root}catalog/series/`;
const names = {};
for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
  const entry = JSON.parse(readFileSync(dir + file, "utf8"));
  const none = entry.source && entry.source.channel === null ? entry.source.no_channel : null;
  names[entry.key] = none ? [entry.name, none.reason] : [entry.name];
}
const text =
  "// GENERATED from catalog/series by scripts/gen-catalog-names.mjs. Do not edit.\n\n" +
  "/** Every Series of the Catalog by key: its name, and why it has no Channel where it has none. No values. */\n" +
  "export const CATALOG_NAMES: Readonly<Record<string, readonly [name: string, noChannel?: string]>> = " +
  JSON.stringify(names, null, 1) +
  ";\n";

const path = `${root}site/src/lib/catalog-names.generated.ts`;
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {
    // missing counts as stale
  }
  if (current !== text) {
    console.error(`${path} is out of date: run "npm run gen" and commit the result`);
    process.exit(1);
  }
} else {
  writeFileSync(path, text);
  console.log(`wrote ${path}`);
}
