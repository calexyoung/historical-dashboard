// Generates the TypeScript side of the release contract from schema/release.schema.json:
//   packages/core/src/release/schema.generated.ts   the schema as a module (core reads no files)
//   packages/core/src/release/types.generated.ts    the types
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

const types = await compile(schema, "Release", {
  bannerComment: banner.trimEnd(),
  additionalProperties: false,
  unreachableDefinitions: true,
  style: { printWidth: 100 },
});

const outputs = {
  "schema.generated.ts":
    banner +
    "\nexport const SCHEMA_VERSION = " +
    JSON.stringify(schema.$defs.manifest.properties.schema_version.const) +
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
