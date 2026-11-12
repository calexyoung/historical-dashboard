/**
 * A Claim's twins (PLAN section 7, M21; ADR 0035): the record and its evidence as files, at the
 * page's own address with a suffix.
 *
 *   /claims/{id}.json          the record, the locked rows and the latest rows
 *   /claims/{id}.md            the page as text
 *   /claims/{id}/evidence.csv  every figure of every Reading, a line each
 *   /claims/{id}/lock.json     the lock, byte for byte as it was written
 *
 * The evidence is chosen by `claimEvidence`, the same function the page asks, so a file and its
 * page cannot hold different numbers. A file of values is handed out, so the gate is asked for
 * the Permission to redistribute, over the lineage the lock and the latest rows record. When it
 * says no, every one of the four is 403 with the reason and no figure, as a Series' twins are;
 * the page still shows the record. A Claim that has no figures to hand out (no lock yet, or a
 * lock named without its numbers) still has `.json` and `.md`, which then hold the record only.
 *
 * The latest rows are values too: when they may not be handed out, all four are refused, the
 * lock included, so that an address either gives a Claim's evidence or does not.
 *
 * `lock.json` is the file's own bytes, so the hash a Release lists for it can be checked. Nothing
 * is added to it, the stamp of a local build included: that is in the file's name.
 *
 * A User note is in none of them: this module is never given one.
 */
import { SEMANTICS_VERSION, type RightsGate, type Surface } from "@macro-atlas/core";
import type { Claim, EvidenceFigure, EvidenceRow } from "@macro-atlas/core/release";
import { releaseHoldsLegacy } from "../catalog";
import { claimEvidence, claimPageView, isClaimId, type Cell, type FigureRow } from "../claims";
import { csvLine, csvNote } from "../export";
import { MAX_BYTES, tooManyBytes } from "../query";
import type { OpenedRelease } from "../release/reader";
import { CLAIM_TWIN_FORMATS, type ClaimTwinFormat } from "./address";
import type { TwinResponse } from "./index";

export type ClaimTwinOptions = { address: string; gate?: Pick<RightsGate, "permits">; maxBytes?: number };

const TYPES: Record<ClaimTwinFormat, string> = {
  json: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  "evidence.csv": "text/csv; charset=utf-8",
  "lock.json": "application/json; charset=utf-8",
};
const STAMP = "NOT FOR PUBLICATION";
const localNote = (release: OpenedRelease): string =>
  releaseHoldsLegacy(release) ? "Local build · v1 data via FRED and Yahoo · rights not settled · do not redistribute" : "Local build · do not redistribute";
const json = (doc: unknown): string => JSON.stringify(doc, null, 1) + "\n";
const sentence = (text: string): string => `${text}${/[.!?]$/.test(text) ? "" : "."}`;
const md = (text: string | number | null | undefined): string =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]#|~])/g, "\\$1")
    .replace(/^([-+>=]|\d+[.)])/, "\\$1");
