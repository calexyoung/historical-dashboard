/**
 * `/llms.txt` (PLAN section 7, M25): where a program that reads text finds every page of the
 * Release being served as Markdown. Generated from the Catalog and the Release's content, so
 * it lists what this Release holds and nothing else.
 *
 * Every link answers 200 here, on this Surface, today (a test follows each one). So a Series
 * whose values may not be handed out is listed by its metadata, which holds no value, and not
 * by a file that would answer 403; a Claim whose record may not be given is counted and not
 * linked. No value of any Series is in this file.
 */
import type { RightsGate, Surface } from "@macro-atlas/core";
import { FREQUENCIES } from "./catalog";
import { mdText as md } from "./markdown";
import { methodIndex } from "./method-docs";
import { mlUse } from "./ml-use";
import { askGate } from "./query";
import type { OpenedRelease } from "./release/reader";
import { claimTwin } from "./twin/claims";
import { PAGE_TWINS } from "./twin/pages";

export function llmsText(release: OpenedRelease, surface: Surface, options: { address: string; gate?: Pick<RightsGate, "permits"> }): string {
  const { address, gate } = options;
  const withheld = new Set(release.manifest.withheld.map((row) => row.key));
  const out = [
    "# Macro Atlas",
    "",
    "> Data and facts about the past and current state of the United States in a global context: series from the agencies that produce them, with where each number came from, what was known when, and what may be redistributed. The site states figures and gives no evaluation of them.",
    "",
    `This file lists release ${release.id}. Every page has a Markdown twin: add \`.md\` to its address (\`/index.md\` for the overview). A series page also has \`.csv\`, \`.json\` and \`.metadata.json\`. A file of values is given only where the rights of every series in it allow redistribution; otherwise the answer is 403 with the reason.`,
    "",
    "Redistribution is not permission to train a model. A series whose rights do not allow use in training machine-learning models says so below, on its page, in each of its files (`rights.ml_use` is false in JSON) and in the bulk files' `ml_use` column.",
    "",
    "## Pages",
    "",
    ...PAGE_TWINS.map((p) => `- [${md(p.about)}](${address}${p.twin})`),
    "",
  ];
  if (release.topics.topics.length > 0) out.push("## Topics", "", ...release.topics.topics.map((t) => `- [${md(t.title)}](${address}/topics/${t.slug}.md)`), "");

  out.push("## Series", "");
  for (const entry of release.catalog.series) {
    const given = !withheld.has(entry.key) && askGate(release, surface, [entry.key], "redistribute", { gate }).ok;
    const about = `${md(entry.unit)}, ${(FREQUENCIES[entry.freq] ?? entry.freq).toLowerCase()}`;
    const training = mlUse(release, surface, entry, { gate }).note;
    const reserved = training ? `. ${md(training)}.` : "";
    out.push(given ? `- [${md(entry.name)}](${address}/data/${entry.key}.md): ${about}${reserved}` : `- [${md(entry.name)}](${address}/data/${entry.key}.metadata.json): ${about}. ${withheld.has(entry.key) ? "Withheld" : "Its values are not handed out here"}; this is its metadata.`);
  }
  out.push("");

  const claims = release.claims.claims.filter((claim) => claimTwin(release, surface, claim.id, "md", { address, gate }).status === 200);
  if (release.claims.claims.length > 0) {
    out.push("## Claims", "", ...claims.map((claim) => `- [${md(claim.claimant.name)}, ${claim.said_on}](${address}/claims/${claim.id}.md)`));
    const kept = release.claims.claims.length - claims.length;
    if (kept > 0) out.push(`- ${kept} more ${kept === 1 ? "is" : "are"} listed at ${address}/claims.md; ${kept === 1 ? "its record is" : "their records are"} not handed out here.`);
    out.push("");
  }
  if (release.events.events.length > 0) out.push("## Events", "", ...release.events.events.map((event) => `- [${md(event.title)}](${address}/events/${event.id}.md)`), "");

  out.push("## Method", "", ...methodIndex().map((doc) => `- [${md(doc.title)}](${address}${doc.href}.md)`), "");
  out.push("## Data", "", `- [The read API: its routes](${address}/api/v1)`, `- [The catalog as JSON](${address}/api/v1/catalog.json)`, `- [Freshness of the release and of each source](${address}/api/v1/status)`);
  if (release.downloads) out.push(`- [Bulk files: the data package that names each file, its hash and its licence](${address}/downloads/${release.id}/datapackage.json)`);
  out.push("");
  return out.join("\n");
}
