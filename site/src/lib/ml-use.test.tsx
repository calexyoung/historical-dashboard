/**
 * "Not for use in training machine-learning models" on every surface a value leaves the site by
 * (ADR 0041). The fixture has one Series that may be handed out and whose (invented) terms
 * reserve model training, `fx_poverty_rate_annual`, and one beside it that allows it,
 * `fx_price_index`. Each test asks one surface about both.
 */
import { createRightsGate } from "@macro-atlas/core";
import type { CatalogEntry } from "@macro-atlas/core/release";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { DownloadsPage } from "@/components/DownloadsPage";
import { SeriesPage } from "@/components/SeriesPage";
import { apiCatalog, apiSeries, apiVintages } from "./api";
import { downloadDecision, downloadsView } from "./downloads";
import { parseExplorerParams } from "./explorer/state";
import { exportView, parseCsv } from "./export";
import { datasetJsonLd } from "./json-ld";
import { llmsText } from "./llms";
import { mlUse, mlUseLines } from "./ml-use";
import { createReleaseReader, type OpenedRelease } from "./release/reader";
import { FIXTURE_ROOT, fixtureRegister } from "./release/testing";
import { seriesPageView } from "./series-page";
import { seriesTwin } from "./twin";
import { claimTwin } from "./twin/claims";
import { pageTwin } from "./twin/pages";

const ADDRESS = "https://example.org/macro-atlas";
const RESERVED = "fx_poverty_rate_annual";
const OPEN = "fx_price_index";
const NOTE = "Not for use in training machine-learning models: Macro Atlas project's terms reserve it";
const LEAD = "Not for use in training machine-learning models";
const none = new URLSearchParams();

let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});
const entry = (key: string): CatalogEntry => release.catalog.series.find((e) => e.key === key)!;
/** A register that allows everything of the fixture's Origin, model training included. */
const everything = createRightsGate(fixtureRegister({ display: true, redistribute: true, ml_use: true }));
/** The same, but its signed row reserves model training. */
const reservedToday = createRightsGate(fixtureRegister({ display: true, redistribute: true, ml_use: false }));
const body = (response: { status: number; body: string }): string => {
  expect(response.status).toBe(200);
  return response.body;
};

describe("mlUse: the Release's statement and the gate's answer today, whichever is stricter", () => {
  it("says nothing of a Series whose Rights allow it", () => {
    expect(mlUse(release, "local", entry(OPEN))).toEqual({ ml_use: true, note: null });
    expect(mlUse(release, "production", entry(OPEN), { gate: everything })).toEqual({ ml_use: true, note: null });
  });

  it("says the sentence, naming whose terms reserve it, wherever the Release says no", () => {
    for (const surface of ["local", "staging", "production"] as const) expect(mlUse(release, surface, entry(RESERVED), { gate: everything })).toEqual({ ml_use: false, note: NOTE });
  });

  it("says no when the register, asked today, no longer allows what the Release recorded", () => {
    const answer = mlUse(release, "production", entry(OPEN), { gate: reservedToday });
    expect(answer.ml_use).toBe(false);
    expect(answer.note).toContain(`${LEAD}: the rights register does not allow it today`);
    expect(answer.note).toContain("does not allow ml_use");
  });

  it("takes a Release written before the contract said so as no permission, and says that", () => {
    const rights = { ...entry(OPEN).rights };
    delete rights.ml_use;
    const before = { ...entry(OPEN), rights } as CatalogEntry;
    expect(mlUse(release, "local", before)).toEqual({ ml_use: false, note: `${LEAD}: this release does not record whether its terms allow it` });
  });

  it("names each Series a sentence is said of, once", () => {
    expect(mlUseLines(release, "local", [OPEN, RESERVED])).toEqual([`${NOTE} (${entry(RESERVED).name})`]);
    expect(mlUseLines(release, "local", [OPEN])).toEqual([]);
    expect(mlUseLines(release, "local", ["fx_no_such_series"])[0]).toContain("this release does not hold the series");
  });
});

