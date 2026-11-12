/**
 * Recipes: the declared rules that produce Derived series (CONTEXT.md; PLAN 4.5; ADR 0003).
 * The contract is `docs/method/transforms.md`, "Recipes"; this module is tested from that text.
 *
 * `evaluateRecipe(key, catalog, load, { asOf })` computes one Derived series from the stored
 * Series it rests on, to any depth. Each stored input's Vintage is resolved on its own; the
 * answer says the weakest Basis among them, the most restrictive Rights, and the whole lineage
 * the rights gate must be asked about. It either answers or is unavailable with a reason, and
 * an unavailable answer holds no Observation.
 *
 * Pure. Hidden here: the dependency closure and its cycle detection, the order of aggregation
 * and arithmetic, which units may be added, how Periods are matched, what a partial Period or
 * a change of metadata does to an answer, and the Status that comes out.
 */
import { aggregate, leastSettled, type AggregateSeries } from "./aggregate";
import type { Frequency } from "./period";
import type { TransformObservation } from "./transform";
import { SEMANTICS_VERSION } from "./transform";
import { resolve, weakestBasis, type CaptureGap, type Cutoff, type ResolveSeries, type VintageBasis, type VintageUnavailableReason } from "./vintage";

export type Recipe =
  | { op: "ratio" | "difference" | "sum" | "product"; inputs: string[]; order: RecipeOrder }
  | { op: "pct_change"; inputs: string[]; order: RecipeOrder; params: { lag: number } };
export type RecipeOrder = "aggregate_then_compute" | "compute_then_aggregate";

/** What the engine needs of a Catalog entry. A Release's `CatalogEntry` is one. */
export type RecipeSeries = {
  key: string;
  freq: Frequency;
  unit: string;
  unit_kind?: string;
  measure_kind?: string;
  agg?: string;
  continuity: "discrete" | "held";
  representation: "native" | "legacy_monthly_rounded";
  rights: { status: string };
  source: { origin: { producer: string; dataset: string }; channel: { via: string } };
  recipe?: Recipe;
};

/** From the least restrictive to the most. A status nobody knows is the most restrictive. */
export const RIGHTS_ORDER = ["public_domain", "cc_by", "citation_required", "permission_required", "no_redistribution", "unknown"] as const;
export type RightsStatus = (typeof RIGHTS_ORDER)[number];

/** The most restrictive of several rights statuses; `unknown` for none, or for one not known. */
export function mostRestrictiveRights(statuses: readonly string[]): RightsStatus {
  if (statuses.length === 0) return "unknown";
  let worst = 0;
  for (const status of statuses) {
    const at = (RIGHTS_ORDER as readonly string[]).indexOf(status);
    worst = Math.max(worst, at < 0 ? RIGHTS_ORDER.length - 1 : at);
  }
  return RIGHTS_ORDER[worst]!;
}

export type RecipeUnavailable =
  | "unknown_series"
  | "not_a_recipe"
  | "unknown_input"
  | "cycle"
  | "input_not_held"
  | "input_unavailable"
  | "input_metadata_mixed"
  | "incompatible_units"
  | "mixed_frequencies"
  | "input_too_coarse"
  | "aggregation_not_declared"
  | "aggregation_not_allowed"
  | "held"
  | "no_cadence"
  | "bad_recipe"
  | "no_values";

export type RecipeClosure =
  | {
      ok: true;
      /** Every Series reached, each after everything it rests on; the Series asked about last. */
      order: string[];
      /** The stored Series it rests on, in the order first reached. */
      stored: string[];
      /** The Derived series among `order`, in that order. */
      derived: string[];
    }
  | { ok: false; reason: "unknown_series" | "unknown_input" | "cycle"; /** The cycle, from a Series back to itself. */ cycle?: string[]; message: string };

