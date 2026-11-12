/**
 * Claim pages and the Claims index (PLAN section 3 and M21), on the synthetic fixture release and
 * on copies of it changed in memory. Everything invented.
 */
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { createRightsGate } from "@macro-atlas/core";
import type { Claim } from "@macro-atlas/core/release";
import { ClaimPage } from "@/components/ClaimPage";
import { ClaimsIndex } from "@/components/ClaimsIndex";
import { claimEvidence, claimPageView, claimsIndexView, parseClaimFilters, type ClaimPageOptions } from "./claims";
import { notesAllowed, notesFor, parseNote } from "./notes";
import { createReleaseReader, type OpenedRelease } from "./release/reader";
import { addRelease, FIXTURE_ROOT, fixtureRegister, promote, tempRoot } from "./release/testing";
import { createHash } from "node:crypto";
import { parseCsv } from "./export";
import { claimTwin } from "./twin/claims";


const CLAIM = "2025-12-11-a-fixture-official-on-fixture-prices";

let fixture: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  fixture = opened.release;
});

describe("the reader opens a Release's Claims, locks and latest Evidence rows", () => {
  it("holds the Claim, its lock (parsed, and as the bytes written) and its latest rows", () => {
    expect(fixture.claims.claims.map((c) => c.id)).toEqual([CLAIM]);
    const lock = fixture.locks[`${CLAIM}.v1`]!;
    expect(lock.parsed.readings[0]!.then.figures[0]).toMatchObject({ name: "value", value: 109.5 });
    expect(JSON.parse(lock.text)).toEqual(lock.parsed);
    expect(fixture.latest?.claims[0]?.readings[0]?.latest?.figures[0]).toMatchObject({ value: 109.3 });
  });

  it("a Release written before there were Claims has none", async () => {
    const root = tempRoot();
    addRelease(root, { id: "20260201T000000Z-aaaaaaa", schema: "0.2.0" });
    promote(root, "20260201T000000Z-aaaaaaa");
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    expect(opened).toMatchObject({ ok: true, release: { claims: { claims: [] }, locks: {}, latest: null } });
  });
});

