/**
 * Claim Readings and their Evidence rows (CONTEXT.md, Claims; PLAN 4.5; ADR 0011, ADR 0034).
 * The contract is `docs/method/claims.md`; this module is tested from that text.
 *
 * A Reading turns a Claim's words into something measurable: one Series, at one frequency,
 * under one Transform, with one Measure from a closed list. `evidenceRow()` answers a Reading
 * against one state of the data; `lockEvidence()` is what a Claim lock freezes (the *then* row
 * and the *now when checked* row of every Reading); `claimDrift()` says where a row computed
 * today is no longer the locked one.
 *
 * A Measure returns numbers. Nothing here returns true or false about a Claim, compares a
 * figure with the Claim's words, or carries a label: there is no rubric (ADR 0011).
 *
 * Pure. Hidden here: the order (resolve the Vintage, aggregate, transform, measure), which
 * Periods a window fixes before any value is looked at, what a missing value does to a figure,
 * and how a tie is ranked.
 */
import { aggregate } from "./aggregate";
import { nextPeriod, periodBounds, periodContaining, type Frequency } from "./period";
import { evaluateRecipe, recipeClosure, type DerivedLineage, type Recipe, type RecipeSeries } from "./recipe";
import { SEMANTICS_VERSION, transform, TRANSFORMS, type TransformedObservation, type TransformName, type TransformObservation } from "./transform";
import { resolve, type CaptureGap, type Cutoff, type ResolveSeries, type VintageBasis } from "./vintage";

/** The closed list (PLAN 4.5). */
export const MEASURES = ["value_at", "change", "extreme", "rank", "difference"] as const;
export type MeasureName = (typeof MEASURES)[number];
/** Measures taken over a window. Only these have Window sensitivity. */
const WINDOWED: readonly string[] = ["change", "extreme", "rank"];
/** Transforms whose answer depends on the window they are asked over. */
const WINDOW_TRANSFORMS: readonly string[] = ["rebase", "z", "drawdown"];

/** Calendar dates, both inclusive. */
export type ClaimWindow = { from: string; to: string };

export type ClaimReading = {
  id: string;
  series: string;
  /** A slower frequency to bring the Series to first. Absent: its own. */
  freq?: Frequency;
  transform: TransformName;
  measure: MeasureName;
  /** `value_at`, `rank`: the Period measured. */
  period?: string;
  /** `difference`: the two Periods, earlier-named first; the answer is the second less the first. */
  periods?: [string, string];
  /** `change`, `extreme`, `rank`: the declared window. */
  window?: ClaimWindow;
  /** `extreme`. */
  which?: "max" | "min";
  /** `rank`: 1 is the highest value, or the lowest. */
  order?: "highest" | "lowest";
  alternative_windows?: ClaimWindow[];
};

const FIELDS: Record<MeasureName, { needs: (keyof ClaimReading)[] }> = {
  value_at: { needs: ["period"] },
  change: { needs: ["window"] },
  extreme: { needs: ["window", "which"] },
  rank: { needs: ["period", "window", "order"] },
  difference: { needs: ["periods"] },
};
const ALWAYS = ["id", "series", "transform", "measure"];
const OPTIONAL = ["freq"];
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isDay(text: unknown): text is string {
  return typeof text === "string" && DATE.test(text) && periodBounds("daily", text) !== null;
}

function windowProblem(window: unknown, what: string): string | null {
  if (typeof window !== "object" || window === null || Array.isArray(window)) return `${what} is not a from and a to`;
  const names = Object.keys(window).sort().join(",");
  const { from, to } = window as Record<string, unknown>;
  if (names !== "from,to" || !isDay(from) || !isDay(to)) return `${what} is not two days of the calendar (from, to)`;
  if (to < from) return `${what} ends before it starts`;
  return null;
}

/**
 * Why `reading` is not a Reading of a Series of frequency `seriesFreq`, or null. Its Period
 * labels are at its own `freq` when it names one.
 * `atlas check` applies the same rules (`atlas/content/claims.py`); `checks/claim-cases.json`
 * holds both to one table.
 */
