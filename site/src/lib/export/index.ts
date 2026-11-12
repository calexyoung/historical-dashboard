/**
 * Export (PLAN M5 and 4.2): a view of the Explorer as a file. One function, and it asks the
 * rights gate before it makes anything.
 *
 * `exportView(release, surface, state, format)` answers with a file (name, type, body) or with a
 * refusal that carries no data. It asks the gate for the Permission to redistribute, Series by
 * Series (M18), each with its full lineage, and for an as-of view with every Origin and Channel
 * its history came through. The file holds only the Series that may be redistributed here; each
 * one left out is named in the file with the gate's reason, and where none may be, the answer is
 * 403 with that reason. On the local surface everything is allowed and the file is stamped "not
 * for publication", in its content and in its name; on any other surface the gate refuses until
 * Alex has signed the rows in the rights register (PLAN 6.1, ADR 0020).
 *
 *   csv   the values on screen: every row of the chart's table, the Series' own value beside the
 *         value as drawn
 *   svg   the chart as one standalone drawing (the browser turns it into a PNG; the picture a
 *         reader saves is made from this file and nothing else)
 *   all   every Series of the Release that may be handed out, whole (v1's "All data CSV")
 *
 * Hidden here: the gate and its lineage, the file formats, the stamp, the composition of the
 * drawing. Node only (it takes an opened Release); pure otherwise.
 */
import { SEMANTICS_VERSION, type RightsGate, type RightsUse, type Surface } from "@macro-atlas/core";
import { releaseHoldsLegacy } from "../catalog";
import type { ExplorerState } from "../explorer/state";
import { explorerView, MODE_LABELS, type ExplorerView } from "../explorer/view";
import { svgString, swatch, type SvgNode } from "../figure";
import { printColors, PRINT_COLORS, PRINT_FONT } from "../figure/print";
import { h } from "../figure/svg";
import { askGate } from "../query";
import type { OpenedRelease } from "../release/reader";
import { sourceWords } from "../series-page";
import { asOfWords, BASIS_INFO } from "../series-words";

