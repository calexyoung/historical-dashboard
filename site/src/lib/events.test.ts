/**
 * Event pages and the Events index (PLAN section 3 and M19), on the synthetic fixture release and
 * on copies of it changed in memory. Everything invented.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { validateRelease, type Annotation, type Event } from "@macro-atlas/core/release";
import { parseExplorerParams } from "./explorer/state";
import { explorerView } from "./explorer/view";
import { eventPageView, eventsIndexView, parseEventFilters } from "./events";
import { createReleaseReader, refusal, type OpenedRelease } from "./release/reader";
import { addRelease, FIXTURE_ROOT, tempRoot } from "./release/testing";
import { breadcrumb, tabsFor } from "./nav";

let fixture: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  fixture = opened.release;
});

const RATE = "2024-09-18-fixture-rate-decision";
const CITE = { url: "https://example.org/x", archive_url: "https://example.org/archive/x" };
const base = { topics: [], related_series: [], sources: [CITE], description: "", status: "public" as const };
const STATUTE: Event = { ...base, id: "2025-03-fixture-statute", date: "2025-03", date_precision: "month", title: "Fixture statute takes effect", category: "legislation" };
const BRIDGES: Event = { ...base, id: "2023-fixture-bridges", date: "2023", date_precision: "year", title: "Fixture bridge programme begins", category: "infrastructure" };
const STORM: Event = { ...base, id: "2025-08-04-fixture-storm", date: "2025-08-04", end: "2025-08-09", date_precision: "day", title: "Fixture storm crosses the coast", category: "disaster" };
const LONG: Event = { ...base, id: "2021-06-fixture-works", date: "2021-06", end: "2024-02", date_precision: "month", title: "Fixture harbour works", category: "infrastructure" };
const DRAFT: Event = { ...base, id: "2025-10-01-fixture-draft", date: "2025-10-01", date_precision: "day", title: "Fixture draft", category: "financial", status: "draft" };

function annotationOf(e: Event): Annotation {
  const anchor: Annotation["anchor"] =
    e.end !== undefined
      ? e.date_precision === "day"
        ? { type: "span", start: e.date, end: e.end }
        : { type: "span", start: `${e.date}-01`, end: e.end === "2024-02" ? "2024-02-29" : `${e.end}-28` }
      : e.date_precision === "day"
        ? { type: "date", date: e.date }
        : { type: "period", period: e.date };
  return { id: `event-${e.id}`, kind: "event", anchor, label: e.title, ref: `content/events/${e.id}.md`, source: CITE, category: e.category, ...(e.end !== undefined && e.date_precision !== "day" ? { attributes: { date_precision: e.date_precision } } : {}) };
}

/** The fixture with more Events, as a local-profile Release would hold them. */
function withEvents(...more: Event[]): OpenedRelease {
  return {
    ...fixture,
    manifest: { ...fixture.manifest, profile: "local" },
    events: { events: [...fixture.events.events, ...more].sort((a, b) => (a.date < b.date ? -1 : 1)) },
    annotations: { annotations: [...fixture.annotations.annotations, ...more.map(annotationOf)] },
  };
}

describe("the release reader", () => {
  it("gives a Release's Events", () => {
    expect(fixture.events.events.map((e) => e.id)).toEqual([RATE]);
  });

  it("gives a Release written before there were Events none, and still opens it", async () => {
    const root = tempRoot();
    const id = "20260102T000000Z-0000002";
    addRelease(root, { id, schema: "0.2.0" });
    const opened = await createReleaseReader({ root, surface: "local" }).open(id);
    expect(opened.ok && opened.release.events.events).toEqual([]);
  });

  it("never serves an Annotation that is v1's on a public Surface", () => {
    const v1: Annotation = { id: "governance-pres-2001-01", kind: "governance", anchor: { type: "span", start: "2001-01-01", end: "2009-01-31" }, label: "v1", ref: null, source: null, provenance: { producer: "Macro Atlas v1", dataset: "v1", via: "hand_entered", representation: "legacy_monthly_rounded" } };
    const held = { ...fixture, annotations: { annotations: [...fixture.annotations.annotations, v1] } };
    expect(refusal(held, "production")).toMatch(/governance-pres-2001-01/);
    expect(refusal(held, "staging")).toMatch(/v1/);
    expect(refusal(held, "local")).toBeNull();
    expect(refusal(fixture, "production")).toBeNull();
  });
});