export function readingProblem(reading: unknown, seriesFreq: string): string | null {
  if (typeof reading !== "object" || reading === null || Array.isArray(reading)) return "it is not a set of names and values";
  const r = reading as Record<string, unknown>;
  if (typeof r.id !== "string" || !ID.test(r.id)) return "its id is not a short name in lower case";
  if (typeof r.series !== "string" || !KEY.test(r.series)) return "its series is not a Series key";
  if (typeof r.measure !== "string" || !(MEASURES as readonly string[]).includes(r.measure)) {
    return `its measure is not one of ${MEASURES.join(", ")}`;
  }
  if (typeof r.transform !== "string" || !(TRANSFORMS as readonly string[]).includes(r.transform)) {
    return `its transform is not one of ${TRANSFORMS.join(", ")}`;
  }
  const measure = r.measure as MeasureName;
  const windowed = WINDOWED.includes(measure);
  const allowed = new Set([...ALWAYS, ...OPTIONAL, ...FIELDS[measure].needs, ...(windowed ? ["alternative_windows"] : [])]);
  for (const name of Object.keys(r)) {
    if (!allowed.has(name)) return `${measure} has no ${name}`;
  }
  for (const name of FIELDS[measure].needs) {
    if (r[name] === undefined) return `${measure} needs ${name === "window" ? "a window" : name === "periods" ? "two periods" : `its ${name}`}`;
  }
  if (!windowed && WINDOW_TRANSFORMS.includes(r.transform)) {
    return `${r.transform} depends on a window, and ${measure} has none`;
  }
  if (r.freq !== undefined && (typeof r.freq !== "string" || !["weekly", "monthly", "quarterly", "annual"].includes(r.freq))) {
    return "its freq is not weekly, monthly, quarterly or annual";
  }
  const freq = typeof r.freq === "string" ? r.freq : seriesFreq;
  const label = (value: unknown): string | null =>
    typeof value === "string" && periodBounds(freq, value) !== null ? null : `${JSON.stringify(value)} is not a ${freq.replace("_", " ")} Period`;
  if (r.period !== undefined) {
    const said = label(r.period);
    if (said) return said;
  }
  if (r.periods !== undefined) {
    if (!Array.isArray(r.periods) || r.periods.length !== 2) return "difference needs two periods";
    for (const period of r.periods) {
      const said = label(period);
      if (said) return said;
    }
    if (r.periods[0] === r.periods[1]) return "its two periods are the same";
  }
  if (r.which !== undefined && r.which !== "max" && r.which !== "min") return "its which is not max or min";
  if (r.order !== undefined && r.order !== "highest" && r.order !== "lowest") return "its order is not highest or lowest";
  if (windowed) {
    const said = windowProblem(r.window, "its window");
    if (said) return said;
    const declared = r.window as ClaimWindow;
    const seen = new Set([`${declared.from}/${declared.to}`]);
    const others = r.alternative_windows ?? [];
    if (!Array.isArray(others)) return "its alternative_windows is not a list";
    for (const other of others) {
      const bad = windowProblem(other, "an alternative window");
      if (bad) return bad;
      const name = `${(other as ClaimWindow).from}/${(other as ClaimWindow).to}`;
      if (seen.has(name)) return "an alternative window repeats another window of the reading";
      seen.add(name);
    }
    if (measure === "rank") {
      const start = periodBounds(freq, r.period as string)!.start;
      for (const window of [declared, ...(others as ClaimWindow[])]) {
        if (start < window.from || start > window.to) return `its period ${String(r.period)} does not start inside the window ${window.from} to ${window.to}`;
      }
    }
  }
  return null;
}

// --- what a Reading resolves to -------------------------------------------------------------------

