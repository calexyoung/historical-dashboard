/** Staleness has a fixed clock: schema/README.md, "Staleness has a fixed clock". */
import { describe, expect, it } from "vitest";
import { staleness } from "./staleness";

const CREATED = "2026-01-01T00:00:00Z";

describe("staleness: how far the last Period trails the Release's created date", () => {
  it.each([
    // last period_end, max_lag, stale?, the day the limit ran out
    ["2025-12-31", "P2M", false, "2026-02-28"],
    ["2025-11-01", "P2M", false, "2026-01-01"], // created on the limit day itself: still inside
    ["2025-10-31", "P2M", true, "2025-12-31"],
    ["2024-06-30", "P3M", true, "2024-09-30"],
    ["2025-11-17", "P45D", false, "2026-01-01"],
    ["2025-11-16", "P45D", true, "2025-12-31"],
    ["2025-12-18", "P2W", false, "2026-01-01"],
    ["2025-12-17", "P2W", true, "2025-12-31"],
    ["2024-01-01", "P2Y", false, "2026-01-01"],
    ["2023-12-31", "P2Y", true, "2025-12-31"],
    ["2024-02-29", "P1Y", true, "2025-02-28"], // a leap day lands on the month's last day
    ["2025-08-31", "P1M", true, "2025-09-30"],
  ])("last period ends %s, limit %s: stale %s", (periodEnd, maxLag, stale, limit) => {
    expect(staleness(periodEnd, maxLag, CREATED)).toEqual({ known: true, stale, limit });
  });

  it("says nothing when no limit is recorded: absent is not a default", () => {
    expect(staleness("2001-01-31", undefined, CREATED)).toEqual({ known: false });
  });

  it.each(["P0M", "3M", "P1.5M", "PT3H", "P1M2D", "", "P-1M"])("refuses a limit it cannot read (%j) by not knowing", (maxLag) => {
    expect(staleness("2025-12-31", maxLag, CREATED)).toEqual({ known: false });
  });

  it("judges against the calendar day of created, in UTC", () => {
    expect(staleness("2025-12-01", "P1M", "2026-01-01T23:59:59Z")).toEqual({ known: true, stale: false, limit: "2026-01-01" });
    expect(staleness("2025-12-01", "P1M", "2026-01-02T00:00:00Z")).toEqual({ known: true, stale: true, limit: "2026-01-01" });
  });
});
