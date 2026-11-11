// The rights gate: permits(rightsUsed, surface) over the rights register (PLAN M6; 6.1; ADR 0006).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, SURFACES, createRightsGate, permits, type RightsUse } from "./rights";
import { RIGHTS_REGISTER } from "./rights-register.generated";

type Case = { name: string; register?: string; lineage: string; surface: string | null; allowed: boolean; reason_has?: string };
type Table = { registers: Record<string, unknown>; lineage: Record<string, RightsUse[]>; cases: Case[] };
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const table = JSON.parse(read("checks/permits-cases.json")) as Table;
const direct = table.lineage["agency_direct"]!;
const testRegister = table.registers["test"] as { rows: { id: string; decision: unknown }[] };

describe("permits, shared table", () => {
  it.each(table.cases)("$name", (c) => {
    const lineage = table.lineage[c.lineage]!;
    const decision =
      c.register === undefined
        ? permits(lineage, c.surface as string)
        : createRightsGate(table.registers[c.register]).permits(lineage, c.surface as string);
    expect(decision.allowed).toBe(c.allowed);
    if (c.reason_has !== undefined && !decision.allowed) expect(decision.reason).toContain(c.reason_has);
  });
});

describe("permits, over the committed register", () => {
  it("is the register Python reads: same version, same rows, same decisions", () => {
    const source = JSON.parse(read("schema/rights-register.json")) as { version: string; rows: { id: string; decision: unknown }[] };
    const generated = RIGHTS_REGISTER as typeof source;
    expect(generated.version).toBe(source.version);
    expect(generated.rows.map((row) => [row.id, row.decision])).toEqual(source.rows.map((row) => [row.id, row.decision]));
    expect(createRightsGate(RIGHTS_REGISTER).problem).toBeNull();
  });

  it("permits only the local surface, for every permission, to an origin it does not list", () => {
    expect([...SURFACES].sort()).toEqual(["local", "production", "staging"]);
    for (const surface of SURFACES) {
      for (const permission of PERMISSIONS) {
        const lineage = [{ ...direct[0]!, permission }];
        expect(permits(lineage, surface).allowed, `${surface} ${permission}`).toBe(surface === "local");
      }
    }
  });

  it("permits nothing on a public surface for any row that is not signed", () => {
    const all = (RIGHTS_REGISTER as { rows: { kind: string; origins?: string[]; datasets?: string[] | "*"; channel?: string; decision: unknown }[] }).rows;
    const rows = all.filter((row) => row.decision === null);
    const channels = ["direct", "computed", "hand_entered", "fixture", ...all.flatMap((row) => (row.channel ? [row.channel] : []))];
    let asked = 0;
    for (const row of rows) {
      for (const origin of row.origins ?? []) {
        for (const dataset of row.datasets === "*" ? ["anything"] : row.datasets!) {
          for (const channel of channels) {
            for (const permission of PERMISSIONS) {
              for (const surface of ["staging", "production"]) {
                const lineage: RightsUse[] = [{ origin, dataset, channel, representation: "native", permission }];
                expect(permits(lineage, surface).allowed, `${origin} ${channel}`).toBe(false);
                asked += 1;
              }
            }
          }
        }
      }
    }
    if (rows.length === all.length) expect(asked).toBeGreaterThan(1000);
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

describe("createRightsGate", () => {
  it("keeps the table it was built from: signing a row afterwards opens nothing", () => {
    const copy = structuredClone(testRegister);
    const unsigned = table.lineage["unsigned__direct__display"]!;
    const gate = createRightsGate(copy);
    expect(gate.permits(unsigned, "production").allowed).toBe(false);
    const signed = copy.rows.find((row) => row.decision !== null)!.decision;
    copy.rows.find((row) => row.id === "unsigned")!.decision = signed;
    expect(gate.permits(unsigned, "production").allowed).toBe(false);
    expect(createRightsGate(copy).permits(unsigned, "production").allowed).toBe(true);
  });

  it("says what is wrong with a table it cannot trust", () => {
    expect(createRightsGate(testRegister).problem).toBeNull();
    expect(createRightsGate(table.registers["invalid_format"]).problem).toContain("format");
    expect(createRightsGate(table.registers["invalid_duplicate_id"]).problem).toContain("open");
  });
});