export type ResolvedPeriod = { period: string; start: string; end: string };
export type ResolvedWindow = ClaimWindow & {
  /** `change` only: the first and the last Period that start inside the window, fixed by the calendar. */
  periods: ResolvedPeriod[];
};
/** A Derived series' identity: its Recipe and every stored Series it rests on. */
export type RecipeIdentity = { key: string; recipe: Recipe; rests_on: string[] };

export type ResolvedReading = {
  id: string;
  series: string;
  /** The frequency the Measure is taken at. */
  freq: Frequency;
  /** The Catalog's unit for the Series, before the Transform. */
  unit: string;
  transform: TransformName;
  measure: MeasureName;
  recipe: RecipeIdentity | null;
  /** The Periods the Reading names (`value_at`, `rank`, `difference`). */
  periods: ResolvedPeriod[];
  window: ResolvedWindow | null;
  alternative_windows: ResolvedWindow[];
};

export type ClaimRefusal =
  | "no_readings"
  | "bad_reading"
  | "unknown_series"
  | "legacy_representation"
  | "bad_as_of"
  /** The Release's own state gives the Reading no figure: there is nothing to check a Claim against. */
  | "not_measurable";

type CatalogSeries = RecipeSeries & { allowed_transforms?: readonly string[] };

/** What Evidence rows are computed from: a Release's Catalog and its stored Series. */
export type ClaimSource = {
  catalog: ReadonlyMap<string, CatalogSeries>;
  /** A stored Series with its vintage file when the Release holds one; null when it holds none. */
  load: (key: string) => ResolveSeries | null;
  releaseId: string;
};

type Failure = { ok: false; reason: ClaimRefusal; message: string };
const refuse = (reason: ClaimRefusal, message: string): Failure => ({ ok: false, reason, message });

const named = (freq: Frequency, period: string): ResolvedPeriod => {
  const bounds = periodBounds(freq, period)!;
  return { period, start: bounds.start, end: bounds.end };
};

/** The first Period of `freq` that starts on or after `day`, by the calendar alone. */
function firstStartingFrom(freq: Frequency, day: string): string | null {
  let at = day;
  for (let i = 0; i < 7; i++) {
    const label = periodContaining(freq, at);
    if (label !== null) {
      if (periodBounds(freq, label)!.start >= day) return label;
      return nextPeriod(freq, label);
    }
    at = shift(at, 1);
  }
  return null;
}

/** The last Period of `freq` that starts on or before `day`. */
function lastStartingBy(freq: Frequency, day: string): string | null {
  let at = day;
  for (let i = 0; i < 7; i++) {
    const label = periodContaining(freq, at);
    if (label !== null) return label;
    at = shift(at, -1);
  }
  return null;
}

function shift(day: string, by: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
}

