/**
 * Saved queries on the site's side (PLAN M18): the strict reading of an address that
 * `python -m atlas save` shares (checks/explorer-addresses.json; tests/v2/test_saved_queries.py
 * runs the same file), and the fixed selection of `saved.json` a page may show.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { savedAddress, savedQueries } from "./saved";

const cases = JSON.parse(readFileSync(new URL("../../../../checks/explorer-addresses.json", import.meta.url), "utf8")) as { accepted: string[]; rejected: string[] };
const PIN = "20260101T000000Z-0000000";
const VIEW = `s=unrate&mode=lin&from=2019-06&to=2022-06&layers=none&pin=${PIN}`;
const entry = (over: Record<string, unknown> = {}) => ({ id: "sq-20260513-0a1b2c3d", note: "Unemployment through the pandemic", query: VIEW, release_id: PIN, saved_at: "2026-05-13T16:07:11Z", ...over });
const file = (...entries: unknown[]) => JSON.stringify({ format: 1, saved: entries });

describe("the address of a saved query", () => {
  it.each(cases.accepted)("accepts %s", (address) => expect(savedAddress(address)).toBe(address));
  it.each(cases.rejected)("rejects %s", (address) => expect(savedAddress(address)).toBeNull());
});

describe("saved.json as a page may show it", () => {
  it("is a fixed selection of each entry, newest first", () => {
    const older = entry({ id: "sq-20260401-ffffffff", saved_at: "2026-04-01T00:00:00Z", extra: "not carried" });
    expect(savedQueries(file(older, entry()))).toEqual([
      { id: "sq-20260513-0a1b2c3d", note: "Unemployment through the pandemic", query: VIEW, releaseId: PIN, savedAt: "2026-05-13T16:07:11Z" },
      { id: "sq-20260401-ffffffff", note: "Unemployment through the pandemic", query: VIEW, releaseId: PIN, savedAt: "2026-04-01T00:00:00Z" },
    ]);
  });

  it.each([
    ["an id that is not one", { id: "../x" }],
    ["no note", { note: " " }],
    ["a note with a control character", { note: "a\u0007b" }],
    ["a note that is too long", { note: "x".repeat(281) }],
    ["an address that is not the Explorer's own", { query: "javascript:alert(1)" }],
    ["an address with no pin", { query: VIEW.replace(`&pin=${PIN}`, "") }],
    ["a pin that is not the release it names", { release_id: "20260102T000000Z-1111111" }],
    ["a time that is not an instant", { saved_at: "yesterday" }],
  ])("drops an entry with %s", (_, over) => expect(savedQueries(file(entry(over)))).toEqual([]));

  it("is empty for a file that is not JSON, or not this shape", () => {
    for (const text of ["", "{", "[]", '{"saved": "all"}', "null"]) expect(savedQueries(text)).toEqual([]);
  });
});
