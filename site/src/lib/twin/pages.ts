/**
 * The Markdown twin of a page (PLAN section 3: "every page has a `.md` twin"; M25; ADR 0039):
 * `/highlights.md`, `/topics/{slug}.md`, `/docs/rights.md`, and `/index.md` for the Overview.
 * A series page and a claim page have twins of their own (`index.ts`, `claims.ts`).
 *
 * `pageTwin` builds each from the function the page itself is drawn from, so the page and its
 * twin cannot say different things. One thing differs, and it is deliberate: a twin is a file
 * that leaves the site, so every value in it is asked for under the Permission to
 * **redistribute**, where the page asks for display. It is asked row by row: the view is given
 * `fileGate`, which puts the question "may this be redistributed?" to the same register
 * wherever the view would have asked "may this be displayed?". A Series that may be shown and
 * not handed out is therefore in the twin by name, with the reason and no value, as a Withheld
 * Series is on its page. (A series page's twin is refused whole instead: it has one Series.)
 *
 * On the local Surface a twin that holds a value is stamped "not for publication", as every
 * file of values is. Text from a Release is written as text (`mdText`).
 *
 * Node only (it takes an opened Release); pure otherwise.
 */
import { permits, SEMANTICS_VERSION, type RightsGate, type Surface } from "@macro-atlas/core";
import { apiDocsView } from "../api/docs";
import { catalogView, parseCatalogFilters } from "../catalog";
import { claimsIndexView, parseClaimFilters } from "../claims";
import { downloadsView, type DownloadRow } from "../downloads";
import { categoryLabel, eventPageView, eventsIndexView, parseEventFilters } from "../events";
import { parseExplorerParams } from "../explorer/state";
import { exportView, parseCsv } from "../export";
import { GLOSSARY, GLOSSARY_GROUPS, glossaryEntry } from "../glossary";
import { highlightsView, overviewView, type HeadlineRow } from "../highlights";
import { mdText as md } from "../markdown";
import { mlUseOf } from "../ml-use";
import { methodDoc, methodIndex } from "../method-docs";
import { tooManyBytes } from "../query";
import type { OpenedRelease } from "../release/reader";
import { GRANT_MEANINGS, rightsPageView, type RightsPageRow } from "../rights-page";
import { parseSearch, search as searchRelease, PAGE_HITS } from "../search";
import { topicPageView, topicsIndexView, type SeriesRef } from "../topics";
import { localNote, STAMP, type TwinOptions, type TwinResponse } from "./index";

type Gate = Pick<RightsGate, "permits">;

/**
 * The gate a file is made under: the same register, asked for `redistribute` whatever
 * Permission the caller named. It can only refuse more than the gate it wraps.
 */
export const fileGate = (inner?: Gate): Gate => ({
  permits: (rows, surface) => {
    const asked = rows.map((row) => ({ ...row, permission: "redistribute" as const }));
    return inner ? inner.permits(asked, surface) : permits(asked, surface);
  },
});

const MARKDOWN = "text/markdown; charset=utf-8";
const sentence = (text: string): string => `${text}${/[.!?]$/.test(text) ? "" : "."}`;
const record = (search: URLSearchParams): Record<string, string | string[]> => {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(search.keys())) {
    const all = search.getAll(key);
    out[key] = all.length === 1 ? all[0]! : all;
  }
  return out;
};

type Made = { title: string; /** The title line as it is to be written, where it is Markdown already. */ heading?: string; body: string[]; /** Whether a value of a Series is in it. */ values: boolean } | { status: 400 | 403 | 404; message: string };

/** Every page that has a twin here, for the index a reader or an agent starts from. */
export const PAGE_TWINS: readonly { page: string; twin: string; about: string }[] = [
  { page: "/", twin: "/index.md", about: "Overview: one headline series for each segment" },
  { page: "/highlights", twin: "/highlights.md", about: "Highlights: each headline series with its change over one, five and ten years" },
  { page: "/topics", twin: "/topics.md", about: "Topics" },
  { page: "/claims", twin: "/claims.md", about: "Claims: public statements set beside data, with no finding" },
  { page: "/events", twin: "/events.md", about: "Events" },
  { page: "/data", twin: "/data.md", about: "Catalog: every series, with its source and rights" },
  { page: "/explore", twin: "/explore.md", about: "Explorer: a view of chosen series, as a table" },
  { page: "/search", twin: "/search.md", about: "Search" },
  { page: "/downloads", twin: "/downloads.md", about: "Bulk files of the release" },
  { page: "/docs/method", twin: "/docs/method.md", about: "Method: how the figures are made" },
  { page: "/docs/api", twin: "/docs/api.md", about: "The read API" },
  { page: "/docs/rights", twin: "/docs/rights.md", about: "Rights: the register of sources and what each permits" },
  { page: "/docs/glossary", twin: "/docs/glossary.md", about: "Glossary" },
];