/** What a Reading means on this Catalog, before any value is looked at; or why it is refused. */
export function resolveReading(reading: ClaimReading, catalog: ClaimSource["catalog"]): { ok: true; resolved: ResolvedReading } | Failure {
  const where = `reading ${typeof reading?.id === "string" ? reading.id : "?"}`;
  const entry = typeof reading?.series === "string" ? catalog.get(reading.series) : undefined;
  if (typeof reading?.series === "string" && KEY.test(reading.series) && !entry) {
    return refuse("unknown_series", `${where}: this release has no Series called ${reading.series}`);
  }
  const freq = (reading?.freq ?? entry?.freq ?? "monthly") as Frequency;
  const problem = readingProblem(reading, entry?.freq ?? "monthly");
  if (problem || !entry) return refuse("bad_reading", `${where}: ${problem ?? "its series is not a Series key"}`);
  const closure = recipeClosure(entry.key, catalog);
  if (!closure.ok) return refuse("bad_reading", `${where}: ${closure.message}`);
  const legacy = closure.order.filter((name) => catalog.get(name)!.representation !== "native");
  if (legacy.length > 0) {
    return refuse(
      "legacy_representation",
      `${where}: ${legacy.join(", ")} is held in v1's legacy representation (monthly, already rounded) in this release. A Claim is locked only on a Series held as its Origin gives it`,
    );
  }
  const windows: ResolvedWindow[] = [];
  for (const window of reading.window ? [reading.window, ...(reading.alternative_windows ?? [])] : []) {
    const periods: ResolvedPeriod[] = [];
    if (reading.measure === "change") {
      if (freq === "irregular") return refuse("bad_reading", `${where}: an irregular Series has no first and last Period of a window to take a change between`);
      const first = firstStartingFrom(freq, window.from);
      const last = lastStartingBy(freq, window.to);
      if (first === null || last === null || periodBounds(freq, first)!.start >= periodBounds(freq, last)!.start) {
        return refuse("bad_reading", `${where}: fewer than two ${freq.replace("_", " ")} Periods start inside the window ${window.from} to ${window.to}`);
      }
      periods.push(named(freq, first), named(freq, last));
    }
    windows.push({ from: window.from, to: window.to, periods });
  }
  const labels = reading.measure === "difference" ? reading.periods! : reading.period !== undefined ? [reading.period] : [];
  return {
    ok: true,
    resolved: {
      id: reading.id, series: entry.key, freq, unit: entry.unit, transform: reading.transform, measure: reading.measure,
      recipe: entry.recipe ? { key: entry.key, recipe: entry.recipe, rests_on: closure.stored } : null,
      periods: labels.map((label) => named(freq, label)),
      window: windows[0] ?? null,
      alternative_windows: windows.slice(1),
    },
  };
}

// --- figures --------------------------------------------------------------------------------------

export type FigureName = "value" | "start" | "end" | "change" | "pct_change" | "extreme" | "n" | "rank" | "of" | "a" | "b" | "difference";
/** Why a figure has no value. */
export type FigureEmpty =
  /** The answer holds no Observation for the Period. */
  | "no_observation"
  /** The Observation has no value, or the Transform gave it none (the Transform's own reason is used when it has one). */
  | "missing"
  /** A figure it is computed from is empty. */
  | "operand_empty"
  /** A percent change from zero or below would read the wrong way round. */
  | "start_not_positive"
  /** No Observation in the window has a value. */
  | "no_values"
  | string;

export type Figure = {
  name: FigureName;
  /** A number, or null with `empty`. Never true or false. */
  value: number | null;
  /** The Period the value is of, where the figure is one Observation's. */
  period?: string;
  /** That Observation's Status. */
  status?: string;
  empty?: FigureEmpty;
};

const computed = (name: FigureName, value: number | null, empty: FigureEmpty = "operand_empty"): Figure =>
  value !== null && Number.isFinite(value) ? { name, value } : { name, value: null, empty };

function measure(reading: ClaimReading, periods: readonly ResolvedPeriod[], observations: readonly TransformedObservation[]): Figure[] {
  const byPeriod = new Map(observations.map((o) => [o.period, o]));
  const at = (name: FigureName, period: string): Figure => {
    const o = byPeriod.get(period);
    if (!o) return { name, value: null, period, empty: "no_observation" };
    if (o.value === null) return { name, value: null, period, status: o.status, empty: o.empty ?? "missing" };
    return { name, value: o.value, period, status: o.status };
  };
  const valued = observations.filter((o): o is TransformedObservation & { value: number } => o.value !== null);
  switch (reading.measure) {
    case "value_at":
      return [at("value", periods[0]!.period)];
    case "difference": {
      const [a, b] = [at("a", periods[0]!.period), at("b", periods[1]!.period)];
      return [a, b, computed("difference", a.value === null || b.value === null ? null : b.value - a.value)];
    }
    case "change": {
      const [start, end] = [at("start", periods[0]!.period), at("end", periods[1]!.period)];
      const both = start.value !== null && end.value !== null;
      return [
        start, end,
        computed("change", both ? end.value! - start.value! : null),
        !both ? computed("pct_change", null) : start.value! <= 0 ? computed("pct_change", null, "start_not_positive") : computed("pct_change", (100 * (end.value! - start.value!)) / start.value!),
      ];
    }
    case "extreme": {
      let best: (TransformedObservation & { value: number }) | null = null;
      for (const o of valued) {
        // The earliest Period on a tie: only a strictly larger (or smaller) value replaces it.
        if (best === null || (reading.which === "max" ? o.value > best.value : o.value < best.value)) best = o;
      }
      const extreme: Figure = best ? { name: "extreme", value: best.value, period: best.period, status: best.status } : { name: "extreme", value: null, empty: "no_values" };
      return [extreme, { name: "n", value: valued.length }];
    }
    default: {
      const value = at("value", periods[0]!.period);
      // Competition ranking: one more than the number of values strictly ahead of it.
      const ahead = value.value === null ? null : valued.filter((o) => (reading.order === "highest" ? o.value > value.value! : o.value < value.value!)).length;
      return [value, computed("rank", ahead === null ? null : ahead + 1), { name: "of", value: valued.length }];
    }
  }
}