export const EXPORT_FORMATS = ["csv", "svg", "all"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Rows in one file. v1's whole dataset is about 40,000; a request for more must be narrowed. */
export const MAX_EXPORT_ROWS = 500_000;

export type ExportFile = {
  ok: true;
  filename: string;
  contentType: string;
  body: string;
  /** Every Series the file rests on (those in it and all their inputs), and what the gate was asked. */
  series: string[];
  rightsUsed: RightsUse[];
};
export type ExportRefusal = { ok: false; status: 400 | 403 | 404 | 422; message: string };

const STAMP = "NOT FOR PUBLICATION";
const refuse = (status: ExportRefusal["status"], message: string): ExportRefusal => ({ ok: false, status, message });

/**
 * A spreadsheet runs a cell that begins with =, +, - or @ as a formula. A number is written as it
 * is; any other text that begins so is given a leading apostrophe, which a spreadsheet shows as
 * text. (Names and units come from a Release's Catalog, not from a reader, but a file is opened
 * by people who did not write the Catalog.)
 */
const FORMULA = /^[=+\-@\t\r]/;
export const csvCell = (value: string | number | null): string => {
  if (value === null) return "";
  const text = typeof value === "number" ? String(value) : FORMULA.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const cell = csvCell;
export const csvLine = (cells: (string | number | null)[]): string => cells.map(cell).join(",");
const line = csvLine;
/**
 * A comment line: one line, whatever the text holds. A spreadsheet does not know `#` and splits
 * the line at its commas like any other, so no part after a comma may begin as a formula either.
 * (The line stays a `#` line, not one quoted cell, so that `comment="#"` still skips it.)
 */
export const csvNote = (text: string): string =>
  `# ${text
    .replace(/\s+/g, " ")
    .trim()
    // No straight double quote, so nothing in the line can open a quoted cell and hide a comma.
    .replace(/"/g, "”")
    .replace(/,(\s*)(?=[=+\-@])/g, ",$1'")}`;

/** Read a CSV back into rows of cells (RFC 4180). For tests and for anything that checks a file. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') [field, i] = [field + '"', i + 1];
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") [row, field] = [[...row, field], ""];
    else if (c === "\n") {
      rows.push([...row, field]);
      [row, field] = [[], ""];
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows;
}

const note = csvNote;

export function preamble(release: OpenedRelease, stamped: boolean, lines: string[]): string[] {
  return [
    note(`Macro Atlas${stamped ? ` · ${STAMP}` : ""}`),
    ...(stamped ? [note(releaseHoldsLegacy(release) ? "Local build · v1 data via FRED and Yahoo · rights not settled · do not redistribute" : "Local build · do not redistribute")] : []),
    note(`Release ${release.id} · engine semantics ${SEMANTICS_VERSION}`),
    ...lines.map(note),
  ];
}

/** Lines of at most `width` characters, broken at spaces. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (current !== "" && current.length + 1 + word.length > width) {
      out.push(current);
      current = word;
    } else current = current === "" ? word : `${current} ${word}`;
  }
  if (current !== "") out.push(current);
  return out;
}

/** The whole chart as one drawing that needs nothing from the page. */
function chartSvg(view: ExplorerView, release: OpenedRelease, stamped: boolean, address: string, left: string[]): string {
  const W = 800;
  const M = 16;
  const CHAR = 7;
  const [INK, INK_2] = ["var(--color-ink)", "var(--color-ink-2)"];
  const parts: SvgNode[] = [];
  let y = M;
  const text = (content: string, attrs: Record<string, string | number> = {}) => h("text", { x: M, y, "font-size": 12, fill: INK_2, ...attrs }, content);
  const lines = (content: string, attrs: Record<string, string | number> = {}) => {
    for (const row of wrap(content, Math.floor((W - 2 * M) / CHAR))) {
      y += 16;
      parts.push(text(row, attrs));
    }
  };
  y += 6;
  parts.push(text("Macro Atlas", { "font-size": 14, "font-weight": 700, fill: INK }));
  if (stamped) parts.push(text(STAMP, { x: W - M, "text-anchor": "end", "font-size": 12, "font-weight": 700, fill: INK }));
  lines(`${view.window.words ?? ""} · ${MODE_LABELS[view.mode]}`, { fill: INK });
  if (view.asOf) lines(asOfLine(view));
  if (view.compare) lines(`Compared with ${view.compare.words}: the pale, wide lines, laid over the same axis from its left edge.`);
  y += 8;
  for (const plot of view.figure!.plots) {
    const drawing = plot.layouts.wide;
    const height = Number(drawing.attrs.height);
    parts.push({ ...drawing, attrs: { ...drawing.attrs, x: M, y } });
    y += height + 4;
    let x = M;
    y += 12;
    for (const s of plot.series) {
      const width = 38 + s.name.length * CHAR + 14;
      if (x > M && x + width > W - M) [x, y] = [M, y + 16];
      parts.push({ ...swatch(s), attrs: { ...swatch(s).attrs, x, y: y - 10 } });
      parts.push(h("text", { x: x + 38, y, "font-size": 12, fill: INK }, s.name));
      x += width;
    }
    lines(plot.unitLine);
    y += 10;
  }
  lines(view.figure!.sourceLine);
  if (left.length > 0) lines(`Not in this picture: ${left.join("; ")}`);
  lines(`Release ${release.id} · engine semantics ${SEMANTICS_VERSION} · ${address}`);
  if (stamped) lines(`${STAMP}${releaseHoldsLegacy(release) ? " · local build · v1 data via FRED and Yahoo · rights not settled" : " · local build"}`, { "font-weight": 700, fill: INK });
  const H = y + M;
  const root = h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", viewBox: `0 0 ${W} ${H}`, width: W, height: H, "font-family": PRINT_FONT, role: "img", "aria-label": `Macro Atlas chart, ${view.window.words ?? ""}` },
    h("rect", { x: 0, y: 0, width: W, height: H, fill: PRINT_COLORS["--color-panel"] }),
    ...parts,
  );
  return printColors(svgString(root));
}

const asOfLine = (view: ExplorerView): string => `As known before ${asOfWords(view.asOf!.date)}${/T/.test(view.asOf!.date) ? "" : " (00:00 in New York)"}. Basis: ${BASIS_INFO[view.asOf!.basis].word}.`;

export type ExportOptions = {
  /** The Explorer's own address, without a query. */
  address: string;
  /** The gate to ask. Left out, the gate over the committed register; only a test passes another (ADR 0031, point 12). */
  gate?: Pick<RightsGate, "permits">;
};

type Asked = { permitted: { key: string; series: string[]; rightsUsed: RightsUse[] }[]; refused: { key: string; name: string; reason: string }[] };

/** The one question, asked of each Series on its own before anything is made: may it be handed out here? */
function askEach(release: OpenedRelease, surface: string, keys: readonly string[], options: { gate?: Pick<RightsGate, "permits">; history?: boolean }): Asked {
  const names = new Map(release.catalog.series.map((e) => [e.key, e.name]));
  const out: Asked = { permitted: [], refused: [] };
  for (const key of keys) {
    const lineage = askGate(release, surface as Surface, [key], "redistribute", options);
    if (lineage.ok) out.permitted.push({ key, series: lineage.series, rightsUsed: lineage.rightsUsed });
    else out.refused.push({ key, name: names.get(key) ?? key, reason: lineage.message });
  }
  return out;
}
const merged = (asked: Asked): { series: string[]; rightsUsed: RightsUse[] } => ({
  series: [...new Set(asked.permitted.flatMap((p) => p.series))].sort(),
  rightsUsed: [...new Map(asked.permitted.flatMap((p) => p.rightsUsed).map((row) => [JSON.stringify(row), row])).values()],
});

/**
 * Whether a view of these Series could be exported on this Surface: the same question
 * `exportView` asks, for a page that must decide whether to offer the links, and which Series a
 * file would leave out.
 */
export function exportAllowed(
  release: OpenedRelease,
  surface: string,
  keys: readonly string[],
  options: { gate?: Pick<RightsGate, "permits">; /** An as-of view: the Series' past is asked about too. */ history?: boolean } = {},
): { allowed: true; leftOut: Asked["refused"] } | { allowed: false; reason: string } {
  const withheld = new Set(release.manifest.withheld.map((row) => row.key));
  const held = new Set(release.catalog.series.map((e) => e.key));
  const asked = keys.filter((k) => held.has(k) && !withheld.has(k));
  const each = askEach(release, surface, asked.length > 0 ? asked : release.catalog.series.filter((e) => !withheld.has(e.key)).map((e) => e.key), options);
  if (each.permitted.length === 0) return { allowed: false, reason: each.refused[0]?.reason ?? "no series here may be handed out" };
  return { allowed: true, leftOut: each.refused };
}

export function exportView(release: OpenedRelease, surface: string, state: ExplorerState, format: ExportFormat, options: ExportOptions): ExportFile | ExportRefusal {
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) return refuse(400, `format: one of ${EXPORT_FORMATS.join(", ")}`);
  const stamped = surface === "local";
  const tail = stamped ? "_not-for-publication" : "";
  const withheld = new Map(release.manifest.withheld.map((row) => [row.key, row.reason]));
  const { gate } = options;
  const notHere = (r: Asked["refused"][number]): string => `${r.name} (may not be redistributed here: ${r.reason})`;
  const refusedAll = (asked: Asked): ExportRefusal => refuse(403, `This cannot be exported here: ${asked.refused[0]?.reason ?? "no series here may be handed out"}.`);

  if (format === "all") {
    // The whole Release is its state today. An as-of question is not answered with today's values.
    if (state.asOf !== null) return refuse(400, "Every series as one file is the release as it is today; it has no as-of form. Take as_of off, or export the view.");
    const entries = release.catalog.series.filter((e) => !withheld.has(e.key));
    if (entries.length === 0) return refuse(422, "This release has no series that may be handed out.");
    const asked = askEach(release, surface, entries.map((e) => e.key), { gate });
    if (asked.permitted.length === 0) return refusedAll(asked);
    const may = new Set(asked.permitted.map((p) => p.key));
    const files = { ...release.series, ...release.derived };
    const rows: string[] = [];
    const inFile = entries.filter((e) => may.has(e.key));
    for (const e of inFile) {
      for (const o of files[e.key]?.observations ?? []) rows.push(line([e.key, e.name, e.unit, e.freq, o.period, o.period_start, o.period_end, o.value, o.status]));
      if (rows.length > MAX_EXPORT_ROWS) return refuse(422, `The file would hold more than ${MAX_EXPORT_ROWS} rows.`);
    }
    const left = [...release.catalog.series.filter((e) => withheld.has(e.key)).map((e) => `${e.name} (withheld: ${withheld.get(e.key)})`), ...asked.refused.map(notHere)];
    const head = preamble(release, stamped, [
      `Every series of the release ${asked.refused.length > 0 ? "that may be redistributed here" : ""}, whole: ${inFile.length} series, ${rows.length} observations, as the release holds them`.replace("  ", " ").replace(" ,", ","),
      ...[...new Set(inFile.map(sourceWords))].slice(0, 40).map((s) => `Source: ${s}`),
      ...(left.length > 0 ? [`Not in this file: ${left.join("; ")}`] : []),
    ]);
    const body = [...head, line(["series", "name", "unit", "frequency", "period", "period_start", "period_end", "value", "status"]), ...rows].join("\n") + "\n";
    return { ok: true, filename: `macro-atlas_all_${release.id}${tail}.csv`, contentType: "text/csv; charset=utf-8", body, ...merged(asked) };
  }

  // The view as the page shows it: what it selects, its window, and every address in it.
  const whole = explorerView(release, surface as Surface, { ...state, pick: false }, { gate });
  const candidates = whole.selection.filter((s) => s.state !== "withheld").map((s) => s.key);
  if (candidates.length === 0) return refuse(422, "There is nothing to export: no series that may be shown is selected.");
  const asked = askEach(release, surface, candidates, { gate, history: state.asOf !== null });
  if (asked.permitted.length === 0) return refusedAll(asked);
  // The file is the same view over the Series that may be handed out, on the view's own window.
  const may = asked.permitted.map((p) => p.key);
  const view = asked.refused.length === 0 ? whole : explorerView(release, surface as Surface, { ...state, pick: false, series: may, from: whole.resolved.from, to: whole.resolved.to }, { gate });
  if (view.figure === null || view.runs.length === 0) return refuse(422, "There is nothing to export: nothing is drawn in this view.");

  const address = `${options.address}?${whole.resolvedQuery.replace(/&(table|pick)=1/g, "")}`;
  const name = `macro-atlas_${view.mode}_${whole.resolved.from ?? "start"}_${whole.resolved.to ?? "end"}${tail}`;
  const inFile = new Set(view.runs.map((r) => r.series));
  const left = [
    ...whole.selection.filter((s) => !inFile.has(s.key) && may.includes(s.key)).map((s) => `${s.name} (not drawn: ${s.reason ?? "no value"})`),
    ...whole.selection.filter((s) => s.state === "withheld").map((s) => `${s.name} (withheld: ${s.reason ?? "no value"})`),
    ...asked.refused.map(notHere),
    ...whole.absent.map((a) => `${a.name} (not in this release: ${a.reason})`),
  ];
  if (format === "svg") {
    return { ok: true, filename: `${name}.svg`, contentType: "image/svg+xml; charset=utf-8", body: chartSvg(view, release, stamped, address, left), ...merged(asked) };
  }

  const head = preamble(release, stamped, [
    `View: ${address}`,
    `Shown as: ${MODE_LABELS[view.mode]} · ${view.window.words ?? ""}${view.compare ? ` · compared with ${view.compare.words}` : ""}`,
    ...(view.asOf ? [asOfLine(view)] : []),
    ...view.selection.filter((s) => s.combined).map((s) => `${s.name}: brought from ${s.combined!.from.replace("_", " ")} to ${s.combined!.to} by ${s.combined!.method}`),
    "value is the series' own value; shown_value is the value as drawn (shown_as names the transform)",
    ...[...new Set(view.runs.map((r) => r.source))].map((s) => `Source: ${s}`),
    ...(left.length > 0 ? [`Not in this file: ${left.join("; ")}`] : []),
  ]);
  const rows = view.runs.flatMap((r) => r.rows.map((o) => line([r.series, r.seriesName, r.run, o.period, o.period_start, o.period_end, o.value, r.unit, view.mode, o.shown, r.shownUnit, o.status === "no_answer" ? "final" : o.status])));
  const body = [...head, line(["series", "name", "run", "period", "period_start", "period_end", "value", "unit", "shown_as", "shown_value", "shown_unit", "status"]), ...rows].join("\n") + "\n";
  return { ok: true, filename: `${name}.csv`, contentType: "text/csv; charset=utf-8", body, ...merged(asked) };
}
