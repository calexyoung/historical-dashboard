/**
 * Search (PLAN 4.6, M22; ADR 0036): lexical, over the Release's own search.json and the site's
 * glossary, grouped by kind. It answers with names and addresses and never with a value.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createReleaseReader, type OpenedRelease } from "./release/reader";
import { addRelease, FIXTURE_ROOT, promote, tempRoot } from "./release/testing";
import { parseSearch, search, type SearchAnswer } from "./search";

const open = async (root: string): Promise<OpenedRelease> => {
  const opened = await createReleaseReader({ root, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  return opened.release;
};
let release: OpenedRelease;
beforeAll(async () => {
  release = await open(FIXTURE_ROOT);
});

const group = (answer: SearchAnswer, kind: string) => answer.groups.find((g) => g.kind === kind);
const ids = (answer: SearchAnswer, kind: string) => group(answer, kind)?.hits.map((hit) => hit.id) ?? [];

describe("search", () => {
  it("returns one query's hits grouped by kind: a Series, an Event and a glossary term", async () => {
    const root = tempRoot();
    const id = "20260301T000000Z-abcdef2";
    addRelease(root, { id, rename: { key: "fx_price_index", name: "Fixture price index, revised basis" }, events: (events) => (events[0]!.title = "Fixture gazette is revised") });
    promote(root, id);
    const answer = search(await open(root), "local", "revised");
    expect(answer.groups.map((g) => [g.kind, g.label])).toEqual([["series", "Series"], ["event", "Events"], ["glossary", "Glossary"]]);
    expect(group(answer, "series")!.hits[0]).toMatchObject({ id: "fx_price_index", title: "Fixture price index, revised basis", href: "/data/fx_price_index" });
    expect(group(answer, "event")!.hits[0]).toMatchObject({ id: "2024-09-18-fixture-rate-decision", title: "Fixture gazette is revised", href: "/events/2024-09-18-fixture-rate-decision" });
    expect(group(answer, "glossary")!.hits[0]).toMatchObject({ id: "revised", title: "Revised", href: "/docs/glossary/revised" });
    expect(answer.total).toBe(answer.groups.reduce((n, g) => n + g.total, 0));
  });

  it("finds a Series by a word of its name, by its key, and by its origin's identifier", () => {
    expect(ids(search(release, "local", "poverty"), "series")).toEqual(["fx_poverty_rate_annual"]);
    expect(ids(search(release, "local", "fx_poverty_rate_annual"), "series")).toEqual(["fx_poverty_rate_annual"]);
    expect(ids(search(release, "local", "FX-OUTPUT"), "series")).toEqual(["fx_output_quarterly"]);
  });

  it("matches the start of a word, in any letter case, and every word asked for", () => {
    expect(ids(search(release, "local", "POV"), "series")).toEqual(["fx_poverty_rate_annual"]);
    expect(ids(search(release, "local", "overty"), "series")).toEqual([]);
    expect(ids(search(release, "local", "price index"), "series")).toEqual(["fx_price_index", "fx_price_index_yoy"]);
    expect(ids(search(release, "local", "price poverty"), "series")).toEqual([]);
  });

  it("puts a match in a name before a match in a description", () => {
    // "quarterly" is in fx_output_quarterly's key and description only; "output" is its name.
    const answer = search(release, "local", "fixture");
    expect(group(answer, "series")!.total).toBe(8);
    const titled = search(release, "local", "index");
    expect(ids(titled, "series").slice(0, 3)).toEqual(["fx_price_index", "fx_price_index_yoy", "fx_exchange_index"]);
  });

  it("finds an Event, a Claim and a glossary term", () => {
    expect(ids(search(release, "local", "central bank"), "event")).toEqual(["2024-09-18-fixture-rate-decision"]);
    const claim = group(search(release, "local", "minister"), "claim")!.hits[0]!;
    expect(claim).toMatchObject({ id: "2025-12-11-a-fixture-official-on-fixture-prices", href: "/claims/2025-12-11-a-fixture-official-on-fixture-prices", title: "A. Fixture, 11 December 2025" });
    expect(ids(search(release, "local", "takeaway"), "glossary")[0]).toBe("takeaway");
  });

  it("lists a Withheld Series by name, marked, and a Series this Surface may not show likewise", () => {
    const hit = group(search(release, "local", "exchange"), "series")!.hits[0]!;
    expect(hit).toMatchObject({ id: "fx_exchange_index", title: "Fixture exchange index", held: "withheld" });
    expect(group(search(release, "local", "poverty"), "series")!.hits[0]!.held).toBeUndefined();
    // On production the fixture's unsigned register permits nothing: named, and marked as not shown.
    expect(group(search(release, "production", "poverty"), "series")!.hits[0]).toMatchObject({ title: "Fixture poverty rate", held: "not_permitted" });
  });

  it("a hit is a name, an address and words: no field of it is, or dates, a value", () => {
    const answer = search(release, "local", "fixture", { limit: 50 });
    for (const g of answer.groups) for (const hit of g.hits) expect(Object.keys(hit).filter((k) => !["kind", "id", "title", "href", "detail", "held"].includes(k))).toEqual([]);
    const text = JSON.stringify(search(release, "local", "price", { limit: 50 }).groups.filter((g) => g.kind === "series"));
    for (const value of ["109.9", "104.5", "2025-12"]) expect(text).not.toContain(value);
  });

  it("gives at most the number of hits asked for in a group, and still says how many there are", () => {
    const answer = search(release, "local", "fixture", { limit: 3 });
    expect(group(answer, "series")).toMatchObject({ total: 8 });
    expect(group(answer, "series")!.hits).toHaveLength(3);
  });

  it("answers nothing for no question, and says so for no match", () => {
    expect(search(release, "local", "")).toEqual({ q: "", asked: false, groups: [], total: 0 });
    expect(search(release, "local", " \t ")).toMatchObject({ asked: false });
    expect(search(release, "local", "zzzz")).toEqual({ q: "zzzz", asked: true, groups: [], total: 0 });
    expect(search(release, "local", "...")).toMatchObject({ asked: true, total: 0 });
  });

  it("reads the question from an address: the first q, trimmed, at most 100 characters", () => {
    expect(parseSearch({ q: "  price  " })).toBe("price");
    expect(parseSearch({ q: ["a", "b"] })).toBe("a");
    expect(parseSearch({})).toBe("");
    expect(parseSearch({ q: "x".repeat(300) })).toHaveLength(100);
  });

  it("searches a Release written before 0.5.0 by the same projection of its own files", async () => {
    const root = tempRoot();
    const id = "20260301T000000Z-abcdef3";
    addRelease(root, { id, schema: "0.4.0" });
    promote(root, id);
    const old = await open(root);
    expect(old.search.entries.map((e) => e.id)).toEqual(release.search.entries.map((e) => e.id));
    expect(ids(search(old, "local", "poverty"), "series")).toEqual(["fx_poverty_rate_annual"]);
  });
});
