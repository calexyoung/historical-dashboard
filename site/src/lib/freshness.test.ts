import { describe, expect, it } from "vitest";
import { formatDay, freshness } from "./freshness";

const created = "2026-11-10T13:05:00Z";
const at = (iso: string) => Date.parse(iso);

describe("freshness: the dot and its word in the top bar", () => {
  it("is current for a day and a half after the release was created (the refresh is daily)", () => {
    expect(freshness(created, null, at("2026-11-10T13:05:01Z"))).toMatchObject({ state: "current", word: "Current" });
    expect(freshness(created, null, at("2026-11-12T01:04:59Z")).state).toBe("current");
  });

  it("is stale after that, and says how old in whole days", () => {
    expect(freshness(created, null, at("2026-11-12T01:05:01Z"))).toMatchObject({ state: "stale", word: "Stale" });
    expect(freshness(created, null, at("2026-11-20T13:05:00Z")).detail).toBe("release of 10 Nov 2026, 10 days old");
  });

  it("says when a newer release could not be opened, whatever the age", () => {
    const failed = { kind: "invalid", id: "20261111T000000Z-abcdef0", reason: "schema" } as const;
    expect(freshness(created, failed, at("2026-11-10T14:00:00Z"))).toMatchObject({
      state: "refresh_failed",
      word: "Refresh failed",
      detail: "showing the release of 10 Nov 2026",
    });
  });

  it("reports the age in seconds, never negative", () => {
    expect(freshness(created, null, at("2026-11-10T13:06:00Z")).ageSeconds).toBe(60);
    expect(freshness(created, null, at("2026-11-10T13:00:00Z")).ageSeconds).toBe(0);
  });

  it("formats a day in UTC, day first", () => {
    expect(formatDay("2026-01-01T00:00:00Z")).toBe("1 Jan 2026");
    expect(formatDay("2026-12-31T23:59:59Z")).toBe("31 Dec 2026");
  });
});
