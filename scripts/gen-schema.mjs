// Generates the TypeScript side of the release contract from schema/release.schema.json:
//   packages/core/src/release/schema.generated.ts   the schema as a module (core reads no files)
//   packages/core/src/release/types.generated.ts    the types
//   packages/core/src/catalog/series.generated.ts   the Series type, from schema/series.schema.json
// `node scripts/gen-schema.mjs --check` fails if the committed files are out of date (CI).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const schemaPath = `${root}schema/release.schema.json`;
const outDir = `${root}packages/core/src/release/`;
const banner = "// GENERATED from schema/release.schema.json by scripts/gen-schema.mjs. Do not edit.\n";

const schemaText = readFileSync(schemaPath, "utf8");
const schema = JSON.parse(schemaText);

// An Event's citation says "an archived copy or the reason there is none, never both" with
// oneOf over required, which only a validator can enforce; the type lists the fields.
const typed = JSON.parse(JSON.stringify(schema));
delete typed.$defs.eventCitation.oneOf;
const types = await compile(typed, "Release", {
  bannerComment: banner.trimEnd(),
  additionalProperties: false,
  unreachableDefinitions: true,
  style: { printWidth: 100 },
});

// The Series schema (a Catalog entry, PLAN 5 and M12): types only. Python is the one reader of
// catalog/series today; the type is here so that the first TypeScript reader has it.
const seriesBanner = "// GENERATED from schema/series.schema.json by scripts/gen-schema.mjs. Do not edit.\n";
const seriesSchema = JSON.parse(readFileSync(`${root}schema/series.schema.json`, "utf8"));
// The schema says "a Source or a Recipe, never both" with oneOf/not, which only a validator
// can enforce; the type lists the fields.
delete seriesSchema.oneOf;
const seriesTypes = await compile(seriesSchema, "Series", {
  bannerComment: seriesBanner.trimEnd(),
  additionalProperties: false,
  unreachableDefinitions: true,
  style: { printWidth: 100 },
});

const outputs = {
  "../catalog/series.generated.ts": seriesTypes,
  "schema.generated.ts":
    banner +
    "\nexport const SCHEMA_VERSION = " +
    JSON.stringify(schema.$defs.manifest.properties.schema_version.enum.at(-1)) +
    ";\n\n/** Every version this reader knows; a writer writes the last. */\nexport const SCHEMA_VERSIONS: readonly string[] = " +
    JSON.stringify(schema.$defs.manifest.properties.schema_version.enum) +
    ";\n\nexport const releaseSchema: Record<string, unknown> = " +
    JSON.stringify(schema, null, 2) +
    ";\n",
  "types.generated.ts": types,
};

const check = process.argv.includes("--check");
let stale = false;
for (const [name, text] of Object.entries(outputs)) {
  const path = outDir + name;
  if (check) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      // missing counts as stale
    }
    if (current !== text) {
      console.error(`${path} is out of date: run "npm run gen" and commit the result`);
      stale = true;
    }
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${path}`);
  }
}
if (stale) process.exit(1);
