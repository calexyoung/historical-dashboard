/**
 * Claims as pages (PLAN section 3 and M21; ADR 0011, ADR 0034, ADR 0035): the index (`/claims`)
 * and one Claim (`/claims/{id}`).
 *
 * A Claim is a record and the figures needed to examine it. These views state the record, what
 * each Reading measures and what the Measure returned. Nothing here weighs the statement: no
 * field, word or mark says what the figures show about it, and none is derived from comparing
 * a figure with the quote.
 *
 * Where each number comes from is the point of the page, so it is fixed here and nowhere else:
 *
 * - *then* and *now when checked*, and their Window sensitivity, are read only from the Claim's
 *   newest lock, and only when that lock's file is in the Release. An older lock never stands in
 *   for a newer one whose numbers are not carried.
 * - *latest* is read only from the Release's `evidence/latest.json`, for that same lock version.
 * - Before either is shown, the rights gate is asked about the lineage the file itself records
 *   (`rights_used`), for this Surface: display for the page, redistribute for a file.
 *
 * Both views are pure functions of one Release (and, for a local build, the User notes handed
 * in); the pages render them with no script.
 */
import { permits, periodBounds, type Frequency, type Permission, type RightsGate, type Surface, type TransformName, type VintageBasis } from "@macro-atlas/core";
import type { Claim, ClaimLock, ClaimLockListed, ClaimReading, EvidenceFigure, EvidenceRow, LatestClaim, LatestReading, LockedReading, RightsLineage } from "@macro-atlas/core/release";
import { claimDrawing } from "./claim-drawing";
import type { MarkName, SvgNode } from "./figure";
import { stateOfStatus, STATE_INFO } from "./figure/states";
import { dayWords, fixed, periodWords, readingDecimals } from "./figure/words";
import type { UserNote } from "./notes";
import type { OpenedRelease } from "./release/reader";
import { shownUnit } from "./series-words";

const CLAIM_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isClaimId = (id: string): boolean => typeof id === "string" && id.length <= 120 && CLAIM_ID.test(id);

type Gate = Pick<RightsGate, "permits">;
type ReleaseClaims = Pick<OpenedRelease, "claims">;

const slug = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
/** The party as the record has it; `none` is said in words. No colour ever stands for a party (DESIGN.md). */
export const partyWords = (party: string): string => (party.trim().toLowerCase() === "none" ? "No party" : party);
const topicWords = (topic: string): string => topic.charAt(0).toUpperCase() + topic.slice(1).replaceAll("-", " ");
const instantWords = (instant: string): string => `${dayWords(instant.slice(0, 10), "short")}, ${instant.slice(11, 16)} UTC`;

// --- the index ------------------------------------------------------------------------------------

export const CLAIM_FACETS = ["person", "party", "topic"] as const;
export type ClaimFacet = (typeof CLAIM_FACETS)[number];
export type ClaimFilters = Record<ClaimFacet, string | null>;

export function parseClaimFilters(raw: Record<string, string | string[] | undefined>): ClaimFilters {
  const one = (name: ClaimFacet): string | null => {
    const value = Array.isArray(raw[name]) ? raw[name][0] : raw[name];
    return typeof value === "string" && value !== "" ? value.slice(0, 60) : null;
  };
  return { person: one("person"), party: one("party"), topic: one("topic") };
}

export type ClaimIndexRow = {
  id: string;
  /** Without the base path. */
  href: string;
  quote: string;
  name: string;
  role: string;
  party: string;
  when: string;
  topics: string[];
  draft: boolean;
  /** How many Readings the record declares. */
  readings: number;
};
export type FacetOption = { value: string; label: string; count: number };
export type ClaimsIndexView = {
  total: number;
  shown: number;
  /** How many of the Claims listed are drafts (a local-profile Release only). */
  drafts: number;
  /** The filters in force: one the Release has no Claim for is dropped and said in `note`. */
  filters: ClaimFilters;
  active: boolean;
  options: Record<ClaimFacet, FacetOption[]>;
  /** Every Claim of the Release by the party its claimant held, whatever is filtered: most first, then by name. */
  byParty: { party: string; count: number; query: string }[];
  /** Newest first. */
  rows: ClaimIndexRow[];
  /** Every Correction to a Claim of the Release, newest first. */
  corrections: { claim: string; href: string; who: string; date: string; when: string; reason: string }[];
  note: string | null;
};