/** An address in Markdown: nothing in it can open a tag, a link, emphasis or a table cell. */
const mdUrl = (url: string): string => url.replace(/[^A-Za-z0-9\-._~:/?#@!$&+,;=%]/gu, (c) => encodeURIComponent(c)).replace(/[()'*_]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The fields of a Claim's record that a file names: a fixed selection, so nothing rides along. */
export function recordOf(claim: Claim) {
  return {
    id: claim.id,
    status: claim.status,
    claimant: { name: claim.claimant.name, role: claim.claimant.role, party: claim.claimant.party },
    said_on: claim.said_on,
    said_at: claim.said_at ?? null,
    venue: claim.venue,
    quote: claim.quote,
    sources: claim.sources.map((s) => ({ name: s.name ?? null, url: s.url, archive_url: s.archive_url, locator: s.locator, kind: s.kind })),
    readings: claim.readings,
    readings_not_measured: claim.readings_not_measured,
    selection_note: claim.selection_note,
    checked_on: claim.checked_on,
    corrections: claim.corrections.map((c) => ({ date: c.date, reason: c.reason })),
    topics: claim.topics ?? [],
    locks: claim.locks.map((l) => ({ version: l.version, locked_at: l.locked_at, reason: l.reason, state: l.state, record_sha256: l.record_sha256, sha256: l.sha256 ?? null, why: l.why ?? null })),
  };
}

export function claimTwin(release: OpenedRelease, surface: Surface, id: string, format: ClaimTwinFormat, options: ClaimTwinOptions): TwinResponse {
  const isJson = format === "json" || format === "lock.json";
  const refuse = (status: TwinResponse["status"], code: string, message: string): TwinResponse => ({
    status,
    contentType: isJson ? TYPES.json : "text/plain; charset=utf-8",
    body: isJson ? json({ error: { status, code, message }, release_id: release.id, semantics_version: SEMANTICS_VERSION }) : `${sentence(message)}\n`,
    cacheable: false,
  });
  if (!(CLAIM_TWIN_FORMATS as readonly string[]).includes(format)) return refuse(404, "unknown_format", `there is no ${String(format).slice(0, 20)} twin`);
  const claim = isClaimId(id) ? release.claims.claims.find((c) => c.id === id) : undefined;
  if (!claim) return refuse(404, "unknown_claim", `there is no claim called ${String(id).slice(0, 120)} in this release`);

  const found = claimEvidence(release, surface, claim, "redistribute", options.gate);
  if (found.state === "not_permitted") return refuse(403, "not_permitted", found.reason);
  const held = found.state === "held" ? found : null;
  const stamped = surface === "local";
  const name = `macro-atlas_claim_${claim.id}${stamped ? "_not-for-publication" : ""}`;
  const page = `${options.address}/claims/${claim.id}`;
  const within = (body: string, filename: string, disposition: "attachment" | "inline"): TwinResponse => {
    const over = tooManyBytes(body, options.maxBytes ?? MAX_BYTES);
    return over ? refuse(over.status, over.code, over.message) : { status: 200, contentType: TYPES[format], body, cacheable: surface === "production", filename, disposition };
  };
  const noEvidence = (): TwinResponse =>
    refuse(404, "no_evidence", found.state === "none" ? "this claim has no lock, so there is no evidence to hand out" : found.state === "absent" ? found.why : "this claim has no evidence in this release");

  if (format === "lock.json") return held ? within(held.text, `${name}.v${held.listed.version}.lock.json`, "attachment") : noEvidence();

  const latest = held && held.latest.ok ? held.latest.rows : null;

  if (format === "evidence.csv") {
    if (!held) return noEvidence();
    const lock = held.lock;
    const head = [
      csvNote(`Macro Atlas${stamped ? ` · ${STAMP}` : ""}`),
      ...(stamped ? [csvNote(localNote(release))] : []),
      csvNote(`Claim ${claim.id} · ${claim.claimant.name}, ${claim.said_on}`),
      csvNote(`then and now_when_checked: lock version ${lock.version}, locked ${lock.locked_at}, computed on release ${lock.release.release_id}, engine semantics ${lock.semantics_version}`),
      csvNote(`latest: release ${release.id}, engine semantics ${SEMANTICS_VERSION}; not part of the lock`),
      csvNote("A figure is a number the Measure returned, or empty with the reason. No column holds a finding."),
      csvNote(`This file: ${page}/evidence.csv`),
    ];
    const lines: string[] = [];
    for (const reading of lock.readings) {
      const late = latest?.readings.find((r) => r.id === reading.id)?.latest ?? null;
      const states: [string, EvidenceRow | null][] = [["then", reading.then], ["now_when_checked", reading.now_when_checked], ["latest", late]];
      for (const [state, row] of states) {
        if (!row) continue;
        const releaseId = state === "latest" ? release.id : row.release_id;
        const put = (window: { from: string; to: string } | null, declared: boolean, figures: EvidenceFigure[], unavailable: string | null) => {
          const lead = [claim.id, lock.version, reading.id, reading.series, reading.freq, reading.transform, reading.measure, state, row.as_of, row.basis, releaseId, window?.from ?? null, window?.to ?? null, window ? (declared ? "declared" : "alternative") : null, row.unit];
          if (unavailable !== null) lines.push(csvLine([...lead, null, null, null, null, null, unavailable]));
          for (const f of figures) lines.push(csvLine([...lead, f.name, f.value, f.period ?? null, f.status ?? null, f.empty ?? null, null]));
        };
        put(reading.window ? { from: reading.window.from, to: reading.window.to } : null, true, row.unavailable ? [] : row.figures, row.unavailable ? row.unavailable.reason : null);
        for (const s of row.unavailable ? [] : row.window_sensitivity) put({ from: s.from, to: s.to }, false, s.unavailable ? [] : s.figures, s.unavailable ? s.unavailable.reason : null);
      }
    }
    const columns = ["claim", "lock_version", "reading", "series", "freq", "transform", "measure", "state", "as_of", "basis", "release_id", "window_from", "window_to", "window", "unit", "figure", "value", "period", "status", "empty", "unavailable"];
    return within([...head, csvLine(columns), ...lines].join("\n") + "\n", `${name}_evidence.csv`, "attachment");
  }

  const state = found.state === "held" ? "held" : found.state;
  const why = found.state === "none" ? "This claim has no lock: no figure has been computed for it." : found.state === "absent" ? found.why : null;

  if (format === "json") {
    const doc = {
      ...(stamped ? { notice: `${STAMP} · ${localNote(release)}` } : {}),
      claim: recordOf(claim),
      evidence_state: state,
      ...(why ? { evidence_reason: why } : {}),
      evidence: held
        ? {
            lock_version: held.lock.version,
            locked_at: held.lock.locked_at,
            lock_release: held.lock.release,
            lock_semantics_version: held.lock.semantics_version,
            rights_used: held.lock.rights_used,
            readings: held.lock.readings.map((reading) => {
              const late = latest?.readings.find((r) => r.id === reading.id);
              return { ...reading, latest: late?.latest ?? null, latest_refused: late?.refused ?? null };
            }),
          }
        : null,
      release_id: release.id,
      semantics_version: SEMANTICS_VERSION,
      address: page,
      twins: { json: `${page}.json`, markdown: `${page}.md`, ...(held ? { evidence_csv: `${page}/evidence.csv`, lock: `${page}/lock.json` } : {}) },
    };
    return within(json(doc), `${name}.json`, "inline");
  }

  // Markdown: the page's own view of the same evidence (both Permissions have been asked by now).
  const view = claimPageView(release, surface, claim.id, { address: options.address, gate: options.gate })!;
  const cellText = (c: Cell): string => (c.kind === "value" ? `${c.exact}${c.period ? ` (${md(c.period)}${c.state ? `, ${c.state.word.toLowerCase()}` : ""})` : ""}` : c.kind === "empty" ? md(c.why) : "No figure");
  const table = (rows: FigureRow[], lead: (row: FigureRow, i: number) => string[] = () => []): string[] => rows.map((row, i) => `| ${[...lead(row, i), md(row.label), cellText(row.then), cellText(row.now), cellText(row.latest)].join(" | ")} |`);
  const out: string[] = [`# ${md(claim.claimant.name)}, ${md(view.when)}`, ""];
  if (stamped) out.push(`> ${STAMP} · ${localNote(release)}`, "");
  out.push(...view.quote.map((p) => `> ${md(p)}`), "");
  out.push(`- Claimant: ${md(claim.claimant.name)}, ${md(claim.claimant.role)} · ${md(view.claimant.party)}`, `- Said on: ${claim.said_on}${claim.said_at ? ` (${claim.said_at})` : ""}`, `- Venue: ${md(claim.venue)}`);
  if (view.draft) out.push("- Status: draft");
  out.push(`- Checked on: ${claim.checked_on}`, `- Release: ${release.id} · engine semantics ${SEMANTICS_VERSION}`, "", "## Sources", "");
  for (const s of view.sources) out.push(`- ${md(s.name)} (${md(s.kind)}, ${md(s.locator)}): ${mdUrl(s.url)} · archived copy: ${mdUrl(s.archive)}`);
  out.push("");
  if (view.evidence.reason) out.push(md(view.evidence.reason), "");
  for (const reading of view.readings) {
    out.push(`## Reading ${reading.n}`, "", `${md(reading.series.name)} (\`${reading.series.key}\`). ${md(reading.what)}${reading.unit ? ` Unit: ${md(reading.unit)}.` : ""}`, "");
    const e = reading.evidence;
    if (!e) continue;
    out.push("| Figure | Then | Now when checked | Latest |", "|---|---|---|---|", ...table(e.rows), "");
    out.push(`- Then: ${e.then.basis ? `Basis: ${md(e.then.basis.replace("_", " "))}. ` : ""}${md(e.then.lines.join(" "))}`, `- Now when checked: ${md(e.now.lines.join(" "))}`, `- Latest: ${md(e.latest.lines.join(" "))}`, "");
    if (e.windows.length > 0) {
      out.push("### Window sensitivity", "", "| Window | Figure | Then | Now when checked | Latest |", "|---|---|---|---|---|");
      for (const w of e.windows) out.push(...table(w.rows, () => [`${md(w.words)}${w.declared ? "" : " (alternative)"}`]));
      out.push("");
    }
  }
  out.push("## Readings not measured", "", ...(view.notMeasured.length > 0 ? view.notMeasured.map((l) => `- ${md(l)}`) : ["The record lists none."]), "", "## Why this statement was recorded", "", md(view.selectionNote), "");
  out.push("## Correction log", "", ...(claim.corrections.length > 0 ? claim.corrections.map((c) => `- ${c.date}: ${md(c.reason)}`) : ["No correction has been made."]), "");
  if (view.lock) {
    out.push("## Lock", "", `- Version ${view.lock.version}, locked ${md(view.lock.lockedAt)}`);
    if (view.lock.release) out.push(`- Computed on release ${view.lock.release} (${view.lock.profile} profile), engine semantics ${view.lock.semantics}`);
    if (view.lock.fileSha256) out.push(`- File SHA-256: ${view.lock.fileSha256}`);
    out.push(`- Record SHA-256: ${view.lock.recordSha256}`, "");
  }
  out.push("## Files", "", `- Page: ${page}`, `- JSON: ${page}.json`, ...(held ? [`- Evidence CSV: ${page}/evidence.csv`, `- Lock file: ${page}/lock.json`] : []), "");
  return within(out.join("\n"), `${name}.md`, "inline");
}