// --- an Evidence row ------------------------------------------------------------------------------

export type EvidenceState = "then" | "now_when_checked" | "latest";

export type EvidenceInput = {
  /** A stored Series the row rests on. */
  key: string;
  /** Null in a row that is not as-of. */
  basis: VintageBasis | null;
  capture_gap: CaptureGap | null;
  same_day_release: boolean;
  /** The unit its values are in: the one in force at the Cutoff, or the Catalog's. */
  unit: string;
  /** The newest Capture of it the Release knows of; null when it holds no history. */
  last_capture: string | null;
};

export type SensitivityRow = ClaimWindow & { figures: Figure[]; unavailable?: { reason: string; message: string } };

export type EvidenceRow = {
  state: EvidenceState;
  /** The question asked of the data: a day or an instant (*then*); null for a Release's own state. */
  as_of: string | null;
  cutoff: Cutoff | null;
  /** The weakest Basis of anything the row rests on. Null when `as_of` is null. */
  basis: VintageBasis | null;
  /** Set when there is no answer. `figures` is then empty: today's figure never stands in. */
  unavailable?: { reason: string; message: string };
  same_day_release: boolean;
  inputs: EvidenceInput[];
  /** The Series' unit in force for this row, before the Transform. Null when unavailable. */
  unit: string | null;
  figures: Figure[];
  /** The same Measure over each alternative window, in the order declared. */
  window_sensitivity: SensitivityRow[];
  release_id: string;
  semantics_version: string;
};

type State = { observations: TransformObservation[]; unit: string } | { reason: string; message: string };

const lastCapture = (series: ResolveSeries | null): string | null => {
  let last: string | null = null;
  for (const capture of series?.vintages?.captures ?? []) if (last === null || capture.retrieved_at > last) last = capture.retrieved_at;
  return last;
};

/**
 * One Reading against one state of the data. `asOf` is a day or an instant for the *then* row
 * and null for a Release's own state. Throws only on a Reading `resolveReading` refuses.
 */
export function evidenceRow(reading: ClaimReading, source: ClaimSource, at: { state: EvidenceState; asOf: string | null }): EvidenceRow {
  const result = resolveReading(reading, source.catalog);
  if (!result.ok) throw new Error(result.message);
  return rowFor(reading, result.resolved, source, at);
}

