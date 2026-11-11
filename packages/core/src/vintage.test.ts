/**
 * Vintage resolution (docs/method/vintage-resolution.md), tested from that text. Every expected
 * table here is written out by hand from the rows above it; none comes from the code under test.
 * All values are invented.
 */
import { describe, expect, it } from "vitest";
import { periodBounds, type Frequency } from "./period";
import type { VintageFile, VintageRow } from "./release/types.generated";
import { SEMANTICS_VERSION } from "./transform";
import { BASES, cutoffFor, resolve, weakestBasis, type ResolveSeries, type VintageAnswer } from "./vintage";

const RELEASE = { releaseId: "20260601T000000Z-abcdef0" };
const hash = (name: string): string => name.padEnd(64, "0").replace(/[^0-9a-f]/g, "a");
const M1 = hash("1");
const M2 = hash("2");

type RowExtra = Partial<Pick<VintageRow, "deleted" | "provider_from" | "provider_to" | "provider_precision" | "metadata" | "channel">>;
/** One version of one Observation: Period, value, Status, held from, held to. */
function row(freq: Frequency, period: string, value: number | null, status: VintageRow["status"], from: string, to: string | null, extra: RowExtra = {}): VintageRow {
  const bounds = periodBounds(freq, period)!;
  return {
    period, period_start: bounds.start, period_end: bounds.end, value, status, deleted: false,
    recorded_from: from, recorded_to: to, provider_from: null, provider_to: null, provider_precision: null,
    channel: "direct", metadata: M1, ...extra,
  };
}
const meta = (hashOf: string, from: string, unit: string): VintageFile["metadata"][number] => ({
  hash: hashOf, recorded_from: from,
  metadata: { name: "Fixture price index", unit, source: { origin: { producer: "Fixture office", dataset: "prices", origin_id: "FX1", url: null }, channel: { via: "direct" } } },
});
const capture = (at: string, change: VintageFile["captures"][number]["change"], scope: [string | null, string | null] = ["2026-01-01", "2026-12-31"]) =>
  ({ retrieved_at: at, scope, change });

function native(vintages: VintageFile | null, current: [string, number | null, string][] = []): ResolveSeries {
  const freq = vintages?.freq ?? "monthly";
  return {
    key: "fx_price", freq, representation: "native", vintages,
    observations: current.map(([period, value, status]) => {
      const bounds = periodBounds(freq, period)!;
      return { period, period_start: bounds.start, period_end: bounds.end, value, status };
    }),
  };
}
const table = (answer: VintageAnswer): unknown[][] => answer.observations.map((o) => [o.period, o.value, o.status, o.basis]);

// Three daily Captures at 10:45 New York time (14:45Z in summer), then none for three days.
//   9 June   first:    January 100.0 final, February 100.4 preliminary
//   10 June  revision: February becomes 100.6 final; March 100.9 preliminary is added
//   11 June  nothing changed (a capture confirmation)
//   15 June  revision: January is no longer listed (a tombstone); April 101.3 is added
const C1 = "2026-06-09T14:45:00Z";
const C2 = "2026-06-10T14:45:00Z";
const C3 = "2026-06-11T14:45:00Z";
const C4 = "2026-06-15T14:45:00Z";
const observed: VintageFile = {
  key: "fx_price", freq: "monthly", representation: "native", provider_coverage: null,
  metadata: [meta(M1, C1, "index, 2024-01 = 100")],
  captures: [capture(C1, "first"), capture(C2, "revision"), capture(C3, "none"), capture(C4, "revision")],
  rows: [
    row("monthly", "2026-01", 100.0, "final", C1, C4),
    row("monthly", "2026-01", null, null, C4, null, { deleted: true }),
    row("monthly", "2026-02", 100.4, "preliminary", C1, C2),
    row("monthly", "2026-02", 100.6, "final", C2, null),
    row("monthly", "2026-03", 100.9, "preliminary", C2, null),
    row("monthly", "2026-04", 101.3, "final", C4, null),
  ],
};
const NOW: [string, number | null, string][] = [["2026-02", 100.6, "final"], ["2026-03", 100.9, "preliminary"], ["2026-04", 101.3, "final"]];