const FACET_NOUN: Record<ClaimFacet, string> = { person: "person", party: "party", topic: "topic" };

export function claimsIndexView(release: ReleaseClaims, asked: ClaimFilters): ClaimsIndexView {
  const claims = release.claims.claims;
  const values: Record<ClaimFacet, (claim: Claim) => { value: string; label: string }[]> = {
    person: (c) => [{ value: slug(c.claimant.name), label: c.claimant.name }],
    party: (c) => [{ value: slug(c.claimant.party), label: partyWords(c.claimant.party) }],
    topic: (c) => (c.topics ?? []).map((t) => ({ value: t, label: topicWords(t) })),
  };
  const options = {} as Record<ClaimFacet, FacetOption[]>;
  for (const facet of CLAIM_FACETS) {
    const found = new Map<string, FacetOption>();
    for (const claim of claims) {
      for (const { value, label } of values[facet](claim)) {
        const held = found.get(value);
        if (held) held.count += 1;
        else found.set(value, { value, label, count: 1 });
      }
    }
    options[facet] = [...found.values()].sort((a, b) => a.label.localeCompare(b.label, "en"));
  }
  const filters = {} as ClaimFilters;
  const dropped: string[] = [];
  for (const facet of CLAIM_FACETS) {
    const value = asked[facet];
    const known = value !== null && options[facet].some((o) => o.value === value);
    filters[facet] = known ? value : null;
    if (value !== null && !known) dropped.push(FACET_NOUN[facet]);
  }
  const listed = claims.filter((claim) => CLAIM_FACETS.every((facet) => filters[facet] === null || values[facet](claim).some((v) => v.value === filters[facet])));
  const newestFirst = (a: Claim, b: Claim) => (a.said_on === b.said_on ? a.id.localeCompare(b.id) : a.said_on < b.said_on ? 1 : -1);
  const rows = [...listed].sort(newestFirst).map((claim) => ({
    id: claim.id,
    href: `/claims/${claim.id}`,
    quote: claim.quote,
    name: claim.claimant.name,
    role: claim.claimant.role,
    party: partyWords(claim.claimant.party),
    when: dayWords(claim.said_on, "short"),
    topics: (claim.topics ?? []).map(topicWords),
    draft: claim.status === "draft",
    readings: claim.readings.length,
  }));
  const corrections = claims
    .flatMap((claim) => claim.corrections.map((c) => ({ claim: claim.id, href: `/claims/${claim.id}`, who: claim.claimant.name, date: c.date, when: dayWords(c.date, "short"), reason: c.reason })))
    .sort((a, b) => (a.date === b.date ? a.claim.localeCompare(b.claim) : a.date < b.date ? 1 : -1));
  return {
    total: claims.length,
    shown: listed.length,
    drafts: listed.filter((c) => c.status === "draft").length,
    filters,
    active: CLAIM_FACETS.some((facet) => filters[facet] !== null),
    options,
    byParty: options.party.map((o) => ({ party: o.label, count: o.count, query: `party=${o.value}` })).sort((a, b) => b.count - a.count || a.party.localeCompare(b.party, "en")),
    rows,
    corrections,
    note: dropped.length > 0 ? `This release holds no claim for the ${dropped.join(" or ")} in the address, so that part of it is left out.` : null,
  };
}

// --- which evidence a Claim has in a Release, and whether it may be used ---------------------------

export type ClaimEvidence =
  /** The Claim has no lock: nothing has been computed for it. */
  | { state: "none" }
  /** Its newest lock is named in the Release without its numbers. */
  | { state: "absent"; listed: ClaimLockListed; why: string }
  /** The gate does not permit what the lock's numbers came through, here, for this use. */
  | { state: "not_permitted"; listed: ClaimLockListed; reason: string }
  | {
      state: "held";
      listed: ClaimLockListed;
      lock: ClaimLock;
      /** The lock's file as it was written. */
      text: string;
      /** The latest rows for this lock version, or why there are none to use. */
      latest: { ok: true; rows: LatestClaim } | { ok: false; reason: string };
    };

const ABSENT: Record<string, string> = {
  withdrawn: "Its numbers are withdrawn",
  not_carried: "This release does not carry its numbers",
};

