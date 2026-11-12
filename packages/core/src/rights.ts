/**
 * The rights gate: `permits(rightsUsed, surface)` over the rights register (PLAN 6, 6.1, M6;
 * ADR 0006, ADR 0020).
 *
 * The one piece of code tracks A and B share. Every export, twin and query asks it before
 * anything leaves the process. The register is one table, `schema/rights-register.json`; this
 * module reads the copy generated from it (`rights-register.generated.ts`) and the Python twin,
 * `atlas/rights.py`, reads the file. Both run `checks/permits-cases.json`.
 *
 * `permission` on a row is the action requested, never a grant. A grant exists only as a
 * decision Alex has signed on a row of the register.
 *
 * On a public Surface (staging and production; the gate knows nothing of a password), for every
 * row of the lineage, most restrictive wins:
 * - the legacy representation is refused, whatever the register says;
 * - the Origin and dataset need a row, signed, that allows the Permission;
 * - a Channel other than `direct` and Macro Atlas's own (computed, hand entered, fixture) is an
 *   intermediary: it needs its own row, signed, that allows the Permission, and a dated amendment
 *   to ADR 0006 named in the table. The origin's row is still needed.
 *
 * A table that cannot be trusted permits nothing on a public Surface.
 */
import { RIGHTS_REGISTER } from "./rights-register.generated";

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

export const REGISTER_FORMAT = 1;
/** The only person whose signature makes a decision (CONTEXT.md, Rights register). */
export const SIGNER = "Alex";
/** What a signed decision says yes or no to. `store` is asked by the capture job, not by a page. */
export const GRANTS = ["display", "redistribute", "store", "ml_use"] as const;
export type Grant = (typeof GRANTS)[number];
const DIRECT = "direct";
/**
 * Routes that are Macro Atlas's own work and so have no terms of their own. Every other Channel
 * but `direct` is an intermediary. Fixed here, not in the table, so that editing the table cannot
 * turn an intermediary into something else.
 */
export const OWN_CHANNELS: readonly string[] = ["computed", "hand_entered", "fixture"];

type SignedDecision = Record<Grant, boolean> & { signed_by: string; signed_on: string };
type OriginRow = { id: string; kind: "origin"; origins: string[]; datasets: "*" | string[]; decision: SignedDecision | null };
type ChannelRow = { id: string; kind: "channel"; channel: string; decision: SignedDecision | null };
type RegisterRow = OriginRow | ChannelRow;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value !== "";
const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isText);

function isDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function decisionProblem(decision: unknown): string | null {
  if (decision === null) return null;
  if (!isObject(decision)) return "its decision is neither null nor an object";
  for (const grant of GRANTS) {
    if (typeof decision[grant] !== "boolean") return `its decision does not say true or false for ${grant}`;
  }
  if (decision.signed_by !== SIGNER) return `its decision is not signed by ${SIGNER}`;
  if (!isDate(decision.signed_on)) return "its decision has no real signing date";
  return null;
}

/**
 * Why `table` cannot be trusted as a rights register, or null. The Python twin applies the same
 * rules in the same order.
 */
export function tableProblem(table: unknown): string | null {
  if (!isObject(table)) return "it is not a table";
  if (table.format !== REGISTER_FORMAT) return `its format is not ${REGISTER_FORMAT}`;
  if (!isText(table.version)) return "it has no version";
  if (!Array.isArray(table.rows)) return "it has no rows";
  const ids = new Set<string>();
  const channels = new Set<string>();
  const claimed = new Map<string, ("*" | string[])[]>();
  for (const row of table.rows as unknown[]) {
    if (!isObject(row) || !isText(row.id)) return "a row has no id";
    const name = row.id;
    if (ids.has(name)) return `two rows are called ${name}`;
    ids.add(name);
    if (!("decision" in row)) return `row ${name} has no decision field (null means not decided)`;
    const problem = decisionProblem(row.decision);
    if (problem) return `row ${name}: ${problem}`;
    if (row.kind === "origin") {
      const { origins, datasets } = row;
      if (!isTextList(origins)) return `row ${name} does not name its origins`;
      if (datasets !== "*" && !isTextList(datasets)) return `row ${name} names neither "*" nor a list of datasets`;
      for (const origin of origins) {
        const others = claimed.get(origin) ?? [];
        for (const other of others) {
          if (other === "*" || datasets === "*" || other.some((d) => datasets.includes(d))) {
            return `row ${name} overlaps another row for ${origin}`;
          }
        }
        claimed.set(origin, [...others, datasets]);
      }
    } else if (row.kind === "channel") {
      const { channel } = row;
      if (!isText(channel)) return `row ${name} does not name its channel`;
      if (channel === DIRECT || OWN_CHANNELS.includes(channel)) {
        return `row ${name}: the ${channel} channel has no terms of its own and takes no row`;
      }
      if (channels.has(channel)) return `two rows are for the ${channel} channel`;
      channels.add(channel);
    } else {
      return `row ${name} is neither an origin row nor a channel row`;
    }
  }
  const cleared = table.cleared_intermediaries;
  if (!Array.isArray(cleared)) return "it has no list of cleared intermediaries";
  for (const entry of cleared as unknown[]) {
    if (!isObject(entry) || !isText(entry.channel)) return "a cleared intermediary does not name its channel";
    if (!channels.has(entry.channel)) return `the cleared intermediary ${entry.channel} has no row`;
    if (!isDate(entry.adr_0006_amendment)) {
      return `the cleared intermediary ${entry.channel} does not date its ADR 0006 amendment`;
    }
    if (entry.approved_by !== SIGNER) return `the clearance of ${entry.channel} is not approved by ${SIGNER}`;
  }
  return null;
}

