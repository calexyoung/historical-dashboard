// Generates, from the one rights register table schema/rights-register.json (PLAN M6, ADR 0020):
//   packages/core/src/rights-register.generated.ts   the rows the gate reads (core reads no files;
//                                                    no terms or quotations, since core can reach
//                                                    a browser bundle)
//   docs/v2/rights-register.md                       the register as a document for Alex to read
//   site/src/lib/rights-rows.generated.ts            the rows as /docs/rights lists them (M25)
// `node scripts/gen-rights.mjs --check` fails if any committed file is out of date (CI).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const table = JSON.parse(readFileSync(`${root}schema/rights-register.json`, "utf8"));
const banner = "GENERATED from schema/rights-register.json by scripts/gen-rights.mjs. Do not edit.";

const lean = {
  format: table.format,
  version: table.version,
  cleared_intermediaries: table.cleared_intermediaries,
  rows: table.rows.map((row) =>
    row.kind === "origin"
      ? { id: row.id, kind: row.kind, origins: row.origins, datasets: row.datasets, decision: row.decision }
      : { id: row.id, kind: row.kind, channel: row.channel, decision: row.decision },
  ),
};

const GRANTS = [
  ["display", "display"],
  ["redistribute", "redistribute"],
  ["store", "store"],
  ["ml_use", "ML use"],
];
const LICENCE = {
  public_domain: "public domain",
  cc_by: "CC BY",
  citation_required: "citation required",
  permission_required: "permission required",
  no_redistribution: "no redistribution",
  unknown: "unknown",
};
const HOW = {
  page: "read on {date}, from the page's own text",
  extract: "read on {date} through a tool that returns short extracts; check the wording against the page before signing",
  not_read: "not read",
  attested: "read by Alex on {date} in a browser; no quotation recorded",
};
/** What a signed decision says no to, in a sentence of its own; nothing when it allows all four. */
const refusedText = (decision) => {
  const no = GRANTS.filter(([key]) => !decision[key]).map(([, word]) => word);
  return no.length === 0 ? "" : ` Not allowed: **${no.join(", ")}**.`;
};
const grantsText = (grants) => {
  const allowed = GRANTS.filter(([key]) => grants[key]).map(([, word]) => word);
  return allowed.length === GRANTS.length ? "all four" : allowed.length ? allowed.join(", ") : "nothing";
};
const cell = (text) => String(text).replaceAll("|", "\\|");

function rowSection(row) {
  const out = [`### ${row.name}`, "", `Row \`${row.id}\`. ${row.used_for}`, ""];
  if (row.kind === "origin") {
    const datasets = row.datasets === "*" ? "all datasets" : row.datasets.map((d) => `"${d}"`).join(", ");
    out.push(`- Origin, as a Catalog entry names it: ${row.origins.map((o) => `"${o}"`).join(" or ")}; ${datasets}.`);
  } else {
    out.push(`- Intermediary Channel: \`${row.channel}\`. A value that came through it needs this row, its Origin's row, and a dated amendment to ADR 0006.`);
  }
  out.push(`- Licence class: ${LICENCE[row.licence_class]}.`);
  out.push(`- Attribution: ${row.attribution ?? "none proposed, because nothing is to be shown."}`);
  out.push("");
  if (row.terms.length === 0) out.push(`Terms: ${row.terms_note}`, "");
  for (const terms of row.terms) {
    out.push(`Terms: <${terms.url}> (${HOW[terms.how].replace("{date}", terms.read_on)}).${terms.note ? ` ${terms.note}` : ""}`, "");
    for (const quote of terms.quotes) out.push(`> ${quote}`, "");
  }
  if (row.capture?.length) {
    out.push("Capture endpoints (fetched by `atlas capture` only once this row is signed and allows store):", "");
    for (const endpoint of row.capture) {
      out.push(`- \`${endpoint.id}\`, the \`${endpoint.adapter}\` adapter, for ${endpoint.datasets.map((d) => `"${d}"`).join(", ")}.${endpoint.note ? ` ${endpoint.note}` : ""}`);
    }
    out.push("");
  }
  out.push(`Proposal: allow **${grantsText(row.proposal)}**. ${row.proposal.note}`, "");
  if (row.open_questions.length > 0) {
    out.push("Open questions:", "");
    for (const question of row.open_questions) out.push(`- ${question}`);
    out.push("");
  }
  out.push(
    row.decision === null
      ? "Decision: **not decided**."
      : `Decision: allow **${grantsText(row.decision)}**. Signed by ${row.decision.signed_by} on ${row.decision.signed_on}.${refusedText(row.decision)}${row.decision.note ? ` ${row.decision.note}` : ""}`,
    "",
  );
  return out;
}

