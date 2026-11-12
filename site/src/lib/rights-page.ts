/**
 * `/docs/rights` (PLAN section 3 and M25): the rights register as a page. One row for each
 * Origin and each intermediary Channel: the terms that were read and when, the licence class,
 * the attribution, what was proposed and what has been decided. A row with no decision permits
 * nothing on a public Surface. The page states the register; it grants nothing and the gate
 * does not read it (`@macro-atlas/core` reads its own copy of the same table).
 */
import { RIGHTS } from "./catalog";
import { dayWords } from "./figure/words";
import { RIGHTS_ROWS, type RightsRow } from "./rights-rows.generated";

const GRANTS = [
  ["display", "display"],
  ["redistribute", "redistribute"],
  ["store", "store"],
  ["ml_use", "use in machine learning"],
] as const;
export const GRANT_MEANINGS: [string, string][] = [
  ["Display", "Show the values on a public page."],
  ["Redistribute", "Hand them out as a file: a download, a twin of a page, the read API, the bulk files."],
  ["Store", "Keep what the source serves in the capture store."],
  ["Use in machine learning", "Describe them as usable for training a model."],
];
const HOW: Record<string, string> = { page: "read {date}", extract: "read {date}, as extracts", attested: "read {date}", not_read: "not read" };

function grants(of: { display: boolean; redistribute: boolean; store: boolean; ml_use: boolean }): string {
  const yes = GRANTS.filter(([key]) => of[key]).map(([, word]) => word);
  return yes.length === GRANTS.length ? "All four" : yes.length > 0 ? `${yes[0]!.charAt(0).toUpperCase()}${yes.join(", ").slice(1)}` : "Nothing";
}

export type RightsPageRow = {
  id: string;
  name: string;
  kind: string;
  licence: string;
  attribution: string | null;
  terms: { url: string | null; text: string; read: string }[];
  proposed: string;
  /** "Not decided", or what the decision allows. */
  decided: string;
  /** The day the decision was signed, in words; null when there is none. */
  signed: string | null;
  /** What follows on a public Surface, in a sentence. */
  effect: string;
};
export type RightsPageView = { version: string; signed: number; total: number; cleared: string[]; origins: RightsPageRow[]; channels: RightsPageRow[] };

function rowOf(row: RightsRow, cleared: readonly string[]): RightsPageRow {
  const d = row.decision;
  let effect: string;
  if (d === null) effect = "Not decided: nothing from it is shown or handed out on a public build.";
  else if (row.kind === "channel" && !cleared.includes(row.id)) effect = "Decided, but the channel is not cleared: nothing that came through it is shown on a public build.";
  else if (d.display && d.redistribute) effect = "Its values may be shown and handed out as files.";
  else if (d.display) effect = "Its values may be shown. They are in no download, twin, API answer or bulk file.";
  else effect = "Its values are not shown on a public build.";
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "origin" ? "Origin" : "Channel",
    licence: RIGHTS[row.licence_class] ?? row.licence_class,
    attribution: row.attribution,
    terms: row.terms.map((t) => ({ url: /^https:\/\//.test(t.url) ? t.url : null, text: t.url.replace(/^https:\/\//, ""), read: (HOW[t.how] ?? "read {date}").replace("{date}", t.read_on ? dayWords(t.read_on) : "") .trim() })),
    proposed: grants(row.proposal),
    decided: d === null ? "Not decided" : grants(d),
    signed: d === null ? null : dayWords(d.signed_on),
    effect,
  };
}

export function rightsPageView(): RightsPageView {
  const rows = RIGHTS_ROWS.rows.map((row) => rowOf(row, RIGHTS_ROWS.cleared));
  return {
    version: RIGHTS_ROWS.version,
    signed: RIGHTS_ROWS.rows.filter((row) => row.decision !== null).length,
    total: rows.length,
    cleared: RIGHTS_ROWS.cleared,
    origins: rows.filter((row) => row.kind === "Origin"),
    channels: rows.filter((row) => row.kind === "Channel"),
  };
}
