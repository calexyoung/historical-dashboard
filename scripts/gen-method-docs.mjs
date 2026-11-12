// Generates, from the method pages (PLAN section 3 and M25: /docs/method, each with a .md twin):
//   site/src/lib/method-docs.generated.ts   every page of /docs/method as its Markdown text
// The pages are the repository's own docs/method/*.md (the contracts the code is tested from)
// and the pages written for a reader of the site (site/content/method-*.md). The site reads no
// file when it runs, so the text is carried in a module; the page is drawn from it and the .md
// twin is the text itself. No value of any Series is in these files.
// `node scripts/gen-method-docs.mjs --check` fails if the committed file is out of date (CI).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// A reader's page keeps the address it was given first (M21); the contract of the same name moves aside.
const SLUGS = { claims: "claim-records" };

function read(path, slug, kind) {
  const text = readFileSync(root + path, "utf8").replace(/\r\n/g, "\n");
  const title = /^# (.+)$/m.exec(text)?.[1]?.trim();
  if (!title) throw new Error(`${path} has no "# Title" line`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error(`${path}: ${slug} is not a slug`);
  return { slug, kind, file: path, title, text };
}

const docs = [];
for (const name of readdirSync(`${root}site/content`).filter((n) => /^method-.+\.md$/.test(n)).sort()) {
  docs.push(read(`site/content/${name}`, name.slice("method-".length, -".md".length), "reader"));
}
for (const name of readdirSync(`${root}docs/method`).filter((n) => n.endsWith(".md")).sort()) {
  const base = name.slice(0, -".md".length);
  docs.push(read(`docs/method/${name}`, SLUGS[base] ?? base, "contract"));
}
const slugs = docs.map((doc) => doc.slug);
if (new Set(slugs).size !== slugs.length) throw new Error("two method pages have one slug");

const text =
  "// GENERATED from docs/method/*.md and site/content/method-*.md by scripts/gen-method-docs.mjs. Do not edit.\n\n" +
  "/** Every page of /docs/method: a reader's page, or a contract of the repository, as its Markdown text. */\n" +
  'export const METHOD_DOCS: readonly { slug: string; kind: "reader" | "contract"; file: string; title: string; text: string }[] = ' +
  JSON.stringify(docs, null, 1) +
  ";\n";

const path = `${root}site/src/lib/method-docs.generated.ts`;
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