describe("a series page and its twins", () => {
  it("states it in the provenance block, among the Rights", () => {
    const found = seriesPageView(release, "local", RESERVED, { address: ADDRESS });
    if (found.kind !== "page") throw new Error("no page");
    expect(found.view.provenance.rights).toContainEqual({ label: "Machine learning", value: NOTE });
    const html = renderToStaticMarkup(<SeriesPage view={found.view} basePath="/macro-atlas" />);
    expect(html).toContain("Machine learning");
    expect(html).toContain("Macro Atlas project&#x27;s terms reserve it");

    const open = seriesPageView(release, "local", OPEN, { address: ADDRESS });
    if (open.kind !== "page") throw new Error("no page");
    expect(open.view.provenance.rights.map((f) => f.label)).not.toContain("Machine learning");
    expect(renderToStaticMarkup(<SeriesPage view={open.view} basePath="/macro-atlas" />)).not.toContain("machine-learning");
  });

  it("puts it in the .csv as a note line, above the header", () => {
    const text = body(seriesTwin(release, "local", RESERVED, "csv", none, { address: ADDRESS }));
    const lines = text.split("\n");
    expect(lines).toContain(`# ${NOTE}`);
    expect(lines.indexOf(`# ${NOTE}`)).toBeLessThan(lines.findIndex((line) => line.startsWith("series,period")));
    expect(body(seriesTwin(release, "local", OPEN, "csv", none, { address: ADDRESS }))).not.toContain("machine-learning");
  });

  it("puts it in the .json and the .metadata.json, as a flag and in words", () => {
    for (const format of ["json", "metadata.json"] as const) {
      const doc = JSON.parse(body(seriesTwin(release, "local", RESERVED, format, none, { address: ADDRESS }))) as { rights: Record<string, unknown> };
      expect(doc.rights, format).toMatchObject({ ml_use: false, ml_use_note: NOTE });
      const open = JSON.parse(body(seriesTwin(release, "local", OPEN, format, none, { address: ADDRESS }))) as { rights: Record<string, unknown> };
      expect(open.rights, format).toMatchObject({ ml_use: true, ml_use_note: null });
    }
  });

  it("puts it in the .md, under the title and in the provenance", () => {
    const text = body(seriesTwin(release, "local", RESERVED, "md", none, { address: ADDRESS }));
    expect(text).toContain(`> ${NOTE}.`);
    expect(text).toContain(`- Rights · Machine learning: ${NOTE}`);
    expect(text.indexOf(`> ${NOTE}.`)).toBeLessThan(text.indexOf("## Values"));
    expect(body(seriesTwin(release, "local", OPEN, "md", none, { address: ADDRESS }))).not.toContain("machine-learning");
  });

  it("says it on a public Surface too, in every format, when the register reserves it today", () => {
    for (const format of ["csv", "json", "md"] as const) {
      const text = body(seriesTwin(release, "production", OPEN, format, none, { address: ADDRESS, gate: reservedToday }));
      expect(text, format).toContain(LEAD);
    }
  });
});

describe("the read API", () => {
  it("series/{key}: the rights of the answer say it", () => {
    const doc = JSON.parse(body(apiSeries(release, "local", RESERVED, none, { address: ADDRESS }))) as { rights: Record<string, unknown> };
    expect(doc.rights).toMatchObject({ permission: "redistribute", permitted: true, ml_use: false, ml_use_note: NOTE });
    const open = JSON.parse(body(apiSeries(release, "local", OPEN, none, { address: ADDRESS }))) as { rights: Record<string, unknown> };
    expect(open.rights).toMatchObject({ ml_use: true, ml_use_note: null });
  });

  it("series/{key}/vintages: the rights of a history say it", () => {
    const doc = JSON.parse(body(apiVintages(release, "local", RESERVED, none, { address: ADDRESS }))) as { rights: Record<string, unknown>; versions: unknown[] };
    expect(doc.versions.length).toBeGreaterThan(0);
    expect(doc.rights).toMatchObject({ ml_use: false, ml_use_note: NOTE });
    const open = JSON.parse(body(apiVintages(release, "local", OPEN, none, { address: ADDRESS }))) as { rights: Record<string, unknown> };
    expect(open.rights).toMatchObject({ ml_use: true, ml_use_note: null });
  });

  it("catalog.json: every row says it of its own Series", () => {
    const doc = JSON.parse(body(apiCatalog(release, "local", none, { address: ADDRESS }))) as { series: { key: string; rights: { ml_use: boolean; ml_use_note: string | null } }[] };
    const by = new Map(doc.series.map((row) => [row.key, row.rights]));
    expect(by.get(RESERVED)).toMatchObject({ ml_use: false, ml_use_note: NOTE });
    expect(by.get(OPEN)).toMatchObject({ ml_use: true, ml_use_note: null });
    expect(doc.series.every((row) => typeof row.rights.ml_use === "boolean")).toBe(true);
  });
});

