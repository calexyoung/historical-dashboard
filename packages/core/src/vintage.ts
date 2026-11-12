/**
 * Vintage resolution: "what did the data say before this date?" (CONTEXT.md, As-of; PLAN 4.5;
 * ADR 0005, ADR 0024). The contract is `docs/method/vintage-resolution.md`; this module is
 * tested from that text.
 *
 * `resolve(series, asOf, release)` answers with a Vintage and its Basis. It never fills an
 * answer it cannot give with today's figures: an unavailable answer holds no Observation.
 *
 * Pure. Hidden here: the Cutoff (00:00 in New York on the date asked about), the two clocks a
 * version can be dated by and why they are never mixed in one answer, which Captures asked
 * about which Period, the Capture gap, the same-day flag, and the metadata in force.
 */
import { nextPeriod, periodBounds, type Frequency } from "./period";
import type { VintageFile, VintageRow } from "./release/types.generated";
import { SEMANTICS_VERSION } from "./transform";

/** The kinds of evidence behind an as-of answer, strongest first (ADR 0005). */
export const BASES = ["provider", "atlas_observed", "legacy", "uncertain", "unavailable"] as const;
export type VintageBasis = (typeof BASES)[number];

/** The weakest of several bases: what an answer built from all of them may claim. */
export function weakestBasis(bases: readonly VintageBasis[]): VintageBasis | null {
  let worst = -1;
  for (const basis of bases) worst = Math.max(worst, BASES.indexOf(basis));
  return worst < 0 ? null : BASES[worst]!;
}

export const CUTOFF_ZONE = "America/New_York";

/** The instant before which a value must have been public to count (CONTEXT.md, Cutoff). */
export type Cutoff = {
  /** UTC, as a Release writes an instant. */
  instant: string;
  /** The New York calendar day the instant falls on. */
  day: string;
  /** `date`: the question named a day. `datetime`: it named an instant. */
  precision: "date" | "datetime";
  zone: typeof CUTOFF_ZONE;
};

export type ResolveObservation = {
  period: string;
  period_start: string;
  period_end: string;
  value: number | null;
  status: string;
};

/** What `resolve` needs of one Series of a Release. */
export type ResolveSeries = {
  key: string;
  freq: Frequency;
  representation: "native" | "legacy_monthly_rounded";
  /** The Release's own state of the Series: `series/{key}.json`. */
  observations: readonly ResolveObservation[];
  /** `vintages/{key}.json`, when the Release holds one. */
  vintages?: VintageFile | null;
  /** Legacy Series only: when v1's output was generated, if the Release says. */
  heldAt?: string | null;
};

export type VintageObservation = ResolveObservation & {
  /** The evidence for this Observation; null in an answer that is not as-of, and for a filled gap. */
  basis: VintageBasis | null;
  /** When the version was published (`provider`) or first held (`atlas`, `legacy`). */
  known_from: string | null;
  known_by: "provider" | "atlas" | "legacy" | null;
  /** The last Capture before the Cutoff that asked about this Period (Atlas-observed only). */
  last_checked: string | null;
};

/** The stretch between the last Capture before the Cutoff and the Cutoff. */
export type CaptureGap = {
  /** The last Capture of the Series before the Cutoff. */
  from: string;
  /** The first Capture at or after the Cutoff; null when there is none yet. */
  to: string | null;
  /** Whole New York days after `from`'s day and before the Cutoff's day: days with no Capture. */
  missed_days: number;
  /** Whether the Capture at `to` found anything changed, for the Periods it asked about. */
  changed_across: boolean | null;
};

export type VintageUnavailableReason =
  /** The question is not a calendar date or an instant, or its UTC year is before 1900. */
  | "bad_as_of"
  /** The Release holds no vintages for the Series. */
  | "no_vintages"
  /** The Cutoff is before anything Macro Atlas or the Origin's record covers. */
  | "no_coverage"
  /** A legacy Series whose Release does not say when v1's output was generated. */
  | "legacy_not_dated"
  /** A legacy Series: the only state held was generated at or after the Cutoff. */
  | "legacy_held_after_cutoff";

export type MetadataInForce = {
  hash: string;
  /** When Macro Atlas first recorded it; null for an answer on the Origin's clock. */
  in_force_from: string | null;
  metadata: VintageFile["metadata"][number]["metadata"];
  /** True when the Series' metadata has changed since. */
  differs_from_current: boolean;
  /** Periods in the answer whose version was recorded under other metadata (ADR 0022, point 7). */
  other_metadata_periods: string[];
};

