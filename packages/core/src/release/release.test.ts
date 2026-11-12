// The release contract, TypeScript side: the fixture validates and each rule has a failing case.
// The cases live in checks/release-cases.json and are also run by pytest (PLAN section 9).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { searchDocument, validateRelease, type Release, type ReleaseFiles } from "./index";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const fixtureRoot = join(repo, "fixtures", "public");
const releaseId = readFileSync(join(fixtureRoot, "CURRENT"), "utf8").trim();
const fixtureDir = join(fixtureRoot, "releases", releaseId);

function readTree(dir: string, root = dir): ReleaseFiles {
  const out: ReleaseFiles = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(out, readTree(path, root));
    else out[relative(root, path).split(sep).join("/")] = new Uint8Array(readFileSync(path));
  }
  return out;
}
const fixture = readTree(fixtureDir);

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Step =
  | { op: "set" | "delete"; file: string; path: (string | number)[]; value?: Json }
  | { op: "remove_file"; file: string }
  | { op: "copy_file" | "move_file"; from: string; to: string }
  | { op: "raw"; file: string; text: string }
  | { op: "rename_release"; id: string }
  /** search.json written again as the projection: for a case about another rule that changes what the index is made from. */
  | { op: "project_search" };
type Case = { name: string; steps: Step[]; expect: string[]; rehash?: boolean };

const cases = (
  JSON.parse(readFileSync(join(repo, "checks", "release-cases.json"), "utf8")) as { cases: Case[] }
).cases;

const text = new TextDecoder();
const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const parse = (data: Uint8Array): Json => JSON.parse(text.decode(data)) as Json;
const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

function applyCase(c: Pick<Case, "steps" | "rehash">): { id: string; files: ReleaseFiles } {
  const files: ReleaseFiles = { ...fixture };
  let id = releaseId;
  for (const step of c.steps) {
    switch (step.op) {
      case "set":
      case "delete": {
        const doc = parse(files[step.file]!);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let target: any = doc;
        for (const part of step.path.slice(0, -1)) target = target[part];
        const last = step.path[step.path.length - 1]!;
        if (step.op === "set") target[last] = structuredClone(step.value);
        else if (Array.isArray(target)) target.splice(last as number, 1);
        else delete target[last];
        files[step.file] = bytes(doc);
        break;
      }
      case "remove_file":
        delete files[step.file];
        break;
      case "copy_file":
        files[step.to] = files[step.from]!;
        break;
      case "move_file":
        files[step.to] = files[step.from]!;
        delete files[step.from];
        break;
      case "raw":
        files[step.file] = new TextEncoder().encode(step.text);
        break;
      case "rename_release":
        id = step.id;
        break;
      case "project_search": {
        const read = (path: string) => (files[path] ? parse(files[path]!) : undefined);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        files["search.json"] = bytes(searchDocument({ catalog: read("catalog.json"), manifest: read("manifest.json"), events: read("content/events.json"), claims: read("content/claims.json") } as any));
        break;
      }
    }
  }
  if (c.rehash !== false && files["manifest.json"]) {
    const manifest = parse(files["manifest.json"]) as { series?: Record<string, { sha256: string; vintages_sha256?: string }> };
    for (const [key, row] of Object.entries(manifest.series ?? {})) {
      for (const folder of ["series", "derived"]) {
        const data = files[`${folder}/${key}.json`];
        if (data) row.sha256 = sha256(data);
      }
      const history = files[`vintages/${key}.json`];
      if (history && row.vintages_sha256 !== undefined) row.vintages_sha256 = sha256(history);
    }
    files["manifest.json"] = bytes(manifest);
  }
  return { id, files };
}

describe("the fixture release", () => {
  it("is valid", () => {
    expect(validateRelease(releaseId, fixture)).toEqual([]);
  });

  it("holds the shapes track A needs, typed from the schema", () => {
    // M0 acceptance: a sparse quarterly series, an annual series and a held (step) series.
    const catalog = parse(fixture["catalog.json"]!) as unknown as Release["catalog"];
    const byKey = new Map(catalog.series.map((entry) => [entry.key, entry]));
    expect(byKey.get("fx_output_quarterly")?.freq).toBe("quarterly");
    expect(byKey.get("fx_poverty_rate_annual")?.freq).toBe("annual");
    expect(byKey.get("fx_vote_margin")?.continuity).toBe("held");
    const quarterly = parse(fixture["series/fx_output_quarterly.json"]!) as unknown as Release["series"][string];
    expect(quarterly.observations).toHaveLength(16);
    expect(quarterly.observations.filter((o) => o.status === "missing").map((o) => o.period)).toEqual([
      "2023-Q3",
    ]);
  });
});

describe("release validation, shared cases", () => {
  it.each(cases)("$name", (c) => {
    const { id, files } = applyCase(c);
    const issues = validateRelease(id, files);
    expect([...new Set(issues.map((i) => i.code))].sort(), JSON.stringify(issues)).toEqual(
      [...c.expect].sort(),
    );
  });

  it("says where and what", () => {
    const { id, files } = applyCase({
      steps: [{ op: "delete", file: "series/fx_price_index.json", path: ["observations", 5] }],
    });
    const issues = validateRelease(id, files);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "implicit_gap", path: "series/fx_price_index.json" });
    expect(issues[0]!.message).toContain("2024-06");
  });

  it("reports an empty release instead of throwing", () => {
    expect(validateRelease(releaseId, {}).map((i) => i.code)).toContain("missing_file");
  });
});
