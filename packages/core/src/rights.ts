/**
 * The rights gate contract: `permits(rightsUsed, surface)` (PLAN 4.2 and 6.1, ADR 0006).
 *
 * The one piece of code tracks A and B share. Every export, twin and query asks it before
 * anything leaves the process. M0 ships the contract with its default body: allow on the local
 * surface, deny on every other. M6 replaces the body with the rights register table, behind the
 * same signature. The Python twin is `atlas/rights.py`; both run `checks/permits-cases.json`.
 *
 * `permission` on a row is the action requested, never a grant.
 */

export const SURFACES = ["local", "staging", "production"] as const;
export type Surface = (typeof SURFACES)[number];

export const PERMISSIONS = ["display", "redistribute", "ml_use"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const REPRESENTATIONS = ["native", "legacy_monthly_rounded"] as const;
export type Representation = (typeof REPRESENTATIONS)[number];

/** One Origin and Channel a value actually came through, and the Permission asked for. */
export type RightsUse = {
  origin: string;
  dataset: string;
  channel: string;
  representation: Representation;
  permission: Permission;
};

export type Decision = { allowed: true } | { allowed: false; reason: string };

const ROW_FIELDS = ["origin", "dataset", "channel", "representation", "permission"] as const;

const deny = (reason: string): Decision => ({ allowed: false, reason });

function rowProblem(row: unknown): string | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return "a rights lineage row is not an object";
  }
  const r = row as Record<string, unknown>;
  for (const field of ROW_FIELDS) {
    if (typeof r[field] !== "string" || r[field] === "") return `a rights lineage row has no ${field}`;
  }
  if (!(PERMISSIONS as readonly string[]).includes(r.permission as string)) {
    return `unknown permission "${String(r.permission)}"`;
  }
  if (!(REPRESENTATIONS as readonly string[]).includes(r.representation as string)) {
    return `unknown representation "${String(r.representation)}"`;
  }
  return null;
}

/**
 * May what `rightsUsed` describes be shown or handed out on `surface`?
 *
 * `rightsUsed` must be the complete lineage: one row per Origin and Channel used, including every
 * input of a Derived series. Fails closed: anything malformed or unknown is a denial, never a
 * throw. `surface` is typed as a string on purpose: it arrives from configuration.
 */
export function permits(rightsUsed: readonly RightsUse[], surface: string): Decision {
  if (!(SURFACES as readonly string[]).includes(surface)) {
    return deny(`unknown surface "${String(surface)}": only ${SURFACES.join(", ")} exist`);
  }
  if (!Array.isArray(rightsUsed) || rightsUsed.length === 0) {
    return deny("no rights lineage was given: nothing is shown without saying where it came from");
  }
  for (const row of rightsUsed) {
    const problem = rowProblem(row);
    if (problem) return deny(problem);
  }
  // Default body (M0). M6 replaces everything below with the rights register table.
  if (surface === "local") return { allowed: true };
  return deny(
    `the rights register is not in force yet, so nothing is permitted on the ${surface} surface`,
  );
}