describe("the cutoff", () => {
  it("for a date is 00:00 in New York on that date, in summer and in winter", () => {
    expect(cutoffFor("2026-06-10")).toEqual({ instant: "2026-06-10T04:00:00Z", day: "2026-06-10", precision: "date", zone: "America/New_York" });
    expect(cutoffFor("2026-01-15")).toEqual({ instant: "2026-01-15T05:00:00Z", day: "2026-01-15", precision: "date", zone: "America/New_York" });
  });
  it("on the days the clocks change is still that day's midnight", () => {
    expect(cutoffFor("2026-03-08")?.instant).toBe("2026-03-08T05:00:00Z"); // clocks go forward at 02:00
    expect(cutoffFor("2026-03-09")?.instant).toBe("2026-03-09T04:00:00Z");
    expect(cutoffFor("2026-11-01")?.instant).toBe("2026-11-01T04:00:00Z"); // clocks go back at 02:00
    expect(cutoffFor("2026-11-02")?.instant).toBe("2026-11-02T05:00:00Z");
  });
  it("for an instant is that instant, and its day is New York's", () => {
    expect(cutoffFor("2026-06-10T02:30:00Z")).toEqual({ instant: "2026-06-10T02:30:00Z", day: "2026-06-09", precision: "datetime", zone: "America/New_York" });
  });
  it("is not made from anything else", () => {
    for (const bad of ["", "2026-6-1", "2026-02-30", "2026-06-10T10:00:00", "2026-06-10T10:00:00+02:00", "yesterday", "2026-13-01"]) {
      expect(cutoffFor(bad)).toBeNull();
    }
  });
});

describe("no coverage", () => {
  it("before Macro Atlas's first Capture the answer is unavailable and holds no Observation", () => {
    const answer = resolve(native(observed, NOW), "2026-06-09", RELEASE);
    expect(answer.basis).toBe("unavailable");
    expect(answer.reason).toBe("no_coverage");
    expect(answer.observations).toEqual([]);
    expect(answer.cutoff?.instant).toBe("2026-06-09T04:00:00Z");
  });
  it("a Series with no vintage file is unavailable as-of any date, never today's figures", () => {
    for (const asOf of ["2020-01-01", "2026-06-12", "2030-01-01"]) {
      const answer = resolve(native(null, NOW), asOf, RELEASE);
      expect([answer.basis, answer.reason, answer.observations]).toEqual(["unavailable", "no_vintages", []]);
    }
  });
  it("a question that is not a date or an instant is unavailable, and says so", () => {
    const answer = resolve(native(observed, NOW), "last tuesday", RELEASE);
    expect([answer.basis, answer.reason, answer.cutoff, answer.observations]).toEqual(["unavailable", "bad_as_of", null, []]);
  });
  it("every answer echoes the Release and the engine's semantics version", () => {
    const answer = resolve(native(observed, NOW), "2026-06-09", RELEASE);
    expect([answer.key, answer.as_of, answer.release_id, answer.semantics_version]).toEqual(["fx_price", "2026-06-09", RELEASE.releaseId, SEMANTICS_VERSION]);
    expect(SEMANTICS_VERSION).toBe("0.5.0");
  });
});

describe("the bases", () => {
  it("are five, strongest first, and the weakest of several is the one furthest down", () => {
    expect(BASES).toEqual(["provider", "atlas_observed", "legacy", "uncertain", "unavailable"]);
    expect(weakestBasis(["provider", "atlas_observed"])).toBe("atlas_observed");
    expect(weakestBasis(["atlas_observed", "uncertain", "legacy"])).toBe("uncertain");
    expect(weakestBasis(["provider", "unavailable"])).toBe("unavailable");
    expect(weakestBasis([])).toBeNull();
  });
});
