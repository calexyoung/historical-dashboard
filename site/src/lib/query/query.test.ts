/**
 * Query v0 (PLAN 4.2, M2): one validated request shape, answered from one Release by the engine,
 * after asking the rights gate. Tested through `query()` on the synthetic fixture release.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { SEMANTICS_VERSION } from "@macro-atlas/core";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { FIXTURE_ID, FIXTURE_ROOT } from "../release/testing";
import { latestValue, MAX_SERIES, query, rightsLineage } from "./index";

let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});

const ask = (request: unknown, surface: "local" | "staging" | "production" = "local") => query(release, surface, request);
const base = { series: ["fx_price_index"], transform: "lin", permission: "display" };

describe("a valid request is answered from the release, by the engine", () => {
  it("returns the observations in the window with the release and semantics it came from", () => {
    const answer = ask({ ...base, from: "2024-01-01", to: "2024-03-31" });
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.release_id).toBe(FIXTURE_ID);
    expect(answer.semantics_version).toBe(SEMANTICS_VERSION);
    expect(answer.series).toHaveLength(1);
    const [series] = answer.series;
    expect(series).toMatchObject({ key: "fx_price_index", name: "Fixture price index", freq: "monthly", representation: "native" });
    if (!series!.result.ok) throw new Error("unavailable");
    expect(series!.result.observations.map((o) => o.period)).toEqual(["2024-01", "2024-02", "2024-03"]);
    expect(series!.result.observations[0]!.value).toBe(100);
    expect(answer.rows).toBe(3);
  });

  it("applies the transform asked for", () => {
    const answer = ask({ ...base, transform: "rebase", from: "2024-01-01", to: "2024-02-29" });
    if (!answer.ok || !answer.series[0]!.result.ok) throw new Error("unavailable");
    expect(answer.series[0]!.result.observations[0]!.value).toBe(100);
    expect(answer.series[0]!.result.reference).toMatchObject({ kind: "rebase", period: "2024-01" });
  });

  it("answers several series in the order asked, each on its own cadence", () => {
    const answer = ask({ ...base, series: ["fx_output_quarterly", "fx_vote_margin", "fx_price_index_yoy"] });
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.series.map((s) => [s.key, s.freq])).toEqual([
      ["fx_output_quarterly", "quarterly"],
      ["fx_vote_margin", "irregular"],
      ["fx_price_index_yoy", "monthly"],
    ]);
  });

  it("a transform that is unavailable for one series is said so for that series; the rest still answer", () => {
    const answer = ask({ ...base, series: ["fx_vote_margin", "fx_price_index"], transform: "pc1" });
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.series[0]!.result).toMatchObject({ ok: false, reason: "frequency_not_supported" });
    expect(answer.series[1]!.result.ok).toBe(true);
  });

  it("an empty window is an answer with no rows, not an error", () => {
    const answer = ask({ ...base, from: "1990-01-01", to: "1990-12-31" });
    expect(answer).toMatchObject({ ok: true, rows: 0 });
  });
});

describe("the one request shape", () => {
  it.each([
    ["not an object", "lin"],
    ["null", null],
    ["an array", [base]],
    ["no series", { ...base, series: [] }],
    ["series not a list", { ...base, series: "fx_price_index" }],
    ["a key that is not a key", { ...base, series: ["../manifest"] }],
    ["the same series twice", { ...base, series: ["fx_price_index", "fx_price_index"] }],
    ["too many series", { ...base, series: Array.from({ length: MAX_SERIES + 1 }, (_, i) => `k${i}`) }],
    ["an unknown transform", { ...base, transform: "pch" }],
    ["no transform", { series: base.series, permission: "display" }],
    ["no permission", { series: base.series, transform: "lin" }],
    ["a permission that does not exist", { ...base, permission: "admin" }],
    ["a date that is not one", { ...base, from: "2024-02-30" }],
    ["a month where a date is wanted", { ...base, from: "2024-02" }],
    ["a window that ends before it starts", { ...base, from: "2024-06-01", to: "2024-01-01" }],
    ["a field the shape does not have", { ...base, as_of: "2024-01-01" }],
  ])("refuses %s with 400", (_, request) => {
    expect(ask(request)).toMatchObject({ ok: false, status: 400, code: "bad_request" });
  });

  it("refuses a series the release does not know with 404, naming it", () => {
    const answer = ask({ ...base, series: ["fx_price_index", "no_such_series"] });
    expect(answer).toMatchObject({ ok: false, status: 404, code: "unknown_series" });
    expect(!answer.ok && answer.message).toContain("no_such_series");
  });

  it("caps the size of an answer", () => {
    const answer = query(release, "local", { ...base, series: ["fx_price_index", "fx_payrolls_break"] }, { maxRows: 10 });
    expect(answer).toMatchObject({ ok: false, status: 422, code: "too_large" });
  });
});

describe("the rights gate is asked before anything is answered (PLAN 6.1)", () => {
  it("a withheld series is refused with its reason and no values", () => {
    const answer = ask({ ...base, series: ["fx_exchange_index"] });
    expect(answer).toMatchObject({ ok: false, status: 403, code: "withheld" });
    expect(!answer.ok && answer.message).toContain("does not allow redistribution");
    expect(JSON.stringify(answer)).not.toMatch(/"value"/);
  });

  it("gives the gate the whole lineage: the series and every input of a derived one", () => {
    const answer = ask({ ...base, series: ["fx_price_index_yoy"], permission: "redistribute" });
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.rights_used).toEqual([
      { origin: "Macro Atlas fixture (synthetic)", dataset: "fixture", channel: "fixture", representation: "native", permission: "redistribute" },
    ]);
    const lineage = rightsLineage(release, ["fx_price_index_yoy"], "display");
    expect(lineage.ok && lineage.series).toEqual(["fx_price_index", "fx_price_index_yoy"]);
  });

  it("on any surface but local, M0's gate allows nothing, so Query answers 403 and holds no values", () => {
    for (const surface of ["staging", "production"] as const) {
      const answer = ask(base, surface);
      expect(answer).toMatchObject({ ok: false, status: 403, code: "not_permitted" });
      expect(!answer.ok && answer.message).toContain(surface);
      expect(JSON.stringify(answer)).not.toMatch(/"value"|observations/);
    }
  });

  it("refuses the whole request when one series in it is not permitted", () => {
    const answer = ask({ ...base, series: ["fx_price_index", "fx_exchange_index"] });
    expect(answer).toMatchObject({ ok: false, status: 403 });
  });
});

describe("the latest value of a series, for a list", () => {
  it("is the last observation that has a value, with its period", () => {
    expect(latestValue(release, "local", "fx_output_quarterly")).toMatchObject({ ok: true, period: expect.stringMatching(/^\d{4}-Q[1-4]$/) });
    const stale = latestValue(release, "local", "fx_permits_stale");
    expect(stale.ok && typeof stale.value).toBe("number");
  });

  it("is refused where the series is withheld or the surface is not permitted", () => {
    expect(latestValue(release, "local", "fx_exchange_index")).toMatchObject({ ok: false, code: "withheld" });
    expect(latestValue(release, "production", "fx_price_index")).toMatchObject({ ok: false, code: "not_permitted" });
  });
});