export type RightsGate = {
  /** Why the table cannot be trusted, or null. A gate with a problem permits nothing public. */
  readonly problem: string | null;
  /**
   * May what `rightsUsed` describes be shown or handed out on `surface`?
   *
   * `rightsUsed` must be the complete lineage: one row per Origin and Channel used, including
   * every input of a Derived series. Fails closed: anything malformed or unknown is a denial,
   * never a throw. `surface` is typed as a string on purpose: it arrives from configuration.
   */
  permits(rightsUsed: readonly RightsUse[], surface: string): Decision;
};

/** The gate over one rights register table. `permits` below is this, over the committed register. */
export function createRightsGate(table: unknown): RightsGate {
  const problem = tableProblem(table);
  // A private copy: signing a row in the caller's table later opens nothing here.
  const trusted = problem === null ? (structuredClone(table) as { rows: RegisterRow[]; cleared_intermediaries: { channel: string }[] }) : null;
  const rows = trusted?.rows ?? [];
  const cleared = new Set(trusted?.cleared_intermediaries.map((entry) => entry.channel));

  /** Why the register does not grant `grant` for this Origin, dataset and Channel. */
  function grantProblem(origin: string, dataset: string, channel: string, grant: Grant): string | null {
    const matches = rows.filter(
      (row): row is OriginRow =>
        row.kind === "origin" && row.origins.includes(origin) && (row.datasets === "*" || row.datasets.includes(dataset)),
    );
    if (matches.length === 0) return `${origin} (${dataset}) is not in the rights register`;
    for (const row of matches) {
      if (row.decision === null) return `the rights register row for ${origin} (${row.id}) is not signed`;
      if (!row.decision[grant]) return `the rights register row for ${origin} (${row.id}) does not allow ${grant}`;
    }
    if (channel === DIRECT || OWN_CHANNELS.includes(channel)) return null;
    const row = rows.find((r): r is ChannelRow => r.kind === "channel" && r.channel === channel);
    if (!row) return `the ${channel} channel is not in the rights register`;
    if (row.decision === null) return `the rights register row for the ${channel} channel (${row.id}) is not signed`;
    if (!row.decision[grant]) return `the rights register row for the ${channel} channel (${row.id}) does not allow ${grant}`;
    if (!cleared.has(channel)) return `the ${channel} channel is an intermediary that no amendment to ADR 0006 has cleared`;
    return null;
  }

  return {
    problem,
    permits(rightsUsed, surface) {
      if (!(SURFACES as readonly string[]).includes(surface)) {
        return deny(`unknown surface "${String(surface)}": only ${SURFACES.join(", ")} exist`);
      }
      if (!Array.isArray(rightsUsed) || rightsUsed.length === 0) {
        return deny("no rights lineage was given: nothing is shown without saying where it came from");
      }
      for (const row of rightsUsed) {
        const bad = rowProblem(row);
        if (bad) return deny(bad);
      }
      if (surface === "local") return { allowed: true }; // not a public Surface (PLAN 6.1, point 3)
      if (problem !== null) {
        return deny(`the rights register cannot be trusted (${problem}), so nothing is permitted on the ${surface} surface`);
      }
      for (const row of rightsUsed as readonly RightsUse[]) {
        if (row.representation !== "native") {
          return deny(`the legacy representation is never permitted on the ${surface} surface`);
        }
      }
      for (const row of rightsUsed as readonly RightsUse[]) {
        const bad = grantProblem(row.origin, row.dataset, row.channel, row.permission);
        if (bad) return deny(`${bad}, so it is not permitted on the ${surface} surface`);
      }
      return { allowed: true };
    },
  };
}

// Built on first use, so that importing this module does nothing and a bundle that never asks
// the gate can drop the table.
let committed: RightsGate | undefined;

/** `RightsGate.permits` over the committed rights register. */
export function permits(rightsUsed: readonly RightsUse[], surface: string): Decision {
  committed ??= createRightsGate(RIGHTS_REGISTER);
  return committed.permits(rightsUsed, surface);
}

/** How every statement that a Series is not for model training begins (ADR 0041). */
export const ML_USE_LEAD = "Not for use in training machine-learning models";

const possessive = (name: string): string => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/**
 * The sentence a Series' values carry wherever they leave the site when its Rights do not allow
 * use in training machine-learning models, or null when they do. `rights` is a Catalog entry's
 * Rights block. A block that does not say (a Release written before contract 0.8.0) is no
 * permission. `atlas/rights.py` says the same; `checks/ml-use-cases.json` holds both to it.
 */
export function mlUseNote(rights: unknown): string | null {
  const flag = isObject(rights) ? rights.ml_use : undefined;
  if (flag === true) return null;
  if (flag !== false) return `${ML_USE_LEAD}: this release does not record whether its terms allow it`;
  const named = (rights as Record<string, unknown>).ml_use_reserved_by;
  const names = Array.isArray(named) ? named.filter(isText) : [];
  if (names.length === 0) return `${ML_USE_LEAD}: its rights are not settled`;
  const owners = names.map(possessive);
  const listed = owners.length === 1 ? owners[0]! : `${owners.slice(0, -1).join(", ")} and ${owners.at(-1)!}`;
  return `${ML_USE_LEAD}: ${listed} terms reserve it`;
}