describe("the Explorer's exports", () => {
  const view = (keys: string) => parseExplorerParams(new URLSearchParams(`s=${keys}`));
  const options = { address: `${ADDRESS}/explore` };

  it("csv: a note line names the Series it is said of", () => {
    const file = exportView(release, "local", view(`${OPEN},${RESERVED}`), "csv", options);
    if (!file.ok) throw new Error(file.message);
    const notes = parseCsv(file.body).filter((row) => row[0]?.startsWith("# ")).map((row) => row.join(","));
    expect(notes).toContain(`# ${NOTE} (${entry(RESERVED).name})`);
    const open = exportView(release, "local", view(OPEN), "csv", options);
    if (!open.ok) throw new Error(open.message);
    expect(open.body).not.toContain("machine-learning");
  });

  it("svg, and so the PNG a browser makes from it: the sentence is in the drawing", () => {
    const file = exportView(release, "local", view(`${OPEN},${RESERVED}`), "svg", options);
    if (!file.ok) throw new Error(file.message);
    const text = file.body.replace(/<[^>]+>/g, " ").replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ");
    expect(text).toContain("Not for use in training machine-learning models: Macro Atlas project's terms reserve it");
    const open = exportView(release, "local", view(OPEN), "svg", options);
    if (!open.ok) throw new Error(open.message);
    expect(open.body).not.toContain("machine-learning");
  });

  it("every series as one file: the note is there for the Series it holds", () => {
    const file = exportView(release, "local", view(""), "all", options);
    if (!file.ok) throw new Error(file.message);
    expect(file.body.split("\n")).toContain(`# ${NOTE} (${entry(RESERVED).name})`);
  });
});

describe("page twins", () => {
  const page = (path: string, search = "") => body(pageTwin(release, "local", path, new URLSearchParams(search), { address: ADDRESS }));

  it("/highlights.md: under the row of a Series whose value is given", () => {
    const text = page("/highlights");
    const at = text.indexOf(`/data/${RESERVED})`);
    expect(at).toBeGreaterThan(-1);
    const next = text.indexOf("\n- [", at);
    expect(text.slice(at, next === -1 ? undefined : next)).toContain(`  - ${NOTE}.`);
    expect(text.split(NOTE).length - 1).toBe(1);
  });

  it("/data.md: in the Rights cell of its row, and of no other", () => {
    const rows = page("/data").split("\n").filter((line) => line.startsWith("| ["));
    expect(rows.find((line) => line.includes(`\`${RESERVED}\``))).toContain(NOTE);
    expect(rows.find((line) => line.includes(`\`${OPEN}\``))).not.toContain("machine-learning");
  });

  it("/explore.md: the view as a table carries the export's note", () => {
    expect(page("/explore", `s=${RESERVED}`)).toContain(NOTE);
    expect(page("/explore", `s=${OPEN}`)).not.toContain("machine-learning");
  });

  it("/downloads.md: which files hold such rows, and which Series", () => {
    const text = page("/downloads");
    expect(text).toContain("## Not for training machine-learning models");
    expect(text).toContain(`${NOTE}.`);
    expect(text).toMatch(/observations\.parquet.*\| Not every row \|/);
    // A Series is listed when any file marks rows of it: its versions may be marked where its
    // Observations are not. And what may be handed out today is said file by file, above.
    expect(text).toContain("Some of their rows are marked false in the `ml_use` column");
    expect(text).not.toContain("Every row of them");
    expect(text).not.toContain("are in the files and may be redistributed");
    expect(text).toMatch(/observations\.public\\?_domain\.parquet.*\| Every row \|/);
  });
});