export type VintageAnswer = {
  key: string;
  /** The question as asked; null for the Release's own state. */
  as_of: string | null;
  /** Null only when `as_of` is null. The weakest basis among the Observations. */
  basis: VintageBasis | null;
  reason?: VintageUnavailableReason;
  cutoff: Cutoff | null;
  observations: VintageObservation[];
  capture_gap: CaptureGap | null;
  /** A version was published, or first seen by Macro Atlas, on the Cutoff's own day. */
  same_day_release: boolean;
  metadata: MetadataInForce | null;
  release_id: string;
  semantics_version: string;
};

// --- time -----------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?Z$/;

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/** UTC milliseconds at 00:00 of a calendar date, or null if there is no such date. */
function dayMs(text: string): number | null {
  const match = DATE.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const made = new Date(ms);
  if (year < 1900 || made.getUTCFullYear() !== year || made.getUTCMonth() !== month - 1 || made.getUTCDate() !== day) return null;
  return ms;
}

function instantMs(text: string | null | undefined): number | null {
  if (typeof text !== "string" || !INSTANT.test(text) || dayMs(text.slice(0, 10)) === null) return null;
  const ms = Date.parse(text.length > 24 ? `${text.slice(0, 23)}Z` : text);
  return Number.isFinite(ms) ? ms : null;
}

const stamp = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");

/**
 * An instant as text that sorts in time order, to the nanosecond a Release may write: the
 * fraction padded to nine digits. Milliseconds are enough to find a calendar day, but two
 * instants are ordered by this, so one a microsecond after another is after it.
 */
const NEVER = "~"; // sorts after every instant: a time that cannot be read is never "before"
function order(text: string | null | undefined): string {
  if (instantMs(text) === null) return NEVER;
  const [whole, fraction = ""] = text!.slice(0, -1).split(".");
  return `${whole}.${fraction.padEnd(9, "0")}`;
}