function gateSays(lineage: readonly RightsLineage[], permission: Permission, surface: Surface, gate?: Gate) {
  const rows = lineage.map((row) => ({ origin: row.origin, dataset: row.dataset, channel: row.channel, representation: row.representation, permission }));
  return gate ? gate.permits(rows, surface) : permits(rows, surface);
}

/**
 * The one place a Claim's evidence is chosen (the page and every twin ask here). The newest
 * lock the Claim lists is the only candidate: if its file is not in the Release there is no
 * evidence to show, whatever older locks the Release holds.
 */
export function claimEvidence(release: Pick<OpenedRelease, "locks" | "latest">, surface: Surface, claim: Claim, permission: Permission, gate?: Gate): ClaimEvidence {
  const listed = [...claim.locks].sort((a, b) => b.version - a.version)[0];
  if (!listed) return { state: "none" };
  const held = listed.state === "in_release" ? release.locks[`${claim.id}.v${listed.version}`] : undefined;
  if (!held) return { state: "absent", listed, why: `${ABSENT[listed.state] ?? "Its numbers are not in this release"}${listed.why ? `: ${listed.why}` : "."}` };
  const lock = held.parsed;
  const decision = gateSays(lock.rights_used, permission, surface, gate);
  if (!decision.allowed) return { state: "not_permitted", listed, reason: decision.reason };
  const rows = release.latest?.claims.find((c) => c.claim_id === claim.id && c.lock_version === listed.version);
  let latest: Extract<ClaimEvidence, { state: "held" }>["latest"];
  if (!rows) latest = { ok: false, reason: "This release holds no latest row for this lock." };
  else {
    const allowed = gateSays(rows.rights_used, permission, surface, gate);
    // A file holds the latest rows too, so a file is refused whole when they may not be handed
    // out; a page shows the lock's figures and says why the latest column is empty.
    if (!allowed.allowed && permission !== "display") return { state: "not_permitted", listed, reason: allowed.reason };
    latest = allowed.allowed ? { ok: true, rows } : { ok: false, reason: `Not shown here: ${allowed.reason}.` };
  }
  return { state: "held", listed, lock, text: held.text, latest };
}

// --- one Claim ---------------------------------------------------------------------------------------

export type FigureName = EvidenceFigure["name"];
export type Cell =
  | { kind: "value"; text: string; exact: number; period: string | null; state: { mark: MarkName; word: string } | null }
  /** The Measure returned no number here, and says why. */
  | { kind: "empty"; why: string }
  /** The row has no such figure (it cannot be answered, or is not shown). */
  | { kind: "none" };
export type FigureRow = { name: FigureName; label: string; then: Cell; now: Cell; latest: Cell };
export type ColumnInfo = {
  /** False: the row holds no figure; `lines` says why. */
  answered: boolean;
  basis: VintageBasis | null;
  /** Facts of the row, a sentence each. */
  lines: string[];
};
export type WindowView = { declared: boolean; words: string; rows: FigureRow[] };
export type ReadingView = {
  id: string;
  n: number;
  series: { key: string; name: string; /** Without the base path; null when this Release has no such Series. */ href: string | null };
  /** What is measured, as a sentence. */
  what: string;
  unit: string | null;
  /** Null when the Claim has no evidence to show: the Reading is described and nothing more. */
  evidence: {
    then: ColumnInfo;
    now: ColumnInfo;
    latest: ColumnInfo;
    rows: FigureRow[];
    /** The declared window first, then each alternative in the order declared. Empty: the Measure has no window. */
    windows: WindowView[];
    drawing: { svg: SvgNode; caption: string } | null;
  } | null;
  /** Doors into the Explorer on the Reading's Series: as it is in this Release, and as known before the Cutoff. */
  explorer: { today: string; then: string } | null;
};