const BASE = "/macro-atlas";
const LOCK = `${CLAIM}.v1`;
const copy = (): OpenedRelease => structuredClone(fixture);
function page(release: OpenedRelease, surface: "local" | "production" = "local", options: ClaimPageOptions = {}) {
  const view = claimPageView(release, surface, CLAIM, options);
  if (!view) throw new Error("no such claim");
  return { view, html: renderToStaticMarkup(<ClaimPage view={view} basePath={BASE} />) };
}
/** The cells of one state, in page order: `data-cell="then"` and so on. */
const cells = (html: string, state: "then" | "now" | "latest"): string[] => [...html.matchAll(new RegExp(`<td class="n" data-cell="${state}">(.*?)</td>`, "g"))].map((m) => m[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|’/g, "'").replace(/\s+/g, " ");

describe("a Claim's page (PLAN section 3, M21)", () => {
  it("states the record: the quote, who said it, when and where, and each source with its archived copy", () => {
    const { view, html } = page(fixture);
    expect(view.quote).toEqual(["The fixture price index stood at 109.5 in November, up about five percent since January."]);
    expect(view.claimant).toMatchObject({ name: "A. Fixture", party: "No party" });
    expect(text(html)).toContain("A. Fixture, 11 December 2025");
    expect(html).toContain('href="https://video.example.org/fixture-briefing"');
    expect(html).toContain('href="https://example.org/archive/2026/fixture-briefing"');
    expect(text(html)).toContain("recording · at 12:40");
    expect(text(html)).toContain("The index with fixture food and fuel left out.");
    expect(text(html)).toContain("Kept in the fixture so that a Claim, its lock and its latest rows can be read in tests.");
    expect(text(html)).toContain("The venue was first entered without its city (synthetic).");
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("the page's heading comes before any section heading: who said it and when, then the sections", () => {
    const { html } = page(fixture);
    const headings = [...html.matchAll(/<(h[1-6])[^>]*>(.*?)<\/\1>/g)].map((m) => [m[1], m[2]!.replace(/<[^>]+>/g, "").trim()]);
    expect(headings[0]).toEqual(["h1", "A. Fixture, 11 December 2025"]);
    expect(headings.slice(1).every(([level]) => level !== "h1")).toBe(true);
    expect(headings.some(([level, words]) => level === "h2" && words === "Claim")).toBe(false);
    // The panel is still named by its label, which is no longer a heading.
    expect(html).toMatch(/<section id="claim" aria-labelledby="claim-title"[^>]*><header[^>]*><p id="claim-title"[^>]*>Claim<\/p>/);
  });

  it("says what each Reading measures, as a sentence that names the computation", () => {
    const { view } = page(fixture);
    expect(view.readings.map((r) => r.what)).toEqual([
      "The value in November 2025.",
      "The change from January 2025 to November 2025.",
      "The value in November 2025.",
    ]);
    expect(view.readings[2]).toMatchObject({ series: { name: "Fixture price index, change from a year earlier", href: "/data/fx_price_index_yoy" }, unit: "percent change from a year earlier" });
  });

  it("shows then and now when checked from the lock, latest from the release, each figure with its Period and Data state", () => {
    const { view, html } = page(fixture);
    const first = view.readings[0]!.evidence!;
    expect(first.rows[0]).toMatchObject({
      label: "Value",
      then: { kind: "value", text: "109.5", period: "Nov 2025", state: { mark: "preliminary", word: "Preliminary" } },
      now: { kind: "value", text: "109.3", state: null },
      latest: { kind: "value", text: "109.3" },
    });
    expect(first.then).toMatchObject({ answered: true, basis: "atlas_observed" });
    expect(html).toMatch(/data-origin="then".*?data-basis="atlas_observed"/s);
    expect(text(html)).toContain("As known before 11 December 2025 (00:00 in New York).");
    expect(text(html)).toContain("On 31 December 2025, the day the claim was checked, in release 20260101T000000Z-0000000.");
    expect(text(html)).toContain("It is not part of the lock.");
    const change = view.readings[1]!.evidence!.rows.map((r) => [r.name, r.then.kind === "value" && r.then.text, r.now.kind === "value" && r.now.text]);
    expect(change).toEqual([["start", "105", "105"], ["end", "109.5", "109.3"], ["change", "4.5", "4.3"], ["pct_change", "4.29", "4.10"]]);
  });

  it("AC: swapping the lock changes the then and now-when-checked rows and the Window sensitivity table, and nothing else", () => {
    const before = page(fixture).html;
    const swapped = copy();
    const lock = swapped.locks[LOCK]!.parsed;
    lock.readings[0]!.then.figures[0]!.value = 222.5;
    lock.readings[0]!.now_when_checked.figures[0]!.value = 333.5;
    lock.readings[1]!.then.window_sensitivity[0]!.figures[2]!.value = 44.5;
    lock.readings[1]!.now_when_checked.window_sensitivity[1]!.figures[2]!.value = 55.5;
    const after = page(swapped).html;
    expect(cells(before, "then")[0]).toContain("109.5");
    expect(cells(after, "then")[0]).toContain("222.5");
    expect(cells(after, "now")[0]).toContain("333.5");
    const sensitivity = (html: string) => /data-sensitivity="rise-since-january".*?<\/table>/s.exec(html)![0];
    expect(cells(sensitivity(after), "then").join("|")).toContain("44.5");
    expect(cells(sensitivity(after), "now").join("|")).toContain("55.5");
    expect(cells(sensitivity(before), "then").join("|")).not.toContain("44.5");
    // The latest cells do not come from the lock: not one of them moved.
    expect(cells(after, "latest")).toEqual(cells(before, "latest"));
  });

  it("AC: changing the release's latest rows changes only the latest cells, which are marked as the release's", () => {
    const before = page(fixture).html;
    const changed = copy();
    const reading = changed.latest!.claims[0]!.readings[1]!.latest!;
    reading.figures[1]!.value = 777.7;
    reading.window_sensitivity[0]!.figures[1]!.value = 888.8;
    changed.latest!.claims[0]!.readings[0]!.latest!.figures[0]!.value = 9.25; // more decimals than the locked figures have
    const after = page(changed).html;
    expect(cells(after, "latest").join("|")).toMatch(/9\.25.*777\.7.*888\.8/);
    expect(cells(before, "latest").join("|")).not.toMatch(/9\.25|777\.7|888\.8/);
    expect(cells(after, "then")).toEqual(cells(before, "then"));
    expect(cells(after, "now")).toEqual(cells(before, "now"));
    // Outside the latest cells the two pages are the same page.
    const withoutLatest = (html: string) => html.replace(/<td class="n" data-cell="latest">.*?<\/td>/g, "");
    expect(withoutLatest(after)).toBe(withoutLatest(before));
    expect(/data-origin="latest".*?<\/dd>/s.exec(after)![0]).toContain("In this release, made 1 January 2026.");
  });

  it("the drawing is of the lock's two rows and of nothing else", () => {
    const { view, html } = page(fixture);
    const drawing = view.readings[1]!.evidence!.drawing!;
    expect(drawing.svg.attrs["aria-label"]).toBe("Then: 105 in Jan 2025, 109.5 in Nov 2025. Now when checked: 105 in Jan 2025, 109.3 in Nov 2025. index, 2024-01 = 100.");
    expect(html.match(/data-point="then"/g)).toHaveLength(4);
    expect(html.match(/data-point="now"/g)).toHaveLength(4);
    const changed = copy();
    changed.latest!.claims[0]!.readings[1]!.latest!.figures[1]!.value = 777.7;
    expect(page(changed).view.readings[1]!.evidence!.drawing).toEqual(drawing);
  });

  it("a then row that cannot be answered says why and holds no figure; today's never stands in", () => {
    const release = copy();
    const then = release.locks[LOCK]!.parsed.readings[0]!.then;
    Object.assign(then, { basis: "unavailable", unavailable: { reason: "no_coverage", message: "no coverage before the cutoff" }, figures: [], unit: null });
    const { view, html } = page(release);
    const evidence = view.readings[0]!.evidence!;
    expect(evidence.then).toMatchObject({ answered: false, basis: "unavailable" });
    expect(evidence.rows[0]!.then).toEqual({ kind: "none" });
    expect(evidence.rows[0]!.now).toMatchObject({ kind: "value", text: "109.3" });
    expect(cells(html, "then")[0]).toBe("No figure");
    expect(text(html)).toContain("No answer: that is before Macro Atlas first fetched this series");
    expect(text(html)).toContain("No figure from a later time is shown in its place.");
    expect(html).toMatch(/data-origin="then".*?data-basis="unavailable"/s);
  });

  it("a then row held under another unit says so, and is not put on the drawing's one axis", () => {
    const release = copy();
    release.locks[LOCK]!.parsed.readings[0]!.then.unit = "index, 2019-01 = 100";
    const { view } = page(release);
    const evidence = view.readings[0]!.evidence!;
    expect(evidence.then.lines.at(-1)).toBe("For this row the series was held in another unit: index, 2019-01 = 100.");
    expect(evidence.now.lines.join(" ")).not.toContain("another unit");
    expect(evidence.drawing!.svg.attrs["aria-label"]).toBe("Then: no figure. Now when checked: 109.3 in Nov 2025. index, 2024-01 = 100.");
    expect(evidence.drawing!.caption).toContain("Then is in another unit and is not drawn.");
    expect(evidence.rows[0]!.then).toMatchObject({ kind: "value", text: "109.5" });
  });

  it("an empty figure says why", () => {
    const release = copy();
    const figures = release.locks[LOCK]!.parsed.readings[1]!.then.figures;
    Object.assign(figures[3] ?? {}, { value: null, empty: "start_not_positive" });
    if (!figures[3]) figures.push({ name: "pct_change", value: null, empty: "start_not_positive" });
    expect(page(release).view.readings[1]!.evidence!.rows.find((r) => r.name === "pct_change")!.then).toEqual({ kind: "empty", why: "Not computed: the start is zero or below" });
  });

  it("never falls back to an older lock: a newest lock named without its numbers shows none, though version 1 is in the release", () => {
    const release = copy();
    const claim = release.claims.claims[0]!;
    (claim.locks as unknown[]).push({ version: 2, locked_at: "2026-02-01T00:00:00Z", reason: "A source moved (synthetic).", record_sha256: claim.locks[0]!.record_sha256, state: "withdrawn", why: "the gate no longer permits what its numbers came through" });
    expect(claimEvidence(release, "local", claim, "display")).toMatchObject({ state: "absent", listed: { version: 2 } });
    const { view, html } = page(release);
    expect(view.evidence).toMatchObject({ state: "absent" });
    expect(view.readings.every((r) => r.evidence === null)).toBe(true);
    expect(html).not.toMatch(/109\.3|4\.5|data-cell/);
    expect(text(html)).toContain("Its numbers are withdrawn: the gate no longer permits what its numbers came through");
    expect(text(html)).toContain("Version 2");
    expect(text(html)).toContain("Recorded afresh: A source moved (synthetic).");
    expect(html).not.toContain("evidence.csv");
    expect(html).not.toContain("lock.json");
  });

  it("asks the rights gate about the lineage the lock records: a denial leaves the record and shows no figure", () => {
    const { view, html } = page(fixture, "production");
    expect(view.evidence.state).toBe("not_permitted");
    expect(text(html)).toContain("Not shown here: the rights register row for Macro Atlas fixture (synthetic)");
    expect(text(html)).toContain("The fixture price index stood at 109.5 in November");
    expect(html).not.toMatch(/data-cell|109\.3|data-claim-drawing/);
    expect(view.downloads).toMatchObject({ permitted: false, files: [] });
    // Display without redistribute: the figures are shown and no file of them is offered.
    const displayOnly = createRightsGate(fixtureRegister({ display: true, redistribute: false }));
    const shown = page(fixture, "production", { gate: displayOnly });
    expect(shown.view.evidence.state).toBe("held");
    expect(cells(shown.html, "then")[0]).toContain("109.5");
    expect(shown.view.downloads).toMatchObject({ permitted: false, files: [] });
    expect(shown.html).not.toContain("evidence.csv");
    const both = createRightsGate(fixtureRegister({ display: true, redistribute: true }));
    expect(page(fixture, "production", { gate: both }).view.downloads.files.map((f) => f.href)).toEqual([`/claims/${CLAIM}/evidence.csv`, `/claims/${CLAIM}.md`, `/claims/${CLAIM}.json`, `/claims/${CLAIM}/lock.json`]);
  });

  it("a file is refused whole when only the latest rows may not be handed out, and the page offers none", () => {
    const release = copy();
    release.latest!.claims[0]!.rights_used = [{ origin: "Another origin (synthetic)", dataset: "x", channel: "direct", representation: "native" }];
    const both = createRightsGate(fixtureRegister({ display: true, redistribute: true }));
    const { view, html } = page(release, "production", { gate: both });
    expect(view.evidence.state).toBe("held");
    expect(cells(html, "then")[0]).toContain("109.5");
    expect(cells(html, "latest")[0]).toBe("No figure");
    expect(text(html)).toContain("Not shown here: Another origin (synthetic) (x) is not in the rights register");
    expect(view.downloads).toMatchObject({ permitted: false, files: [] });
    for (const format of ["json", "md", "evidence.csv", "lock.json"] as const) {
      expect(claimTwin(release, "production", CLAIM, format, { address: "https://x.example/macro-atlas", gate: both }).status, format).toBe(403);
    }
  });

  it("the door to the Explorer as known before the statement carries the statement's own time when the record has one", () => {
    expect(page(fixture).view.readings[0]!.explorer!.then).toBe("s=fx_price_index&from=2024-11&to=2026-11&as_of=2025-12-11");
    const timed = copy();
    timed.claims.claims[0]!.said_at = "2025-12-11T15:30:00Z";
    expect(page(timed).view.readings[0]!.explorer!.then).toBe("s=fx_price_index&from=2024-11&to=2026-11&as_of=2025-12-11T15%3A30%3A00Z");
  });

  it("a draft with no lock is its record, said to be a draft, with no figure", () => {
    const release = copy();
    const claim = release.claims.claims[0]!;
    Object.assign(claim, { status: "draft", locks: [] });
    release.locks = {};
    release.latest = null;
    const { view, html } = page(release);
    expect(view).toMatchObject({ draft: true, evidence: { state: "none" }, lock: null });
    expect(text(html)).toContain("No figure has been computed for this claim yet: it has no lock.");
    expect(text(html)).toContain("The change over 1 Jan 2025 to 30 Nov 2025.");
    expect(html).not.toMatch(/data-cell/);
  });

  it("is not found for an id that is not a Claim of the Release", () => {
    expect(claimPageView(fixture, "local", "2025-12-11-nobody")).toBeNull();
    expect(claimPageView(fixture, "local", "../etc/passwd")).toBeNull();
  });
});

/**
 * ADR 0011: the site's own words on a Claim are labels and template sentences that state
 * figures. This list is of words that work as a finding, a rating or a label. It is asked of
 * the text a reader sees, with the claimant's own words (the quote) and the names in the record
 * taken out: those are not Macro Atlas's.
 */
const VERDICT_WORDS = [
  "true", "false", "truth", "accurate", "inaccurate", "accuracy", "misleading", "misleads", "correct", "incorrect", "wrong", "right", "verdict", "rating", "rated",
  "finding", "label", "labelled", "mostly", "partly", "half", "exaggerated", "exaggerates", "overstated", "overstates", "understated", "cherry", "selective", "supported",
  "unsupported", "debunked", "lie", "lied", "lying", "honest", "dishonest", "bogus", "spin", "confirmed", "confirms", "refuted", "refutes", "contradicts", "contradicted",
  "consistent", "inconsistent", "matches", "holds up", "checks out", "valid", "invalid", "fair", "unfair", "fake", "proven", "disproven", "claimed falsely", "fact-check", "pinocchio", "pants",
  "context", "justified", "unjustified", "credible", "score", "grade",
];
const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rarr: "→", larr: "←", middot: "·" };
/** The text a reader sees, entities decoded. Tags are taken out twice: joined (a word split by markup) and spaced. */
const visibleText = (html: string): string[] => {
  const body = html.replace(/<blockquote.*?<\/blockquote>/gs, " ").replace(/<(script|style)\b.*?<\/\1>/gs, " ");
  const decode = (t: string) =>
    t
      .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#([0-9]+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
      .replace(/&([a-z]+);/g, (m, n: string) => ENTITY[n] ?? m);
  return [decode(body.replace(/<[^>]+>/g, "")), decode(body.replace(/<[^>]+>/g, " "))];
};
const verdictWords = (html: string, own: string[]): string[] => {
  const texts = visibleText(html).map((t) => own.reduce((left, words) => left.replaceAll(words, " "), t));
  return VERDICT_WORDS.filter((word) => texts.some((t) => new RegExp(`(?<![A-Za-z])${word}(?![A-Za-z])`, "i").test(t)));
};

describe("AC: the pages carry no finding, rating or label", () => {
  const record = (claim: Claim) => [claim.quote, claim.claimant.name, claim.claimant.role, claim.venue, ...claim.sources.map((s) => s.name ?? "")];

  it("the fixture Claim's page, in every state it can be in", () => {
    const own = record(fixture.claims.claims[0]!);
    const unavailable = copy();
    Object.assign(unavailable.locks[LOCK]!.parsed.readings[0]!.then, { basis: "unavailable", unavailable: { reason: "no_vintages", message: "no vintages" }, figures: [] });
    const withdrawn = copy();
    Object.assign(withdrawn.claims.claims[0]!.locks[0]!, { state: "withdrawn", why: "a series it rests on was withdrawn" });
    const draft = copy();
    Object.assign(draft.claims.claims[0]!, { status: "draft", locks: [] });
    for (const [name, html] of [
      ["shown", page(fixture).html],
      ["not permitted", page(fixture, "production").html],
      ["unavailable", page(unavailable).html],
      ["withdrawn", page(withdrawn).html],
      ["draft", page(draft).html],
    ] as const) {
      expect(verdictWords(html, own), name).toEqual([]);
    }
  });

  it("the list is not blind: it finds a rating when one is put on the page, split by markup or written as entities", () => {
    expect(verdictWords("<p>Rating: mostly true</p>", [])).toEqual(["true", "rating", "mostly"]);
    expect(verdictWords("<p><b>mis</b>leading, tr&#117;e, f&#x61;lse</p>", [])).toEqual(["true", "false", "misleading"]);
    expect(verdictWords('<td class="n">Verdict</td>', [])).toEqual(["verdict"]);
  });

  it("the index, with a filter in force and with none", () => {
    const own = record(fixture.claims.claims[0]!);
    for (const raw of [{}, { party: "none" }, { party: "nonsense" }]) {
      const html = renderToStaticMarkup(<ClaimsIndex view={claimsIndexView(fixture, parseClaimFilters(raw))} basePath={BASE} />);
      expect(html).toContain("Recorded, by party:");
      expect(verdictWords(html, own)).toEqual([]);
    }
    const none = copy();
    none.claims.claims = [];
    expect(verdictWords(renderToStaticMarkup(<ClaimsIndex view={claimsIndexView(none, parseClaimFilters({}))} basePath={BASE} />), [])).toEqual([]);
  });

  it("the method page uses such words only to say what Macro Atlas does not give", async () => {
    process.env.ATLAS_SURFACE = "local";
    process.env.NEXT_PUBLIC_BASE_PATH = BASE;
    const { default: Method } = await import("@/app/docs/method/[name]/page");
    const html = renderToStaticMarkup(await Method({ params: Promise.resolve({ name: "claims" }), searchParams: Promise.resolve({}) }));
    const said = visibleText(html)[1]!.replace(/\s+/g, " ");
    // The three sentences that say what is not given. With exactly those taken out, no such word is left.
    const NEGATIONS = ["It gives no finding, rating or label: no file, page or download has a place for one.", "Each returns numbers, never true or false.", "Macro Atlas does not say whether a statement is accurate."];
    let rest = said;
    for (const sentence of NEGATIONS) {
      expect(rest).toContain(sentence);
      rest = rest.replace(sentence, " ");
    }
    expect(verdictWords(`<p>${rest}</p>`, [])).toEqual([]);
    expect(verdictWords(`<p>${rest} This statement is true and accurate.</p>`, [])).toEqual(["true", "accurate"]);
  });

  it("no file of a Release has a field that could hold one", () => {
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
          keys.add(k);
          walk(v);
        }
      }
    };
    walk(fixture.claims);
    walk(fixture.locks[LOCK]!.parsed);
    walk(fixture.latest);
    expect([...keys].filter((k) => /finding|rating|verdict|label|flag|score|judg/i.test(k))).toEqual([]);
  });
});