/** Everything a Series rests on, to any depth, or the cycle that makes that endless. */
export function recipeClosure(key: string, catalog: ReadonlyMap<string, RecipeSeries>): RecipeClosure {
  if (!catalog.has(key)) return { ok: false, reason: "unknown_series", message: `there is no series called ${key} in the catalog` };
  const order: string[] = [];
  const done = new Set<string>();
  const path: string[] = [];
  let failure: RecipeClosure | null = null;
  const visit = (name: string, from: string | null): void => {
    if (failure || done.has(name)) return;
    const entry = catalog.get(name);
    if (!entry) {
      failure = { ok: false, reason: "unknown_input", message: `${from} takes ${name}, which is not in the catalog` };
      return;
    }
    const at = path.indexOf(name);
    if (at >= 0) {
      const cycle = [...path.slice(at), name];
      failure = { ok: false, reason: "cycle", cycle, message: `the recipes go round in a circle: ${cycle.join(" → ")}` };
      return;
    }
    path.push(name);
    for (const input of entry.recipe?.inputs ?? []) visit(input, name);
    path.pop();
    if (failure) return;
    done.add(name);
    order.push(name);
  };
  visit(key, null);
  if (failure) return failure;
  return { ok: true, order, stored: order.filter((name) => !catalog.get(name)!.recipe), derived: order.filter((name) => catalog.get(name)!.recipe) };
}

/** One stored Series a Derived answer rests on, as it was resolved. */
export type DerivedInput = {
  key: string;
  /** Null in an answer that is not as-of. */
  basis: VintageBasis | null;
  reason?: VintageUnavailableReason;
  cutoff: Cutoff | null;
  capture_gap: CaptureGap | null;
  same_day_release: boolean;
  /** The unit the values are in: the one in force at the Cutoff, or the Catalog's. */
  unit: string;
  /** Periods left out of the arithmetic because they were still held under other metadata. */
  left_out_periods: string[];
};

/** One row of the lineage, for `permits()`; the caller adds the Permission asked for. */
export type DerivedLineage = { origin: string; dataset: string; channel: string; representation: RecipeSeries["representation"] };

export type DerivedAnswer = {
  key: string;
  /** The question as asked; null for the Release's own state. */
  as_of: string | null;
  /** The weakest Basis among the inputs. Null only when `as_of` is null. */
  basis: VintageBasis | null;
  /** Set when there is no answer. `observations` is then empty. */
  unavailable?: { reason: RecipeUnavailable; message: string };
  /** From the first Period with a value to the last, every Period between them present. */
  observations: TransformObservation[];
  inputs: DerivedInput[];
  /** The most restrictive Rights status of the stored Series it rests on. */
  rights_status: RightsStatus | null;
  /** Every Origin, dataset and Channel the answer came through, its own included. */
  rights_used: DerivedLineage[];
  release_id: string;
  semantics_version: string;
};

type Operand = Pick<RecipeSeries, "key" | "freq" | "unit" | "unit_kind" | "measure_kind" | "agg" | "continuity"> & { observations: readonly TransformObservation[] };
type Failure = { reason: RecipeUnavailable; message: string };
const isFailure = (value: unknown): value is Failure => typeof value === "object" && value !== null && "reason" in value && !Array.isArray(value);

const plain = (o: TransformObservation, value: number | null, status: string): TransformObservation => ({
  period: o.period, period_start: o.period_start, period_end: o.period_end, value, status: value === null ? "missing" : status,
});
/** A value that may be computed from: present, and not of a Period still under way. */
const usable = (o: TransformObservation | undefined): o is TransformObservation & { value: number } => !!o && o.value !== null && o.status !== "partial";
const finite = (value: number): number | null => (Number.isFinite(value) ? value : null);

function trimmed(observations: TransformObservation[]): TransformObservation[] {
  let first = 0;
  let last = observations.length - 1;
  while (first <= last && observations[first]!.value === null) first++;
  while (last >= first && observations[last]!.value === null) last--;
  return observations.slice(first, last + 1);
}

function arithmetic(recipe: Recipe, operands: readonly Operand[]): TransformObservation[] {
  if (recipe.op === "pct_change") {
    const all = operands[0]!.observations;
    const lag = recipe.params.lag;
    return all.map((o, i) => {
      const before = i >= lag ? all[i - lag] : undefined;
      if (!usable(o) || !usable(before) || before.value === 0) return plain(o, null, "missing");
      return plain(o, finite((o.value / before.value - 1) * 100), leastSettled([o.status, before.status]));
    });
  }
  const byPeriod = operands.map((operand) => new Map(operand.observations.map((o) => [o.period, o])));
  const periods = new Map<string, TransformObservation>();
  for (const operand of operands) for (const o of operand.observations) if (!periods.has(o.period)) periods.set(o.period, o);
  const ordered = [...periods.values()].sort((a, b) => (a.period_start < b.period_start ? -1 : a.period_start > b.period_start ? 1 : 0));
  return ordered.map((o) => {
    const used = byPeriod.map((map) => map.get(o.period));
    if (!used.every(usable)) return plain(o, null, "missing");
    const values = used.map((u) => u.value);
    let value: number | null;
    switch (recipe.op) {
      case "ratio":
        value = values[1] === 0 ? null : values[0]! / values[1]!;
        break;
      case "difference":
        value = values[0]! - values[1]!;
        break;
      case "sum":
        value = values.reduce((a, b) => a + b, 0);
        break;
      default:
        value = values.reduce((a, b) => a * b, 1);
    }
    return plain(o, value === null ? null : finite(value), leastSettled(used.map((u) => u.status)));
  });
}