export type ClaimSourceView = { name: string; url: string; archive: string; locator: string; kind: string };
export type ClaimPageView = {
  id: string;
  quote: string[];
  claimant: { name: string; role: string; party: string; personQuery: string };
  when: string;
  /** The instant, when the record has one. */
  at: string | null;
  venue: string;
  draft: boolean;
  topics: { label: string; query: string }[];
  sources: ClaimSourceView[];
  checkedOn: string;
  selectionNote: string;
  notMeasured: string[];
  corrections: { when: string; reason: string }[];
  /** How the page stands as a whole, with the sentence that says so when there is no figure. */
  evidence: { state: "none" | "absent" | "not_permitted" | "held"; reason: string | null };
  readings: ReadingView[];
  /** The lock the figures are read from, and every lock the Claim has had. */
  lock: {
    version: number;
    lockedAt: string;
    release: string | null;
    releaseCreated: string | null;
    profile: string | null;
    semantics: string | null;
    fileSha256: string | null;
    recordSha256: string;
    history: { version: number; lockedAt: string; reason: string | null; state: string }[];
  } | null;
  /** This Release, for the latest column. */
  release: { id: string; created: string };
  downloads: { permitted: true; files: { label: string; href: string; note: string }[] } | { permitted: false; reason: string; files: { label: string; href: string; note: string }[] };
  /** User notes about this Claim: a local build only, each marked as its author's. */
  notes: { user: string; created: string; paragraphs: string[] }[];
  methodHref: string;
};