function rowFor(reading: ClaimReading, resolved: ResolvedReading, source: ClaimSource, at: { state: EvidenceState; asOf: string | null }): EvidenceRow {
  const { asOf } = at;
  const entry = source.catalog.get(resolved.series)!;
  const row: EvidenceRow = {
    state: at.state, as_of: asOf, cutoff: null, basis: null, same_day_release: false, inputs: [], unit: null, figures: [],
    window_sensitivity: [], release_id: source.releaseId, semantics_version: SEMANTICS_VERSION,
  };
  const without = (reason: string, message: string): EvidenceRow => ({
    ...row, basis: asOf === null ? null : row.basis ?? "unavailable", unavailable: { reason, message }, unit: null, figures: [], window_sensitivity: [],
  });

  // 1. Resolve the Vintage: each stored Series on its own.
  let state: State;
  if (entry.recipe) {
    const answer = evaluateRecipe(entry.key, source.catalog, source.load, { asOf, releaseId: source.releaseId });
    row.basis = answer.basis;
    row.cutoff = answer.inputs[0]?.cutoff ?? null;
    row.inputs = answer.inputs.map((input) => ({
      key: input.key, basis: input.basis, capture_gap: input.capture_gap, same_day_release: input.same_day_release, unit: input.unit,
      last_capture: lastCapture(source.load(input.key)),
    }));
    state = answer.unavailable ? { reason: answer.unavailable.reason, message: answer.unavailable.message } : { observations: answer.observations, unit: entry.unit };
  } else {
    const series = source.load(entry.key);
    if (!series) return without("not_in_release", `this release holds no values for ${entry.key}`);
    const answer = resolve(series, asOf, { releaseId: source.releaseId });
    row.basis = answer.basis;
    row.cutoff = answer.cutoff;
    const unit = (asOf !== null && answer.metadata?.metadata.unit) || entry.unit;
    row.inputs = [{ key: entry.key, basis: answer.basis, capture_gap: answer.capture_gap, same_day_release: answer.same_day_release, unit, last_capture: lastCapture(series) }];
    const leftOut = new Set(answer.metadata?.other_metadata_periods ?? []);
    if (answer.basis === "unavailable") {
      state = { reason: answer.reason ?? "unavailable", message: `there is no as-of answer for ${entry.key} at ${asOf}` };
    } else if (asOf !== null && answer.metadata === null && answer.observations.length > 0) {
      // As a Recipe refuses it: more than one unit or definition was in force, and which
      // applied to each Period cannot be told. Nothing is measured across them.
      state = { reason: "input_metadata_mixed", message: `${entry.key} was held under more than one unit or definition at that time; nothing is measured across them` };
    } else {
      state = {
        unit,
        observations: answer.observations.map((o) => ({
          period: o.period, period_start: o.period_start, period_end: o.period_end,
          value: leftOut.has(o.period) ? null : o.value, status: leftOut.has(o.period) ? "missing" : o.status,
        })),
      };
    }
  }
  row.same_day_release = row.inputs.some((input) => input.same_day_release);
  if ("reason" in state) return without(state.reason, state.message);

  // 2. Aggregate to the Reading's frequency.
  let observations = state.observations;
  if (resolved.freq !== entry.freq) {
    const brought = aggregate({ freq: entry.freq, continuity: entry.continuity, measure_kind: entry.measure_kind, agg: entry.agg, observations }, resolved.freq);
    if (!brought.ok) return without(brought.reason, `${entry.key}: ${brought.message}`);
    observations = brought.observations.map((o) => ({ period: o.period, period_start: o.period_start, period_end: o.period_end, value: o.value, status: o.status }));
  }

  // 3. Transform, then 4. measure: once for the declared window, once for each alternative.
  const over = (window: ResolvedWindow | null): { figures: Figure[] } | { reason: string; message: string } => {
    const answer = transform(
      { freq: resolved.freq, continuity: entry.continuity, observations, allowed: entry.allowed_transforms, measure_kind: entry.measure_kind, agg: entry.agg },
      resolved.transform, window ? { from: window.from, to: window.to } : {},
    );
    if (!answer.ok) return { reason: answer.reason, message: answer.message };
    if (answer.aggregated) {
      return { reason: "frequency_needed", message: `${resolved.transform} of a ${resolved.freq.replace("_", " ")} Series is answered on months: the reading must say freq: monthly, or a slower one` };
    }
    return { figures: measure(reading, window && reading.measure === "change" ? window.periods : resolved.periods, answer.observations) };
  };
  const declared = over(resolved.window);
  if ("reason" in declared) return without(declared.reason, declared.message);
  row.unit = state.unit;
  row.figures = declared.figures;
  row.window_sensitivity = resolved.alternative_windows.map((window) => {
    const other = over(window);
    return "reason" in other ? { from: window.from, to: window.to, figures: [], unavailable: other } : { from: window.from, to: window.to, figures: other.figures };
  });
  return row;
}

