// The permits(rightsUsed, surface) contract, default body (PLAN M0; section 6.1; ADR 0006).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, SURFACES, permits, type RightsUse } from "./rights";

type Table = {
  lineage: Record<string, RightsUse[]>;
  cases: { name: string; lineage: string; surface: string | null; allowed: boolean }[];
};
const table = JSON.parse(
  readFileSync(new URL("../../../checks/permits-cases.json", import.meta.url), "utf8"),
) as Table;
const direct = table.lineage["agency_direct"]!;

describe("permits, shared table", () => {
  it.each(table.cases)("$name", (c) => {
    expect(permits(table.lineage[c.lineage]!, c.surface as string).allowed).toBe(c.allowed);
  });
});

describe("permits, default body", () => {
  it("denies every surface other than local, for every permission", () => {
    expect([...SURFACES].sort()).toEqual(["local", "production", "staging"]);
    for (const surface of SURFACES) {
      for (const permission of PERMISSIONS) {
        const lineage = [{ ...direct[0]!, permission }];
        expect(permits(lineage, surface).allowed, `${surface} ${permission}`).toBe(surface === "local");
      }
    }
  });

  it("gives a reason with a denial", () => {
    const denied = permits(direct, "production");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toContain("production");
  });

  it("denies a malformed lineage instead of throwing", () => {
    expect(permits([{ origin: "x" }] as unknown as RightsUse[], "local").allowed).toBe(false);
    expect(permits(null as unknown as RightsUse[], "local").allowed).toBe(false);
    expect(
      permits([{ ...direct[0]!, permission: "publish" }] as unknown as RightsUse[], "local").allowed,
    ).toBe(false);
  });
});