const FIGURE_LABEL: Record<FigureName, string> = {
  value: "Value",
  start: "Start",
  end: "End",
  change: "Change",
  pct_change: "Percent change",
  extreme: "Extreme",
  n: "Periods with a value",
  rank: "Rank",
  of: "Out of",
  a: "First period",
  b: "Second period",
  difference: "Difference",
};
const EMPTY: Record<string, string> = {
  no_observation: "No observation for this period",
  missing: "The period has no value",
  operand_empty: "A figure it is computed from has no value",
  start_not_positive: "Not computed: the start is zero or below",
  no_values: "No period in the window has a value",
};
const UNAVAILABLE: Record<string, string> = {
  no_coverage: "that is before Macro Atlas first fetched this series, and outside any record of the origin's releases it holds",
  no_vintages: "this release holds no history for this series, only its values as they are now",
  input_unavailable: "a series it is computed from has no answer for that time",
  input_not_held: "this release does not hold a series it is computed from",
};
const sentence = (text: string): string => {
  const t = text.trim();
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}`;
};

type Described = Pick<ClaimReading, "measure" | "transform" | "period" | "periods" | "window" | "which" | "order">;
/** A Period label in words at a frequency; the label itself when it is not one. */
function labelWords(freq: Frequency, label: string, style: "long" | "short" = "long"): string {
  const bounds = periodBounds(freq, label);
  return bounds ? periodWords(freq, { period: label, period_start: bounds.start }, style) : label;
}
const windowWords = (w: { from: string; to: string }): string => `${dayWords(w.from, "short")} to ${dayWords(w.to, "short")}`;

/** What a Reading measures, as a template sentence. It names the computation and nothing else. */
export function readingWords(reading: Described, freq: Frequency, unit: string | null, locked?: Pick<LockedReading, "window">): string {
  const p = (label: string) => labelWords(freq, label);
  const as = reading.transform === "lin" || unit === null ? "" : `, as ${shownUnit(reading.transform as TransformName, unit)}`;
  switch (reading.measure) {
    case "value_at":
      return `The value in ${p(reading.period ?? "")}${as}.`;
    case "change": {
      const ends = locked?.window?.periods ?? [];
      const span = ends.length === 2 ? `from ${p(ends[0]!.period)} to ${p(ends[1]!.period)}` : reading.window ? `over ${windowWords(reading.window)}` : "";
      return `The change ${span}${as}.`;
    }
    case "extreme":
      return `The ${reading.which === "min" ? "lowest" : "highest"} value in the window ${reading.window ? windowWords(reading.window) : ""}, and its period${as}.`;
    case "rank":
      return `Where ${p(reading.period ?? "")} ranks among the periods of the window ${reading.window ? windowWords(reading.window) : ""}, counting from the ${reading.order === "lowest" ? "lowest" : "highest"} value${as}.`;
    default: {
      const [a, b] = reading.periods ?? ["", ""];
      return `The difference between ${p(a ?? "")} and ${p(b ?? "")} (the second less the first)${as}.`;
    }
  }
}

function figureLabel(name: FigureName, reading: Described): string {
  if (name === "extreme") return reading.which === "min" ? "Lowest" : "Highest";
  if (name === "rank") return `Rank (1 is the ${reading.order === "lowest" ? "lowest" : "highest"})`;
  return FIGURE_LABEL[name];
}

const COUNTS: ReadonlySet<FigureName> = new Set(["n", "rank", "of"]);

/** One figure across the three states. */
function figureRow(name: FigureName, reading: Described, freq: Frequency, rows: { then: EvidenceFigure[] | null; now: EvidenceFigure[] | null; latest: EvidenceFigure[] | null }): FigureRow {
  const found = { then: rows.then?.find((f) => f.name === name), now: rows.now?.find((f) => f.name === name), latest: rows.latest?.find((f) => f.name === name) };
  // The two locked figures are written with the same number of decimals, chosen from them
  // alone: nothing in a Release can change how a locked figure reads. Latest has at least as many.
  const most = (...figures: (EvidenceFigure | undefined)[]): number => (COUNTS.has(name) ? 0 : Math.max(0, ...figures.flatMap((f) => (f && typeof f.value === "number" ? [readingDecimals(f.value)] : []))));
  const locked = most(found.then, found.now);
  const cell = (figure: EvidenceFigure | undefined, decimals: number): Cell => {
    if (!figure) return { kind: "none" };
    if (typeof figure.value !== "number") return { kind: "empty", why: EMPTY[figure.empty ?? ""] ?? `No value (${(figure.empty ?? "not given").replaceAll("_", " ")})` };
    const mark = figure.status ? stateOfStatus(figure.status) : null;
    return {
      kind: "value",
      text: fixed(figure.value, decimals),
      exact: figure.value,
      period: figure.period ? labelWords(freq, figure.period, "short") : null,
      state: mark ? { mark, word: STATE_INFO[mark].word } : null,
    };
  };
  return { name, label: figureLabel(name, reading), then: cell(found.then, locked), now: cell(found.now, locked), latest: cell(found.latest, Math.max(locked, most(found.latest))) };
}

const names = (...rows: (EvidenceFigure[] | null)[]): FigureName[] => {
  const seen: FigureName[] = [];
  for (const row of rows) for (const figure of row ?? []) if (!seen.includes(figure.name)) seen.push(figure.name);
  return seen;
};

function unavailableLine(row: EvidenceRow): string {
  const u = row.unavailable;
  return `No answer: ${UNAVAILABLE[u?.reason ?? ""] ?? u?.message ?? "this cannot be answered"}.`.replace(/\.\.$/, ".");
}

function thenInfo(row: EvidenceRow): ColumnInfo {
  const precise = row.cutoff?.precision === "datetime";
  const when = row.as_of === null ? "the Cutoff" : /^\d{4}-\d{2}-\d{2}$/.test(row.as_of) ? `${dayWords(row.as_of)} (00:00 in New York)` : instantWords(row.as_of);
  const lines = [`As known before ${when}${precise ? ", the time of the statement" : ""}.`];
  const answered = row.basis !== "unavailable" && !row.unavailable;
  if (!answered) lines.push(unavailableLine(row), "No figure from a later time is shown in its place.");
  else {
    for (const input of row.inputs) {
      const gap = input.capture_gap;
      if (!gap) continue;
      const unseen = gap.missed_days > 0 ? `${gap.missed_days} whole ${gap.missed_days === 1 ? "day" : "days"} went unseen between it and that time.` : "No day went unseen between it and that time.";
      lines.push(`Last Capture of ${input.key} before then: ${instantWords(gap.from)}. ${unseen}`);
    }
    if (row.same_day_release) lines.push("A version is dated to that same day; it does not count as known before it.");
  }
  return { answered, basis: row.basis, lines };
}

function ownStateInfo(row: EvidenceRow, lead: string): ColumnInfo {
  const answered = !row.unavailable;
  const lines = [lead];
  if (!answered) lines.push(unavailableLine(row));
  else for (const input of row.inputs) if (input.last_capture) lines.push(`Last Capture of ${input.key}: ${instantWords(input.last_capture)}.`);
  return { answered, basis: null, lines };
}

const month = (day: string, by: number): string => {
  const at = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + by;
  return `${String(Math.floor(at / 12)).padStart(4, "0")}-${String((at % 12) + 1).padStart(2, "0")}`;
};

export type ClaimPageOptions = {
  /** The site's own address with its base path and no trailing slash. */
  address?: string;
  /** Only a test passes one: the page asks the committed register otherwise. */
  gate?: Gate;
  /** User notes, already read. The caller reads none unless the build and the Release are both local (lib/notes.ts). */
  notes?: readonly UserNote[];
};

export function claimPageView(release: OpenedRelease, surface: Surface, id: string, options: ClaimPageOptions = {}): ClaimPageView | null {
  if (!isClaimId(id)) return null;
  const claim = release.claims.claims.find((c) => c.id === id);
  if (!claim) return null;
  const entries = new Map(release.catalog.series.map((entry) => [entry.key, entry]));
  const found = claimEvidence(release, surface, claim, "display", options.gate);
  const lock = found.state === "held" ? found.lock : null;
  const latest = found.state === "held" && found.latest.ok ? found.latest.rows : null;
  const created = release.manifest.created;

  const readings: ReadingView[] = claim.readings.map((reading, index) => {
    const entry = entries.get(reading.series);
    const locked = lock?.readings.find((r) => r.id === reading.id) ?? null;
    const freq = (locked?.freq ?? reading.freq ?? entry?.freq ?? "monthly") as Frequency;
    const unit = locked?.unit ?? entry?.unit ?? null;
    const shown = unit === null ? null : shownUnit(reading.transform as TransformName, unit);
    let evidence: ReadingView["evidence"] = null;
    if (locked && lock && found.state === "held") {
      const late: LatestReading | undefined = latest?.readings.find((r) => r.id === reading.id);
      const lateRow = late?.latest ?? null;
      const then = thenInfo(locked.then);
      const now = ownStateInfo(locked.now_when_checked, `On ${dayWords(claim.checked_on)}, the day the claim was checked, in release ${lock.release.release_id}.`);
      const latestInfo: ColumnInfo = lateRow
        ? ownStateInfo(lateRow, `In this release, made ${dayWords(created.slice(0, 10))}. Computed when the release was written. It is not part of the lock.`)
        : { answered: false, basis: null, lines: [late?.refused ? `This release cannot measure it: ${sentence(late.refused.message)}` : found.latest.ok ? "This release holds no latest row for this reading." : found.latest.reason] };
      const figures = { then: then.answered ? locked.then.figures : null, now: now.answered ? locked.now_when_checked.figures : null, latest: lateRow && latestInfo.answered ? lateRow.figures : null };
      const order = names(locked.now_when_checked.figures, locked.then.figures, lateRow?.figures ?? null);
      const rows = order.map((name) => figureRow(name, reading, freq, figures));
      const windows: WindowView[] = [];
      if (locked.window) {
        windows.push({ declared: true, words: windowWords(locked.window), rows });
        locked.alternative_windows.forEach((w, i) => {
          const at = (row: EvidenceRow | null, ok: boolean): EvidenceFigure[] | null => {
            const s = ok ? row?.window_sensitivity[i] : undefined;
            return s && !s.unavailable && s.from === w.from && s.to === w.to ? s.figures : null;
          };
          const alt = { then: at(locked.then, then.answered), now: at(locked.now_when_checked, now.answered), latest: at(lateRow, latestInfo.answered) };
          windows.push({ declared: false, words: windowWords(w), rows: names(alt.now, alt.then, alt.latest, locked.now_when_checked.figures).map((name) => figureRow(name, reading, freq, alt)) });
        });
      }
      const drawn = claimDrawing({ freq, unit: shown ?? "", then: figures.then, now: figures.now });
      evidence = {
        then,
        now,
        latest: latestInfo,
        rows,
        windows: windows.length > 1 ? windows : [],
        drawing: drawn ? { svg: drawn, caption: `Drawn from the lock: ${figures.then ? "then (hollow, dashed) and " : ""}now when checked (filled).${figures.then ? "" : " The lock holds no figure for then."}` } : null,
      };
    }
    const span = locked?.window ?? reading.window ?? null;
    const labels = [reading.period, ...(reading.periods ?? [])].filter((l): l is string => typeof l === "string");
    const starts = labels.map((l) => periodBounds(freq, l)?.start).filter((s): s is string => typeof s === "string");
    const first = span?.from ?? [...starts].sort()[0];
    const last = span?.to ?? [...starts].sort().at(-1);
    const view = entry && first && last ? `s=${reading.series}&from=${month(first, -12)}&to=${month(last, 12)}` : null;
    return {
      id: reading.id,
      n: index + 1,
      series: { key: reading.series, name: entry?.name ?? reading.series, href: entry ? `/data/${reading.series}` : null },
      what: readingWords(reading, freq, unit, locked ?? undefined),
      unit: shown,
      evidence,
      explorer: view ? { today: view, then: `${view}&as_of=${encodeURIComponent(claim.said_at ?? claim.said_on)}` } : null,
    };
  });

  const newest = found.state === "none" ? null : found.listed;
  const files = (permission: "ok" | "refused") => {
    const base = `/claims/${claim.id}`;
    const record = [
      { label: "Markdown", href: `${base}.md`, note: "The page as text." },
      { label: "JSON", href: `${base}.json`, note: "The record, the locked rows and the latest rows." },
    ];
    if (found.state !== "held" && found.state !== "not_permitted") return record.map((f) => ({ ...f, note: f.label === "JSON" ? "The record." : f.note }));
    return permission === "ok"
      ? [{ label: "Evidence CSV", href: `${base}/evidence.csv`, note: "Every figure of every reading, a line each." }, ...record, { label: "Lock file", href: `${base}/lock.json`, note: "The lock as it was written, byte for byte." }]
      : [];
  };
  const redistribute = found.state === "held" || found.state === "not_permitted" ? claimEvidence(release, surface, claim, "redistribute", options.gate) : found;
  const downloads: ClaimPageView["downloads"] =
    redistribute.state === "not_permitted" ? { permitted: false, reason: sentence(`Not offered here: ${redistribute.reason}`), files: files("refused") } : { permitted: true, files: files("ok") };

  return {
    id: claim.id,
    quote: claim.quote.split(/\n\s*\n/).map((p) => p.trim().replace(/\s*\n\s*/g, " ")).filter(Boolean),
    claimant: { name: claim.claimant.name, role: claim.claimant.role, party: partyWords(claim.claimant.party), personQuery: `person=${slug(claim.claimant.name)}` },
    when: dayWords(claim.said_on),
    at: claim.said_at ? instantWords(claim.said_at) : null,
    venue: claim.venue,
    draft: claim.status === "draft",
    topics: (claim.topics ?? []).map((t) => ({ label: topicWords(t), query: `topic=${t}` })),
    sources: claim.sources.filter((s) => /^https:\/\//.test(s.url) && /^https:\/\//.test(s.archive_url)).map((s) => ({ name: s.name ?? s.url, url: s.url, archive: s.archive_url, locator: s.locator, kind: s.kind.replaceAll("_", " ") })),
    checkedOn: dayWords(claim.checked_on),
    selectionNote: claim.selection_note,
    notMeasured: [...claim.readings_not_measured],
    corrections: [...claim.corrections].sort((a, b) => (a.date < b.date ? 1 : -1)).map((c) => ({ when: dayWords(c.date), reason: c.reason })),
    evidence: {
      state: found.state,
      reason:
        found.state === "none"
          ? "No figure has been computed for this claim yet: it has no lock."
          : found.state === "absent"
            ? `${found.why} The record and where the numbers came from stay; no number is shown.`
            : found.state === "not_permitted"
              ? sentence(`Not shown here: ${found.reason}`)
              : null,
    },
    readings,
    lock: newest
      ? {
          version: newest.version,
          lockedAt: instantWords(newest.locked_at),
          release: lock?.release.release_id ?? null,
          releaseCreated: lock ? instantWords(lock.release.created) : null,
          profile: lock?.release.profile ?? null,
          semantics: lock?.semantics_version ?? null,
          fileSha256: newest.sha256 ?? null,
          recordSha256: newest.record_sha256,
          history: [...claim.locks].sort((a, b) => b.version - a.version).map((l) => ({ version: l.version, lockedAt: instantWords(l.locked_at), reason: l.reason, state: l.state.replaceAll("_", " ") })),
        }
      : null,
    release: { id: release.id, created: dayWords(created.slice(0, 10)) },
    downloads,
    notes: (options.notes ?? [])
      .filter((note) => note.about.kind === "claim" && note.about.id === claim.id)
      .map((note) => ({ user: note.user, created: dayWords(note.created), paragraphs: note.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) })),
    methodHref: "/docs/method/claims",
  };
}