// --- what a lock freezes ---------------------------------------------------------------------------

/** The part of a Claim the engine reads. */
export type ClaimSpec = { said_on: string; said_at?: string; checked_on: string; readings: ClaimReading[] };

export type LockedReading = ResolvedReading & { then: EvidenceRow; now_when_checked: EvidenceRow };

export type LockEvidence =
  | {
      ok: true;
      semantics_version: string;
      /** Every Origin, dataset and Channel the rows came through, history included, in a fixed order. */
      rights_used: DerivedLineage[];
      readings: LockedReading[];
    }
  | Failure;

/** The lineage of one Reading: the Catalog's, and whatever its stored Series' histories came through. */
function lineageOf(resolved: ResolvedReading, source: ClaimSource, into: Map<string, DerivedLineage>): void {
  const add = (row: DerivedLineage): void => void into.set(JSON.stringify([row.origin, row.dataset, row.channel, row.representation]), row);
  const closure = recipeClosure(resolved.series, source.catalog);
  if (!closure.ok) return;
  for (const name of closure.order) {
    const entry = source.catalog.get(name)!;
    add({ origin: entry.source.origin.producer, dataset: entry.source.origin.dataset, channel: entry.source.channel.via, representation: entry.representation });
  }
  for (const name of closure.stored) {
    const file = source.load(name)?.vintages;
    if (!file) continue;
    for (const line of file.metadata) {
      const { origin, channel } = line.metadata.source;
      add({ origin: origin.producer, dataset: origin.dataset, channel: channel.via, representation: file.representation });
      for (const version of file.rows) {
        if (version.metadata === line.hash) add({ origin: origin.producer, dataset: origin.dataset, channel: version.channel, representation: file.representation });
      }
    }
  }
}

const sortedLineage = (rows: Map<string, DerivedLineage>): DerivedLineage[] =>
  [...rows.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row);

/**
 * The rows a Claim lock freezes: for each Reading, *then* (as of the Claim's instant, or the
 * day it was made) and *now when checked* (this Release's own state). Refused whole when any
 * Reading is not one, names a Series the Release lacks or holds in the legacy representation,
 * or cannot be measured on the Release's own state.
 */
export function lockEvidence(spec: ClaimSpec, source: ClaimSource): LockEvidence {
  if (!Array.isArray(spec.readings) || spec.readings.length === 0) return refuse("no_readings", "the Claim has no reading to measure");
  const asOf = spec.said_at ?? spec.said_on;
  const readings: LockedReading[] = [];
  const lineage = new Map<string, DerivedLineage>();
  const seen = new Set<string>();
  for (const reading of spec.readings) {
    const result = resolveReading(reading, source.catalog);
    if (!result.ok) return result;
    const { resolved } = result;
    if (seen.has(resolved.id)) return refuse("bad_reading", `two readings share the id ${resolved.id}`);
    seen.add(resolved.id);
    const now = rowFor(reading, resolved, source, { state: "now_when_checked", asOf: null });
    if (now.unavailable) {
      return refuse("not_measurable", `reading ${resolved.id}: this release cannot measure it (${now.unavailable.reason}: ${now.unavailable.message})`);
    }
    if (now.figures.every((figure) => figure.value === null)) {
      return refuse("not_measurable", `reading ${resolved.id}: this release gives it no figure (${now.figures.map((figure) => `${figure.name}: ${figure.empty}`).join(", ")})`);
    }
    const then = rowFor(reading, resolved, source, { state: "then", asOf });
    if (then.unavailable?.reason === "bad_as_of") return refuse("bad_as_of", `${asOf} is not a day or an instant an as-of question can be asked of`);
    lineageOf(resolved, source, lineage);
    readings.push({ ...resolved, then, now_when_checked: now });
  }
  return { ok: true, semantics_version: SEMANTICS_VERSION, rights_used: sortedLineage(lineage), readings };
}