describe("the events index", () => {
  it("lists every Event of the Release, newest first, each a door to its page", () => {
    const v = eventsIndexView(withEvents(STATUTE, BRIDGES, STORM), parseEventFilters({}));
    expect(v.total).toBe(4);
    expect(v.groups.map((g) => g.year)).toEqual(["2025", "2024", "2023"]);
    expect(v.groups[0]!.rows.map((r) => [r.when, r.category, r.title, r.href])).toEqual([
      ["4 to 9 Aug 2025", "Disaster", "Fixture storm crosses the coast", "/events/2025-08-04-fixture-storm"],
      ["Mar 2025", "Legislation", "Fixture statute takes effect", "/events/2025-03-fixture-statute"],
    ]);
    expect(v.groups[2]!.rows[0]).toMatchObject({ when: "2023", category: "Infrastructure" });
  });

  it("narrows to one category by the address, and counts each", () => {
    const release = withEvents(STATUTE, BRIDGES, STORM, LONG);
    const all = eventsIndexView(release, parseEventFilters({}));
    expect(all.categories.map((c) => [c.value, c.label, c.count, c.current])).toEqual([
      ["", "All", 5, true],
      ["policy", "Economic policy", 1, false],
      ["disaster", "Disaster", 1, false],
      ["infrastructure", "Infrastructure", 2, false],
      ["legislation", "Legislation", 1, false],
    ]);
    expect(all.categories.map((c) => c.query)).toEqual(["", "cat=policy", "cat=disaster", "cat=infrastructure", "cat=legislation"]);
    const one = eventsIndexView(release, parseEventFilters({ cat: "infrastructure" }));
    expect(one.groups.flatMap((g) => g.rows.map((r) => r.title))).toEqual(["Fixture bridge programme begins", "Fixture harbour works"]);
    expect(one.shown).toBe(2);
    expect(one.groups.find((g) => g.year === "2021")!.rows[0]!.when).toBe("Jun 2021 to Feb 2024");
  });

  it("a category the Release does not have, or one that is not a category, shows everything and says so", () => {
    const v = eventsIndexView(fixture, parseEventFilters({ cat: "<script>" }));
    expect(v.shown).toBe(1);
    expect(v.note).toMatch(/not a category/);
  });

  it("marks a draft with a word, in a local Release", () => {
    const v = eventsIndexView(withEvents(DRAFT), parseEventFilters({}));
    expect(v.groups[0]!.rows[0]).toMatchObject({ title: "Fixture draft", draft: true });
    expect(v.drafts).toBe(1);
  });

  it("says so when the Release holds no Events", () => {
    const v = eventsIndexView({ ...fixture, events: { events: [] } }, parseEventFilters({}));
    expect(v.total).toBe(0);
    expect(v.groups).toEqual([]);
  });
});