const ARITY: Record<Recipe["op"], [number, number]> = { ratio: [2, 2], difference: [2, 2], sum: [2, Infinity], product: [2, Infinity], pct_change: [1, 1] };

/** One Derived series from the Series its Recipe names, already in hand. */
function compute(entry: RecipeSeries, inputs: readonly Operand[]): TransformObservation[] | Failure {
  const recipe = entry.recipe!;
  const arity = ARITY[recipe.op];
  if (!arity || inputs.length < arity[0] || inputs.length > arity[1] || (recipe.op === "pct_change" && !(Number.isInteger(recipe.params?.lag) && recipe.params.lag >= 1))) {
    return { reason: "bad_recipe", message: `${entry.key}: its recipe is not one the engine knows how to compute` };
  }
  if (recipe.op === "sum" || recipe.op === "difference") {
    const first = inputs[0]!;
    const odd = inputs.find((input) => input.unit !== first.unit || input.unit_kind !== first.unit_kind);
    if (odd) {
      return {
        reason: "incompatible_units",
        message: `${entry.key}: a ${recipe.op} needs its inputs in one unit, and ${first.key} is in ${first.unit} while ${odd.key} is in ${odd.unit}`,
      };
    }
  }
  const brought = (series: AggregateSeries & { key: string }, to: Frequency): TransformObservation[] | Failure => {
    const result = aggregate(series, to);
    if (result.ok) return result.observations.map((o) => plain(o, o.value, o.status));
    if (result.reason === "not_slower") {
      return { reason: "input_too_coarse", message: `${entry.key} is ${to.replace("_", " ")}, and ${series.key} (${series.freq.replace("_", " ")}) cannot be brought to that` };
    }
    return { reason: result.reason, message: `${series.key}: ${result.message}` };
  };

  let observations: TransformObservation[];
  if (recipe.order === "aggregate_then_compute") {
    const operands: Operand[] = [];
    for (const input of inputs) {
      if (input.freq === entry.freq) {
        operands.push(input);
        continue;
      }
      const at = brought(input, entry.freq);
      if (isFailure(at)) return at;
      operands.push({ ...input, freq: entry.freq, observations: at });
    }
    observations = trimmed(arithmetic(recipe, operands));
  } else {
    const freq = inputs[0]!.freq;
    const other = inputs.find((input) => input.freq !== freq);
    if (other) {
      return {
        reason: "mixed_frequencies",
        message: `${entry.key}: computing before aggregating needs every input at one frequency, and ${inputs[0]!.key} is ${freq.replace("_", " ")} while ${other.key} is ${other.freq.replace("_", " ")}`,
      };
    }
    // Not trimmed before it is aggregated: an empty Period at either end is still a member of
    // the slower Period, and counts against its sum and its more-than-half.
    observations = arithmetic(recipe, inputs);
    if (freq !== entry.freq) {
      const at = brought({ key: entry.key, freq, continuity: entry.continuity, measure_kind: entry.measure_kind, agg: entry.agg, observations }, entry.freq);
      if (isFailure(at)) return at;
      observations = at;
    }
    observations = trimmed(observations);
  }
  if (observations.length === 0) {
    return { reason: "no_values", message: `${entry.key}: its recipe gives no value from what its inputs hold` };
  }
  return observations;
}