describe("/downloads", () => {
  it("names the Series whose rows are not for model training, and marks each file that holds them", () => {
    const view = downloadsView(release, "local");
    expect(view.notForMl).toEqual([{ key: RESERVED, name: entry(RESERVED).name, reason: NOTE }]);
    expect(view.mlUseNotRecorded).toBe(false);
    const by = new Map([...view.whole, ...view.byLicence.flatMap((g) => g.rows)].map((row) => [row.name, row.mlUse]));
    expect(by.get("observations.parquet")).toBe(false);
    expect(by.get("vintages.parquet")).toBe(false);
    expect(by.get("observations.citation_required.csv.gz")).toBe(false);
    expect(by.get("observations.public_domain.parquet")).toBe(true);
    expect(view.byLicence.find((g) => g.licence === "citation_required")!.notForMl.map((s) => s.key)).toEqual([RESERVED]);
    expect(view.byLicence.find((g) => g.licence === "public_domain")!.notForMl).toEqual([]);

    const html = renderToStaticMarkup(<DownloadsPage view={view} basePath="/macro-atlas" address={ADDRESS} current />);
    expect(html).toContain("Not for training machine-learning models");
    expect(html).toContain("Macro Atlas project&#x27;s terms reserve it");
    expect(html).toContain("Some of their rows are marked");
    expect(html).not.toContain("very row of them");
    expect(html).not.toContain("are in the files and may be redistributed");
    // The notice is beside each file that holds such rows and beside no other: asked row by row,
    // by the words a reader sees.
    const cells = new Map([...html.matchAll(/<tr data-file="([^"]+)">(.*?)<\/tr>/g)].map((m) => [m[1]!, m[2]!]));
    expect([...cells.keys()].sort()).toEqual([...by.keys()].sort());
    for (const [name, usable] of by) {
      if (usable) expect(cells.get(name), name).not.toContain("not for use in training machine-learning models");
      else expect(cells.get(name), name).toContain("Holds rows that are not for use in training machine-learning models.");
    }
  });

  it("takes files written before a Release said so as no permission", () => {
    const pack = { ...release.downloads!, resources: release.downloads!.resources.map((resource) => ({ ...resource, ml_use: undefined, ml_use_reserved: undefined })) };
    const view = downloadsView({ ...release, downloads: pack } as OpenedRelease, "local");
    expect(view.mlUseNotRecorded).toBe(true);
    expect(view.whole.every((row) => row.mlUse === null)).toBe(true);
    expect(renderToStaticMarkup(<DownloadsPage view={view} basePath="/macro-atlas" address={ADDRESS} current />)).toContain("Nothing here says that they may");
  });
});

describe("a bulk file at the door: what it says of model training is fixed in its bytes", () => {
  it("is given when every Series it does not mark is still allowed today", () => {
    for (const resource of release.downloads!.resources) expect(downloadDecision(release, "production", resource.path, { gate: everything }), resource.path).toMatchObject({ ok: true });
  });

  it("is refused whole when the register no longer allows a Series the file marks as usable", () => {
    for (const name of ["observations.parquet", "observations.public_domain.csv.gz", "vintages.parquet", "vintages.public_domain.parquet"]) {
      const decided = downloadDecision(release, "production", name, { gate: reservedToday });
      expect(decided, name).toMatchObject({ ok: false, status: 403 });
      if (!decided.ok) expect(decided.message).toContain("does not mark rows that are not for use in training machine-learning models today");
    }
  });

  it("is still given when every Series the register reserves is one the file already marks", () => {
    for (const name of ["observations.citation_required.parquet", "vintages.citation_required.parquet"]) expect(downloadDecision(release, "production", name, { gate: reservedToday }), name).toMatchObject({ ok: true });
  });

  it("a file written before files said anything is given only where the register allows all of it", () => {
    const pack = { ...release.downloads!, resources: release.downloads!.resources.map((resource) => ({ ...resource, ml_use: undefined, ml_use_reserved: undefined })) };
    const before = { ...release, downloads: pack } as OpenedRelease;
    expect(downloadDecision(before, "production", "observations.parquet", { gate: everything })).toMatchObject({ ok: true });
    expect(downloadDecision(before, "production", "observations.citation_required.parquet", { gate: reservedToday })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("what was recorded, not only what a Series rests on today", () => {
  const OTHER = "Another origin (synthetic)";
  /** The fixture's Origin allowed everything; another Origin may be handed out and reserves model training. */
  const table = fixtureRegister({ display: true, redistribute: true, ml_use: true }) as { rows: Record<string, unknown>[] };
  const gate = createRightsGate({ ...table, rows: [...table.rows, { ...table.rows[0]!, id: "another", name: OTHER, origins: [OTHER], decision: { display: true, redistribute: true, store: false, ml_use: false, signed_by: "Alex", signed_on: "2026-01-01" } }] });
  const claimId = () => release.claims.claims[0]!.id;
  const notes = (changed: OpenedRelease): string[] => (JSON.parse(body(claimTwin(changed, "production", claimId(), "json", { address: ADDRESS, gate }))) as { evidence: { ml_use_notes: string[] } }).evidence.ml_use_notes;

  it("nothing is said while every lineage is the fixture's", () => {
    expect(notes(release)).toEqual([]);
  });

  it("a lock whose figures came through an Origin that reserves it says so, though the Series today does not", () => {
    const changed = structuredClone(release);
    for (const lock of Object.values(changed.locks)) for (const row of lock.parsed.rights_used) row.origin = OTHER;
    expect(notes(changed)).toEqual([expect.stringContaining(`${LEAD}: the rights register does not allow it today for what these figures were computed from`)]);
    expect(body(claimTwin(changed, "production", claimId(), "evidence.csv", { address: ADDRESS, gate }))).toContain(`# ${LEAD}`);
    expect(body(claimTwin(changed, "production", claimId(), "md", { address: ADDRESS, gate }))).toContain(`> ${LEAD}`);
  });

  it("the latest rows' own lineage is asked as well", () => {
    const changed = structuredClone(release);
    for (const claim of changed.latest!.claims) for (const row of claim.rights_used) row.origin = OTHER;
    expect(notes(changed)).toEqual([expect.stringContaining("for what these figures were computed from")]);
  });

  it("a lock and latest rows that came through two Origins that each reserve it name both", () => {
    const THIRD = "A third origin (synthetic)";
    const both = createRightsGate({ ...table, rows: [...table.rows, ...[OTHER, THIRD].map((name, n) => ({ ...table.rows[0]!, id: `another-${n}`, name, origins: [name], decision: { display: true, redistribute: true, store: false, ml_use: false, signed_by: "Alex", signed_on: "2026-01-01" } }))] });
    const said = (changed: OpenedRelease): string[] => (JSON.parse(body(claimTwin(changed, "production", claimId(), "json", { address: ADDRESS, gate: both }))) as { evidence: { ml_use_notes: string[] } }).evidence.ml_use_notes;
    const changed = structuredClone(release);
    for (const lock of Object.values(changed.locks)) for (const row of lock.parsed.rights_used) row.origin = OTHER;
    for (const claim of changed.latest!.claims) for (const row of claim.rights_used) row.origin = THIRD;
    expect(said(changed)).toHaveLength(2);
    expect(said(changed)[0]).toContain(OTHER);
    expect(said(changed)[1]).toContain(THIRD);
    // The same lineage in both is said once.
    for (const claim of changed.latest!.claims) for (const row of claim.rights_used) row.origin = OTHER;
    expect(said(changed)).toHaveLength(1);
  });

  it("a file of versions whose history came through an Origin that reserves it is refused, and the Observations are not", () => {
    const changed = structuredClone(release);
    for (const line of changed.vintages[OPEN]!.metadata) line.metadata.source.origin.producer = OTHER;
    expect(downloadDecision(changed, "production", "observations.public_domain.parquet", { gate })).toMatchObject({ ok: true });
    const decided = downloadDecision(changed, "production", "vintages.public_domain.parquet", { gate });
    expect(decided).toMatchObject({ ok: false, status: 403 });
    if (!decided.ok) expect(decided.message).toContain("not for use in training machine-learning models today");
    // And the API's history says it, where the values of today do not.
    const history = JSON.parse(body(apiVintages(changed, "production", OPEN, none, { address: ADDRESS, gate }))) as { rights: { ml_use: boolean; ml_use_note: string } };
    expect(history.rights.ml_use).toBe(false);
    expect(history.rights.ml_use_note).toContain("the rights register does not allow it today");
    const today = JSON.parse(body(apiSeries(changed, "production", OPEN, none, { address: ADDRESS, gate }))) as { rights: { ml_use: boolean } };
    expect(today.rights.ml_use).toBe(true);
  });

  it("/downloads.md does not call a refused file usable", () => {
    const text = body(pageTwin(release, "production", "/downloads", none, { address: ADDRESS, gate: reservedToday }));
    const line = text.split("\n").find((l) => l.includes("observations.public"))!;
    expect(line).toContain("Not handed out here");
    expect(line).not.toContain("Every row");
  });
});

describe("discovery", () => {
  it("llms.txt: says it on the line of each such Series, and what the flag is called", () => {
    const text = llmsText(release, "local", { address: ADDRESS });
    const line = (key: string) => text.split("\n").find((l) => l.includes(`/data/${key}.md)`))!;
    expect(line(RESERVED)).toContain(`${NOTE}.`);
    expect(line(OPEN)).not.toContain("machine-learning");
    expect(text).toContain("Redistribution is not permission to train a model");
  });

  it("llms.txt: speaks of the bulk files' ml_use column only where this Release's files have one", () => {
    const sentence = (changed: OpenedRelease): string => llmsText(changed, "local", { address: ADDRESS }).split("\n").find((l) => l.startsWith("Redistribution is not permission"))!;
    expect(sentence(release)).toContain("and in the bulk files' `ml_use` column");
    // Files written before a Release said anything of model training have no such column.
    const before = { ...release, downloads: { ...release.downloads!, resources: release.downloads!.resources.map((resource) => ({ ...resource, ml_use: undefined, ml_use_reserved: undefined })) } } as OpenedRelease;
    expect(sentence(before)).not.toContain("`ml_use` column");
    expect(sentence(before)).toContain("Not every bulk file of this release records it: a file that does not say gives no permission.");
    // One file that does not say is enough: the column is not promised of the files.
    const mixed = { ...release, downloads: { ...release.downloads!, resources: release.downloads!.resources.map((resource, n) => (n === 0 ? { ...resource, ml_use: undefined, ml_use_reserved: undefined } : resource)) } } as OpenedRelease;
    expect(sentence(mixed)).toBe(sentence(before));
    expect(sentence(before)).toContain("`rights.ml_use` is false in JSON");
    // A Release with no bulk files says nothing of them.
    const none = { ...release, downloads: null } as OpenedRelease;
    expect(sentence(none)).not.toContain("bulk files");
    expect(sentence(none)).toContain("`rights.ml_use` is false in JSON");
  });

  it("llms.txt: says it of a Series listed by its metadata alone, withheld or not handed out here", () => {
    const withheld = release.manifest.withheld[0]!.key;
    const local = llmsText(release, "local", { address: ADDRESS }).split("\n").find((l) => l.includes(`/data/${withheld}.metadata.json)`))!;
    expect(local).toContain("Withheld; this is its metadata.");
    expect(local).toContain(`${LEAD}: `);
    // Nothing may be redistributed and the register reserves model training: every line is
    // metadata only, and the one whose Rights reserve it still says so.
    const closed = createRightsGate(fixtureRegister({ display: true, redistribute: false, ml_use: false }));
    const text = llmsText(release, "production", { address: ADDRESS, gate: closed });
    const line = text.split("\n").find((l) => l.includes(`/data/${RESERVED}.metadata.json)`))!;
    expect(line).toContain("Its values are not handed out here; this is its metadata.");
    expect(line).toContain(`${NOTE}.`);
    expect(line.endsWith(".")).toBe(true);
    expect(line).not.toContain("..");
  });

  it("JSON-LD: the Dataset's conditions of access say it", () => {
    expect(datasetJsonLd(release, "local", RESERVED, { address: ADDRESS })).toMatchObject({ conditionsOfAccess: `${NOTE}.` });
    expect(datasetJsonLd(release, "local", OPEN, { address: ADDRESS })).not.toHaveProperty("conditionsOfAccess");
  });
});

describe("a Claim's files", () => {
  it("say it of the Series a Reading is computed from, when that Series is not for model training", () => {
    const claim = release.claims.claims[0]!;
    const options = { address: ADDRESS, gate: reservedToday };
    expect(body(claimTwin(release, "production", claim.id, "evidence.csv", options))).toContain(`# ${LEAD}`);
    expect(body(claimTwin(release, "production", claim.id, "md", options))).toContain(`> ${LEAD}`);
    const doc = JSON.parse(body(claimTwin(release, "production", claim.id, "json", options))) as { evidence: { ml_use: boolean; ml_use_notes: string[] } };
    expect(doc.evidence.ml_use).toBe(false);
    expect(doc.evidence.ml_use_notes[0]).toContain(LEAD);

    // The lock froze the lineage its figures came through: that is asked too, so a Series whose
    // key the Release no longer holds, or that rests on something else today, is not passed over.
    expect(doc.evidence.ml_use_notes.join(" ")).toContain("does not allow ml_use");

    const open = { address: ADDRESS, gate: everything };
    expect(body(claimTwin(release, "production", claim.id, "evidence.csv", open))).not.toContain("machine-learning");
    expect(body(claimTwin(release, "production", claim.id, "md", open))).not.toContain("machine-learning");
    expect((JSON.parse(body(claimTwin(release, "production", claim.id, "json", open))) as { evidence: { ml_use: boolean } }).evidence.ml_use).toBe(true);
  });
});