export function pageTwin(release: OpenedRelease, surface: Surface, page: string, search: URLSearchParams, options: TwinOptions): TwinResponse {
  const refuse = (status: TwinResponse["status"], message: string): TwinResponse => ({ status, contentType: "text/plain; charset=utf-8", body: `${sentence(message)}\n`, cacheable: false });
  const gate = fileGate(options.gate);
  const { address } = options;
  const at = (href: string | null): string => (href === null ? "" : `${address}${href}`);
  const link = (text: string, href: string | null): string => (href === null ? md(text) : `[${md(text)}](${at(href)})`);
  const query = search.toString() ? `?${search.toString()}` : "";

  const made = build();
  if ("status" in made) return refuse(made.status, made.message);
  const stamped = surface === "local" && made.values;
  const slug = page === "/" ? "overview" : page.slice(1).replace(/[^a-z0-9]+/g, "-");
  const text = [
    made.heading ?? `# ${md(made.title)}`,
    "",
    ...(stamped ? [`> ${STAMP} · ${localNote(release)}`, ""] : []),
    ...made.body,
    "",
    "---",
    "",
    `- Page: ${address}${page === "/" ? "/" : page}${query}`,
    `- Release: ${release.id} · engine semantics ${SEMANTICS_VERSION}`,
    `- Every page of Macro Atlas in Markdown: ${address}/llms.txt`,
    "",
  ].join("\n");
  const over = tooManyBytes(text, options.maxBytes);
  if (over) return refuse(over.status, over.message);
  return { status: 200, contentType: MARKDOWN, body: text, filename: `macro-atlas_${slug}${stamped ? "_not-for-publication" : ""}.md`, disposition: "inline", cacheable: surface === "production" };

  // --- one function per page ------------------------------------------------------------------

  function headline(row: HeadlineRow): string[] {
    if (row.state !== "shown") return [`- ${link(row.name, row.href)}: no value here. ${md(sentence(row.reason))}`];
    const marks = row.marks.map((m) => `, ${m.word.toLowerCase()}`).join("");
    const out = [`- ${link(row.name, row.href)}: ${row.latest ? `${md(row.latest.words)}${marks}` : "no value"}`];
    for (const cell of row.cells ?? []) {
      const span = cell.years === 1 ? "1 year" : `${cell.years} years`;
      out.push(`  - ${span}: ${cell.figure ? `${md(cell.figure.words)} (${md(cell.earlier ?? "")} in ${md(cell.periodWords ?? cell.period)})` : md(sentence(cell.reason ?? cell.state?.word ?? "no figure"))}`);
    }
    if (row.cells === null && row.reason) out.push(`  - ${md(sentence(row.reason))}`);
    if (row.compared) out.push(`  - ${md(row.compared)}`);
    out.push(...training(row.key));
    return out;
  }
  /** Under a Series whose value is in the file: the sentence, where it is not for model training (ADR 0041). */
  function training(key: string): string[] {
    const note = mlUseOf(release, surface, key, { gate: options.gate })?.note;
    return note ? [`  - ${md(sentence(note))}`] : [];
  }
  function ref(s: SeriesRef, extra = ""): string {
    return `- ${link(s.name, s.href)}${extra}${s.state === "shown" ? "" : `: no value here. ${md(sentence(s.note ?? "It is not shown"))}`}`;
  }

  function build(): Made {
    if (page === "/") {
      const view = overviewView(release, surface, { gate });
      const body = [`Data and facts about the past and current state of the United States in a global context. This release was made on ${md(view.release)}.`, ""];
      for (const segment of view.segments) {
        body.push(`## ${md(segment.label)}`, "");
        if (segment.row) body.push(...headline(segment.row));
        else body.push("This release names no headline series for this segment.");
        body.push(`- ${link(segment.more > 0 ? `${segment.more} more in Highlights; every series of the segment` : "Every series of the segment", segment.href)}`, "");
      }
      body.push("## Pages", "", ...PAGE_TWINS.filter((p) => p.page !== "/").map((p) => `- [${p.about}](${at(p.twin)})`));
      return { title: "Macro Atlas", body, values: true };
    }
    if (page === "/highlights") {
      const view = highlightsView(release, surface, { gate });
      const body = ["Each headline series with its latest value and how that differs from the same period one, five and ten years earlier. A series measured in percent changes by percentage points; any other by a percent of the earlier value.", ""];
      if (view.total === 0) body.push("This release names no headline series.");
      for (const segment of view.segments.filter((s) => s.rows.length > 0)) body.push(`## ${md(segment.label)}`, "", ...segment.rows.flatMap(headline), "");
      return { title: "Highlights", body, values: true };
    }
    if (page === "/topics") {
      const view = topicsIndexView(release, surface, { gate });
      const body = view.topics.length === 0 ? ["This release holds no topic."] : view.topics.flatMap((t) => [`## ${link(t.title, t.href)}${t.draft ? " (draft)" : ""}`, "", `> ${md(t.quote)}`, "", `- Definition from: ${md(t.source)}`, `- Main series: ${link(t.main.name, t.main.href)}`, `- Markdown: ${at(t.href)}.md`, ""]);
      return { title: "Topics", body, values: false };
    }
    if (page.startsWith("/topics/")) {
      const view = topicPageView(release, surface, page.slice("/topics/".length), { gate });
      if (!view) return { status: 404, message: "There is no such topic in this release" };
      const cite = view.definition.source;
      const body = [`> ${md(view.definition.quote)}`, "", `Definition from ${md(cite.name)}: ${cite.url}${cite.archive ? ` (archived: ${cite.archive})` : cite.noArchive ? ` (no archived copy: ${md(cite.noArchive)})` : ""}`, "", `- Segment: ${link(view.segment.label, view.segment.href)}`, ""];
      body.push("## Main series", "");
      if ("latest" in view.main || view.main.state !== "not_in_release") body.push(...headline(view.main as HeadlineRow));
      else body.push(ref(view.main));
      if (view.figure?.takeaway) body.push("", md(view.figure.takeaway));
      if (view.figure) body.push("", md(view.figure.sourceLine));
      if (view.window) body.push("", `Every figure on the page spans ${md(view.window)}.`);
      if (view.companions.items.length > 0) body.push("", "## What else moved", "", ...view.companions.items.map((c) => ref(c, ` (${md(c.relation)})`)));
      if (view.range) {
        const r = view.range;
        body.push("", `## Against the ${md(r.label)} range`, "", `${md(r.indicator)}. ${r.shown} of ${r.of} members can be shown and compared here.`, "");
        if (r.sentence) body.push(md(r.sentence), "");
        if (r.reason) body.push(md(sentence(r.reason)), "");
        body.push(...r.caption.map((line) => md(line)), "");
        if (r.rows.length > 0) body.push("| Period | Members counted | Lowest | Median | Highest |", "|---|---|---|---|---|", ...r.rows.map((row) => `| ${md(row.label)} | ${row.n} | ${md(row.minimum ?? "")} | ${md(row.median ?? "")} | ${md(row.maximum ?? "")} |`), "");
        body.push("Members:", "", ...r.members.flatMap((m) => [ref(m, ` (${md(m.country)}${m.counted ? "" : ", not counted"})`), ...(m.counted ? training(m.key) : [])]));
      }
      if (view.claims.length > 0) body.push("", "## Claims", "", ...view.claims.map((c) => `- ${link(c.title, c.href)}${c.draft ? " (draft)" : ""}: “${md(c.quote)}”`));
      if (view.events.length > 0) body.push("", "## Events", "", ...view.events.map((e) => `- ${md(e.when)}: ${link(e.title, e.href)}${e.draft ? " (draft)" : ""}`));
      body.push("", "## Series", "", ...view.series.map((s) => ref(s)));
      return { title: `${view.title}${view.draft ? " (draft)" : ""}`, body, values: true };
    }
    if (page === "/claims") {
      const view = claimsIndexView(release, parseClaimFilters(record(search)));
      const body = ["Public statements by officials, candidates and named commentators, each kept as a record and set beside the data. Macro Atlas computes the figures and gives no finding, rating or label.", "", `${view.shown} of ${view.total} listed.${view.note ? ` ${md(view.note)}` : ""}`, ""];
      if (view.byParty.length > 0) body.push(`Recorded, by party: ${view.byParty.map((p) => `${md(p.party)} ${p.count}`).join(", ")}.`, "");
      for (const row of view.rows) body.push(`## ${link(`${row.name}, ${row.when}`, row.href)}${row.draft ? " (draft)" : ""}`, "", `> ${md(row.quote)}`, "", `- ${md(row.role)} · ${md(row.party)}`, `- Readings: ${row.readings}`, `- Record and figures: ${at(row.href)}.md`, "");
      if (view.corrections.length > 0) body.push("## Corrections", "", ...view.corrections.map((c) => `- ${md(c.when)}, ${link(c.who, c.href)}: ${md(c.reason)}`), "");
      body.push(`How a claim record is built: ${at("/docs/method/claims")}.md`);
      return { title: "Claims", body, values: false };
    }
    if (page === "/events") {
      const view = eventsIndexView(release, parseEventFilters(record(search)));
      const body = [`${view.shown} of ${view.total} events.${view.note ? ` ${md(view.note)}` : ""}`, ""];
      for (const group of view.groups) body.push(`## ${md(group.year)}`, "", ...group.rows.map((row) => `- ${md(row.when)} · ${md(categoryLabel(row.category))}: ${link(row.title, row.href)}${row.draft ? " (draft)" : ""}`), "");
      return { title: "Events", body, values: false };
    }
    if (page.startsWith("/events/")) {
      const view = eventPageView(release, surface, page.slice("/events/".length));
      if (!view) return { status: 404, message: "There is no such event in this release" };
      const body = [`- When: ${md(view.when)}`, `- Category: ${md(categoryLabel(view.category))}`, ""];
      body.push(...(view.description.length > 0 ? view.description.flatMap((p) => [md(p), ""]) : ["No description has been written.", ""]));
      if (view.sources.length > 0) body.push("## Sources", "", ...view.sources.map((s) => `- ${s.name ? `${md(s.name)}: ` : ""}${s.url}${s.archive ? ` (archived: ${s.archive})` : s.noArchive ? ` (no archived copy: ${md(s.noArchive)})` : ""}`), "");
      if (view.related.length > 0) body.push("## Related series", "", ...view.related.map((r) => `- ${link(r.name, r.href)}${r.state ? `: ${md(r.state)}` : ""}`), "");
      return { title: `${view.title}${view.draft ? " (draft)" : ""}`, body, values: false };
    }
    if (page === "/data") {
      const view = catalogView(release, surface, parseCatalogFilters(record(search)), { gate });
      const body = [`${view.rows.length} of ${view.total} series${view.active ? ", as the address narrows them" : ""}. A latest value is given only where the series may be handed out here.`, "", "| Series | Key | Unit | Frequency | Coverage | Latest | Origin | Rights |", "|---|---|---|---|---|---|---|---|"];
      for (const row of view.rows) {
        const latest = row.state === "shown" ? (row.latest ? `${md(row.latest.text)} (${md(row.latest.period)})` : "No value") : md(sentence(`${row.state === "withheld" ? "Withheld" : "Not handed out here"}: ${row.reason ?? ""}`));
        const note = mlUseOf(release, surface, row.key, { gate: options.gate })?.note;
        body.push(`| ${link(row.name, `/data/${row.key}`)} | \`${row.key}\` | ${md(row.unit)} | ${md(row.frequency)} | ${row.first && row.last ? `${md(row.first)} to ${md(row.last)}` : ""} | ${latest} | ${md(row.origin)} | ${md(row.rights)}${note ? `. ${md(sentence(note))}` : ""} |`);
      }
      body.push("", `Each series' own page has twins: add \`.md\`, \`.csv\`, \`.json\` or \`.metadata.json\` to its address.`);
      return { title: "Catalog", body, values: true };
    }
    if (page === "/search") {
      const q = parseSearch(search);
      const answer = searchRelease(release, surface, q, { limit: PAGE_HITS, gate });
      const body = answer.asked ? [`${answer.total} found for “${md(answer.q)}”.`, ""] : ["Add `?q=` and the words to look for: a series, a topic, an event, a claim or a term of the glossary.", ""];
      for (const group of answer.groups.filter((g) => g.hits.length > 0)) {
        body.push(`## ${md(group.label)} (${group.total})`, "", ...group.hits.map((hit) => `- ${link(hit.title, hit.href)}${hit.held ? ` (${hit.held === "withheld" ? "withheld" : "not shown here"})` : ""}${hit.detail ? `: ${md(hit.detail)}` : ""}`), "");
      }
      return { title: "Search", body, values: false };
    }
    if (page === "/explore") {
      const file = exportView(release, surface, parseExplorerParams(search), "csv", { address: `${address}/explore`, gate: options.gate });
      if (!file.ok) {
        if (file.status !== 422) return { status: file.status === 403 ? 403 : 400, message: file.message };
        return { title: "Explorer", body: [md(file.message), "", "The Explorer draws chosen series on one time axis. Its address is the view: `?s=` and the series' keys, `from` and `to` as months, `mode` for the transform, `as_of` for what was known before a date. This file is the same view as a table."], values: false };
      }
      const lines = parseCsv(file.body);
      const notes = lines.filter((line) => line[0]?.startsWith("# ")).map((line) => line.join(",").slice(2));
      const table = lines.filter((line) => !line[0]?.startsWith("# "));
      const body = [...notes.filter((n) => !n.startsWith("Macro Atlas") && !n.startsWith("Local build")).map((n) => `- ${md(n)}`), ""];
      const head = table[0] ?? [];
      body.push(`| ${head.map((h) => md(h)).join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...table.slice(1).map((row) => `| ${row.map((c) => md(c)).join(" | ")} |`));
      return { title: "Explorer", body, values: true };
    }
    if (page === "/downloads") {
      const view = downloadsView(release, surface, { gate: options.gate });
      const body: string[] = [];
      if (view.none) body.push(md(view.none), "", `Each series' own values are at its page's address with \`.csv\`, \`.json\` or \`.md\`: ${at("/data")}.md`);
      else {
        const rows = (list: DownloadRow[]): string[] => ["| File | Format | Rows | Series | Size | SHA-256 | Usable for ML, as the file marks its rows |", "|---|---|---|---|---|---|---|", ...list.map((f) => `| ${f.refused ? `${md(f.name)} (${md(f.refused)})` : `[${md(f.name)}](${at(f.href)})`} | ${f.format} | ${f.rows} | ${f.series} | ${f.size} | \`${f.sha256}\` | ${f.refused ? "Not handed out here" : f.mlUse === null ? "Not recorded" : f.mlUse ? "Every row" : "Not every row"} |`)];
        body.push(`Every series of release ${view.release} that may be redistributed, at its native frequency and not rounded: ${view.counts.observations} observations of ${view.counts.series} series, and ${view.counts.versions} versions held of ${view.counts.withHistory} of them.`, "", ...rows(view.whole), "", `- Data package (Frictionless v2), with every file's size, hash and licence: ${at(view.datapackage)}`, `- The newest release's files are always at ${at("/downloads/latest/")}{file}`, "");
        for (const group of view.byLicence) body.push(`## ${md(group.label)}`, "", ...group.attributions.map((a) => `- ${md(a)}`), ...group.terms.map((t) => `- Terms: ${t}`), ...group.notForMl.map((s) => `- ${link(s.name, `/data/${s.key}`)}: ${md(sentence(s.reason))}`), "", ...rows(group.rows), "");
        if (view.mlUseNotRecorded) body.push("## Not for training machine-learning models", "", "These files were written before a release recorded whether its series may be used to train a model. Nothing here says that they may.", "");
        else if (view.notForMl.length > 0) body.push("## Not for training machine-learning models", "", "These series are in the files and may be redistributed. Every row of them is marked false in the `ml_use` column.", "", ...view.notForMl.map((s) => `- ${link(s.name, `/data/${s.key}`)}: ${md(sentence(s.reason))}`), "");
        if (view.leftOut.length > 0) body.push("## Published, and in no bulk file", "", ...view.leftOut.map((s) => `- ${link(s.name, `/data/${s.key}`)}: ${md(sentence(s.reason))}`), "");
      }
      if (view.withheld.length > 0) body.push("", "## Withheld", "", ...view.withheld.map((s) => `- ${link(s.name, `/data/${s.key}`)}: ${md(sentence(s.reason))}`));
      return { title: "Bulk files", body, values: false };
    }
    if (page === "/docs/method") {
      const entries = methodIndex();
      const body = ["How Macro Atlas makes its figures. The first page is written for a reader of the site. The others are the repository's own method documents: the contracts the code is tested from, with the commands that run it.", ""];
      body.push(...entries.map((e) => `- [${md(e.title)}](${at(e.href)}.md)${e.kind === "reader" ? "" : ` (contract)`}: ${md(e.summary.length > 220 ? `${e.summary.slice(0, 217)}…` : e.summary)}`));
      return { title: "Method", body, values: false };
    }
    if (page.startsWith("/docs/method/")) {
      const doc = methodDoc(page.slice("/docs/method/".length));
      if (!doc) return { status: 404, message: "There is no such method page" };
      // The document itself, as it is in the repository: the page is drawn from this text.
      return { title: doc.title, heading: `# ${doc.title}`, body: [doc.text.replace(/^# .*\n/, "").trim()], values: false };
    }
    if (page === "/docs/api") {
      const view = apiDocsView(release, surface, address, options.gate);
      const table = (head: [string, string], rows: [string, string][]): string[] => [`| ${head[0]} | ${head[1]} |`, "|---|---|", ...rows.map(([a, b]) => `| ${md(a)} | ${md(b)} |`), ""];
      const body = [`The read API is at ${view.root}. It answers from the release being served, with the same Query the pages and their files use. Every answer is JSON.`, "", "## Routes", "", "| Route | What it gives | Parameters | Example |", "|---|---|---|---|", ...view.routes.map((r) => `| \`${r.path}\` | ${md(r.about)} | ${md(r.parameters)} | ${r.example} |`), ""];
      body.push("## Parameters of a series", "", ...table(["Parameter", "Means"], view.seriesParameters), "## Other parameters", "", ...table(["Parameter", "Means"], view.otherParameters));
      body.push("## What every answer carries", "", ...table(["Field", "What it is"], view.fields), "## Errors", "", ...table(["Status", "When"], view.errors), "## Limits", "", ...table(["", ""], view.limits));
      body.push("## Try it", "", "```", ...view.curl, "```");
      if (view.example && !view.example.given) body.push("", "On this build no series is handed out, so a request for values answers 403 with the reason.");
      return { title: "The read API", body, values: false };
    }
    if (page === "/docs/rights") {
      const view = rightsPageView();
      const row = (r: RightsPageRow): string[] => [
        `### ${md(r.name)}`,
        "",
        `- Licence class: ${md(r.licence)}`,
        ...(r.attribution ? [`- Attribution: ${md(r.attribution)}`] : []),
        ...r.terms.map((t) => `- Terms: ${t.url ?? md(t.text)} (${md(t.read)})`),
        `- Proposed: ${md(r.proposed)}`,
        `- Decision: ${md(r.decided)}${r.signed ? `, signed ${md(r.signed)}` : ""}`,
        `- ${md(r.effect)}`,
        "",
      ];
      const body = [
        `Every series comes from an origin, and every origin has a row here: the terms that were read, the licence class, the attribution, what was proposed and what has been decided. A value is shown or handed out on a public build only where a signed row allows it. Register version ${md(view.version)}: ${view.signed} of ${view.total} rows are signed.`,
        "",
        "## What a decision allows",
        "",
        ...GRANT_MEANINGS.map(([name, text]) => `- ${name}: ${text}`),
        "",
        "A row that is not decided allows nothing. A value that came through an intermediary channel needs that channel's row as well as its origin's, and the channel cleared by name. A series computed from others needs every one of them allowed.",
        "",
        "## Origins",
        "",
        ...view.origins.flatMap(row),
        "## Intermediary channels",
        "",
        ...view.channels.flatMap(row),
      ];
      return { title: "Rights", body, values: false };
    }
    if (page === "/docs/glossary") {
      const body = GLOSSARY_GROUPS.flatMap((group) => [`## ${group}`, "", ...GLOSSARY.filter((e) => e.group === group).map((e) => `- [${md(e.term)}](${at(`/docs/glossary/${e.slug}`)}.md): ${md(e.definition)}`), ""]);
      return { title: "Glossary", body, values: false };
    }
    if (page.startsWith("/docs/glossary/")) {
      const entry = glossaryEntry(page.slice("/docs/glossary/".length));
      if (!entry) return { status: 404, message: "There is no such entry in the glossary" };
      const see = (entry.see ?? []).map((slug) => glossaryEntry(slug)).filter((e) => e !== null);
      return { title: entry.term, body: [md(entry.definition), "", `- Group: ${entry.group}`, ...(see.length > 0 ? [`- See also: ${see.map((e) => `[${md(e.term)}](${at(`/docs/glossary/${e.slug}`)}.md)`).join(", ")}`] : []), `- Glossary: ${at("/docs/glossary")}.md`], values: false };
    }
    return { status: 404, message: "That page has no Markdown twin" };
  }
}