const signed = table.rows.filter((row) => row.decision !== null).length;
const cleared = table.cleared_intermediaries.map((entry) => `\`${entry.channel}\` (ADR 0006 amendment of ${entry.adr_0006_amendment})`);
const md = [
  `<!-- ${banner} -->`,
  "",
  "# Rights register",
  "",
  `Version \`${table.version}\`. ${signed} of ${table.rows.length} rows signed. Intermediary Channels cleared: ${cleared.join(", ") || "none"}.`,
  "",
  "One row per Origin and per intermediary Channel: the terms that were read, the sentences that",
  "matter quoted, a proposal, and Alex's decision (CONTEXT.md, Rights register; PLAN 6 and 6.1;",
  "ADR 0006, ADR 0020). The builder proposes. Only Alex decides, and no decision below was filled",
  "in by the builder.",
  "",
  "This page is generated from `schema/rights-register.json`, which is the one table the rights",
  "gate reads in Python and in TypeScript. Edit the table, never this page.",
  "",
  "## What a row decides",
  "",
  "A decision says yes or no to four things:",
  "",
  "- **display**: show the values on a public page.",
  "- **redistribute**: offer them as a download or through the API.",
  "- **store**: keep what the source serves in the capture store.",
  "- **ML use**: describe them as usable for model training.",
  "",
  "On the local Surface the gate allows everything (PLAN 6.1, point 3). On staging and production",
  "it allows a value only when all of these hold, and the most restrictive answer wins across",
  "every input of a derived Series:",
  "",
  "1. The value is not in the legacy representation. v1's data is refused whatever a row says.",
  "2. Its Origin and dataset have a row, the row is signed, and the decision says yes.",
  "3. If it came through an intermediary Channel (anything but `direct`, or Macro Atlas's own",
  "   computing, hand entry and fixture), that Channel has a row, the row is signed and says yes,",
  "   and the Channel is listed in `cleared_intermediaries` with a dated amendment to ADR 0006.",
  "",
  "An Origin, dataset or Channel with no row is unknown, and unknown is refused.",
  "",
  "## How Alex signs a row",
  "",
  "1. Open the terms link in the row and read it. Rows marked \"through a tool that returns short",
  "   extracts\" and \"not read\" need this most.",
  "2. In `schema/rights-register.json`, replace the row's `\"decision\": null` with, for example,",
  "   `\"decision\": { \"display\": true, \"redistribute\": true, \"store\": true, \"ml_use\": false,",
  "   \"signed_by\": \"Alex\", \"signed_on\": \"2026-11-20\" }`, and change `version` at the top.",
  "3. Add the row's id to `SIGNED_BY_ALEX` in `tests/v2/test_rights_register.py`. It is the one",
  "   test edit a signature needs: every other test reads what is signed from the table.",
  "4. Run `npm run gen` (this page and `packages/core/src/rights-register.generated.ts`) and",
  "   `python -m atlas catalog --write` (`docs/v2/g20-coverage.md`, `docs/v2/v1-coverage.md` and",
  "   `docs/v2/catalog-migration.md`, which say what the gate would show today).",
  "5. Run `make v2-check` and `make v2-site-check`, and commit. `python -m atlas rights` lists what",
  "   is signed, and `python -m atlas capture --dry-run` what the capture job is now cleared to ask.",
  "",
  "What a signature changes, and what it does not:",
  "",
  "- **Capture.** If the decision allows store, the row's endpoints are cleared for storage. A run",
  "  still fetches nothing while any endpoint it selects is not cleared, so a run of only the",
  "  cleared rows names them:",
  "  `python -m atlas capture --only <row>`. On the capture host that is the variable",
  "  `ATLAS_CAPTURE_ONLY`, and the host runs the commit `ATLAS_REF` names, so it sees the signature",
  "  once `ATLAS_REF` is moved to a commit that holds it (`deploy/capture/README.md`). A source",
  "  that wants an API key also needs its key.",
  "- **A public Release.** It may hold a Series once every row that Series rests on is signed and",
  "  allows display, the store holds captures of it, and the Release's checks pass. Signing alone",
  "  publishes nothing.",
  "- **The repository.** No agency data is fetched or committed by signing. The committed capture",
  "  fixtures stay invented values until a real capture is exported under a row that allows",
  "  redistribution (`python -m atlas capture --export-fixtures`).",
  "",
  "Clearing an intermediary Channel (FRED, ALFRED, Yahoo) takes two more things: a section in",
  "`docs/adr/0006-rights-gate-allowlist-releases.md` headed",
  "`## Amendment YYYY-MM-DD: the <channel> channel is cleared (approved by Alex)`, and an entry",
  "with that date in `cleared_intermediaries`.",
  "",
  "## Summary",
  "",
  "| Row | Kind | Licence class | Terms read | Proposed | Decision |",
  "|---|---|---|---|---|---|",
  ...table.rows.map((row) => {
    const read = row.terms.length === 0 ? "none to read" : row.terms.every((t) => t.how === "not_read") ? "no" : row.terms.some((t) => t.how !== "page" && t.how !== "attested") ? "in part" : "yes";
    return `| \`${row.id}\` ${cell(row.name)} | ${row.kind} | ${LICENCE[row.licence_class]} | ${read} | ${grantsText(row.proposal)} | ${row.decision === null ? "not decided" : grantsText(row.decision)} |`;
  }),
  "",
  "\"In part\" means at least one page was not read, or was read only as extracts.",
  "",
  "## Rows",
  "",
  ...table.rows.flatMap(rowSection),
].join("\n");

