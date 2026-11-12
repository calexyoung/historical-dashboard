/**
 * Test support: a public-profile Release of agency Series, made by the real capture kit and the
 * real release writer from the recorded exchanges in fixtures/capture (invented values), in a
 * temporary directory (`python fixtures/release/agency.py`). Never imported by the app.
 *
 * It is decided under a test register in which every capturing row carries a decision. That is
 * test data: the committed register signs no row. The same table is handed back as a gate, so a
 * test can ask the Explorer what it would show on a public Surface once rows are signed
 * (ADR 0031, point 12: a gate is an argument, and only tests pass one).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRightsGate, type RightsGate } from "@macro-atlas/core";

const REPO = fileURLToPath(new URL("../../../..", import.meta.url));

export type AgencyFixture = {
  /** A release root holding one promoted public-profile Release. */
  root: string;
  /** The test register the Release was decided under, as a table. */
  register: { rows: { id: string; decision: Record<string, unknown> | null }[] } & Record<string, unknown>;
  /** A gate over that table. */
  gate: RightsGate;
  /** The same table with every decision allowing display and not redistribution. */
  displayOnly: RightsGate;
};

/** Takes about fifteen seconds. */
export function buildAgencyRelease(): AgencyFixture {
  const dir = mkdtempSync(join(tmpdir(), "atlas-agency-"));
  const venv = join(REPO, ".venv", "bin", "python");
  const python = process.env.ATLAS_PYTHON ?? (existsSync(venv) ? venv : "python3");
  try {
    execFileSync(python, [join(REPO, "fixtures", "release", "agency.py"), "--out", dir], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const detail = (error as { stderr?: Buffer }).stderr?.toString().split("\n").slice(-6).join("\n") ?? String(error);
    throw new Error(`could not build the agency fixture release (${python}). Is the Python environment set up (make v2-setup)?\n${detail}`);
  }
  const register = JSON.parse(readFileSync(join(dir, "register.json"), "utf8")) as AgencyFixture["register"];
  const narrowed = { ...register, rows: register.rows.map((row) => (row.decision ? { ...row, decision: { ...row.decision, redistribute: false } } : row)) };
  return { root: join(dir, "public"), register, gate: createRightsGate(register), displayOnly: createRightsGate(narrowed) };
}