/** The lineage a set of Readings rests on in this Release (for the *latest* rows). */
export function readingsLineage(resolved: readonly ResolvedReading[], source: ClaimSource): DerivedLineage[] {
  const lineage = new Map<string, DerivedLineage>();
  for (const reading of resolved) lineageOf(reading, source, lineage);
  return sortedLineage(lineage);
}

// --- drift ----------------------------------------------------------------------------------------

export type DriftEntry = {
  /**
   * `latest_differs`: the *latest* row is not the locked *now when checked* row.
   * `then_differs`: the *then* row, computed again on this Release by this engine, is not the locked one.
   */
  kind: "latest_differs" | "then_differs";
  /** The alternative window the difference is in; null for the declared one, or for the row itself. */
  window: ClaimWindow | null;
  /** The figure that differs; null when the row's availability or unit does. */
  figure: FigureName | null;
  field: "value" | "period" | "status" | "empty" | "unit" | "availability";
  locked: number | string | null;
  now: number | string | null;
};

type Comparable = Pick<EvidenceRow, "unit" | "figures" | "window_sensitivity"> & { unavailable?: { reason: string } };

function compare(kind: DriftEntry["kind"], locked: Comparable, now: Comparable): DriftEntry[] {
  const out: DriftEntry[] = [];
  const availability = (row: Comparable): string | null => row.unavailable?.reason ?? null;
  if (availability(locked) !== availability(now)) {
    return [{ kind, window: null, figure: null, field: "availability", locked: availability(locked), now: availability(now) }];
  }
  if ((locked.unit ?? null) !== (now.unit ?? null)) out.push({ kind, window: null, figure: null, field: "unit", locked: locked.unit ?? null, now: now.unit ?? null });
  const figures = (window: ClaimWindow | null, was: readonly Figure[], is: readonly Figure[]): void => {
    const names = [...new Set([...was, ...is].map((f) => f.name))];
    for (const name of names) {
      const [a, b] = [was.find((f) => f.name === name), is.find((f) => f.name === name)];
      for (const field of ["value", "period", "status", "empty"] as const) {
        const [x, y] = [a?.[field] ?? null, b?.[field] ?? null];
        if (x !== y) out.push({ kind, window, figure: name, field, locked: x, now: y });
      }
    }
  };
  figures(null, locked.figures, now.figures);
  const windows = new Map<string, [SensitivityRow | undefined, SensitivityRow | undefined]>();
  for (const w of locked.window_sensitivity) windows.set(`${w.from}/${w.to}`, [w, undefined]);
  for (const w of now.window_sensitivity) windows.set(`${w.from}/${w.to}`, [windows.get(`${w.from}/${w.to}`)?.[0], w]);
  for (const [was, is] of windows.values()) {
    const window = { from: (was ?? is)!.from, to: (was ?? is)!.to };
    const [x, y] = [was?.unavailable?.reason ?? (was ? null : "absent"), is?.unavailable?.reason ?? (is ? null : "absent")];
    if (x !== y) out.push({ kind, window, figure: null, field: "availability", locked: x, now: y });
    else figures(window, was?.figures ?? [], is?.figures ?? []);
  }
  return out;
}

/**
 * Where a locked Reading's rows are no longer what this Release gives: the *latest* row
 * against the locked *now when checked*, and the *then* row computed again against the locked
 * *then*. It reports differences and names no cause: a Revision, a withdrawn history and a
 * change of engine all look the same from here. Empty when nothing differs. Only a person
 * re-locks.
 */
export function claimDrift(locked: Pick<LockedReading, "then" | "now_when_checked">, latest: EvidenceRow, thenAgain: EvidenceRow): DriftEntry[] {
  return [...compare("latest_differs", locked.now_when_checked, latest), ...compare("then_differs", locked.then, thenAgain)];
}
