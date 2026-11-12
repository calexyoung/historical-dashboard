/**
 * Twins (PLAN sections 3 and 7): add a suffix to a series page's address and get the data behind
 * the page. `/data/{key}.csv | .json | .md` carry the values the page shows, for the same
 * question (`?transform=&freq=&agg=&start=&end=&as_of=`), from the same Query; `.metadata.json`
 * carries the Catalog's record of the Series and no value.
 *
 * `seriesTwin(release, surface, key, format, search)` answers with a status, a type and a body,
 * and nothing else: the route that serves it only copies them out. A file of values is handed
 * out, so Query is asked for the Permission to redistribute, with the Series' whole lineage; a
 * refusal is 403 with the gate's reason and no value. The metadata twin needs no Permission,
 * for the same reason the catalog page may name a Withheld Series.
 *
 * Hidden here: the four formats, the stamp of a local build, what a refusal looks like in each
 * format, the cap on bytes, and which fields of a Catalog entry leave the building (a fixed
 * selection, so nothing rides along). Node only; pure otherwise.
 */
import { SEMANTICS_VERSION, type RightsGate, type Surface } from "@macro-atlas/core";
import type { CatalogEntry } from "@macro-atlas/core/release";
import { releaseHoldsLegacy } from "../catalog";
import { citation } from "../citation";
import { csvLine, csvNote } from "../export";
import { askGate, MAX_BYTES, query, tooManyBytes, vintageTable, type QueryFailure, type SeriesAnswer } from "../query";
import type { OpenedRelease } from "../release/reader";
import { retrieved, seriesPageView, sourceWords } from "../series-page";
import { parseSeriesRequest, toQuery, type SeriesRequest } from "../series-request";
import { asOfLines, shownAs, shownUnit } from "../series-words";
import { TWIN_FORMATS, type TwinFormat } from "./address";

export { TWIN_FORMATS, twinOf, type TwinFormat } from "./address";

export type TwinResponse = {
  status: 200 | 308 | 400 | 403 | 404 | 422 | 503;
  contentType: string;
  body: string;
  /** The name a browser saves the file under. On a local build it carries the stamp. */
  filename?: string;
  /** Whether a browser should save the file (`attachment`) or may show it. */
  disposition?: "attachment" | "inline";
  /** For 308: the permanent address, without the base path. */
  location?: string;
  /** Whether a cache may keep it for a short while. Never a refusal, never anything but production. */
  cacheable: boolean;
};

export type TwinOptions = {
  /** The site's own address with its base path and no trailing slash, as the reader wrote it. */
  address: string;
  /** See `QueryOptions.gate`: only a test passes one. */
  gate?: Pick<RightsGate, "permits">;
  maxBytes?: number;
};

const TYPES: Record<TwinFormat, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  "metadata.json": "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};
const STAMP = "NOT FOR PUBLICATION";
const localNote = (release: OpenedRelease): string =>
  releaseHoldsLegacy(release) ? "Local build · v1 data via FRED and Yahoo · rights not settled · do not redistribute" : "Local build · do not redistribute";

const json = (doc: unknown): string => JSON.stringify(doc, null, 1) + "\n";
const sentence = (text: string): string => `${text}${/[.!?]$/.test(text) ? "" : "."}`;

/** The fields of a Source that a file names. A Channel's endpoint and how it signs in stay behind. */
function sourceOf(entry: CatalogEntry) {
  const { origin, channel } = entry.source;
  return {
    origin: { producer: origin.producer, dataset: origin.dataset, origin_id: origin.origin_id, url: origin.url },
    channel: { via: channel.via, adapter: channel.adapter ?? null },
  };
}
function rightsOf(entry: CatalogEntry) {
  const { rights } = entry;
  return { status: rights.status, owner: rights.owner, attribution: rights.attribution ?? null, terms_url: rights.terms_url ?? null, reviewed: rights.reviewed ?? null };
}