export function evaluateRecipe(
  key: string,
  catalog: ReadonlyMap<string, RecipeSeries>,
  /** The stored Series of the Release, as `resolve()` takes it; null when the Release holds none. */
  load: (key: string) => ResolveSeries | null,
  options: { asOf?: string | null; releaseId: string },
): DerivedAnswer {
  const asOf = options.asOf ?? null;
  const answer: DerivedAnswer = {
    key, as_of: asOf, basis: null, observations: [], inputs: [], rights_status: null, rights_used: [],
    release_id: options.releaseId, semantics_version: SEMANTICS_VERSION,
  };
  const fail = (reason: RecipeUnavailable, message: string, basis: VintageBasis | null = asOf === null ? null : "unavailable"): DerivedAnswer => ({
    ...answer, basis, unavailable: { reason, message }, observations: [],
  });
  const closure = recipeClosure(key, catalog);
  if (!closure.ok) return fail(closure.reason, closure.message);
  if (!catalog.get(key)!.recipe) return fail("not_a_recipe", `${key} is a stored series, not one a recipe computes`);

  const lineage = new Map<string, DerivedLineage>();
  for (const name of closure.order) {
    const entry = catalog.get(name)!;
    const row = { origin: entry.source.origin.producer, dataset: entry.source.origin.dataset, channel: entry.source.channel.via, representation: entry.representation };
    lineage.set(JSON.stringify([row.origin, row.dataset, row.channel, row.representation]), row);
  }
  answer.rights_used = [...lineage.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row);
  answer.rights_status = mostRestrictiveRights(closure.stored.map((name) => catalog.get(name)!.rights.status));

  // Each stored input is resolved on its own: its own Vintage, Basis and metadata in force.
  const held = new Map<string, Operand>();
  for (const name of closure.stored) {
    const entry = catalog.get(name)!;
    const series = load(name);
    if (!series) return fail("input_not_held", `this release holds no values for ${name}, which ${key} rests on`);
    const resolved = resolve(series, asOf, { releaseId: options.releaseId });
    if (asOf !== null && resolved.metadata === null && resolved.basis !== "legacy" && resolved.basis !== "unavailable") {
      // The versions in the answer were recorded under more than one metadata and no one of
      // them is in force (the Origin's clock, vintage-resolution.md). Today's unit must not
      // stand in for it, so nothing is computed.
      answer.inputs.push({
        key: name, basis: resolved.basis, cutoff: resolved.cutoff, capture_gap: resolved.capture_gap,
        same_day_release: resolved.same_day_release, unit: entry.unit, left_out_periods: [],
      });
      return fail("input_metadata_mixed", `${name} was held under more than one unit or definition at that time, and which applied to each Period cannot be told; ${key} is not computed across them`, resolved.basis);
    }
    const leftOut = new Set(resolved.metadata?.other_metadata_periods ?? []);
    const unit = (asOf !== null && resolved.metadata?.metadata.unit) || entry.unit;
    answer.inputs.push({
      key: name, basis: resolved.basis, ...(resolved.reason ? { reason: resolved.reason } : {}), cutoff: resolved.cutoff,
      capture_gap: resolved.capture_gap, same_day_release: resolved.same_day_release, unit, left_out_periods: [...leftOut],
    });
    held.set(name, {
      key: name, freq: entry.freq, unit, unit_kind: entry.unit_kind, measure_kind: entry.measure_kind, agg: entry.agg, continuity: entry.continuity,
      observations: resolved.observations.map((o) => (leftOut.has(o.period) ? plain(o, null, "missing") : plain(o, o.value, o.status))),
    });
  }
  if (asOf !== null) {
    answer.basis = weakestBasis(answer.inputs.map((input) => input.basis ?? "unavailable")) ?? "unavailable";
    if (answer.basis === "unavailable") {
      const without = answer.inputs.filter((input) => input.basis === "unavailable" || input.basis === null).map((input) => input.key);
      return fail("input_unavailable", `there is no as-of answer for ${without.join(", ")}, so there is none for ${key}`);
    }
  }
  for (const name of closure.derived) {
    const entry = catalog.get(name)!;
    const result = compute(entry, entry.recipe!.inputs.map((input) => held.get(input)!));
    if (isFailure(result)) return fail(result.reason, result.message, answer.basis);
    held.set(name, { key: name, freq: entry.freq, unit: entry.unit, unit_kind: entry.unit_kind, measure_kind: entry.measure_kind, agg: entry.agg, continuity: entry.continuity, observations: result });
  }
  return { ...answer, observations: [...held.get(key)!.observations] };
}