describe("the Claims index (PLAN M21)", () => {
  const more = (): OpenedRelease => {
    const release = copy();
    const one = release.claims.claims[0]!;
    const make = (id: string, name: string, party: string, topics: string[], more: Partial<Claim> = {}): Claim => ({ ...structuredClone(one), id, said_on: id.slice(0, 10), claimant: { name, role: "Fixture senator (synthetic)", party }, topics, corrections: [], ...more });
    release.claims.claims.push(
      make("2025-10-02-b-example-on-fixture-jobs", "B. Example", "Fixture Blue", ["jobs"]),
      make("2025-11-20-c-sample-on-fixture-prices", "C. Sample", "Fixture Yellow", ["inflation", "jobs"], { status: "draft", corrections: [{ date: "2026-01-05", reason: "A locator was entered for the first source (synthetic)." }] }),
      make("2025-09-09-b-example-on-fixture-output", "B. Example", "Fixture Blue", []),
    );
    return release;
  };

  it("lists every Claim newest first, with who said it, the party in words, and a count by party over the whole Release", () => {
    const view = claimsIndexView(more(), parseClaimFilters({}));
    expect(view).toMatchObject({ total: 4, shown: 4, drafts: 1, active: false, note: null });
    expect(view.rows.map((r) => [r.when, r.name, r.party, r.draft])).toEqual([
      ["11 Dec 2025", "A. Fixture", "No party", false],
      ["20 Nov 2025", "C. Sample", "Fixture Yellow", true],
      ["2 Oct 2025", "B. Example", "Fixture Blue", false],
      ["9 Sep 2025", "B. Example", "Fixture Blue", false],
    ]);
    expect(view.byParty).toEqual([
      { party: "Fixture Blue", count: 2, query: "party=fixture-blue" },
      { party: "Fixture Yellow", count: 1, query: "party=fixture-yellow" },
      { party: "No party", count: 1, query: "party=none" },
    ]);
    expect(view.rows[0]).toMatchObject({ href: `/claims/${CLAIM}`, quote: "The fixture price index stood at 109.5 in November, up about five percent since January.", topics: ["Inflation"] });
  });

  it("filters by person, party and topic from the address; the count by party does not move", () => {
    const release = more();
    const by = (raw: Record<string, string>) => claimsIndexView(release, parseClaimFilters(raw));
    expect(by({ person: "b-example" }).rows.map((r) => r.id)).toEqual(["2025-10-02-b-example-on-fixture-jobs", "2025-09-09-b-example-on-fixture-output"]);
    expect(by({ party: "fixture-yellow" }).rows.map((r) => r.name)).toEqual(["C. Sample"]);
    expect(by({ topic: "jobs" }).rows.map((r) => r.name)).toEqual(["C. Sample", "B. Example"]);
    expect(by({ topic: "jobs", party: "fixture-blue" })).toMatchObject({ shown: 1, total: 4, active: true });
    expect(by({ topic: "jobs" }).byParty).toEqual(by({}).byParty);
    expect(by({ party: "nonsense" })).toMatchObject({ shown: 4, active: false, note: "This release holds no claim for the party in the address, so that part of it is left out." });
    expect(by({}).options.person).toEqual([
      { value: "a-fixture", label: "A. Fixture", count: 1 },
      { value: "b-example", label: "B. Example", count: 2 },
      { value: "c-sample", label: "C. Sample", count: 1 },
    ]);
  });

  it("a name with no Latin letter still has a filter of its own", () => {
    const release = more();
    release.claims.claims[1]!.claimant.name = "例の人";
    const view = claimsIndexView(release, parseClaimFilters({}));
    const option = view.options.person.find((o) => o.label === "例の人")!;
    expect(option.value).toMatch(/^u-[0-9a-z-]+$/);
    expect(claimsIndexView(release, parseClaimFilters({ person: option.value })).rows.map((r) => r.name)).toEqual(["例の人"]);
  });

  it("gathers every Correction of the Release, newest first", () => {
    expect(claimsIndexView(more(), parseClaimFilters({})).corrections.map((c) => [c.when, c.who])).toEqual([
      ["5 Jan 2026", "C. Sample"],
      ["1 Jan 2026", "A. Fixture"],
    ]);
  });
});