export function seriesTwin(release: OpenedRelease, surface: Surface, key: string, format: TwinFormat, search: URLSearchParams, options: TwinOptions): TwinResponse {
  const isJson = format === "json" || format === "metadata.json";
  const refuse = (status: TwinResponse["status"], code: string, message: string): TwinResponse => ({
    status,
    contentType: isJson ? TYPES.json : "text/plain; charset=utf-8",
    body: isJson ? json({ error: { status, code, message }, release_id: release.id, semantics_version: SEMANTICS_VERSION }) : `${sentence(message)}\n`,
    cacheable: false,
  });
  const failed = (failure: QueryFailure): TwinResponse => refuse(failure.status, failure.code, failure.message);
  const within = (body: string, more: Omit<TwinResponse, "body" | "status" | "cacheable" | "contentType"> = {}): TwinResponse => {
    const over = tooManyBytes(body, options.maxBytes ?? MAX_BYTES);
    return over ? failed(over) : { status: 200, contentType: TYPES[format], body, cacheable: surface === "production", ...more };
  };

  if (!(TWIN_FORMATS as readonly string[]).includes(format)) return refuse(404, "unknown_format", `there is no ${String(format).slice(0, 20)} twin`);
  const parsed = parseSeriesRequest(search, true);
  if (!parsed.ok) return refuse(400, "bad_request", parsed.message);
  const tail = parsed.search ? `?${parsed.search}` : "";
  const entry = typeof key === "string" ? release.catalog.series.find((e) => e.key === key) : undefined;
  if (!entry) {
    const aliased = release.catalog.series.find((e) => e.aliases?.includes(key));
    if (!aliased) return refuse(404, "unknown_series", `there is no series called ${String(key).slice(0, 64)} in this release`);
    const location = `/data/${aliased.key}.${format}${tail}`;
    return { status: 308, contentType: "text/plain; charset=utf-8", body: `This series is now called ${aliased.key}.\n`, location, cacheable: false };
  }
  const { address } = options;
  const page = `${address}/data/${entry.key}`;
  const stamped = surface === "local";

  if (format === "metadata.json") return within(json(metadata(release, surface, entry, address, options.gate)), { filename: `macro-atlas_${entry.key}.metadata.json`, disposition: "inline" });

  const answer = query(release, surface, toQuery(parsed.request, entry.key, "redistribute"), { gate: options.gate });
  if (!answer.ok) return failed(answer);
  const series = answer.series[0]!;
  if (!series.result.ok) return refuse(400, series.result.reason, `${series.result.message}`);
  const observations = series.result.observations;
  const evidence = new Map((series.vintage?.evidence ?? []).map((e) => [e.period, e]));
  const unit = shownUnit(parsed.request.transform, series.unit);
  const shown = shownAs(parsed.request, series);
  const when = series.vintage ? asOfLines(series.vintage) : [];
  const cite = citation(release, entry, page, parsed.request.as_of);
  const got = retrieved(release, entry);
  const name = `macro-atlas_${entry.key}${stamped ? "_not-for-publication" : ""}`;

  if (format === "csv") {
    const head = [
      csvNote(`Macro Atlas${stamped ? ` · ${STAMP}` : ""}`),
      ...(stamped ? [csvNote(localNote(release))] : []),
      csvNote(`Release ${release.id} · engine semantics ${SEMANTICS_VERSION}`),
      csvNote(`Series: ${entry.name} (${entry.key}) · ${unit} · ${series.answered_freq.replace("_", " ")}`),
      ...(shown ? [csvNote(`Shown as: ${shown}`)] : []),
      ...when.map(csvNote),
      csvNote(`Source: ${sourceWords(entry)}${got ? ` · ${got.line}` : ""}`),
      csvNote(`Rights: ${entry.rights.status}${entry.rights.attribution ? ` · ${entry.rights.attribution}` : ""}`),
      csvNote(`Cite as: ${cite}`),
      csvNote(`This file: ${page}.csv${tail}`),
    ];
    const rows = observations.map((o) => csvLine([entry.key, o.period, o.period_start, o.period_end, o.value, o.status, evidence.get(o.period)?.basis ?? null, o.empty && o.empty !== "missing" ? o.empty : null]));
    const body = [...head, csvLine(["series", "period", "period_start", "period_end", "value", "status", "basis", "note"]), ...rows].join("\n") + "\n";
    return within(body, { filename: `${name}.csv`, disposition: "attachment" });
  }

  if (format === "json") {
    const { vintage } = series;
    const doc = {
      ...(stamped ? { notice: `${STAMP} · ${localNote(release)}` } : {}),
      key: entry.key,
      name: entry.name,
      description: entry.description ?? null,
      unit,
      frequency: series.answered_freq,
      native_frequency: series.freq,
      release_id: answer.release_id,
      semantics_version: answer.semantics_version,
      request: parsed.request,
      transform: { name: parsed.request.transform, ...("reference" in series.result && series.result.reference ? { reference: series.result.reference } : {}) },
      aggregated: series.aggregated,
      as_of: vintage?.as_of ?? null,
      basis: vintage?.basis ?? null,
      ...(vintage
        ? {
            ...(vintage.reason ? { reason: vintage.reason } : {}),
            cutoff: vintage.cutoff,
            capture_gap: vintage.capture_gap,
            same_day_release: vintage.same_day_release,
            metadata_in_force: vintage.metadata,
            left_out_periods: vintage.left_out_periods,
            ...(vintage.inputs ? { inputs: vintage.inputs } : {}),
          }
        : {}),
      provenance: {
        ...sourceOf(entry),
        representation: entry.representation,
        retrieved: release.manifest.sources?.find((s) => s.producer === entry.source.origin.producer && s.via === entry.source.channel.via)?.fetched ?? null,
        ...(entry.recipe ? { recipe: { op: entry.recipe.op, inputs: entry.recipe.inputs } } : {}),
      },
      rights: { ...rightsOf(entry), permission: "redistribute", lineage: answer.rights_used.map(({ origin, dataset, channel }) => ({ origin, dataset, channel })) },
      citation: cite,
      address: page,
      observations: observations.map((o) => {
        const e = evidence.get(o.period);
        return {
          period: o.period,
          period_start: o.period_start,
          period_end: o.period_end,
          value: o.value,
          status: o.status,
          ...(o.empty && o.empty !== "missing" ? { empty: o.empty } : {}),
          ...(e ? { basis: e.basis, known_from: e.known_from, known_by: e.known_by, last_checked: e.last_checked } : {}),
        };
      }),
    };
    return within(json(doc), { filename: `${name}.json`, disposition: "inline" });
  }

  return within(markdown(release, surface, entry, series, parsed.request, search, { ...options, unit, shown, when, cite, page, tail, stamped }), { filename: `${name}.md`, disposition: "inline" });
}

