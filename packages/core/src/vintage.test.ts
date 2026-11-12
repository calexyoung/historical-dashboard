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
  metadata: { name: "Fixture price index", unit, source: { origin: { producer: "Fixture office", dataset: "prices", origin_id: "FX1", url: null }, channel: { via: "direct" } }, rights: null },
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
  it("a question before 1900 has no Cutoff: the floor is the UTC year of what was asked", () => {
    // docs/method/vintage-resolution.md: New York's clock is taken as four or five hours behind
    // UTC, which holds from 1883, and no record here reaches back so far.
    for (const asOf of ["1899-12-31", "1899-12-31T23:59:59Z", "0001-01-01", "0099-06-10"]) {
      const answer = resolve(native(observed, NOW), asOf, RELEASE);
      expect([asOf, answer.basis, answer.reason, answer.cutoff, answer.observations]).toEqual([asOf, "unavailable", "bad_as_of", null, []]);
    }
    // From 1900 the question is a good one that nothing here covers.
    const first = resolve(native(observed, NOW), "1900-01-01", RELEASE);
    expect([first.basis, first.reason, first.cutoff?.instant, first.cutoff?.day]).toEqual(["unavailable", "no_coverage", "1900-01-01T05:00:00Z", "1900-01-01"]);
    // An instant is judged by its UTC date, so this one is asked although its New York day is in 1899.
    const instant = resolve(native(observed, NOW), "1900-01-01T00:00:00Z", RELEASE);
    expect([instant.basis, instant.reason, instant.cutoff?.instant, instant.cutoff?.day]).toEqual(["unavailable", "no_coverage", "1900-01-01T00:00:00Z", "1899-12-31"]);
  });
  it("every answer echoes the Release and the engine's semantics version", () => {
    const answer = resolve(native(observed, NOW), "2026-06-09", RELEASE);
    expect([answer.key, answer.as_of, answer.release_id, answer.semantics_version]).toEqual(["fx_price", "2026-06-09", RELEASE.releaseId, SEMANTICS_VERSION]);
    expect(SEMANTICS_VERSION).toBe("0.8.0");
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

describe("an Atlas-observed vintage: what Macro Atlas held just before the cutoff", () => {
  it("the morning after the first Capture: the two months first seen", () => {
    const answer = resolve(native(observed, NOW), "2026-06-10", RELEASE);
    expect(answer.basis).toBe("atlas_observed");
    expect(table(answer)).toEqual([
      ["2026-01", 100.0, "final", "atlas_observed"],
      ["2026-02", 100.4, "preliminary", "atlas_observed"],
    ]);
    expect(answer.observations[1]).toMatchObject({ known_by: "atlas", known_from: C1, last_checked: C1 });
    expect(answer.capture_gap).toEqual({ from: C1, to: C2, missed_days: 0, changed_across: true });
  });
  it("after the revision: the revised February and the new March; the old February is gone", () => {
    const answer = resolve(native(observed, NOW), "2026-06-11", RELEASE);
    expect(answer.basis).toBe("atlas_observed");
    expect(table(answer)).toEqual([
      ["2026-01", 100.0, "final", "atlas_observed"],
      ["2026-02", 100.6, "final", "atlas_observed"],
      ["2026-03", 100.9, "preliminary", "atlas_observed"],
    ]);
    expect(answer.observations[1]).toMatchObject({ known_from: C2, last_checked: C2 });
    expect(answer.capture_gap).toEqual({ from: C2, to: C3, missed_days: 0, changed_across: false });
  });
  it("a Capture taken at the cutoff's own instant is not before it", () => {
    const answer = resolve(native(observed, NOW), C2, RELEASE);
    expect(table(answer)).toEqual([
      ["2026-01", 100.0, "final", "atlas_observed"],
      ["2026-02", 100.4, "preliminary", "atlas_observed"],
    ]);
    expect(answer.capture_gap).toMatchObject({ from: C1, to: C2 });
  });
  it("orders instants to the last digit a Release may write, not to the millisecond", () => {
    // One microsecond after the first Capture, that Capture is before the cutoff.
    const just = resolve(native(observed, NOW), "2026-06-09T14:45:00.000001Z", RELEASE);
    expect([just.basis, table(just).length, just.capture_gap?.from]).toEqual(["atlas_observed", 2, C1]);
    // A Capture stamped a microsecond after the cutoff is not.
    const fine: VintageFile = { ...observed, captures: [capture("2026-06-09T14:45:00.000002Z", "first")], rows: [row("monthly", "2026-01", 100.0, "final", "2026-06-09T14:45:00.000002Z", null)] };
    expect(resolve(native(fine), "2026-06-09T14:45:00.000001Z", RELEASE).basis).toBe("unavailable");
    expect(resolve(native(fine), "2026-06-09T14:45:00.000003Z", RELEASE).basis).toBe("atlas_observed");
  });
  it("a question with a time counts what Macro Atlas held by that time on the day", () => {
    const answer = resolve(native(observed, NOW), "2026-06-10T18:00:00Z", RELEASE); // 14:00 in New York
    expect(answer.cutoff).toMatchObject({ day: "2026-06-10", precision: "datetime" });
    expect(table(answer).map((r) => r[1])).toEqual([100.0, 100.6, 100.9]);
  });
  it("a withdrawn Period is absent, and what is left starts where the data starts", () => {
    const answer = resolve(native(observed, NOW), "2026-06-16", RELEASE);
    expect(table(answer)).toEqual([
      ["2026-02", 100.6, "final", "atlas_observed"],
      ["2026-03", 100.9, "preliminary", "atlas_observed"],
      ["2026-04", 101.3, "final", "atlas_observed"],
    ]);
    expect(answer.capture_gap).toEqual({ from: C4, to: null, missed_days: 0, changed_across: null });
  });
  it("a Period withdrawn from the middle is an explicit missing Observation with no basis", () => {
    const file: VintageFile = {
      ...observed,
      captures: [capture(C1, "first"), capture(C2, "revision")],
      rows: [
        row("monthly", "2026-01", 100.0, "final", C1, null),
        row("monthly", "2026-02", 100.4, "final", C1, C2),
        row("monthly", "2026-02", null, null, C2, null, { deleted: true }),
        row("monthly", "2026-03", 100.9, "final", C1, null),
      ],
    };
    expect(table(resolve(native(file), "2026-06-11", RELEASE))).toEqual([
      ["2026-01", 100.0, "final", "atlas_observed"],
      ["2026-02", null, "missing", null],
      ["2026-03", 100.9, "final", "atlas_observed"],
    ]);
    expect(table(resolve(native(file), "2026-06-10", RELEASE)).map((r) => r[1])).toEqual([100.0, 100.4, 100.9]);
  });
});

describe("the capture gap", () => {
  it("one whole day with no Capture before the cutoff makes the answer uncertain", () => {
    const answer = resolve(native(observed, NOW), "2026-06-13", RELEASE); // nothing on 12 June
    expect(answer.basis).toBe("uncertain");
    expect(answer.capture_gap).toEqual({ from: C3, to: C4, missed_days: 1, changed_across: true });
    expect(table(answer)).toEqual([
      ["2026-01", 100.0, "final", "uncertain"],
      ["2026-02", 100.6, "final", "uncertain"],
      ["2026-03", 100.9, "preliminary", "uncertain"],
    ]);
  });
  it("counts every whole New York day between the last Capture and the cutoff", () => {
    expect(resolve(native(observed, NOW), "2026-06-12", RELEASE).capture_gap?.missed_days).toBe(0);
    expect(resolve(native(observed, NOW), "2026-06-15", RELEASE).capture_gap?.missed_days).toBe(3);
    const later = resolve(native(observed, NOW), "2026-06-20", RELEASE); // 16, 17, 18, 19 June
    expect([later.basis, later.capture_gap?.missed_days, later.capture_gap?.to]).toEqual(["uncertain", 4, null]);
  });
  it("stays uncertain even when the next Capture found nothing changed, and says that it did not", () => {
    const file: VintageFile = { ...observed, captures: [capture(C1, "first"), capture(C4, "none")], rows: [row("monthly", "2026-01", 100.0, "final", C1, null)] };
    const answer = resolve(native(file), "2026-06-12", RELEASE);
    expect([answer.basis, answer.capture_gap]).toEqual(["uncertain", { from: C1, to: C4, missed_days: 2, changed_across: false }]);
  });
  it("a Capture vouches only for the Periods it asked about", () => {
    // The first Capture asked about 2025 and 2026; the second, a day later, only about 2026.
    const file: VintageFile = {
      ...observed,
      captures: [capture(C1, "first", ["2025-01-01", "2026-12-31"]), capture(C2, "none", ["2026-01-01", "2026-12-31"])],
      rows: [row("monthly", "2025-12", 99.7, "final", C1, null), row("monthly", "2026-01", 100.0, "final", C1, null)],
    };
    const answer = resolve(native(file), "2026-06-11", RELEASE);
    expect(table(answer)).toEqual([
      ["2025-12", 99.7, "final", "uncertain"], // last asked about on 9 June; 10 June is a day unseen
      ["2026-01", 100.0, "final", "atlas_observed"],
    ]);
    expect(answer.observations.map((o) => o.last_checked)).toEqual([C1, C2]);
    expect(answer.basis).toBe("uncertain"); // the weakest of its Observations
    expect(answer.capture_gap?.missed_days).toBe(0);
  });
});

describe("the same-day flag", () => {
  it("is set when a version was first seen on the cutoff's day, whether or not it counts", () => {
    expect(resolve(native(observed, NOW), "2026-06-10", RELEASE).same_day_release).toBe(true); // seen 10:45 that day
    expect(resolve(native(observed, NOW), "2026-06-10T18:00:00Z", RELEASE).same_day_release).toBe(true);
    expect(resolve(native(observed, NOW), "2026-06-15", RELEASE).same_day_release).toBe(true);
  });
  it("is not set on a day when nothing changed", () => {
    expect(resolve(native(observed, NOW), "2026-06-11", RELEASE).same_day_release).toBe(false);
    expect(resolve(native(observed, NOW), "2026-06-12", RELEASE).same_day_release).toBe(false);
  });
  it("is not set by the first Capture: that is when Macro Atlas began to watch, not a release", () => {
    const answer = resolve(native(observed, NOW), "2026-06-09T18:00:00Z", RELEASE);
    expect([answer.basis, answer.same_day_release, table(answer).length]).toEqual(["atlas_observed", false, 2]);
  });
});

describe("metadata", () => {
  // On 10 June the unit was restated: every Period asked about is recorded again under it,
  // with the same number. December 2025 was not asked about that day.
  const restated: VintageFile = {
    ...observed,
    metadata: [meta(M1, C1, "index, 2024-01 = 100"), meta(M2, C2, "index, 2025-01 = 100")],
    captures: [capture(C1, "first", ["2025-01-01", "2026-12-31"]), capture(C2, "metadata")],
    rows: [
      row("monthly", "2025-12", 99.7, "final", C1, null),
      row("monthly", "2026-01", 100.0, "final", C1, C2),
      row("monthly", "2026-01", 100.0, "final", C2, null, { metadata: M2 }),
    ],
  };
  it("the metadata reported is the one in force at the cutoff, not today's", () => {
    const before = resolve(native(restated), "2026-06-10", RELEASE);
    expect(before.metadata).toMatchObject({ hash: M1, in_force_from: C1, differs_from_current: true, other_metadata_periods: [] });
    expect(before.metadata?.metadata.unit).toBe("index, 2024-01 = 100");
    const after = resolve(native(restated), "2026-06-11", RELEASE);
    expect(after.metadata).toMatchObject({ hash: M2, in_force_from: C2, differs_from_current: false });
    expect(after.metadata?.metadata.unit).toBe("index, 2025-01 = 100");
  });
  it("names the Periods still held under the earlier metadata", () => {
    expect(resolve(native(restated), "2026-06-11", RELEASE).metadata?.other_metadata_periods).toEqual(["2025-12"]);
  });
  it("a restatement under new metadata is not a same-day release of a figure", () => {
    expect(resolve(native(restated), "2026-06-10T18:00:00Z", RELEASE).same_day_release).toBe(false);
  });
});

describe("a provider vintage: what the Origin had published before the cutoff", () => {
  // An archive of the Origin's releases, imported on 1 June 2026 (I), complete from 1 January
  // 2025 to that day. Q1 was first published 29 April 2025 at 08:30 New York and revised on 28
  // May. Q2 is dated only to the day, 30 July. On 20 June 2026 (J) Macro Atlas saw Q2 change.
  const I = "2026-06-01T15:00:00Z";
  const J = "2026-06-20T14:45:00Z";
  const Q1A = "2025-04-29T12:30:00Z";
  const Q1B = "2025-05-28T12:30:00Z";
  const archive: VintageFile = {
    key: "fx_price", freq: "quarterly", representation: "native",
    provider_coverage: { from: "2025-01-01T00:00:00Z", to: "2026-06-01T00:00:00Z" },
    metadata: [meta(M1, I, "billions")],
    captures: [capture(I, "first", [null, null]), capture(J, "revision", [null, null])],
    rows: [
      row("quarterly", "2025-Q1", 600.0, "preliminary", I, I, { provider_from: Q1A, provider_to: Q1B, provider_precision: "datetime" }),
      row("quarterly", "2025-Q1", 601.5, "revised", I, null, { provider_from: Q1B, provider_precision: "datetime" }),
      row("quarterly", "2025-Q2", 610.0, "preliminary", I, J, { provider_from: "2025-07-30T00:00:00Z", provider_precision: "date" }),
      row("quarterly", "2025-Q2", 611.0, "revised", J, null),
    ],
  };
  const ask = (asOf: string): VintageAnswer => resolve(native(archive), asOf, RELEASE);

  it("on the morning of a release nothing is published yet: provider basis, no Observation, same day", () => {
    const answer = ask("2025-04-29");
    expect([answer.basis, table(answer), answer.same_day_release, answer.capture_gap]).toEqual(["provider", [], true, null]);
  });
  it("the day after: the first print, dated by the Origin", () => {
    const answer = ask("2025-04-30");
    expect(table(answer)).toEqual([["2025-Q1", 600.0, "preliminary", "provider"]]);
    expect(answer.observations[0]).toMatchObject({ known_by: "provider", known_from: Q1A, last_checked: null });
    expect(answer.same_day_release).toBe(false);
  });
  it("a question with a time counts a release dated to the minute earlier that day", () => {
    const answer = ask("2025-04-29T13:00:00Z"); // 09:00 New York, half an hour after the release
    expect([table(answer), answer.same_day_release]).toEqual([[["2025-Q1", 600.0, "preliminary", "provider"]], true]);
  });
  it("after the revision the revised figure is the one in force", () => {
    expect(table(ask("2025-06-01"))).toEqual([["2025-Q1", 601.5, "revised", "provider"]]);
  });
  it("a release dated only to the day does not count on that day, at any hour", () => {
    for (const asOf of ["2025-07-30", "2025-07-30T20:00:00Z"]) {
      const answer = ask(asOf);
      expect([table(answer), answer.same_day_release]).toEqual([[["2025-Q1", 601.5, "revised", "provider"]], true]);
    }
    const next = ask("2025-07-31");
    expect(table(next)).toEqual([["2025-Q1", 601.5, "revised", "provider"], ["2025-Q2", 610.0, "preliminary", "provider"]]);
    expect(next.observations[1]!.known_from).toBe("2025-07-30");
  });
  it("reports the metadata the versions were recorded under, with no date it cannot know", () => {
    expect(ask("2025-06-01").metadata).toMatchObject({ hash: M1, in_force_from: null, differs_from_current: false });
  });
  it("a microsecond past the end of the Origin's record is outside it", () => {
    expect(ask("2026-06-01T00:00:00Z").basis).toBe("provider"); // the record's last instant
    const past = ask("2026-06-01T00:00:00.000001Z"); // imported at 15:00 that day: nothing held yet
    expect([past.basis, past.reason]).toEqual(["unavailable", "no_coverage"]);
  });
  it("before the Origin's record begins there is no coverage", () => {
    expect([ask("2024-12-31").basis, ask("2024-12-31").reason]).toEqual(["unavailable", "no_coverage"]);
  });
  it("past the end of the Origin's record the answer is what Macro Atlas held, on its own clock", () => {
    const june = ask("2026-06-10"); // imported 1 June; no Capture from 2 to 9 June
    expect([june.basis, june.capture_gap?.missed_days]).toEqual(["uncertain", 8]);
    expect(table(june)).toEqual([["2025-Q1", 601.5, "revised", "uncertain"], ["2025-Q2", 610.0, "preliminary", "uncertain"]]);
    expect(june.observations[0]).toMatchObject({ known_by: "atlas", known_from: I });
    expect(table(ask("2026-06-21"))).toEqual([["2025-Q1", 601.5, "revised", "atlas_observed"], ["2025-Q2", 611.0, "revised", "atlas_observed"]]);
  });

  // Macro Atlas saw 700 on 10 January. In March it imported the Origin's record, which shows a
  // revision to 705 published on 8 January, before Macro Atlas ever looked.
  const K1 = "2026-01-10T15:45:00Z";
  const K2 = "2026-03-01T15:00:00Z";
  const late: VintageFile = {
    key: "fx_price", freq: "quarterly", representation: "native",
    provider_coverage: { from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" },
    metadata: [meta(M1, K1, "billions")],
    captures: [capture(K1, "first", [null, null]), capture(K2, "revision", [null, null])],
    rows: [
      row("quarterly", "2025-Q4", 700.0, "final", K1, K2),
      row("quarterly", "2025-Q4", 705.0, "revised", K2, null, { provider_from: "2026-01-08T13:30:00Z", provider_precision: "datetime" }),
    ],
  };
  it("past the Origin's record, a version it dated long ago but first held on the cutoff's day is flagged", () => {
    // The Origin dated the revision to 8 January; Macro Atlas first held it on 1 March.
    const noted = { ...late, provider_coverage: null };
    expect(resolve(native(noted), "2026-03-01", RELEASE).same_day_release).toBe(true);
    expect(resolve(native(noted), "2026-03-02", RELEASE).same_day_release).toBe(false);
  });
  it("the two clocks are never mixed: inside the Origin's record only versions it dated take part", () => {
    expect(table(resolve(native(late), "2026-01-11", RELEASE))).toEqual([["2025-Q4", 705.0, "revised", "provider"]]);
    expect(table(resolve(native(late), "2026-01-08", RELEASE))).toEqual([]); // published later that morning
  });
  it("without the Origin's record the same question is answered by what Macro Atlas held", () => {
    const answer = resolve(native({ ...late, provider_coverage: null }), "2026-01-11", RELEASE);
    expect(table(answer)).toEqual([["2025-Q4", 700.0, "final", "atlas_observed"]]);
  });
});

describe("a legacy Series", () => {
  const legacy = (heldAt: string | null): ResolveSeries => ({
    key: "cpi", freq: "monthly", representation: "legacy_monthly_rounded", heldAt,
    observations: [
      { period: "2026-03", period_start: "2026-03-01", period_end: "2026-03-31", value: 320.1, status: "final" },
      { period: "2026-04", period_start: "2026-04-01", period_end: "2026-04-30", value: 320.8, status: "final" },
    ],
  });
  const HELD = "2026-05-01T12:00:00Z";
  it("answers a cutoff after v1 generated it with what v1 held, on the legacy basis", () => {
    const answer = resolve(legacy(HELD), "2026-05-02", RELEASE);
    expect(answer.basis).toBe("legacy");
    expect(table(answer)).toEqual([["2026-03", 320.1, "final", "legacy"], ["2026-04", 320.8, "final", "legacy"]]);
    expect(answer.observations[0]).toMatchObject({ known_by: "legacy", known_from: HELD });
    expect([answer.capture_gap, answer.same_day_release, answer.metadata]).toEqual([null, false, null]);
  });
  it("is unavailable for any cutoff at or before that, and never answers with today's figures", () => {
    for (const asOf of ["2026-05-01", "2026-04-15", "2020-01-01", HELD]) {
      const answer = resolve(legacy(HELD), asOf, RELEASE);
      expect([answer.basis, answer.reason, answer.observations]).toEqual(["unavailable", "legacy_held_after_cutoff", []]);
    }
  });
  it("is unavailable when the Release does not say when v1 generated it", () => {
    for (const heldAt of [null, "sometime"]) {
      const answer = resolve(legacy(heldAt), "2030-01-01", RELEASE);
      expect([answer.basis, answer.reason, answer.observations]).toEqual(["unavailable", "legacy_not_dated", []]);
    }
  });
});

describe("no as-of question", () => {
  it("returns the Release's own state, which is not an as-of answer and has no basis", () => {
    const answer = resolve(native(observed, NOW), null, RELEASE);
    expect([answer.as_of, answer.basis, answer.cutoff, answer.capture_gap, answer.same_day_release]).toEqual([null, null, null, null, false]);
    expect(table(answer)).toEqual([["2026-02", 100.6, "final", null], ["2026-03", 100.9, "preliminary", null], ["2026-04", 101.3, "final", null]]);
  });
  it("the as-of answer just after the last Capture is that same state", () => {
    expect(table(resolve(native(observed, NOW), "2026-06-16", RELEASE)).map((r) => r.slice(0, 3))).toEqual(NOW);
  });
});