const outputs = {
  "packages/core/src/rights-register.generated.ts":
    `// ${banner}\n` +
    "// The rows the rights gate reads. Terms, quotations and proposals are in docs/v2/rights-register.md.\n\n" +
    "export const RIGHTS_REGISTER: unknown = " +
    JSON.stringify(lean, null, 2) +
    ";\n",
  "docs/v2/rights-register.md": md,
  // The register as the site's /docs/rights page reads it (M25): a fixed selection of each row.
  // No quotation, note or open question, and not who signed: the page says where those are.
  "site/src/lib/rights-rows.generated.ts":
    `// ${banner}\n` +
    "// The rows /docs/rights lists. The gate reads packages/core/src/rights-register.generated.ts, not this.\n\n" +
    "export type RightsRow = {\n" +
    "  id: string;\n" +
    '  kind: "origin" | "channel";\n' +
    "  name: string;\n" +
    "  licence_class: string;\n" +
    "  attribution: string | null;\n" +
    "  terms: { url: string; read_on: string | null; how: string }[];\n" +
    "  proposal: { display: boolean; redistribute: boolean; store: boolean; ml_use: boolean };\n" +
    "  decision: { display: boolean; redistribute: boolean; store: boolean; ml_use: boolean; signed_on: string } | null;\n" +
    "};\n\n" +
    "export const RIGHTS_ROWS: { version: string; cleared: string[]; rows: RightsRow[] } = " +
    JSON.stringify(
      {
        version: table.version,
        cleared: table.cleared_intermediaries.map((entry) => entry.channel),
        rows: table.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          name: row.name,
          licence_class: row.licence_class,
          attribution: row.attribution ?? null,
          terms: row.terms.map((t) => ({ url: t.url, read_on: t.read_on ?? null, how: t.how })),
          proposal: { display: row.proposal.display, redistribute: row.proposal.redistribute, store: row.proposal.store, ml_use: row.proposal.ml_use },
          decision: row.decision === null ? null : { display: row.decision.display, redistribute: row.decision.redistribute, store: row.decision.store, ml_use: row.decision.ml_use, signed_on: row.decision.signed_on },
        })),
      },
      null,
      1,
    ) +
    ";\n",
};

const check = process.argv.includes("--check");
let stale = false;
for (const [name, text] of Object.entries(outputs)) {
  const path = root + name;
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