describe("User notes (PLAN M21): a local build only, marked as their author's", () => {
  const NOTE = `---\nid: "2026-11-12-my-reading-of-it"\nuser: "alex"\nabout:\n  kind: claim\n  id: "${CLAIM}"\ncreated: "2026-11-12"\nstatus: draft\n---\n\nI think this one is misleading.\n\nSecond paragraph.\n`;
  const notesDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-notes-"));
    mkdirSync(join(dir, "alex"));
    writeFileSync(join(dir, "alex", "2026-11-12-my-reading-of-it.md"), NOTE);
    writeFileSync(join(dir, "alex", "2026-11-12-about-a-series.md"), NOTE.replace("my-reading-of-it", "about-a-series").replace("kind: claim", "kind: series").replace(CLAIM, "fx_price_index"));
    writeFileSync(join(dir, "alex", "not-a-note.md"), "hello");
    mkdirSync(join(dir, "bo"));
    writeFileSync(join(dir, "bo", "2026-11-12-my-reading-of-it.md"), NOTE); // says it is alex's, in bo's folder
    return dir;
  };

  it("reads the file `atlas add note` writes, and nothing that is not one", () => {
    expect(parseNote(NOTE, "alex", "2026-11-12-my-reading-of-it.md")).toEqual({
      id: "2026-11-12-my-reading-of-it",
      user: "alex",
      about: { kind: "claim", id: CLAIM },
      created: "2026-11-12",
      text: "I think this one is misleading.\n\nSecond paragraph.",
    });
    expect(parseNote(NOTE, "bo", "2026-11-12-my-reading-of-it.md")).toBeNull();
    expect(parseNote(NOTE, "alex", "another-name.md")).toBeNull();
    expect(parseNote(NOTE.replace("status: draft", "status: public"), "alex", "2026-11-12-my-reading-of-it.md")).toBeNull();
    expect(parseNote(NOTE.replace("status: draft", "status: draft\nrating: false"), "alex", "2026-11-12-my-reading-of-it.md")).toBeNull();
  });

  it("AC: renders on a local build of a local-profile Release, marked with its author", async () => {
    const local = copy();
    local.manifest.profile = "local";
    const notes = await notesFor({ directory: notesDir(), surface: "local", profile: local.manifest.profile }, "claim", CLAIM);
    expect(notes.map((n) => n.user)).toEqual(["alex"]);
    const { html } = page(local, "local", { notes });
    expect(html).toContain('data-note-by="alex"');
    expect(text(html)).toContain("Note by alex · 12 November 2026 · alex's own, not Macro Atlas's");
    expect(text(html)).toContain("I think this one is misleading.");
  });

  it("AC: is absent from a public-profile Release, and from every public Surface: the directory is not even read", async () => {
    const directory = notesDir();
    expect(notesAllowed("local", "public")).toBe(false);
    expect(notesAllowed("production", "local")).toBe(false);
    expect(notesAllowed("staging", "local")).toBe(false);
    expect(await notesFor({ directory, surface: "local", profile: fixture.manifest.profile }, "claim", CLAIM)).toEqual([]);
    expect(await notesFor({ directory, surface: "production", profile: "local" }, "claim", CLAIM)).toEqual([]);
    expect(await notesFor({ directory: undefined, surface: "local", profile: "local" }, "claim", CLAIM)).toEqual([]);
    const { html } = page(fixture, "local", { notes: await notesFor({ directory, surface: "local", profile: fixture.manifest.profile }, "claim", CLAIM) });
    expect(html).not.toMatch(/data-note-by|misleading|Note by/);
  });

  it("does not follow a link out of the notes directory", async () => {
    const directory = notesDir();
    const outside = mkdtempSync(join(tmpdir(), "atlas-outside-"));
    writeFileSync(join(outside, "2026-11-13-linked.md"), NOTE.replace("my-reading-of-it", "linked"));
    symlinkSync(join(outside, "2026-11-13-linked.md"), join(directory, "alex", "2026-11-13-linked.md"));
    expect((await notesFor({ directory, surface: "local", profile: "local" }, "claim", CLAIM)).map((n) => n.id)).toEqual(["2026-11-12-my-reading-of-it"]);
  });
});