describe("an event page", () => {
  it("is not found for an id the Release does not hold", () => {
    expect(eventPageView(fixture, "production", "2020-01-01-nothing")).toBeNull();
    expect(eventPageView(fixture, "production", "../../etc")).toBeNull();
  });

  it("states what happened, when, and where it can be checked", () => {
    const v = eventPageView(fixture, "production", RATE)!;
    expect(v).toMatchObject({ title: "Fixture central bank changes its rate", when: "18 September 2024", category: "Economic policy", draft: false });
    expect(v.description).toEqual(["The fixture central bank announced a new policy rate on 18 September 2024.", "The announcement was published in the fixture gazette the same day."]);
    expect(v.sources).toEqual([
      { name: "Fixture gazette (synthetic)", url: "https://example.org/fixture-gazette", archive: "https://example.org/archive/2026/fixture-gazette", noArchive: null },
      { name: "Fixture harbour board (synthetic)", url: "https://example.org/fixture-harbour", archive: null, noArchive: "The fixture harbour board's pages cannot be archived (synthetic reason)." },
    ]);
    expect(v.magnitude).toMatchObject({ words: "0.5 percentage points (invented)", source: { url: "https://example.org/fixture-harbour" } });
    expect(v.topics).toEqual(["inflation"]);
  });

  it("names each related Series: a door where the Release shows it, the reason where it does not", () => {
    const v = eventPageView(fixture, "production", RATE)!;
    expect(v.related).toEqual([
      { key: "fx_price_index", name: "Fixture price index", href: "/data/fx_price_index", state: null },
      { key: "fx_exchange_index", name: "Fixture exchange index", href: "/data/fx_exchange_index", state: "Withheld: The licence does not allow redistribution." },
      { key: "fx_not_in_this_release", name: "fx_not_in_this_release", href: null, state: "Not in this release." },
    ]);
  });

  it("opens the Explorer on its Series around its date, with its layer on and itself marked", () => {
    const v = eventPageView(fixture, "production", RATE)!;
    expect(v.explorer).toBe("s=fx_price_index&from=2022-09&to=2026-09&layers=ev.policy&event=event-2024-09-18-fixture-rate-decision");
    const explorer = explorerView(fixture, "local", parseExplorerParams(new URLSearchParams(v.explorer!)));
    expect(explorer.events.find((e) => e.chosen)?.label).toBe("Fixture central bank changes its rate");
    expect(explorer.figure).not.toBeNull();
  });

  it("offers no Explorer link when it names no Series the Release can draw", () => {
    expect(eventPageView(withEvents(STATUTE), "local", STATUTE.id)!.explorer).toBeNull();
  });

  it("says a month as a month, a year as a year, and a span as a span", () => {
    const release = withEvents(STATUTE, BRIDGES, STORM, LONG);
    expect(eventPageView(release, "local", STATUTE.id)!.when).toBe("March 2025");
    expect(eventPageView(release, "local", BRIDGES.id)!.when).toBe("2023");
    expect(eventPageView(release, "local", STORM.id)!.when).toBe("4 August 2025 to 9 August 2025");
    expect(eventPageView(release, "local", LONG.id)!.when).toBe("June 2021 to February 2024");
  });

  it("says when no description has been written, and marks a draft", () => {
    const v = eventPageView(withEvents(DRAFT), "local", DRAFT.id)!;
    expect(v.description).toEqual([]);
    expect(v.draft).toBe(true);
  });
});

describe("the Explorer and the new ways an Event is dated", () => {
  const view = (release: OpenedRelease, query: string) => explorerView(release, "local", parseExplorerParams(new URLSearchParams(query)));

  it("lists an Event of a year and an Event of a month in a window that holds them", () => {
    const v = view(withEvents(STATUTE, BRIDGES), "s=fx_price_index&from=2022-01&to=2025-12");
    expect(v.events.map((e) => [e.label, e.when])).toEqual([
      ["Fixture bridge programme begins", "2023"],
      ["Fixture central bank changes its rate", "18 Sep 2024"],
      ["Fixture statute takes effect", "Mar 2025"],
    ]);
  });

  it("lists an Event that spans time whenever any part of it is in the window", () => {
    const release = withEvents(LONG, STORM);
    expect(view(release, "s=fx_price_index&from=2023-06&to=2023-12").events.map((e) => e.label)).toEqual(["Fixture harbour works"]);
    expect(view(release, "s=fx_price_index&from=2025-08&to=2025-12").events.map((e) => [e.label, e.when])).toEqual([["Fixture storm crosses the coast", "4 Aug 2025 to 9 Aug 2025"]]);
    expect(view(release, "s=fx_price_index&from=2024-03&to=2024-06").events).toEqual([]);
  });

  it("offers the new categories as layers after v1's five", () => {
    const v = view(withEvents(STATUTE, BRIDGES, STORM), "s=fx_price_index");
    expect(v.layers.toggles.map((t) => [t.token, t.label])).toEqual([["rec", "Recessions"], ["ev.policy", "Economic policy"], ["ev.disaster", "Disaster"], ["ev.infrastructure", "Infrastructure"], ["ev.legislation", "Legislation"]]);
  });

  it("each listed Event is a door to its page", () => {
    expect(view(fixture, "s=fx_price_index").events[0]!.page).toBe(`/events/${RATE}`);
  });
});

describe("the tab bar", () => {
  it("has Events between Explore and Data, as the plan orders them", () => {
    expect(tabsFor("/events/x").map((t) => [t.label, t.current])).toEqual([["Explore", false], ["Events", true], ["Data", false]]);
    expect(breadcrumb("/events")).toBe("Events");
  });
});

describe("the fixture's Events", () => {
  it("are the ones the contract's own rules accept", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(FIXTURE_ROOT, "releases", fixture.id);
    const files = Object.fromEntries((readdirSync(dir, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[]).filter((e) => e.isFile()).map((e) => [join(e.parentPath, e.name).slice(dir.length + 1), readFileSync(join(e.parentPath, e.name))]));
    expect(validateRelease(fixture.id, files)).toEqual([]);
  });
});