/** The Catalog's record of one Series, as a fixed selection, and no value. */
function metadata(release: OpenedRelease, surface: Surface, entry: CatalogEntry, address: string, gate: TwinOptions["gate"]) {
  const withheld = release.manifest.withheld.find((row) => row.key === entry.key);
  const display = askGate(release, surface, [entry.key], "display", { gate });
  const hand = askGate(release, surface, [entry.key], "redistribute", { gate });
  const state = withheld ? "withheld" : display.ok ? "shown" : "not_permitted";
  const file = display.ok ? (release.series[entry.key] ?? release.derived[entry.key]) : undefined;
  const history = display.ok ? vintageTable(release, surface, entry.key, { gate }) : null;
  const page = `${address}/data/${entry.key}`;
  return {
    key: entry.key,
    name: entry.name,
    description: entry.description ?? null,
    definition: entry.definition ? { population: entry.definition.population ?? null, geography: entry.definition.geography ?? null, denominator: entry.definition.denominator ?? null } : null,
    unit: entry.unit,
    unit_kind: entry.unit_kind ?? null,
    measure_kind: entry.measure_kind,
    frequency: entry.freq,
    continuity: entry.continuity,
    agg: entry.agg ?? null,
    seasonal_adjustment: entry.seasonal_adjustment ?? null,
    price_basis: entry.price_basis ?? null,
    base_period: entry.base_period ?? null,
    country: entry.country ?? null,
    segment: entry.segment,
    topics: entry.topics ?? [],
    aliases: entry.aliases ?? [],
    max_lag: entry.max_lag ?? null,
    representation: entry.representation,
    allowed_transforms: entry.allowed_transforms ?? null,
    recipe: entry.recipe ? { op: entry.recipe.op, inputs: entry.recipe.inputs } : null,
    breaks: (entry.breaks ?? []).map((b) => ({ period: b.period, note: b.note })),
    source: sourceOf(entry),
    rights: rightsOf(entry),
    /** Whether this build shows the Series, and why not when it does not. */
    state,
    reason: withheld?.reason ?? (display.ok ? null : display.message),
    downloads: { permitted: hand.ok, reason: hand.ok ? null : hand.message },
    coverage: file
      ? { first_period: file.observations[0]?.period ?? null, last_period: file.observations.at(-1)?.period ?? null, periods: file.observations.length }
      : null,
    history: history && history.ok && history.held ? { captures: history.captures.count, first_capture: history.captures.first, last_capture: history.captures.last, revised_periods: history.revised_periods.length } : null,
    release_id: release.id,
    semantics_version: SEMANTICS_VERSION,
    address: page,
    twins: { csv: `${page}.csv`, json: `${page}.json`, markdown: `${page}.md`, metadata: `${page}.metadata.json` },
  };
}

