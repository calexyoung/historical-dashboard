/**
 * "Not for use in training machine-learning models" over HTTP, against a real production build
 * (ADR 0041): what a downloader actually receives for a Series whose Rights reserve it
 * (`fx_poverty_rate_annual`, an invented reservation of the fixture) and for one beside it
 * that allows it (`fx_price_index`). The unit tests of `src/lib/ml-use.test.tsx` cover each
 * function; these cover the routes that serve them.
 */
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_ID, FIXTURE_ROOT } from "@/lib/release/testing";
import { startVariant, type Running } from "./builds";

const RESERVED = "fx_poverty_rate_annual";
const OPEN = "fx_price_index";
const NOTE = "Not for use in training machine-learning models: Macro Atlas project's terms reserve it";
let caller = 0;
const get = (url: string) => fetch(url, { redirect: "manual", headers: { "x-forwarded-for": `198.51.100.${(caller++ % 200) + 1}` } });
const unescaped = (html: string): string => html.replace(/&#x27;|&#39;|&apos;/g, "'").replace(/\\u0027/g, "'");

describe("ml_use false is said wherever the values go (local build, the fixture release)", () => {
  let atlas: Running;
  beforeAll(async () => {
    atlas = await startVariant("local-atlas", { root: FIXTURE_ROOT });
  });
  afterAll(() => atlas.stop());
  const text = async (path: string): Promise<string> => {
    const response = await get(atlas.url(path));
    expect(response.status, path).toBe(200);
    return response.text();
  };

  it("the series page: in its provenance block and in its JSON-LD", async () => {
    const html = unescaped(await text(`/data/${RESERVED}`));
    expect(html).toContain("Machine learning");
    expect(html).toContain(NOTE);
    expect(html).toMatch(/"conditionsOfAccess":"Not for use in training machine-learning models: /);
    expect(await text(`/data/${OPEN}`)).not.toContain("machine-learning");
  });

  it("its twins: .csv, .json, .metadata.json and .md", async () => {
    expect((await text(`/data/${RESERVED}.csv`)).split("\n")).toContain(`# ${NOTE}`);
    for (const suffix of [".json", ".metadata.json"]) {
      expect((JSON.parse(await text(`/data/${RESERVED}${suffix}`)) as { rights: unknown }).rights, suffix).toMatchObject({ ml_use: false, ml_use_note: NOTE });
      expect((JSON.parse(await text(`/data/${OPEN}${suffix}`)) as { rights: unknown }).rights, suffix).toMatchObject({ ml_use: true, ml_use_note: null });
    }
    expect(await text(`/data/${RESERVED}.md`)).toContain(`> ${NOTE}.`);
    for (const suffix of [".csv", ".md"]) expect(await text(`/data/${OPEN}${suffix}`), suffix).not.toContain("machine-learning");
  });

  it("the read API: a series, its vintages and the catalog", async () => {
    for (const path of [`/api/v1/series/${RESERVED}`, `/api/v1/series/${RESERVED}/vintages`]) {
      expect((JSON.parse(await text(path)) as { rights: unknown }).rights, path).toMatchObject({ ml_use: false, ml_use_note: NOTE });
    }
    const catalog = JSON.parse(await text("/api/v1/catalog.json")) as { series: { key: string; rights: { ml_use: boolean; ml_use_note: string | null } }[] };
    expect(catalog.series.find((row) => row.key === RESERVED)!.rights).toMatchObject({ ml_use: false, ml_use_note: NOTE });
    expect(catalog.series.find((row) => row.key === OPEN)!.rights).toMatchObject({ ml_use: true, ml_use_note: null });
  });

  it("the Explorer's exports: the CSV and the drawing a PNG is made from", async () => {
    const csv = await text(`/explore/export?s=${OPEN},${RESERVED}&format=csv`);
    expect(csv.split("\n").some((line) => line.startsWith(`# ${NOTE} (`))).toBe(true);
    const svg = unescaped((await text(`/explore/export?s=${OPEN},${RESERVED}&format=svg`)).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    expect(svg).toContain("Not for use in training machine-learning models: Macro Atlas project's terms reserve it");
    expect(await text(`/explore/export?s=${OPEN}&format=csv`)).not.toContain("machine-learning");
  });

  it("page twins and llms.txt", async () => {
    expect(await text("/highlights.md")).toContain(`  - ${NOTE}.`);
    expect(await text("/data.md")).toContain(NOTE);
    expect(await text(`/explore.md?s=${RESERVED}`)).toContain(NOTE);
    expect(await text("/downloads.md")).toContain("## Not for training machine-learning models");
    const llms = await text("/llms.txt");
    expect(llms.split("\n").find((line) => line.includes(`/data/${RESERVED}.md)`))).toContain(`${NOTE}.`);
    expect(llms.split("\n").find((line) => line.includes(`/data/${OPEN}.md)`))).not.toContain("machine-learning");
  });

  it("bulk files: the page, the datapackage for each file and each licence class, and the rows themselves", async () => {
    const page = unescaped(await text("/downloads"));
    expect(page).toContain("Not for training machine-learning models");
    expect(page).toContain(NOTE);
    const pack = JSON.parse(await text(`/downloads/${FIXTURE_ID}/datapackage.json`)) as { description: string; resources: { path: string; description: string; ml_use: boolean; ml_use_reserved: { key: string; note: string }[] }[] };
    expect(pack.description).toContain(NOTE);
    const by = new Map(pack.resources.map((r) => [r.path, r]));
    for (const name of ["observations.parquet", "observations.csv.gz", "observations.ndjson.gz", "observations.citation_required.parquet", "vintages.parquet", "vintages.citation_required.parquet"]) {
      expect(by.get(name), name).toMatchObject({ ml_use: false, ml_use_reserved: [{ key: RESERVED, note: NOTE }] });
      expect(by.get(name)!.description, name).toContain(NOTE);
    }
    for (const name of ["observations.public_domain.parquet", "vintages.public_domain.parquet"]) expect(by.get(name), name).toMatchObject({ ml_use: true, ml_use_reserved: [] });

    const file = await get(atlas.url(`/downloads/${FIXTURE_ID}/observations.csv.gz`));
    expect(file.status).toBe(200);
    const lines = gunzipSync(new Uint8Array(await file.arrayBuffer())).toString("utf8").trim().split("\n");
    expect(lines[0]!.split(",").at(-1)).toBe("ml_use");
    const flags = new Map<string, Set<string>>();
    for (const line of lines.slice(1)) {
      const cells = line.split(",");
      flags.set(cells[0]!, (flags.get(cells[0]!) ?? new Set()).add(cells.at(-1)!));
    }
    expect([...flags.get(RESERVED)!]).toEqual(["false"]);
    expect([...flags.get(OPEN)!]).toEqual(["true"]);
  });
});