describe("a Claim's twins (PLAN section 7, M21)", () => {
  const ADDRESS = "http://localhost:3000/macro-atlas";
  const both = createRightsGate(fixtureRegister({ display: true, redistribute: true }));
  const twin = (format: Parameters<typeof claimTwin>[3], release = fixture, surface: "local" | "production" = "local", gate?: typeof both) => claimTwin(release, surface, CLAIM, format, { address: ADDRESS, gate });

  it("the JSON holds the record, the lock's rows and the release's latest rows, and says which is which", () => {
    const answer = twin("json");
    expect(answer).toMatchObject({ status: 200, contentType: "application/json; charset=utf-8", cacheable: false, filename: `macro-atlas_claim_${CLAIM}_not-for-publication.json` });
    const doc = JSON.parse(answer.body);
    expect(doc.notice).toContain("NOT FOR PUBLICATION");
    expect(doc.claim).toMatchObject({ id: CLAIM, quote: fixture.claims.claims[0]!.quote, claimant: { party: "none" } });
    expect(doc.evidence).toMatchObject({ lock_version: 1, lock_release: { release_id: "20260101T000000Z-0000000" } });
    expect(doc.evidence.readings[0].then.figures[0].value).toBe(109.5);
    expect(doc.evidence.readings[0].now_when_checked.figures[0].value).toBe(109.3);
    expect(doc.evidence.readings[0].latest.figures[0].value).toBe(109.3);
    expect(doc).toMatchObject({ release_id: fixture.id, evidence_state: "held", address: `${ADDRESS}/claims/${CLAIM}` });
    expect(Object.keys(doc).some((k) => /note/.test(k) && k !== "notice")).toBe(false);
  });

  it("the CSV, the JSON and the page hold the same figures", () => {
    const rows = parseCsv(twin("evidence.csv").body).filter((r) => !r[0]!.startsWith("#"));
    const head = rows[0]!;
    const at = (name: string) => head.indexOf(name);
    const pick = (reading: string, state: string, figure: string, window = "declared") => rows.find((r) => r[at("reading")] === reading && r[at("state")] === state && r[at("figure")] === figure && (r[at("window")] || "declared") === window)?.[at("value")];
    expect(pick("index-in-november", "then", "value")).toBe("109.5");
    expect(pick("index-in-november", "now_when_checked", "value")).toBe("109.3");
    expect(pick("index-in-november", "latest", "value")).toBe("109.3");
    expect(pick("rise-since-january", "then", "change")).toBe("4.5");
    expect(rows.filter((r) => r[at("reading")] === "rise-since-january" && r[at("window")] === "alternative" && r[at("figure")] === "change").map((r) => [r[at("state")], r[at("window_from")], Number(r[at("value")]).toFixed(1)])).toEqual([
      ["then", "2024-11-01", "5.4"], ["then", "2025-06-01", "2.3"],
      ["now_when_checked", "2024-11-01", "5.2"], ["now_when_checked", "2025-06-01", "2.1"],
      ["latest", "2024-11-01", "5.2"], ["latest", "2025-06-01", "2.1"],
    ]);
    const { view } = page(fixture);
    const cell = view.readings[1]!.evidence!.rows.find((r) => r.name === "end")!;
    expect(cell.then).toMatchObject({ exact: Number(pick("rise-since-january", "then", "end")) });
    expect(head).not.toContain("finding");
  });

  it("the lock is its own bytes: the hash the Release lists is the hash of the file", () => {
    const answer = twin("lock.json");
    expect(answer.body).toBe(fixture.locks[LOCK]!.text);
    expect(createHash("sha256").update(answer.body).digest("hex")).toBe(fixture.claims.claims[0]!.locks[0]!.sha256);
    expect(answer.filename).toBe(`macro-atlas_claim_${CLAIM}_not-for-publication.v1.lock.json`);
    expect(answer.body).not.toContain("NOT FOR PUBLICATION");
  });

  it("the Markdown is the page as text", () => {
    const body = twin("md").body;
    expect(body).toContain("# A. Fixture, 11 December 2025");
    expect(body).toContain("> The fixture price index stood at 109.5 in November, up about five percent since January.");
    expect(body).toContain("| Value | 109.5 (Nov 2025, preliminary) | 109.3 (Nov 2025) | 109.3 (Nov 2025) |");
    expect(body).toContain("### Window sensitivity");
    expect(body).toContain(`- Evidence CSV: ${ADDRESS}/claims/${CLAIM}/evidence.csv`);
  });

  it("an address in the Markdown cannot open a tag or a link", () => {
    const release = copy();
    release.claims.claims[0]!.sources[0]!.url = "https://example.org/<img/src=x/onerror=alert(1)>)[x](y";
    const body = twin("md", release).body;
    expect(body).toContain("https://example.org/%3Cimg/src=x/onerror=alert%281%29%3E%29%5Bx%5D%28y");
    expect(body).not.toMatch(/<img|\]\(y/);
    release.claims.claims[0]!.sources[0]!.url = "https://example.org/😀";
    expect(twin("md", release).body).toContain("https://example.org/%F0%9F%98%80");
  });

  it("where the values may not be handed out every twin is 403 with the reason and no figure", () => {
    const displayOnly = createRightsGate(fixtureRegister({ display: true, redistribute: false }));
    for (const gate of [undefined, displayOnly]) {
      for (const format of ["json", "md", "evidence.csv", "lock.json"] as const) {
        const answer = twin(format, fixture, "production", gate);
        expect(answer, format).toMatchObject({ status: 403, cacheable: false });
        expect(answer.body, format).not.toMatch(/109\.|4\.5|period/);
      }
    }
    expect(twin("json", fixture, "production", both)).toMatchObject({ status: 200, cacheable: true, filename: `macro-atlas_claim_${CLAIM}.json` });
    expect(JSON.parse(twin("json", fixture, "production", both).body).notice).toBeUndefined();
  });

  it("the CSV says of a Reading this Release could not measure that it could not, with the reason", () => {
    const release = copy();
    const late = release.latest!.claims[0]!.readings[0]!;
    late.latest = null;
    late.refused = { reason: "series_withheld", message: "the series is withheld in this release" };
    const rows = parseCsv(twin("evidence.csv", release).body).filter((r) => !r[0]!.startsWith("#"));
    const head = rows[0]!;
    const at = (name: string) => head.indexOf(name);
    const mine = rows.filter((r) => r[at("reading")] === late.id && r[at("state")] === "latest");
    expect(mine).toHaveLength(1);
    expect(mine[0]![at("unavailable")]).toBe("series_withheld");
    expect(mine[0]![at("release_id")]).toBe(release.id);
    expect(mine[0]![at("value")]).toBe("");
    // The JSON twin and the page already said so.
    expect(JSON.parse(twin("json", release).body).evidence.readings[0].latest_refused).toMatchObject({ reason: "series_withheld" });
  });

  it("a newest lock without its numbers: the record is served, no older lock's figures or file stand in", () => {
    const release = copy();
    const claim = release.claims.claims[0]!;
    (claim.locks as unknown[]).push({ version: 2, locked_at: "2026-02-01T00:00:00Z", reason: "A source moved (synthetic).", record_sha256: claim.locks[0]!.record_sha256, state: "withdrawn", why: "a series it rests on was withdrawn" });
    const doc = JSON.parse(twin("json", release).body);
    expect(doc).toMatchObject({ evidence: null, evidence_state: "absent" });
    expect(twin("lock.json", release).status).toBe(404);
    expect(twin("evidence.csv", release)).toMatchObject({ status: 404 });
    expect(twin("evidence.csv", release).body).not.toMatch(/109\.3/);
    expect(twin("md", release).body).not.toMatch(/109\.3|\| Figure/);
  });

  it("404 for a Claim the Release does not hold", () => {
    expect(claimTwin(fixture, "local", "2025-12-11-nobody", "json", { address: ADDRESS }).status).toBe(404);
  });
});