/**
 * Text from a Release (a name, a description, a note), written so that Markdown and anything
 * that renders it take it as text: no markup, no link, no heading, no table cell of its own.
 * A Catalog is not written by readers, but a file is opened by people who did not write it.
 */
const md = (text: string | number | null | undefined): string =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]#|])/g, "\\$1");
const cell = md;

/** The page in Markdown: the same facts, in the same order, with the values as a table. */
function markdown(
  release: OpenedRelease,
  surface: Surface,
  entry: CatalogEntry,
  series: SeriesAnswer,
  request: SeriesRequest,
  search: URLSearchParams,
  o: TwinOptions & { unit: string; shown: string | null; when: string[]; cite: string; page: string; tail: string; stamped: boolean },
): string {
  const found = seriesPageView(release, surface, entry.key, { search, address: o.address, gate: o.gate });
  const view = found.kind === "page" ? found.view : null;
  const out: string[] = [`# ${md(entry.name)}`, ""];
  if (o.stamped) out.push(`> ${STAMP} · ${localNote(release)}`, "");
  if (entry.description) out.push(md(entry.description), "");
  out.push(`- Series key: \`${entry.key}\``, `- Unit: ${md(o.unit)}`, `- Frequency: ${series.answered_freq.replace("_", " ")}`);
  if (o.shown) out.push(`- Shown as: ${md(o.shown)}`);
  if (view?.latest) out.push(`- ${view.latest.label}: ${md(view.latest.value)} (${md(view.latest.period)}${view.latest.states.map((s) => `, ${s.word.toLowerCase()}`).join("")})`);
  out.push(`- Release: ${release.id} · engine semantics ${SEMANTICS_VERSION}`, "");
  if (o.when.length > 0) out.push("## As of", "", ...o.when.map((line) => `- ${md(line)}`), "");
  if (view) {
    out.push("## Definition", "", ...view.facts.map((f) => `- ${md(f.label)}: ${md(f.value)}`), "");
    const p = view.provenance;
    out.push("## Provenance", "");
    for (const [title, facts] of [["Origin", p.origin], ["Channel", p.channel], ["Rights", p.rights], ["Release", p.release]] as const) {
      out.push(...facts.map((f) => `- ${title} · ${md(f.label)}: ${md(f.value)}`));
    }
    if (p.lineage) out.push(`- ${md(p.lineage.text)} ${p.lineage.inputs.map((i) => `${md(i.name)} (\`${i.key}\`)`).join(", ")}`);
    out.push("");
    if (view.notes.length > 0) out.push("## Breaks and notes", "", ...view.notes.map((n) => `- ${n.kind}, ${md(n.period)}: ${md(n.text)}`), "");
  }
  const rows = series.result.ok ? series.result.observations : [];
  out.push("## Values", "", `${md(entry.name)}, ${md(o.unit)}.`, "", "| Period | Value | Status |", "|---|---|---|");
  for (const r of rows) out.push(`| ${cell(r.period)} | ${r.value ?? ""} | ${cell(r.status)} |`);
  if (rows.length === 0) out.push("", "No observation.");
  // The citation holds the page's address, which is this site's own; the rest of it is text.
  const [citedText, citedAddress] = o.cite.endsWith(o.page) ? [o.cite.slice(0, -o.page.length), o.page] : [o.cite, ""];
  out.push("", "## Cite and download", "", `${md(citedText)} ${citedAddress}`.trim(), "", `- CSV: ${o.page}.csv${o.tail}`, `- JSON: ${o.page}.json${o.tail}`, `- Metadata: ${o.page}.metadata.json`, `- Page: ${o.page}${o.tail}`, "");
  return out.join("\n");
}