// Built on first use: importing this module does nothing.
let clock: Intl.DateTimeFormat | undefined;
/** The New York calendar day and wall-clock time of an instant. */
function newYork(ms: number): { day: string; time: string } {
  clock ??= new Intl.DateTimeFormat("en-US", {
    timeZone: CUTOFF_ZONE, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const part: Record<string, string> = {};
  for (const { type, value } of clock.formatToParts(ms)) part[type] = value;
  return { day: `${pad(Number(part.year), 4)}-${part.month}-${part.day}`, time: `${part.hour}:${part.minute}:${part.second}` };
}

/**
 * The Cutoff for a question (PLAN 4.5): a calendar date means 00:00 in New York on that date;
 * an instant (`2026-06-10T18:00:00Z`) means itself. Anything else has no Cutoff.
 */
export function cutoffFor(asOf: string): Cutoff | null {
  if (typeof asOf !== "string") return null;
  const day = dayMs(asOf);
  if (day !== null) {
    // New York is four or five hours behind UTC, and its clocks never change at midnight.
    for (const hours of [4, 5]) {
      const ms = day + hours * 3_600_000;
      const local = newYork(ms);
      if (local.day === asOf && local.time === "00:00:00") {
        return { instant: stamp(ms), day: asOf, precision: "date", zone: CUTOFF_ZONE };
      }
    }
    return null;
  }
  const ms = instantMs(asOf);
  if (ms === null) return null;
  return { instant: asOf, day: newYork(ms).day, precision: "datetime", zone: CUTOFF_ZONE };
}

// --- resolve --------------------------------------------------------------------------------------

type Timed = { row: VintageRow; index: number; from: string; to: string | null; provider: string | null; providerTo: string | null };
type Picked = { timed: Timed; basis: VintageBasis; lastChecked: string | null };

/**
 * The Vintage of a Series as of a date or an instant, with its Basis. `asOf` null asks for the
 * Release's own state, which is not an as-of answer and carries no Basis.
 */
export function resolve(series: ResolveSeries, asOf: string | null, release: { releaseId: string }): VintageAnswer {
  const answer: VintageAnswer = {
    key: series.key, as_of: asOf, basis: null, cutoff: null, observations: [], capture_gap: null,
    same_day_release: false, metadata: null, release_id: release.releaseId, semantics_version: SEMANTICS_VERSION,
  };
  const unavailable = (reason: VintageUnavailableReason): VintageAnswer => ({ ...answer, basis: "unavailable", reason });

  if (asOf === null) {
    answer.observations = series.observations.map((o) => plain(o, null, null, null));
    return answer;
  }
  const cutoff = cutoffFor(asOf);
  if (!cutoff) return unavailable("bad_as_of");
  answer.cutoff = cutoff;
  const at = order(cutoff.instant);

  if (series.representation !== "native") {
    // v1's output is one state, rounded, with one date: when v1 generated it. It can say what
    // was known before a later Cutoff and nothing about an earlier one.
    if (instantMs(series.heldAt) === null) return unavailable("legacy_not_dated");
    if (order(series.heldAt) >= at) return unavailable("legacy_held_after_cutoff");
    answer.basis = "legacy";
    answer.observations = series.observations.map((o) => plain(o, "legacy", series.heldAt!, "legacy"));
    return answer;
  }

  const file = series.vintages;
  if (!file) return unavailable("no_vintages");
  const rows: Timed[] = file.rows.map((row, index) => ({
    row, index,
    from: order(row.recorded_from),
    to: row.recorded_to === null ? null : order(row.recorded_to),
    provider: row.provider_from === null ? null : order(row.provider_from),
    providerTo: row.provider_to === null ? null : order(row.provider_to),
  }));
  const cutoffDay = dayMs(cutoff.day)!;
  /** Whether something the Origin dated was published before the Cutoff. A day is before the
   * Cutoff only if it is an earlier day than the Cutoff's: nobody knows the hour (PLAN 4.5). */
  const publishedBefore = (time: string, precision: VintageRow["provider_precision"]): boolean =>
    precision === "date" ? time.slice(0, 10) < cutoff.day : time < at;
  /** The calendar day the Origin dated a version to: its own day, or New York's for an instant. */
  const providerDay = (timed: Timed): string | null => {
    if (timed.row.provider_precision === "date") return timed.row.provider_from!.slice(0, 10);
    const ms = instantMs(timed.row.provider_from);
    return ms === null ? null : newYork(ms).day;
  };

  const coverage = file.provider_coverage;
  const picked = new Map<string, Picked>();

  if (coverage && order(coverage.from) <= at && at <= order(coverage.to) && order(coverage.to) !== NEVER) {
    // The Origin's clock. Only versions the Origin dated take part: a version Macro Atlas
    // merely held says nothing about when it was published.
    for (const timed of rows) {
      if (timed.provider === null || !publishedBefore(timed.provider, timed.row.provider_precision)) continue;
      if (timed.providerTo !== null && publishedBefore(timed.providerTo, timed.row.provider_precision)) continue;
      picked.set(timed.row.period, { timed, basis: "provider", lastChecked: null });
    }
    answer.basis = "provider";
    answer.same_day_release = rows.some((timed) => timed.provider !== null && providerDay(timed) === cutoff.day);
    // Of the versions in the answer: a Period the Origin withdrew is not one of them.
    const hashes = new Set([...picked.values()].filter((p) => !p.timed.row.deleted).map((p) => p.timed.row.metadata));
    const shared = hashes.size === 1 ? file.metadata.find((line) => line.hash === [...hashes][0]) : undefined;
    if (shared) {
      answer.metadata = {
        hash: shared.hash, in_force_from: null, metadata: shared.metadata,
        differs_from_current: shared.hash !== file.metadata[file.metadata.length - 1]!.hash,
        other_metadata_periods: [],
      };
    }
  } else {
    // Macro Atlas's clock: what was held just before the Cutoff.
    const captures = file.captures
      .map((capture) => ({ capture, at: order(capture.retrieved_at), ms: instantMs(capture.retrieved_at) ?? 0 }))
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const before = captures.filter((c) => c.at < at);
    if (before.length === 0) return unavailable("no_coverage");
    const last = before[before.length - 1]!;
    const next = captures.find((c) => c.at >= at) ?? null;
    const missedSince = (ms: number): number => Math.max(0, Math.round((cutoffDay - dayMs(newYork(ms).day)!) / DAY_MS) - 1);
    answer.capture_gap = {
      from: last.capture.retrieved_at,
      to: next ? next.capture.retrieved_at : null,
      missed_days: missedSince(last.ms),
      changed_across: next ? next.capture.change !== "none" : null,
    };
    answer.basis = answer.capture_gap.missed_days > 0 ? "uncertain" : "atlas_observed";
    for (const timed of rows) {
      if (!(timed.from < at) || (timed.to !== null && timed.to < at)) continue;
      // A Capture vouches only for the Periods it asked about (ADR 0022, point 5).
      const { period_start, period_end } = timed.row;
      const asked = before.filter(({ capture: { scope } }) =>
        (scope[0] === null || scope[0] <= period_start) && (scope[1] === null || scope[1] >= period_end));
      const checked = asked[asked.length - 1];
      const basis: VintageBasis = checked && missedSince(checked.ms) === 0 ? "atlas_observed" : "uncertain";
      picked.set(timed.row.period, { timed, basis, lastChecked: checked ? checked.capture.retrieved_at : null });
    }
    // A version first seen on the Cutoff's day: the figure changed that day, or may have.
    // Not counted: what the first Capture found (that is when Macro Atlas began to watch), and
    // a version that only restates the one before under new metadata.
    const firstCapture = captures[0]!.at;
    answer.same_day_release = rows.some((timed, i) => {
      if (timed.provider !== null && providerDay(timed) === cutoff.day) return true;
      const heldFrom = instantMs(timed.row.recorded_from);
      if (timed.from === firstCapture || heldFrom === null || newYork(heldFrom).day !== cutoff.day) return false;
      const earlier = i > 0 && rows[i - 1]!.row.period === timed.row.period ? rows[i - 1]!.row : null;
      const restated = earlier !== null && !earlier.deleted && !timed.row.deleted
        && earlier.value === timed.row.value && earlier.status === timed.row.status;
      return !restated;
    });
    const lines = file.metadata.filter((line) => order(line.recorded_from) < at);
    const line = lines[lines.length - 1];
    if (line) {
      answer.metadata = {
        hash: line.hash, in_force_from: line.recorded_from, metadata: line.metadata,
        differs_from_current: line.hash !== file.metadata[file.metadata.length - 1]!.hash,
        other_metadata_periods: [...picked.values()]
          .filter((p) => !p.timed.row.deleted && p.timed.row.metadata !== line.hash)
          .map((p) => p.timed.row.period),
      };
    }
  }

  // The Vintage: one Observation per Period that had a version in force, in Period order, with
  // every Period between the first and the last present, as a Release holds a Series.
  const held = [...picked.values()].filter((p) => !p.timed.row.deleted).sort((a, b) => a.timed.index - b.timed.index);
  let expected: string | null = null;
  for (const { timed, basis, lastChecked } of held) {
    const { row } = timed;
    while (series.freq !== "irregular" && expected !== null && expected !== row.period) {
      const gap = gapObservation(series.freq, expected);
      if (!gap || gap.period_start >= row.period_start) break;
      answer.observations.push(gap);
      expected = nextPeriod(series.freq, expected);
    }
    const byProvider = basis === "provider";
    answer.observations.push({
      period: row.period, period_start: row.period_start, period_end: row.period_end,
      value: row.value, status: row.status ?? "missing", basis,
      known_from: byProvider ? (row.provider_precision === "date" ? row.provider_from!.slice(0, 10) : row.provider_from) : row.recorded_from,
      known_by: byProvider ? "provider" : "atlas",
      last_checked: lastChecked,
    });
    expected = nextPeriod(series.freq, row.period);
  }
  answer.basis = weakestBasis([answer.basis!, ...held.map((p) => p.basis)]);
  return answer;
}

function plain(o: ResolveObservation, basis: VintageBasis | null, knownFrom: string | null, knownBy: VintageObservation["known_by"]): VintageObservation {
  return {
    period: o.period, period_start: o.period_start, period_end: o.period_end, value: o.value, status: o.status,
    basis, known_from: knownFrom, known_by: knownBy, last_checked: null,
  };
}

function gapObservation(freq: Frequency, period: string): VintageObservation | null {
  const bounds = periodBounds(freq, period);
  if (!bounds) return null;
  return {
    period, period_start: bounds.start, period_end: bounds.end, value: null, status: "missing",
    basis: null, known_from: null, known_by: null, last_checked: null,
  };
}
