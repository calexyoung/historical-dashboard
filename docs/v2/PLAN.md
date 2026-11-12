# Macro Atlas v2 — the plan

Status: **Gate 1 passed 2026-11-11**, with one change from Alex: the milestones are reordered so
that a usable site comes first (this revision; section 10). Decided so far: D1 approved (v2.0, then
v2.1–v2.3), D3 approved as recommended. Still open, each with a recommendation in section 12: D2
(rights), D4, D5, D6 (capture host), D7–D13. While D2 is open the interim data rule in section 6.1
applies. Nothing here is built and no code was changed.

Inputs: `docs/v2/BRIEF.md` including its "Decisions added 2026-11-11" (which override the
research and the drafts), research notes `docs/v2/research/01`–`04`, the two drafts in
`docs/v2/drafts/` (research-first and reader-first) and the critique of them. Vocabulary is in
`/CONTEXT.md`; the decisions behind this plan are in `docs/adr/0001`–`0012` (accepted at Gate 1;
ADR 0006 carries the interim data rule).

Items that need Alex are marked **[ALEX]** and collected in section 12.

---

## 1. Executive summary

**What v2 is.** Macro Atlas becomes a live website at `mydashboards.co/macro-atlas`, refreshed
every day, in the same family as `/missions`. Every series, claim and topic gets its own page and
address. Every number says where it came from. The first thing it does well is the thing the brief
puts first: set what a politician or pundit said beside the figures that were public on the day
they said it, so you can judge the claim yourself.

**What it is not.** Per your added decisions, it is a neutral source of data and facts. The site
gives no verdict, rating or label on any claim, writes no opinion and no explanations of its own,
and has no Letter. It is inspired by Bagby's annual report but is not one. Judgments belong to the
user, in a separate layer of personal notes that is clearly marked and kept out of the data. The
plan favours ways in and out of the data (views, exports, an API, later MCP) over editorial content.

**What gets built first.** A site you can use. Six small steps (M0–M5, about 62 hours of agent
work) give you the v2 shell and the Explorer you have today, rebuilt on the new stack and running
on your machine: series pages, links that carry the whole view, v1's old hash links, the six scale
modes, events and governance bands, compare ranges and exports. It is usable after the fifth step
and at v1 parity after the sixth. It reads v1's existing data through the same release format the
finished site will use, so nothing built here is thrown away when the agency sources arrive. The
layers that make the site trustworthy in public (the rights gate, daily capture, kept history,
agency sources, claim records) follow in tracks that do not hold the usable site up. Then the
overview, two topics, downloads and an API. Then v1 is switched off.

**What you should know.** Four things:

1. **v2.0 is not the whole brief** (D1, approved). v2.0 is the release that replaces v1: 29 pull
   requests, about 246 hours of agent work (222 in the Gate 1 draft). US infrastructure, most of the G20 table, trade,
   disasters and the full statement-style views come in v2.1 to v2.3 (about 17 more pull
   requests). The brief's scope is planned to be complete at v2.3, except items that turn out to
   have no free publishable source (the stock indices, possibly broadband programme outlays and
   monthly port volumes), which are reported to you as such. Putting the usable site first costs
   three more pull requests and about 24 more hours than the Gate 1 draft.
2. **Licensing is the biggest open question** (D2, open). Today v1 gets 83 of its 109 catalog
   entries through FRED and 25 through Yahoo. Yahoo's terms forbid redistribution. FRED's terms
   restrict storing and archiving what it serves, and using it for ML, even when the underlying
   data is public domain. The plan's default for anything public is strict: v2 keeps and shows
   only what it fetches directly from the agency that produces it (BLS, BEA, Treasury, the Fed
   Board, Census, EIA, IMF if its terms allow). So v2.0 may launch with fewer series than v1's
   126, and the stock-market series will be listed as "withheld". **Until you decide, your interim
   basis applies (section 6.1):** local builds, and staging behind a password, may show v1's
   current data; nothing that came through FRED or Yahoo can reach the production path, and the
   build is made to refuse it. I am not giving legal advice; the register quotes the terms so you
   can judge.
3. **The brief's "G20 main stock index" probably cannot be published from free sources** (D5,
   not yet answered). Index levels are licensed products from every channel. I recommend amending
   the brief: link out to each exchange and show the row as withheld. Until you answer, that is
   what the build does.
4. **Atlas's own record of history cannot be bought back.** For most series, Macro Atlas can say
   "this was public by date X" only for days on which it was fetching. (For a few headline series
   an archive kept by the provider may fill in earlier dates later, in v2.1, if its terms allow.)
   The daily capture job can start only when you have cleared its first three sources (D2) and
   named a place for it to run (D6). Its code is two small steps (M6, M7) that can be built beside
   the usable site the day you answer.

**What I need from you, and when.** Nothing for the usable local site (M0–M5). Then: D2 for BLS,
Treasury and the Fed Board, and D6, to start capture. Two free API keys (BEA, EIA) before M15. The
rest of D2, signed, before anything is public. Server access, the Caddy change with a staging
password, and a backup target before staging (M27). Your OK for cutover (M28). Nothing in v2.0
costs money unless you choose a paid backup target.

**How it is built.** Fable 5.2 builds one milestone per pull request onto a `v2` branch, tests
first, with Codex as partner on each (the protocol is section 10.1). `main` and the live v1 site
are not touched until cutover. The agent stops only for the four things the brief lists:
production deploys, merges to `main`, money, your credentials. It reports at the end of every
milestone.

---

## 2. Goals and non-goals

### Goals, in priority order

1. **Examine a claim honestly.** Given a quote, a date and a reading of it, show what the data
   said before the claim, what it says now, and how the answer changes with the window chosen, with
   the basis for each figure stated. When the earlier figure is not known, say so; never substitute
   today's number. The site shows the evidence and stops there: no finding, rating or label.
2. **Trace every number.** From any figure: origin agency, dataset, series ID, address, the channel
   it came through, when it was fetched, the release, the licence and a copyable citation.
3. **Every figure explains itself.** A takeaway sentence (or silence when a sentence would
   mislead), units in words, a source line, "how to read this", the table behind it, and a door
   into the Explorer. Readable on a phone.
4. **Complex interaction over single causes.** "What else moved" companions, window sensitivity
   and US-against-G20 bands. No causal statements and no explanations written by the site.
5. **Breadth of access.** File twins on every page address, a versioned read API with provenance,
   immutable bulk files (CSV, Parquet, JSON) with a licence per resource, `llms.txt`, then MCP.
6. **The Explorer, kept and hardened.** v1's workbench at parity, then native frequency, as-of
   views and honest statistics.
7. **Breadth per the brief.** US in depth including infrastructure, G20 headline indicators, trade
   and commodities, disasters and pandemics (v2.1–v2.2).
8. **Report-style views.** Inspired by Bagby's annual report, without being one: an Overview by
   segment and Highlights in v2.0; statement tables, segment pages and a frozen yearly Edition in
   v2.3. Data and template sentences only.

### Non-goals for v2.0

- No database server, no login, no in-browser editor, no claim submission form.
- No runtime AI calls. Search is lexical over an index built at release time.
- No verdict, finding, rating or label on any claim. No Letter, no signed or opinion prose, no
  explanations written by the site (brief, added decisions 2 and 3).
- No causal statements and no counterfactual baselines.
- No intraday data.
- No promise of "free for ML training". The wording is "machine-readable, licence per series".
- No port of ingest to TypeScript (ADR 0002).
- No exact recomputation of old answers (ADR 0005). Claim locks are exact; pinned links pin data.
- No MCP endpoint (v2.1). No statement tables, segment pages or frozen Editions (v2.3).
- `ClaimReview` markup is never emitted: it requires a rating, which the site does not give.
- No FRED or Yahoo data on any public surface, in STORE or in a public release unless Alex clears
  it in the rights register. v1's existing data may be shown on local builds and on staging behind
  a password while D2 is open (section 6.1).

### Releases

| Release | Contains | Milestones | Size |
|---|---|---|---|
| **v2.0 Cutover** | The site shell and the Explorer at v1 parity on a local build first (M0–M5); then the rights gate, capture and history; US series re-sourced from agencies; G20 CPI and FX; claim records; Overview, Highlights, two topics; read API and bulk files; v1 retired | M0–M28 | 29 PRs, ~246 h |
| **v2.1 Access, history, infrastructure** | MCP; provider vintages; construction, freight, grid; IIJA and CHIPS spending; broadband | M29–M35 | 7 PRs, ~60 h |
| **v2.2 World and shocks** | G20 rates, unemployment, GDP; trade and commodities; disasters and health | M36–M39 | 4 PRs, ~34 h |
| **v2.3 Report-style views** | Statement tables, segment pages, the frozen 2025 Edition; claims depth and the user-notes layer | M40–M45 | 6+ PRs, ~54 h |

Hours are agent working time, not calendar time. Waiting on Alex is extra.

---

## 3. Information architecture

All under the base path `/macro-atlas` (staging: `/macro-atlas-staging`).

```
/                         Overview: one row per segment, search, topics
/highlights               1/5/10-year change table
/statements/…, /segments/{segment}, /editions/{year}/…     (v2.3)
/topics, /topics/{topic}  Topic pages (Inflation and Jobs in v2.0)
/claims, /claims/{id}     Claims file (hidden from public builds until Alex opens it)
/explore?s=…&from=…&to=…&mode=…&layers=…&as_of=…&pin=…
/compare?s=…&a=…&b=…
/events, /events/{id}
/data                     Catalog: search and filter by topic, origin, frequency, country, rights
/data/{key}               Series page; twins at .csv .json .metadata.json .md
/downloads, /downloads/{release_id}/…, /downloads/latest/…
/docs/method | api | rights | changelog      (each with a .md twin)
/api/v1/…                 Read API
/api/health               Liveness, current release id and age
/llms.txt
```

**Navigation.** Top bar as on /missions: name and breadcrumb left; search, a data-freshness dot
with a word, and the theme toggle right. Tabs in v2.0: `Topics · Claims · Explore · Events · Data`
(Claims appears once the first claim is public). A tab is shown only when its pages exist; until the
Overview is built (M22), `/` redirects to `/explore`. On a phone the three research tabs fold under
"Research ▾". When the statement views exist (v2.3) the bar becomes
`Overview · Topics · Claims · Research ▾`. A small "mydashboards" home link sits in the top bar.

**Rules for every page.**

- **The page address is the API.** Add a suffix, get the data behind the page. HTML and downloads
  come from the same query and are tested to agree.
- **Every figure is a door** into `/data/{key}` or an Explorer state.
- **A basis badge** sits next to any as-of value: provider, Atlas-observed, legacy, uncertain,
  unavailable.
- **Data states are drawn and named** with a mark and a word, never colour alone.
- **Withheld is visible.** A series kept back for rights reasons appears by name with the reason
  and no values.
- **Series keys are permanent.** Renames go through aliases and redirect.
- **The site's own words are neutral.** Text on a page is a label, a template sentence stating a
  figure, a quoted and cited definition, or an event's cited description of what happened. Nothing
  evaluates.
- Reading pages (overview, topic, claim, series) render complete without JavaScript. Search, the
  Explorer and popovers may need it.

**Page designs, phone first.**

- *Overview.* A date line ("Data to 11 Nov 2026"), six rows, one per segment (Economy & jobs ·
  Markets & money · Infrastructure · Governance & politics · Disasters & health · The US in the
  world), each with a label, the latest value in words, the one-year change and a small sparkline;
  then search and topic links. No hero, no cards, no KPI tiles.
- *Series page.* Name; definition in plain words (population, geography, percent or percentage
  points, seasonal adjustment, real or nominal); latest value with its period and release date; the
  explained figure; provenance block; vintage table; breaks and notes; related claims and events;
  downloads with a citation and a reproduce snippet.
- *Claim page.* Quote, claimant, date, source and archive links. For each reading: the figures
  then and now with basis badges, one figure showing both, and a window-sensitivity table. A
  "latest data" row. Readings not measured. Correction log. Evidence downloads. No finding, rating
  or label. Alex's own notes on a claim, if any, are a separate layer marked as his and are not
  part of the public data in v2.0.
- *Topic page.* A definition quoted from the origin agency and a change strip; main figure; **What
  else moved** (curated companions on one time axis); the US against the G20 range where the data
  exists; claims and events on the topic; member series. No explanations written by the site.
- *Explorer.* v1's workbench. On a phone: chart at full width, series picker as a bottom sheet, a
  readout strip above the chart, a soft cap of four series.

**The explained figure** is one component with a fixed anatomy:

```
PANEL LABEL (uppercase, 2px ink rule above)
Takeaway sentence, or nothing.
[ SVG chart, server-rendered ]
Percent change from a year earlier, not seasonally adjusted
Source: U.S. Bureau of Labor Statistics · data to Sep 2026 · retrieved 11 Nov 2026 · preliminary
▸ How to read this        ▸ Show the table        Open in Explorer →
```

Takeaways come from a small set of fixed templates, not AI, and only state figures ("Consumer
prices were 3.1% higher in September 2026 than a year earlier, down from 3.4% in August"). They
carry no adjectives and no judgment. A template returns nothing when the
latest period is partial, stale, estimated, across a break, or when two series are not comparable;
the figure then states the data state in words.

---

## 4. Architecture

### 4.1 Shape

```
        host systemd timer (daily, America/New_York)            Caddy (existing, shared)
                        |                                                |
              +---------v-----------+                         +----------v-----------+
              | ingest job          |  one-shot, holds LOCK   | web (Next.js 16)     |
              | Python + Node step  |  the only writer        | always on, read-only |
              +----+-----------+----+                         +----------+-----------+
       writer-only |           | promotes                                | read-only mount
          +--------v---+   +---v--------------------------+              |
          | STORE      |   | PUBLIC                       <--------------+
          | raw/       |   | releases/{release_id}/       |
          | fetchlog   |   | CURRENT   STATUS.json        |
          | obslog/    |   | pins.json                    |
          | metalog/   |   +------------------------------+
          +------------+
```

Decisions: ADR 0001 (stack), 0002 (Python writer), 0003 (one engine), 0004 (files, two volumes),
0008 (deploy).

### 4.2 Modules and seams

| Module | Language | Interface | Hides |
|---|---|---|---|
| **Source adapter** | Python | `fetch(spec) -> RawCapture`; `parse(capture) -> NormalizedState` (observations, metadata, `complete`). Raises on failure; never invents or passes partial data as complete | Per-host throttle, serial requests, backoff, the 429 breaker, User-Agent policy, paging, encodings, SDMX quirks |
| **VintageStore** | Python | `record(state, capture) -> ChangeSet`; `replay(captures)`; `export_public(allowlist) -> staged release` | Raw blob store, fetch log, state hashing, the observation log, tombstones, metadata history, capture confirmations |
| **Release** | contract | A directory validated by `schema/release.schema.json` | (It is the seam between the writer and every reader. Three things write one: the committed fixture release, the legacy converter from M2, and the real writer from M9) |
| **Legacy converter** | Python | `legacy_release(v1 files) -> local release` | v1's `atlas.json` layout, month arrays, sparse and held series, v1 channels and derived lineage. Local profile only (section 6.1); removed at cutover unless Alex keeps it for local use |
| **Publisher** | Python, with a Node step | `publish(staged) -> promoted \| rejected(reasons)` | LOCK, staging, Python checks, the Node step, atomic `CURRENT` replacement, `STATUS.json`, retention, pins, withdrawal |
| **core** | TypeScript, pure | `resolve(series, asOf) -> VintageAnswer`; `evaluate(request, data) -> Answer`; `measure(reading, data) -> EvidenceRow`; statistics | Cutoff policy, basis selection, aggregation by measure kind, the transform contract, recipe dependency closure, rights intersection, window sensitivity. No I/O; runs in Node and the browser |
| **ReleaseReader** | TypeScript (Node) | `open() -> ReleaseHandle`, fixed once per request | File layout, schema validation on open, caching by release id, the failed-refresh state |
| **Query** | TypeScript (Node) | `query(request) -> Answer` from a validated, allowlisted request | Reader + core + RightsGate + caps on rows, bytes and time |
| **RightsGate** | Python and TypeScript, generated from one table | `permits(rightsUsed, surface) -> allow \| deny(reason)` | Derivation from status and channel; most restrictive wins; the legacy representation is denied on every public surface |
| **figure** | TypeScript, pure | `renderFigure(spec, data) -> {svg, table, takeaway, stateLine}` | Scales, ticks, layout at any width, data-state marks, takeaway templates and silence rules, palette |
| **Delivery adapters** | TypeScript | Pages, suffix twins, REST routes, the `atlas-core` CLI (later MCP) | Parameter parsing and serialisation only |

Who writes what in a release: Python creates the staging directory and writes stored series,
content and manifest. The Node step (`atlas-core verify --release staged/`) writes only `derived/`,
`search.json` and its check report inside that staging directory. Python then writes bulk files
from stored plus derived tables, and alone promotes. One job, one lock (ADR 0002).

### 4.3 Storage

```
$ATLAS_STORE/                         writer-only; never mounted by web
  LOCK                                a second run exits at once with a clear message
  raw/{source}/{yyyy-mm-dd}/{sha256}.gz   exact bytes as fetched; kept for good
  fetchlog.ndjson                     every attempt: retrieval time, request, status, response
                                      headers, raw hash, adapter version, the register row's
                                      rights then, paging and completeness evidence
  obslog/{key}.parquet                the observation log (columns below)
  metalog/{key}.ndjson                unit, definition, adjustment, source, rights over time
  caplog/{key}.ndjson                 every complete capture recorded for the series, with its
                                      scope and state hash; an unchanged one is a capture
                                      confirmation (ADR 0022)
  runs.ndjson                         one line per run; drives missed-run detection
  rejected/                           check reports of failed runs
  retired/                            releases withdrawn from PUBLIC (ADR 0006)

$ATLAS_PUBLIC/                        read-only for web
  releases/{release_id}/
    manifest.json                     profile (public | local), the rights-register version it
                                      was built against, ids, hashes, schema and semantics versions, per-source
                                      freshness, per-series {state hash, channel, rights}, the
                                      withheld list with reasons, the check report
    catalog.json                      public series metadata, rights, recipes
    series/{key}.json                 native-frequency observations, metadata history, coverage
    vintages/{key}.json               the public vintage rows and capture confirmations for a key
    derived/{key}.json                recipe outputs, written by the Node step
    content/                          compiled public events, topics, claims, data notes
                                      (no drafts, no user notes)
    locks/{claim_id}.v{n}.lock.json
    search.json
    downloads/                        observations.parquet, .csv.gz, .ndjson.gz, vintages.parquet,
                                      datapackage.json
  CURRENT                             text file: the promoted release id
  STATUS.json                         last run: started, finished, outcome, failed checks
  pins.json                           release ids that retention must keep

$ATLAS_LOCAL/                         local-profile releases only (section 6.1); same layout as
  releases/{release_id}/  CURRENT     PUBLIC; never mounted by a production container; git-ignored
```

Observation log columns: `key, period, period_start, period_end, value` (unrounded), `status`,
`deleted` (tombstone, only from a complete fetch), `provider_from, provider_to,
provider_precision`, `recorded_from, recorded_to`, `release_id` (the run that wrote the row),
`channel`, `representation` (`native` or `legacy_monthly_rounded`; never mixed). M8 added
`capture_id` (the capture that opened the row) and `metadata_hash`, keeps `value` as the
provider's decimal text, and leaves `release_id` and the provider times empty (ADR 0022).

As built in M9 (ADR 0023, `docs/method/release-writer.md`): each release root also has its own
`LOCK`, taken before the store's; `root.json` (the root's profile and whether its values are an
agency's or invented), `withdrawn.json`, `trash/` and `.staging/`; release runs are lines marked
`"job": "release"` in the store's `runs.ndjson`. M9 writes `manifest.json`, `catalog.json`,
`series/` and `content/annotations.json`; the other files of a release arrive with their
milestones (`vintages/` M10, `derived/` M11, content M19, `locks/` M20, `search.json` M22,
`downloads/` M25). A release run does not fetch: `atlas capture`, `atlas replay`, `atlas release`
run in that order, and one job for the three is M26's.

As built in M10 (ADR 0024, `docs/method/vintage-resolution.md`): the release contract is 0.2.0
and `vintages/{key}.json` holds, for each published stored Series, its versions, metadata
history and Captures with their scope; the manifest row carries `vintages_sha256`. The file is
written only when the gate permits every Origin, dataset and Channel the history came through.
`resolve()` never mixes the Origin's clock and Macro Atlas's in one answer, and decides
`uncertain` per Observation from the Captures that asked about its Period.

As built in M11 (ADR 0025, `docs/method/transforms.md`, `docs/method/release-writer.md`): the
series table lists Recipes (`cpi_yoy` first); `atlas-core verify` computes them in a directory
of its own under `.staging/`, before the release id exists, and Python checks what it left
before taking the Derived files in; spot values are `checks/spot.json`; a Derived series is
published only when everything it rests on is, and carries the most restrictive rights status
of its inputs; `semantics_version` is 0.6.0; `deploy/ingest.Dockerfile` is the ingest image.

Rules:

- **A release is immutable once promoted.** Promotion is one atomic replacement of `CURRENT`. A
  failed run leaves `CURRENT` alone and updates only `STATUS.json`; the site keeps serving the last
  good release and says "the 11 Nov refresh failed".
- **Each request reads `CURRENT` once** and uses that release for text, figures, tables and links.
  A promotion or rollback takes effect with no restart.
- **Only allowlisted material enters PUBLIC.** Withheld series, v1's legacy series, draft claims,
  user notes and raw bytes are never copied in. "Hidden" means absent from release JSON, search, twins and
  bulk files, not merely unlinked.
- **"Changed" is a hash of the full normalized state** per series plus a separate hash of its
  metadata. A change of unit, definition, adjustment, source or rights is a revision.
- **Unchanged complete fetches are logged** as capture confirmations. They are what `capture gap`
  is computed from.
- **Raw blobs are kept for good** (worst case about 0.6 GB a year) so a parser fix can replay them.
- **Retention:** the last 30 releases plus everything in `pins.json` (releases named by a claim
  lock, a saved query or an Edition). Pruning renames into `trash/` first and deletes a day later.
  A pruned release answers `410 Gone` with a link to the current one.
- **Backups, off-host, nightly [ALEX: target]:** all of STORE, plus `pins.json`, `CURRENT` and
  every pinned release. Catalog, content and locks are in git. The restore test rebuilds a release
  from a backup and requires a locked claim to show its original numbers.
- **Withdrawal** (a permission was wrong): `atlas withdraw <key>` publishes a new release without
  the series and everything derived from it, moves every retained release containing it to
  `STORE/retired/`, and leaves an explanatory page for links pinned there. Affected claim locks
  keep their provenance and show their numbers as withdrawn until the claim is re-locked on a
  permitted source.

### 4.4 Publishing a release

`atlas release` runs to completion and exits non-zero on any failure:

1. Take `LOCK`. Fetch per each entry's refresh rule, hosts in parallel, requests to one host
   serial, with backoff and one retry pass at the end. `record()` each state.
2. `export_public()` writes a staged release from the rights allowlist.
3. Python checks: release schema, storage integrity (hashes, monotonic periods, no NaN, no future
   observations unless projected), v1's staleness and range checks.
4. Node step: materialise recipes into `derived/`; check derived ranges and spot values against
   `checks/spot.yaml` (independently sourced expected values); verify every public claim has a lock
   whose spec hash matches; compute each claim's unlocked *latest* row and the drift report; build
   `search.json`.
5. Python writes bulk files and `datapackage.json` with checksums and a licence per resource.
6. Rename into `releases/`, replace `CURRENT`, write `STATUS.json`, append `runs.ndjson`, prune.

`atlas release --reuse-data` builds a content-only release (a new paragraph, a newly public claim)
by hard-linking the previous release's data files.

### 4.5 The analytical engine (`packages/core`)

- **Order:** resolve vintage, aggregate to the target frequency, transform.
- **Aggregation is declared per series by measure kind**: stock (last or average, declared), flow
  (sum), rate (mean, or recomputed from numerator and denominator where a recipe says so), index
  (mean or last, declared), annualized (not summable). An undeclared combination is an error.
- **Transforms are an allowlist** with FRED's names: `lin, chg, ch1, pch, pc1, pca, log,
  rebase:{period}, z`, plus v1's drawdown. Lookback, gaps (no interpolation), daily year-over-year
  (aggregate first), partial periods and the z reference window are specified once in
  `docs/method/transforms.md` and tested from that text.
- **Recipes** define derived series. The engine computes the dependency closure with cycle
  detection, resolves each input's vintage separately, reports the weakest basis among inputs,
  takes the most restrictive rights, and refuses incompatible units.
- **As-of resolution.** Cutoff: strictly before 00:00 America/New_York on the claim date unless the
  claim has a time and the provider vintage has datetime precision **[ALEX: confirm, D7]**. Returns
  the basis, the capture gap and a same-day-release flag. No coverage returns `unavailable`.
- **Claim measures** are a closed list of computations that return numbers, never true or false:
  the value at a period, the change over a window, the extreme in a window and its date, the rank
  in a window, the difference between two periods.
- **Window sensitivity** recomputes a measure over a declared set of alternative windows and
  reports each result, so the reader sees how much the chosen window matters.
- **No finding.** The engine has no rubric and produces no label, rating or pass/fail (ADR 0011).
- **Three evidence rows, never confused:** *then* (locked), *now when checked* (locked), *latest*
  (recomputed each release and shown as such).
- **What a lock freezes:** the claim specification and its hash; resolved periods and windows;
  units; basis and cutoff per row; recipe identity; the exact numbers, including the
  window-sensitivity table; the release id and `semantics_version`. So an engine change cannot
  alter published evidence. Locks are append-only; a re-lock needs a reason.
- **`semantics_version`** is echoed in every answer. A behaviour change bumps it. Old versions are
  not kept executable; the drift report lists locks whose numbers would differ, for a person to
  re-lock.
- **A `pin=` link pins data, not the computation.** It resolves against a retained release and is
  drawn by today's engine, with a banner saying so. Pinned responses are cached by release id plus
  engine version, not as `immutable`.
- **Statistics are descriptive.** Correlation is shown on changes by default with n, the window,
  the common frequency and the missingness. v1's `p < 0.05` hint is not ported: with trending,
  autocorrelated series and a lag search it misleads.

### 4.6 The web app

- Next 16 App Router, React 19, Tailwind 4, TypeScript, Vitest, copied from mission-dashboard's
  skeleton. The agent reads `node_modules/next/dist/docs/` first.
- `basePath` from a `BASE_PATH` build argument; production and staging are two builds of one commit.
- Server components read through Query. Client islands: search sheet, glossary popover, theme
  toggle, the Explorer.
- **Content Security Policy.** /missions sends `script-src 'self' 'unsafe-inline'` as Report-Only.
  A `'self'`-only enforced policy breaks Next's inline bootstrap, and a nonce makes every page
  dynamic. So M1 runs a spike: enforce a nonce or hash policy only if it works with release-keyed
  caching and no-JS rendering; otherwise ship /missions' Report-Only policy. Either way the agent
  records the result in an ADR, and nothing loads from a CDN.
- **JavaScript budget.** M1 measures the framework floor and sets the reading-page budget at the
  floor plus 15 KB, recorded in an ADR. It is not a stop for Alex.
- **Health.** `/api/health`: liveness, release id and age, never an upstream call. `/api/v1/status`:
  per-source and per-series freshness and the last run's outcome. A fresh release with stale inputs
  is reported as stale inputs.
- **Charts:** SVG drawn by `figure`, using bundled `d3-scale` and `d3-shape` as pure functions. No
  chart library. Every chart has a table and a summary sentence or state line.
- **Search:** `search.json` built at release time; `/` focuses search; results grouped by kind.

### 4.7 Daily refresh and capture

- **Schedule.** A host systemd timer with `OnCalendar=… America/New_York`: main run about 10:45 ET
  (after the 08:30 and 10:00 ET releases, in both daylight regimes), optional second run about
  17:30 ET (after the Fed's 16:15 H.15). A fixed UTC time would miss 10:00 ET releases in winter.
- **Same-day is a target, not a guarantee.** A failed fetch is retried in the run and by the next
  run; the status route and each series page show per-series freshness.
- **Missed runs** show as "release N hours old" in the footer and status route, and as capture gaps
  that downgrade as-of answers across them to `uncertain`.
- **Interim capture (ADR 0012).** From M7, a raw-only job fetches the rights-cleared agency
  endpoints (first list: BLS, Treasury Fiscal Data, Federal Reserve Board) and keeps bytes plus
  retrieval time, request, headers and paging evidence. M8's store replays them with their original
  retrieval times. Scheduled GitHub workflows fire only from the default branch, so this cannot
  live on `v2`. Options **[ALEX, D6]**: (a) a separate private repository whose scheduled workflow
  commits each day's captures to itself (recommended: durable, off the Mac, no merge to `main`);
  (b) a cron entry Alex installs on the VPS, with a nightly off-host copy; (c) launchd on the Mac
  (loses days when it sleeps); (d) wait for staging and accept the lost days. Either way the job
  reports a missed day, and moving capture to the VPS later is a written hand-off.

### 4.8 Deploy

- `deploy/compose.yaml`: `web` (Next standalone on `node:24-alpine`, non-root, PUBLIC read-only,
  healthcheck, listening on `127.0.0.1` only, built with an explicit surface per section 6.1) and `ingest` (Python with uv, plus Node; mounts STORE and PUBLIC; reads API keys
  from the server environment).
- Caddy, two non-overlapping matchers, prefix not stripped:

  ```
  @atlas path /macro-atlas /macro-atlas/*
  handle @atlas { reverse_proxy 127.0.0.1:3101 }

  @atlas_staging path /macro-atlas-staging /macro-atlas-staging/*
  handle @atlas_staging { reverse_proxy 127.0.0.1:3102 }
  ```

  The Caddy config is outside both repos; `deploy/Caddyfile.snippet` is for Alex to apply.
- Staging sends `X-Robots-Tag: noindex`. **[ALEX, D9]** Recommended: put staging behind Caddy
  basic auth, so drafts and v1's interim data can be reviewed there. Without it, staging serves
  public-profile releases only and drafts are reviewed on a local build (section 6.1).
- The deploy kit is tested locally: compose brings up both builds behind a throwaway Caddy
  container and a smoke test checks each path serves its own build.
- Every production deploy starts with the preflight `atlas doctor --surface production` (section
  6.1).
- Before the first deploy, a read-only headroom script (`free -m`, `df -h`, container stats) checks
  the VPS can carry two more Next containers and a pandas/pyarrow job beside /missions.
- CI: GitHub Actions on pull requests to `v2` (pytest, Vitest, typecheck, lint, schema check,
  Docker build for both base paths, Playwright smoke). No deploy step.

---

## 5. Data model

Defined once as JSON Schema 2020-12 in `schema/`; Python validates with it and TypeScript types are
generated from it. Terms are in `/CONTEXT.md`.

- **Source** = **Origin** `{producer, dataset, origin_id, url}` + **Channel** `{via, adapter,
  endpoint, auth}`, never merged. **Rights** `{owner, terms_url, status, attribution, reviewed}`
  with status one of `public_domain | cc_by | citation_required | permission_required |
  no_redistribution | unknown`. Permissions `display`, `redistribute`, `ml_use` are derived from
  status and the channel actually used, per row.
- **Series** `key` (immutable), `aliases`, `name`, `description`, `definition {population,
  geography, denominator}`, `unit`, `unit_kind`, `measure_kind`, `freq`, `seasonal_adjustment`,
  `price_basis`, `base_period`, `agg`, `allowed_transforms`, `country`, `segment`, `topics[]`,
  `source`, `fallback[]`, `refresh`, `max_lag`, `range`, `breaks[]`, `status` (draft, active,
  retired), `recipe` (derived series only), `next_release`.
- **Observation** `key, period, period_start, period_end, value, status`. Native frequency,
  unrounded. Rounding happens only at display. Observed and projected are different statuses.
- **Vintage** is the state of a whole series at a moment. It is stored as observation-log rows
  (4.3), one per version of each observation, and returned as a **VintageAnswer**:
  observations plus `basis`, `cutoff`, `capture_gap`, `same_day_release`, release id and
  `semantics_version`.
- **Release** `release_id` (UTC time plus short hash), hashes, versions, per-series state,
  `withheld[] {key, reason}`, check report, `reused_data_from?`.
- **Event** `content/events/{date}-{slug}.md`: `id, date, end?, date_precision, title, category,
  topics[], related_series[], magnitude?, sources[] {url, archive_url}`, `description`. v1's five
  categories plus `disaster`, `infrastructure`, `legislation`. The description states what
  happened and when, supported by the cited sources; it does not evaluate and never says "caused".
- **Annotation** one shape for all layers: `{id, kind, anchor (date | span | period), series[]?,
  label, ref, source}`. Kinds: `event`, `claim`, `recession`, `governance`, `policy`, `data_note`.
- **Topic** `content/topics/{topic}.md`: a definition quoted from a cited source, segment, key
  series, main figure, `companions[] {series, relation}` (a factual relation such as "component
  of"), events. Optional and unused in v2.0: `published_accounts[] {publisher, title, url,
  archive_url, quoted_passage}`, an unranked list of what named third parties have published.
- **Claim** `content/claims/{date}-{slug}.md`: claimant with role and party at the time, `said_on`,
  optional `said_at`, venue, `sources[]` (two, each with locator and archive URL), verbatim
  `quote`, `readings[]` (series, transform, frozen periods and window, measure,
  `alternative_windows[]`), `readings_not_measured[]`, `selection_note`, `checked_on`,
  `corrections[]`, `status: draft | public`. The schema has no field for a finding, rating, label
  or context flag. **ClaimLock** as in 4.5.
- **UserNote** `notes/{user}/…`: one user's own remarks on a claim, series or topic, carrying that
  user's name. Kept outside `content/`, never part of a public release in v2.0.
- **SavedQuery** a pinned Explorer address plus a note. **Edition** (v2.3): year, version, cutoff,
  pinned release, corrections. No Letter.

**Data in.** Everything above is files in the repo. `atlas add series|event|claim|topic|note`
writes a draft file and never commits. `atlas check` validates in layers: schema, references,
semantics (units, measure kinds, recipe graph), rights, and the claim record rules (ADR 0011).

---

## 6. Data sources by priority

Tiering follows research 02 (all checked live on 2026-11-11), re-ordered by the rights default:
origin agencies first, intermediaries only if Alex clears them.

| Priority | Source | What it gives | Auth | Release |
|---|---|---|---|---|
| 1 | **BLS** API v2 / flat files | CPI, payrolls, unemployment, participation, wages | none (keyless tier is rate-limited) | v2.0 (M7, M13) |
| 1 | **Treasury Fiscal Data** | Debt, Monthly Treasury Statement receipts and outlays | none | v2.0 (M13) |
| 1 | **Federal Reserve Board** Data Download | H.15 rates, H.10 FX, H.4.1 balance sheet, Z.1 net worth | none | v2.0 (M13) |
| 1 | **BEA** API | GDP, PCE, income, profits, trade balance | free key **[ALEX]** | v2.0 (M15) |
| 1 | **EIA** API v2 | Energy prices; generation and capacity | free key **[ALEX]** | v2.0 headline (M15); depth v2.1 |
| 2 | **IMF SDMX 3.0** (`api.imf.org`) | Japan CPI fix; G20 CPI and FX; later WEO GDP, commodity prices | none; reuse terms to confirm in the register | v2.0 (M14); v2.2 |
| 2 | **Census** C30 XLSX and other files | Construction spending, retail, housing | none for files (the API now needs a key) | v2.0 top lines (M16); v2.1 |
| 2 | Hand-entered files | Approval, election margins, terms of government, each with a citation | — | v2.0 (M16) |
| 3 | **BIS** SDMX | Policy rates for 18 G20 economies and the euro area | none | v2.2 |
| 3 | **OECD** SDMX, national statistics offices | G20 unemployment and gaps | mostly none | v2.2 |
| 3 | **World Bank** API | Annual GDP, population, trade share (CC BY 4.0) | none | v2.2 |
| 3 | **USAspending** | IIJA by DEF code; CHIPS by federal account | none | v2.1 |
| 3 | **BTS** (Socrata) | Freight TSI, rail, trucking, annual port TEU | none | v2.1 |
| 3 | **OpenFEMA**, **CDC NCHS**, **OWID** | Disaster declarations, deaths, COVID history | none | v2.2 |
| 3 | **NOAA** billion-dollar disasters | Frozen at 2024; shown with its end stated | none | v2.2 |
| 3 | **Philadelphia Fed** real-time data set | Provider vintages for GDP, payrolls, unemployment, CPI | none; terms unclear | v2.1, after a spike |
| 3 | **NTIA** Internet Use Survey | Broadband adoption | none | v2.1 |
| 4 | **e-Stat** file download | Japan CPI source of record (cross-check) | none | v2.0 test only |
| — | **FRED** (83 v1 entries) | Was v1's main channel | none | Not fetched, stored or shown publicly unless cleared (D2). v1's existing values are read on local builds under section 6.1. Used in tests as a cross-check on captured fixtures only if the register allows |
| — | **Yahoo** (25 v1 entries) | Index levels, FX, commodities | none | Withheld from every public surface; v1's existing values are read on local builds under section 6.1. FX and rates are re-sourced from the Fed Board; index levels have no free publishable source |
| — | **EM-DAT** | Disasters | registration | Link only; terms forbid redistribution |

**The rights register** (`docs/v2/rights-register.md`, drafted in M6) has one row per origin and
channel: terms URL, date read, the relevant sentences quoted, licence class, attribution string,
whether display, bulk redistribution, storage and ML description are allowed, and open questions.
The agent proposes; Alex decides and signs once. Rows it must cover: BLS, BEA, Census, Treasury,
Fed Board, EIA, FRED and ALFRED, Yahoo, Philadelphia Fed, IMF, OECD, World Bank, BIS, Eurostat,
e-Stat, BTS, USAspending, OpenFEMA, CDC, NOAA, OWID, EM-DAT.

### 6.1 The interim data rule (D2 open)

Alex's interim basis, 2026-11-11: until he decides D2, **local and staging builds may show v1's
current data, which came through FRED and Yahoo, because nothing is redistributed publicly. The
strict origin-agency allowlist must be in force before anything is deployed to the public
production path.** This is not a reading of FRED's or Yahoo's terms and settles nothing in D2;
access control is a boundary, not a licence. The rule is written so that an autonomous builder
cannot ship that data publicly by accident or by convenience.

1. **Three surfaces.** *Local*: Alex's machine, listening on loopback. *Staging*:
   `/macro-atlas-staging`. *Production*: `/macro-atlas`. Every build is given its surface
   explicitly; a build with no surface, or with a surface that does not match its base path, fails.
2. **Two release profiles.** `public`: written only by the publisher (M9), from the rights
   allowlist. `local`: may also hold v1's legacy series, draft claims and user notes. A local
   release lives under `$ATLAS_LOCAL`, never under `$ATLAS_PUBLIC`, and the production containers
   never mount `$ATLAS_LOCAL`.
3. **Where v1's data may appear.** Only in a local-profile release, as whole series marked
   `legacy_monthly_rounded`. A local-profile release may be served on the local surface. It may be
   served on staging only behind Caddy basic auth covering every route, twin, static asset and
   API path, with no direct port open; staging is on the public internet, so without a password it
   is public. (This last condition tightens Alex's wording; it is what makes "nothing is
   redistributed publicly" true.)
4. **Production serves only public-profile releases.** A public release requires, for every series
   and every input of every derived series, a row in the rights register that Alex has signed for
   that origin, dataset, channel and permission. The output of `atlas legacy-release` is never
   eligible, whatever the register says. An intermediary channel (FRED, Yahoo) becomes eligible
   only if Alex's D2 decision clears it in two places, a signed register row and a dated
   amendment to ADR 0006; a register row alone does not override the origin-only default. Its
   data is then fetched afresh by a real adapter through capture and STORE (M16), never taken
   from `data/atlas.json`.
5. **Fail closed, in five places.**
   - *Writer*: `--profile public` refuses an unsigned or unknown row and the legacy
     representation, and cannot reuse, pin or roll back to a local-profile file.
   - *Reader*: a production-surface build checks every release it opens (current, pinned or
     rolled back). If the profile is not `public`, the register reference is unsigned, or any
     series is legacy, every route answers 503 and the health check fails.
   - *Deploy*: `atlas doctor --surface production` runs before any production deploy and refuses
     the same three things. A staging deploy of a local-profile release first proves that a
     request without the password gets 401.
   - *Build and CI*: generated releases, and v1's own files that hold the same values
     (`data/`, `dist/`, `web/`, `.git`), are excluded from the Docker build context, from image
     layers and from Next's build output (data pages render at request time); generated releases
     are also git-ignored. A test inspects the built image and the build output for a seeded
     value, separately from the profile checks. CI
     previews, screenshots, logs and uploaded artefacts use only the fixture release, which holds
     rights-cleared or synthetic data. Tests that need v1's values build the local release in a
     temporary directory and upload nothing.
   - *Tests*: each check above has a test with a seeded FRED value that must not appear.
6. **The builder may not weaken, skip or work around these checks.** Work that seems to need
   that is parked and reported to Alex (build protocol, point 7).
7. **v2 does not fetch from FRED or Yahoo** unless point 4's two-part clearance exists for that
   channel. The converter reads v1's committed output in place. Nothing from it enters STORE or
   the capture job (ADR 0012 stands).
8. **Duration.** Point 3's permission for local and staging use lasts until Alex records a D2
   decision. Points 4 to 7 do not expire; they change only by an amendment to ADR 0006 that Alex
   approves.

Not covered: v1's own exposure today (the live Pages site and the committed `data/atlas.json`)
is the separate open question D4. This rule neither worsens it nor resolves it; v2 adds no new
committed copy of that data.

**Still unverified** (each is checked in the milestone that first depends on it, with a captured
fixture): BLS keyless limits for daily use; IMF reuse wording; EIA and Socrata rate limits; the
e-Stat file ID surviving a rebase; USAspending state-level IIJA and the BEAD account; monthly port
TEU.

---

## 7. Data out

- **Twins.** `/data/{key}.csv | .json | .metadata.json | .md`, the full native series by default;
  `?freq=&agg=&transform=&start=&end=&as_of=&pin=` on request. `/claims/{id}.json | .md`,
  `/claims/{id}/evidence.csv`. Every page has a `.md` twin.
- **Read API** (`/api/v1`): `catalog.json`; `series/{key}`; `series/{key}/vintages` (with
  `period=` the history of one period); `events.json`; `claims.json`; `status`. Every JSON body
  carries `provenance`, `rights`, `release_id`, `semantics_version` and, for as-of answers,
  `basis`, `capture_gap`, `same_day_release`. Invalid transforms and unknown keys get 400 with the
  allowlist. A series that may be displayed but not redistributed returns 403 with the reason on
  its download and API routes while its page still renders.
- **Limits** in the app (per-IP and global token buckets; caps on rows, bytes and time).
- **Bulk.** `/downloads/{release_id}/`: long-format `observations.parquet` and `.csv.gz` (stored
  and derived, native frequency, unrounded), the same table as `observations.ndjson.gz` (JSON
  Lines), `vintages.parquet`, and a Frictionless v2 `datapackage.json` split into resources by
  licence. `/downloads/latest/` redirects.
- **Discovery.** `/llms.txt` generated from the catalog; schema.org `Dataset` JSON-LD on series
  pages; `<link rel="alternate" type="text/markdown">`.
- **Caching.** Latest addresses use `ETag` = release id plus engine version and a short `max-age`.
  Bulk files under a release id are immutable.
- **MCP** (v2.1, ADR 0007): stateless Streamable HTTP at `/macro-atlas/mcp`, seven read-only tools
  over Query, no SQL, URLs or expressions as input, hard caps, restricted series absent.

---

## 8. Design direction

**Family.** Take /missions' tokens and panel grammar unchanged (ADR 0009): white ground, ink and
hairlines, a 2px ink rule above each panel, no cards, system sans with tabular figures, 14px body
and nothing under 12px, Plot Navy `#2f5e95` as the only interactive colour, 4px corners on controls
and none on panels, flat at rest with shadows only on overlays, status as colour plus icon plus
word. Same top bar, tab bar, skip link and focus ring, and a small "mydashboards" home link in both
apps' top bars (the /missions side is a one-line change in that repo, for Alex's OK).

**One deliberate difference from /missions** (brief, added decision 5): the theme follows the OS
setting (`prefers-color-scheme`), with a manual toggle that overrides it. /missions ignores the OS
setting. Type is system sans everywhere; no serif.

**Added for Macro Atlas** (recorded in this repo's `DESIGN.md` in M1): an Okabe-Ito-based series
palette of eight colours that avoids navy, checked for colour-vision deficiency and contrast in
both themes, with line style as a second channel and end labels instead of a legend where there is
room; no party colours for data (muted tints only in governance bands, with the party named); no
up/down colours (unemployment up is not "good"); statement-table styles; the explained figure.

**Emil Kowalski's principles, applied.** This is a reading and research tool its main user opens
many times a day. By his frequency rule that means almost no motion, and every animation must earn
its place.

| Element | Decision |
|---|---|
| Chart data (add a series, change range or mode), crosshair, readout | No animation. Redraw at once; tabular figures so nothing shifts |
| Keyboard actions, search opening | Never animated |
| Hover on rows and links | Colour only, 120 ms, only where a fine pointer exists |
| Button and chip press | `scale(0.97)` on `:active`, 120 ms ease-out |
| Popovers | 150 ms, `cubic-bezier(0.23, 1, 0.32, 1)`, from `scale(0.97)` and opacity 0, origin at the trigger |
| Bottom sheets and drawers | In 240 ms `cubic-bezier(0.32, 0.72, 0, 1)`, out 180 ms, `translateY(100%)` |
| Highlighted series, layer toggles | 150 ms opacity crossfade |
| "Copied" on a copy button | Label crossfade, 200 ms |
| Overview on first visit | The one small flourish: rows fade up with a 40 ms stagger, never blocking input |

Rules: movement uses only transform and opacity; CSS transitions, not keyframes, for anything that
can be retriggered; no motion library; under reduced motion, keep opacity and colour fades and
remove movement. The unseen details matter most: a readout strip that never changes height;
skeletons that are the chart's own frame and axis; a focus ring drawn inside SVG plots; an error
state that names the source that failed and the date of the data shown; scroll position restored
on Back. No hover-only information anywhere.

**Accessibility and phone budgets** (checked in CI by Playwright on the fixture release): no
horizontal page scroll at 320px; 200% zoom keeps everything reachable; axe-core clean; every figure
has a table and a sentence or state line; keyboard order follows reading order; reading pages
complete without JavaScript; largest contentful paint under 2.5 s on a throttled phone profile. One
manual VoiceOver pass at each release boundary, not per milestone.

---

## 9. Testing

Test-first with the tdd skill: one behaviour at a time through a module's public interface, red,
green, refactor, in vertical slices. Tests never touch the network.

| Layer | Tool | What is proved |
|---|---|---|
| Source adapters | pytest | `parse(captured blob)` gives the expected state; failures raise; incomplete responses are flagged. Fixtures are real captured responses with provenance recorded |
| VintageStore | pytest + hypothesis | A revision opens a new row and closes the old; an unchanged complete fetch adds a confirmation only; tombstones only on complete states; a metadata change is a revision; replay with original retrieval times gives the same store; no overlapping validity intervals |
| Publisher | pytest on temp dirs | Overlapping runs; a kill between staging and promotion; a kill during promotion; disk full; a provider returning stale data, an empty body or HTML; rollback by rewriting `CURRENT`; pruning while a reader holds an older release; pinned releases survive retention; withdrawal retires the right releases |
| Rights | pytest + Vitest table tests | Status × channel → permissions; most restrictive wins; unknown blocks all; every fail-closed check of section 6.1 (writer, reader, deploy preflight, build context) with a seeded FRED value; a withheld series' values appear nowhere in a release (grep test); drafts appear nowhere in a public release |
| core | Vitest | Against **independently specified** expected tables (hand-computed, or published figures such as CPI y/y for 2022-06 ≈ 9.1). Cutoff edge cases; `unavailable` never falls back to current; cyclic recipes fail by name |
| Release contract | both | The fixture release validates in pytest and Vitest; a release written by Python from fixture blobs is read by the TypeScript reader in one CI job |
| Query, twins, REST | Vitest | HTML data, `.json` and `.csv` agree for the same request; 403 for restricted; caps; 400s |
| figure | Vitest | Structural assertions on SVG and table; every takeaway template and every silence rule |
| Claims | Vitest + pytest | The slice story as one test: after a simulated revision the *latest* row changes, the locked rows do not, and a drift report is produced. A spec edit after locking fails the build. Claim record rules fail `atlas check` when broken. The claim and lock schemas reject any finding, rating or label field |
| Site | Playwright | Both base paths, 360px and 1280px, JavaScript on and off for reading pages, axe, keyboard path, budgets, v1 hash links |
| Deploy kit | compose + throwaway Caddy | Each path serves its own build; health; promotion without restart; backup then restore |
| Statistics | Vitest | v1's 16 cases ported; its two caveats (`minN`, quarterly and annual changes) as failing-then-fixed tests |
| v1 comparison | pytest | Re-sourced series against v1's `data/atlas.json` within a stated tolerance; every difference listed with its reason |
| Live sources | `atlas check --network`, nightly and by hand, never in PR CI | Endpoints still answer and parse; archive URLs resolve. Reports only |

A committed **fixture release** (about eight series: provider vintages, observed-only vintages, a
gap, a derived series, a display-only series, a withheld series, a break, a stale series) backs all
TypeScript tests, previews and screenshots. It holds only rights-cleared or synthetic data. Tests
that need v1's real values (Explorer parity, the comparison with v1) build the local release in a
temporary directory; CI uploads no artefact, screenshot or log made from it (section 6.1).

Every milestone PR follows the build protocol in section 10.1: tests first and visible in the
history, CI green, a Codex review, a short "how to see it" note, and the PR body written with the
mattpocock `pr` skill.

---

## 10. Milestones

Reordered at Gate 1 (2026-11-11) so that a site Alex can use comes first. One PR each, to the `v2`
branch. Size is hours of agent work. No acceptance criterion depends on waiting days; soak periods
are checklists before cutover, not PR gates.

**Needs Alex** on each milestone names what only Alex can supply, in the brief's four stop
conditions: **deploy** (production), **merge to `main`**, **money**, **credentials** (API keys,
SSH, anything typed into a server; a staging deploy falls here, since it needs his server access). "—" means the milestone runs start to finish
without him. A decision that is still open never blocks a PR: the recommended default applies and
the result stays local, draft or withheld until he decides.

| Track | Milestones | What it gives | Hours |
|---|---|---|---|
| **A · A site you can use** | M0–M5 | The v2 shell and the Explorer at v1 parity on your machine, on v1's data | ~62 |
| **B · Data foundation** | M6–M18 | Rights register and gate, capture, vintages, the release writer, agency sources, native frequency and as-of in the Explorer | ~108 |
| **C · Content and claims** | M19–M21 | Events as files, claim records and claim pages | ~26 |
| **D · Reading pages and data out** | M22–M25 | Overview, Highlights, search, two topics, read API, bulk files | ~34 |
| **Ship** | M26–M28 | Deploy kit, staging, cutover | ~16 |

Track A runs first and alone, in order. After M5 the default order is by number. Tracks B, C and D
do not block the usable site, and the head of track B (M6, then M7) may be started beside track A
at any time after M0, because all it shares with track A is the `permits()` contract defined in
M0; either order of M2 and M6 works. That matters once Alex has answered D2
for the first three sources and D6: from that day, every day without the capture job is a day of
Atlas-observed history that cannot be recovered (ADR 0012).

### 10.1 Build protocol for the autonomous builder

1. **Branch.** All work lands on the long-lived `v2` branch (ADR 0010). The builder creates `v2`
   from `main` once, in M0. `main` and `refresh.yml` are not touched before cutover (M28).
2. **One PR per milestone**, from a branch `v2-mNN-short-name` into `v2`. The builder merges its
   own PR into `v2` when CI is green and the Codex review is settled. It never merges into `main`.
3. **Tests first.** Use the `mattpocock-skills:tdd` skill: one behaviour at a time through a
   module's public interface, red, green, refactor. The failing test is visible in the history.
   Tests never touch the network.
4. **UI work** (anything under `site/`, any figure, any motion) uses the `emil-design-eng` skill
   and section 8 of this plan. Charts and data get no animation.
5. **Codex is the partner on every milestone** (the rule in Alex's `CLAUDE.md`): send the plan for
   the milestone to Codex before writing code; run `codex exec --sandbox read-only -C <repo>
   review --uncommitted < /dev/null` before each commit that closes the milestone; adopt what is
   right, answer what is not, and put one line `Codex check: <raised> → <done>` in the PR body.
   If Codex is unavailable the PR says "not reviewed" and is not merged into `v2` until it is.
6. **Stop and ask Alex only for:** a production deploy; a merge to `main`; anything that costs
   money; any credential (API keys, SSH, server environment; staging needs these, so it waits for
   them). Everything else the builder decides, records in the PR or an ADR, and continues. An
   open decision (section 12) is not a stop: its recommended default applies, the one acceptance
   item that depends on it is marked "awaiting Alex" in the report, and other work goes on.
7. **Never weaken the interim data rule** (section 6.1). The builder has no authority to relax
   one of its checks or to put v1's FRED- or Yahoo-sourced data on a public surface, in a new
   committed file, a CI artefact or an image. This is not a fifth stop: the piece of work that
   seems to need it is parked and reported to Alex, and the builder carries on with the rest.
8. **Report at the end of each milestone:** what was built, how to see it (one command and one
   address), test and CI results, the Codex line, anything deferred with the milestone it moved
   to, hours used against the estimate, and what Alex is needed for next. The PR body is written
   with the `mattpocock-skills:pr` skill.
9. **Estimates are budgets, acceptance is the bar.** A milestone is reported complete only when
   every acceptance criterion passes. If it passes 150% of its hours it may be split: the working
   part is merged, and the follow-up PR is listed with its remaining criteria and what depends on
   them. The "usable" and "parity" markers after M4 and M5 count only on full acceptance. No
   milestone absorbs its neighbour.

### v2.0 — Track A: a site you can use

**M0 · Foundations (6 h). Needs Alex: —.**
`v2` branch; repo layout (`atlas/`, `packages/core/`, `site/`, `schema/`, `content/`, `checks/`,
`fixtures/`, `deploy/`); CI for PRs to `v2`; `release.schema.json` v0; the hand-written fixture
release. The schema already carries what later tracks need, so that track A is not rebuilt: the
manifest `profile` (`local` or `public`); per series the native frequency, period bounds,
`representation`, origin, channel and rights; a minimal catalog entry; the one Annotation shape;
missing values as explicit gaps. Also the `permits(rightsUsed, surface)` contract with its
default body (allow on the local surface, deny on every other), which M6 later replaces with the
register table; it is the one piece of code tracks A and B share.
AC: `permits()` denies every non-local surface (test); CI runs pytest, Vitest, typecheck and
lint; the fixture release validates in both languages
and contains a sparse quarterly series, an annual series and a held (step) series; `main` and
`refresh.yml` are unchanged; `.gitignore` and `.dockerignore` exclude every generated release.

**M1 · Site shell (12 h). Needs Alex: —.** Needs M0.
Next 16 app copied from the /missions skeleton; tokens and `DESIGN.md`; the theme follows the OS
setting with a toggle that overrides it; top bar and tabs (only tabs that exist are shown; `/`
redirects to `/explore` until the Overview exists in M22); both base paths; Dockerfile and a
`web`-only compose file that binds to `127.0.0.1`; `/api/health`; `ReleaseReader` v0 (open,
validate, read `CURRENT` once per request, cache by release id); the surface setting and its guard
(section 6.1); the CSP spike and the JavaScript-floor measurement.
AC: `docker compose up` serves the fixture release at both base paths on loopback only; rewriting
`CURRENT` changes the served page with no restart (test); everything on a page comes from one
release id (test); the theme follows the OS and the toggle overrides and persists (test, both
themes pass contrast checks); a build with no surface set, or with a surface that does not match
its base path, fails; a production-surface build pointed at a local-profile release serves 503 on
every route and fails its health check (test); the CSP decision and the JS budget are each
recorded in an ADR with a passing test.

**M2 · v1's data through the release reader; transforms; the catalog page (12 h). Needs Alex: —.**
Needs M1.
`atlas legacy-release` (Python): converts v1's committed output (`data/atlas.json`, the v1 catalog,
`events.yaml`, `politics.yaml`, `approval.yaml`) into a `local`-profile release under
`$ATLAS_LOCAL`, using the staging, validation and atomic-promotion helper that the release writer
(M9) will reuse. Each series keeps its v1 key, its `legacy_monthly_rounded` representation, its
real cadence (monthly, quarterly, annual, per election), its v1 channel and the lineage of v1's
derived series; rights are recorded as not settled. The manifest records the input commit and file
hash, and the conversion time separately from v1's own `generated` time. `packages/core` gets the
transform contract for v1's six scale modes (`lin`, `log`, `rebase`, `z`, `pc1`, drawdown), written
first as `docs/method/transforms.md`; the rest of the allowlist in 4.5 arrives in M11. Query v0
(reader plus core, one validated request shape). Export and Query call `permits()` from M0; if M6
has already landed, its register table is what answers and M2 leaves it alone. The `/data` catalog page with search and filters.
AC: all 126 v1 series and 83 events are in the release and it validates; for every series the six
transforms match v1's `stats.js` output for three recorded windows, including a quarterly, an
annual and a held series (differences that are deliberate fixes are listed, not hidden); the
converter cannot write a `public` profile (test); nothing is written to STORE and no network call
is made (test); a visible strip on every page of a local-profile release reads "Local build ·
v1 data via FRED and Yahoo · not for publication"; `make v2` builds the release and starts the
site with one command.

**M3 · The explained figure and series pages (10 h). Needs Alex: —.** Needs M2.
`figure` for line and multi-line charts; takeaway templates with silence rules; data-state marks;
"how to read this"; the table twin; the series palette validated in both themes; glossary pages;
`/data/{key}` v0: name, definition and unit from the catalog, latest value with its period, the
explained figure, a provenance block that names origin and channel as v1 recorded them and the
legacy representation, the table, and a door into the Explorer. Vintage table, as-of and file
twins come in M17.
AC: each silence rule has a test (partial, stale, estimate, break, non-comparable); every data
state renders with a mark and a word; a figure at 320px has no clipped labels; series pages render
complete without JavaScript for all 126 series; a sparse series is drawn as points or steps at its
real cadence, never as an invented monthly line.

**M4 · Explorer I (12 h). Needs Alex: —.** Needs M3.
The interactive chart on `figure`; address state in search parameters; the v1 hash shim; the six
scale modes with per-series valid transforms; small multiples for mixed units; annotation layers
(events by category, governance bands, recessions) from the release's annotations; pinned readout;
the phone bottom sheet; presets.
AC: each of v1's 11 presets and ten recorded v1 hash links open the same selection, mode and
range; a copied link reproduces the view in a fresh session; every v1 event category and the
governance bands can be switched on and off and match v1's dates; no animation on data; nothing is
hover-only; usable at 360px.

> **Usable local site: after M4 (5 PRs, about 52 h).** `make v2`, then open
> `http://localhost:3000/macro-atlas/explore`. Checkpoint A1 **[ALEX, non-blocking]**: use it and
> say what is wrong. Work continues meanwhile.

**M5 · Explorer II (10 h). Needs Alex: —.** Needs M4.
`stats.ts` (descriptive, no p-value hint), lag profile and rolling correlation with guard text,
compare ranges, the snapshot table, CSV and PNG export through one export function that asks
`permits()` (on the local surface every export is allowed and is stamped "not for
publication"; on any other surface it is refused unless M6's table allows it).
The as-of control, `pin=` and saved queries come in M18, when vintages exist.
AC: v1's 16 statistics cases pass plus its two caveats (`minN`, quarterly and annual changes) as
failing-then-fixed tests; compare ranges reproduce v1's result for two recorded pairs; exported CSV
holds the values on screen; a parity checklist of every v1 control is attached to the PR, each
ticked or marked as a deliberate change with the reason.

> **v1 parity on the local site: after M5 (6 PRs, about 62 h).**

### v2.0 — Track B: data foundation

**M6 · Rights register and the rights gate (6 h). Needs Alex: — (D2 is his to sign; unsigned rows
stay blocked).** Needs M0. May start beside track A.
`docs/v2/rights-register.md` with terms quoted and a proposal per row (section 6); `RightsGate`
generated from one table for Python and TypeScript: `permits(rightsUsed, surface)`, keyed by
origin, dataset, channel and permission, most restrictive wins, unknown blocks every public
surface. It replaces M0's default body behind the same contract.
AC: the register has a row for every source in section 6 with a proposal and no decision filled
in; table tests cover status × channel × surface; an unsigned or unknown row permits nothing on a
public surface; the legacy representation is refused on a public surface whatever its row says.

**M7 · Capture kit and the first agency adapter (8 h). Needs Alex: — for the PR; credentials and
D2 + D6 for the job to start.** Needs M6. May start beside track A.
The adapter contract, a fixture adapter, the BLS adapter (CPI-U, unemployment rate, payrolls), the
raw blob store, the fetch log with request, headers and completeness evidence, and `atlas capture`
(raw only). Capture needs only the fetch half of an adapter, so the first endpoint list covers
BLS, Treasury Fiscal Data and the Federal Reserve Board; parsing for the last two arrives in M13
and replays these captures. A ready-to-copy scheduled workflow and a runbook for the capture host.
AC: against captured fixtures `atlas capture` writes a blob and a fetch-log line; an incomplete
response is flagged and a failure raises; a skipped day is reported; the endpoint list is read from
the register and contains only rows Alex has cleared (an uncleared row fails the run); a captured
fixture exists for one endpoint of each of the three sources.

**M8 · Vintage store with replay (10 h). Needs Alex: —.** Needs M7.
Observation log, metadata history, state hashing, tombstones, capture confirmations, `atlas
replay`.
AC: the property tests in section 9 pass; replaying a three-fetch fixture (initial, revision,
withdrawal) gives the expected rows exactly, using the fixtures' retrieval times and not the
replay time.

**M9 · Release writer (10 h). Needs Alex: —.** Needs M6, M8 and M2's promotion helper.
Allowlist export, staging, Python checks, atomic `CURRENT`, `STATUS.json`, `LOCK`, `runs.ndjson`,
retention with pins and `trash/`, the withheld list, `atlas doctor` (including `--surface
production`). Publishes native series only; the derived-series gate arrives in M11. `atlas release
--profile public` writes to `$ATLAS_PUBLIC`; `--profile local` writes a separate release to
`$ATLAS_LOCAL` that adds, as whole series, v1's legacy series for keys not yet live from an
origin, so the local site never loses a series.
AC: a release from fixtures validates; every publisher failure case in section 9 passes; a
withheld series is named in the manifest and its values appear nowhere in the public release; a
public release is refused if any series, or any input of a derived series, lacks a signed row for
its origin, dataset, channel and permission, or carries the legacy representation; `--reuse-data`,
rollback and pins cannot bring a local-profile file into `$ATLAS_PUBLIC` (tests); a series is never
a mix of legacy and origin values.

**M10 · Engine II: vintage resolution (6 h). Needs Alex: —.** Needs M1. May run beside M7–M9.
`packages/core` `resolve()` with every basis, cutoff policy, capture gap and same-day flag; the
reader learns vintages.
AC: expected-table tests pass, including: no coverage returns `unavailable`; a legacy series
answers as-of with basis `legacy` or `unavailable`, never as today's figure; a metadata change is
reported as in force at the cutoff; a browser bundle of core imports no `fs`.

**M11 · Engine III: aggregation, the full transform allowlist, recipes (8 h). Needs Alex: —.**
Needs M9, M10.
Measure-kind aggregation at native frequency, the rest of the transform allowlist in 4.5 (`chg`,
`ch1`, `pch`, `pca` and the daily and partial-period rules), recipes with dependency closure and
rights intersection, `cpi_yoy` as the first recipe, `atlas-core verify` as the Node step of the
publisher, the `ingest` image. Extends `docs/method/transforms.md`; any change to what M2 defined
bumps `semantics_version` and is listed.
AC: tests derived from `docs/method/transforms.md` pass; a cyclic recipe fails with the cycle
named; `cpi_yoy` for 2022-06 matches the published figure within tolerance; derived output carries
the weakest input basis and the most restrictive rights; the Node step writes only inside staging.

**M12 · Catalog v2 and migration (10 h). Needs Alex: —.** Needs M11.
Series schema; a script that rewrites the 109 entries (origin, channel, measure and unit kind,
adjustment, price basis, refresh, rights block); recipes for the 14 y/y series and the ratio;
`atlas check` layers; `atlas add series`; for each entry a proposed origin-agency channel or "no
free publishable source".
AC: all 109 validate; no permission is hand-set; the recipe graph is acyclic; `atlas check` fails
on a seeded error in each layer; a table lists every v1 series as *re-source from X*, *needs D2*,
or *withheld*; v1 keys are unchanged, so every Explorer link from track A still opens.

**M13 · Agency adapters I: Treasury, Fed Board, BLS coverage (10 h). Needs Alex: —.** Needs M12.
Treasury Fiscal Data (debt, receipts, outlays), Fed Board DDP (H.15, H.10, H.4.1, Z.1), remaining
BLS series. The capture list grows to match.
AC: captured fixtures with provenance; each series passes the release gate; each matches v1's
value for the overlap within a stated tolerance or the difference is explained.

**M14 · IMF SDMX: Japan CPI and the G20 CPI and FX rows (8 h). Needs Alex: — (the IMF row of the
register must be signed for the series to be public).** Needs M12.
`api.imf.org` SDMX 3.0 adapter with the observed/projected split; Japan CPI replaces the truncated
FRED series; CPI for all 19 countries and FX for the non-euro members plus EUR.
AC: Japan CPI matches the e-Stat file for the 25 months research 02 checked; a coverage matrix
page generated from the catalog shows what exists per country and why anything is missing.

**M15 · Agency adapters II: BEA and EIA (8 h). Needs Alex: credentials (two free API keys, before
it starts; fixtures cannot be captured without them).** Needs M12.
GDP, PCE, income, profits, trade balance; headline energy prices and generation.
AC: suites pass with no keys present; each keyed source degrades to "stale, last fetched …" when
its key is missing; keys never appear in the repo, logs or fixtures (test).

**M16 · v1 coverage, Census top lines and hand-entered series (8 h). Needs Alex: —.** Needs M13.
Census files for construction, retail and housing headline series; a `manual` adapter for
approval, election margins and terms of government with a citation per value; legacy-channel
adapters only for channels Alex cleared in D2 by a signed register row and an amendment to ADR
0006 (these fetch through capture and STORE like any other; v1's `data/atlas.json` is never a
public source); the v1 comparison test and coverage
report.
AC: every one of v1's 126 series is accounted for as *live from origin*, *live via a cleared
channel*, or *withheld (reason)*; the comparison table is attached with every difference
explained; the public release holds only allowlisted series.

**M17 · Series pages II: vintages, twins and Query (8 h). Needs Alex: —.** Needs M3, M6, M11.
`/data/{key}` gains the vintage table, breaks, citation and reproduce snippet; `.json`, `.csv`,
`.metadata.json`, `.md`; full Query with RightsGate and caps; `/api/v1/status`.
AC: for every fixture series the HTML table, JSON and CSV hold the same values; a display-only
series renders but its downloads return 403 with a reason; `?as_of=` on a date without coverage
shows the unavailable state; the withheld fixture series shows by name with no values.

**M18 · Explorer on agency data (8 h). Needs Alex: —.** Needs M5, M16, M17.
Native frequency in the Explorer (daily, quarterly and annual series drawn as such, aggregation by
measure kind when series are combined), the as-of control, `pin=`, saved queries and `atlas save`,
export that honours rights, and the parity suite of M4 and M5 run again on a public-profile
release.
AC: on a public-profile release each v1 preset and recorded hash link opens the same view or names
the withheld series; a pinned link to a retained release shows the same data after a newer release
is promoted and returns 410 once pruned; export of a display-only series is refused with the
reason; no Explorer test from track A is deleted to make this pass.
(Built: ADR 0032, `docs/method/explorer.md`. Saved queries are kept in the local root only; one
for a public Surface waits for Alex, since a note is a person's own text.)

### v2.0 — Track C: content and claims

**M19 · Events, annotations and the content pipeline (8 h). Needs Alex: —.** Needs M4, M9, M12.
The content compiler (public and local profiles); a lossless script from `events.yaml` (83 events)
to `content/events/*.md`; new categories and spans; annotation projection; event pages and index;
governance and recession layers; `atlas add event|note`. The Explorer's layers now read compiled
content in place of the converter's projection.
AC: a round-trip test covers all 83 events and every v1 field; each citation has an archive URL or
a listed exception; every migrated description is checked against a word list of causal and
evaluative terms and by Codex, and any that fails is listed for Alex with a proposed neutral
rewording, not silently changed; `atlas add` writes drafts only and its output passes `atlas
check`; the Explorer's annotation tests from M4 pass unchanged.

**M20 · Claim engine and claim authoring (10 h). Needs Alex: — (D7 defaults apply; claims stay
draft).** Needs M11, M19.
Claim schema, claims in the content compiler, `atlas add claim`, the closed list of measures,
window sensitivity, `atlas claims compute`, lock files with everything listed in 4.5, `relock`,
the claim record rules in `atlas check`.
AC: the slice story test passes (after a simulated revision the *latest* row changes, the locked
rows do not, a drift report appears); editing a locked reading fails the build; `compute` refuses
to overwrite a lock; a claim with one source or no archive URL fails `atlas check`; the schema
rejects a finding, rating or label field; window-sensitivity numbers match a hand-computed
fixture; a draft claim is absent from a public-profile release; a claim cannot be locked on a
legacy-representation series.

**M21 · Claim page and index (8 h). Needs Alex: —.** Needs M17, M20.
`/claims/{id}` as in section 3, the claims index with filters by person, party and topic and a
count by party, the correction log, `/docs/method/claims` (how a claim record is built), evidence
downloads, twins. A `notes/` reader for the local profile only.
AC: the *then* and *now when checked* rows and the window-sensitivity table come from the lock (a
test swaps the lock and sees the page change); the *latest* row comes from the release and is
marked as such (a second test changes the release and sees only that row change); the page
contains no finding, rating or label (test greps the rendered HTML against a word list); quote,
source and the then/now figures are above the fold at 360×740; a user note renders on a local
build, marked with its author, and is absent from a public-profile release; one fully worked real
claim is included as a draft for Alex.

**Checkpoint A2 [ALEX, non-blocking].** Alex tries one real claim end to end on a local build and
comments on the page and the CLI. Work continues meanwhile.

### v2.0 — Track D: reading pages and data out

**M22 · Overview, Highlights and search (10 h). Needs Alex: —.** Needs M3, M16, M19.
The Overview as home (one row per segment; `/` stops redirecting to the Explorer), the 1/5/10-year
Highlights table where every cell is a door, sparkline and change-strip figure types,
`search.json`, the search sheet and a no-JavaScript `/search`.
AC: the Overview renders complete with JavaScript off; every Highlights cell opens the Explorer at
that window; one query returns grouped hits for a series, an event and a glossary term (topic
hits are added and tested in M23); the search index of a public release contains no withheld series' values.

**M23 · Two topics: Inflation and Jobs (8 h). Needs Alex: —.** Needs M14, M19, M22.
The topic template, "what else moved" with curated companions as small multiples on one axis, the
"US against the G20 range" figure for CPI (data from M14), definitions quoted from the agencies.
AC: every sentence on a topic page is a label, a template sentence or a quoted and cited
definition (test against the content schema, which has no free-prose field); each companion
states a factual relation; the G20 band matches a hand-computed minimum, median and maximum for a
fixture month; compile fails on a dangling reference with file and line; search returns the two
topics.

**M24 · Read API (8 h). Needs Alex: —.** Needs M17, M19, M20.
`/api/v1` routes, validation, caps, rate limiting, `/docs/api`.
AC: a contract test per route; over-limit requests get 429; invalid input gets 400 with the
allowlist; every response carries the fields in section 7.

**M25 · Bulk files and discovery (8 h). Needs Alex: —.** Needs M21, M23, M24.
Parquet, CSV.gz and JSON Lines, `vintages.parquet`, `datapackage.json` by licence, `/downloads`,
Markdown twins for every page, `llms.txt`, JSON-LD, `/docs/method` and `/docs/rights`.
AC: files load in pandas, polars and DuckDB in CI; the three formats hold the same rows (round-trip
test); checksums match; nothing withheld, non-redistributable or legacy is in any bulk file
(test); bulk files are written only for a public-profile release; every link in `llms.txt`
resolves.

### v2.0 — Ship

**M26 · Deploy kit (8 h). Needs Alex: —.** Needs M1, M9, M21.
`deploy/` with compose (`web` and `ingest`), both builds, `Caddyfile.snippet` (including basic
auth for staging), timer units in `America/New_York`, backup and restore scripts, the VPS headroom
script, the capture hand-off procedure, the runbook, the local throwaway-Caddy smoke test, and the
deploy preflight of section 6.1.
AC: the local smoke passes for both paths together; backup then restore reproduces a working STORE
and PUBLIC and a locked claim shows its original numbers; the production preflight refuses a
local-profile release, an unsigned register and a release holding a legacy series (three tests);
containers listen on loopback only; the runbook lists every manual step.

**M27 · Staging (4 h agent). Needs Alex: credentials for the staging deploy (SSH user and key,
applying the Caddy snippet, placing keys), possibly money (backup target).** Needs M26; can run any time after it.
Deploy to `/macro-atlas-staging`, server environment, timer, backups, capture hand-off (replay the
interim captures into the VPS store), restore drill.
AC, all checked on the day: the headroom script shows room; the smoke suite passes from outside;
one release is promoted by the timer path; a restore from the off-host backup passes `atlas
doctor`; if staging serves a local-profile release, a request without the password gets 401 on a
page, a twin, a static asset and the API, and the container port is not reachable from outside. A
separate *soak checklist* (seven daily public-profile releases without intervention, no missed
run) must be ticked before M28; it is not part of this PR.

**M28 · Cutover (4 h agent). Needs Alex: deploy, merge to `main`.** Needs M0–M27, the
soak checklist, the signed rights register (D2) and the cutover rule (D3, approved).
Production at `/macro-atlas`; a GitHub Pages page that carries v1 hash links across to
`/macro-atlas/explore`; `refresh.yml` retired in the same merge (it would otherwise fire on the
merge); tag `v1-final`; merge `v2` to `main`.
AC: the production preflight passes on the release to be served; production serves no value that
came through FRED or Yahoo unless section 6.1 point 4 clears that exact channel (grep test against
v1's `data/atlas.json` for the withheld keys); v1 preset links land on the equivalent v2 view or
name the withheld series; production smoke passes; rollback (restore the previous Pages commit) is
written down and rehearsed on staging.

### v2.1 — Access, history and infrastructure

| # | Milestone | Scope and acceptance | Size | Needs Alex |
|---|---|---|---|---|
| M29 | MCP endpoint | As ADR 0007: stateless, seven read-only tools over Query, resources, caps. AC: SDK client round-trip per tool on the fixture release; caps enforced; withheld and draft material absent; a manual check from Claude Code against the local container recorded in the PR | 8 h | — |
| M30 | Provider vintages | Spike on the Philadelphia Fed data set (format, coverage, terms into the register), then an importer for GDP, payrolls, unemployment, CPI; v1's git history imported as its own `legacy` representation. AC: for a named revised quarter the vintage table shows the advance, later and current values listed in a fixture; no locked claim changes. No-go outcome: the PR ships the coverage machinery and the written reason, and Alex is told | 10 h | a decision if the terms are unclear |
| M31 | Construction | Census C30: total, public, private, water supply, sewage, power, highway, communication (eight named series). AC: the PR's fixture of expected values names each series by its origin identifier; each passes the release gate from captured fixtures and matches a published value for one named period at its native frequency (month, quarter or year); rights recorded; a Construction topic page | 8 h | — |
| M32 | Freight and transport | BTS freight TSI, rail carloads and intermodal, truck tonnage; annual port TEU. AC: as M31 for each named series; monthly TEU recorded as "no free machine-readable source found" unless the spike finds one | 8 h | — |
| M33 | Grid and energy | EIA net generation by source, capacity by source, retail electricity price. AC: as M31 | 8 h | credentials (the EIA key from M15) |
| M34 | IIJA spending | Spike (one day): can budget authority, obligations and outlays be extracted by DEF code and agency? Then three separate series per agency with dated captures. AC: each of the three measures for two named agencies matches the USAspending site's figure for a fixture date; the measures are never summed or mixed in a label. No-go outcome: a written finding for Alex and the series left out | 10 h | — |
| M35 | CHIPS and broadband | CHIPS through federal account 013-0520 and related accounts; NTIA adoption; C30 communication construction; BEAD outlays if its account is found. AC: CHIPS obligations and outlays match the account page for a fixture date, or the spike's no-go is written up; NTIA and C30 series pass the gate. Anything not delivered needs Alex's sign-off; it does not pass as a listed gap | 8 h | — |

### v2.2 — World and shocks

| # | Milestone | Scope and acceptance | Size | Needs Alex |
|---|---|---|---|---|
| M36 | G20 rates and unemployment | BIS policy rates for 18 economies and the euro area, Argentina from its central bank; monthly unemployment for the 19 countries from OECD or national sources. AC: the expected matrix (19 economies plus the euro area × CPI, FX, policy rate, unemployment) is a fixture; every cell is either live from captured fixtures or carries a written "no free monthly source" reason that Alex has accepted | 10 h | — |
| M37 | G20 GDP and the peer band | WEO with observed and projected values split and a dated capture per WEO release; the band figure for GDP growth and unemployment. AC: projections are never drawn as observed (test on the boundary year); the band matches a hand-computed minimum, median and maximum | 8 h | — |
| M38 | Trade and commodities | IMF commodity price indices; US trade balance, exports and imports; World Bank trade share for the G20. AC: as M31 for each named series | 8 h | — |
| M39 | Disasters and health | OpenFEMA declarations; NOAA billion-dollar series to 2024 with its end stated; CDC deaths; OWID COVID; EM-DAT as a link only. AC: as M31 for each named series | 8 h | — |

### v2.3 — Report-style views

| # | Milestone | Scope and acceptance | Size | Needs Alex |
|---|---|---|---|---|
| M40 | Statement tables: shell and federal | The statement-table figure type, Notes generated from the catalog, print stylesheet, the two-layer navigation; the federal statement from the Monthly Treasury Statement (cash) and the accrual balance sheet as a hand-entered annual table with page citations; an ADR on fiscal against calendar year, stock against flow, cash against accrual. AC: every header states entity, basis and period; no total across bases; Notes lists every break | 10 h | — |
| M41 | National and external statements | GDP, income, net worth; trade, current account, investment position. AC: each line maps to a catalog series or says "no free source"; every cell is a door | 10 h | — |
| M42 | Segment pages | One page per segment from a single template: a metrics strip, two to four figures, events. AC: every sentence is a label or a template sentence; all six segments render from catalog data alone | 8 h | — |
| M43 | The 2025 Edition | Freezing (pin plus rendered figures and tables), corrections log, the "compiled later" label, three views (as in this Edition, as first reported, today's estimate). AC: a renderer change does not alter a frozen Edition; a correction makes v1.1 and leaves v1.0 at its address | 10 h | — |
| M44 | Claims depth and user notes | Claim markers in the Explorer, the choose-your-window control, the drift report on the status page, a "report an error" link; the user-notes layer on public pages if Alex wants it, marked with the author and excluded from the data files. AC: a note never appears in a twin, the API or a bulk file (test) | 8 h | a decision: notes public or not |
| M45+ | More topics | Two topics per PR (housing, federal budget, energy and grid, freight, G20 growth, …), same rules as M23 | 8 h each | — |

### Order and lead times

Track A is strictly in order (M0 to M5). After it the default is number order; hard prerequisites
are on each milestone. Beyond those: M6 and M7 may start any time after M0, and should start as
soon as D2 (first three sources) and D6 are answered; M10 can run beside M7–M9; M13, M14 and M15
are independent of each other; track C needs M12 and M17 but not M13–M16 or M18, so it can be
pulled ahead of those if Alex wants claims sooner; v2.1 and v2.2 milestones can be reordered by
what Alex wants to study first.

What the reorder costs: three more PRs and about 24 more agent hours in v2.0 (the converter, the
surface guard, and bringing the Explorer over from v1's monthly data to agency data in M18), and a
later start for the capture kit's code (M7, not second). The second cost is nil while D2 and D6
are open, and is avoided afterwards by starting M6–M7 in parallel.

| Alex's input | Needed before | If it is late |
|---|---|---|
| Gate 1: this plan, D1 scope, D3 cutover rule | M0 | Done 2026-11-11 |
| Nothing | M0–M5 (the usable local site) | — |
| D2 rights for BLS, Treasury, Fed Board; D6 capture host | M7's job starting | Capture days are lost; the build continues |
| D2 remaining rows (FRED, Yahoo, IMF, Census, …); D5 stock index | M12 (IMF: M14) | Affected series stay withheld on public surfaces; still visible locally under 6.1 |
| BEA and EIA keys (D8) | M15 start | M15 is skipped and done later; GDP and energy come only from v1's data, locally |
| D7 claims rules | M20 | Defaults apply; claims stay draft |
| Checkpoints A1 (after M4) and A2 (after M21) | — | Non-blocking |
| SSH, Caddy with basic auth, env, backup target (D9) | M27 | Everything stays local |
| Signed rights register (D2), soak checklist, cutover approval | M28 | v1 stays live; nothing reaches the production path |

---

## 11. Risks

| Risk | Containment |
|---|---|
| The rights decision leaves v2.0 with far fewer series than v1 | Agency re-sourcing is the core of track B; withheld rows are named, not silent; D3 lets Alex set the cutover bar; v1 stays live until he is satisfied |
| An agency source (BLS keyless tier, Census files) is rate-limited or changes format | Serial per host, backoff, breaker; captured fixtures; flat files as a second path; a failed source degrades to "stale", never to invented data |
| Vintage coverage is thin at launch | `unavailable` and `uncertain` are designed, tested states; capture starts as soon as D2 and D6 allow (M6–M7 can be built beside track A); provider vintages in M30 |
| Two languages drift | The mathematics exists only in `core`; one cross-language test on the release contract; the schema is the single source |
| Autonomous PRs too large or stuck on Alex | No milestone over 12 h; stops and lead times are listed per milestone; no wall-clock acceptance criteria |
| A claim page is read as partisan, or a quote is wrong | The site gives no verdict at all; two archived sources per quote; a selection note and a count by party on the index; correction log; claims hidden until Alex opens them |
| The site's own text drifts into opinion | Claim and topic schemas have no free-prose or finding fields; pages are labels, template sentences and quoted definitions; event descriptions are the one hand-written text, limited to cited statements of what happened and checked in M19; an HTML word-list test on claim pages; each Codex review checks for evaluative language |
| The choice of readings and windows is itself a judgment | Readings not measured are listed; window sensitivity shows every declared window; the selection note says why the claim was recorded |
| v1's FRED- or Yahoo-sourced data reaches a public surface while D2 is open | The interim data rule (6.1): separate volume, explicit surface, fail-closed checks in the writer, the reader, the deploy preflight and the build context, a test for each; the builder may not relax them; staging only behind a password |
| The Explorer is built on v1's monthly data and must be redone for native frequency | The release schema carries native frequency, period bounds and representation from M0; sparse and held series are tested in M2–M4; M18 extends the same components and may not delete track A's tests |
| Something is published that should not have been | Allowlist releases; grep tests; a written withdrawal procedure that retires affected releases |
| Next 16 differences, CSP or the JS floor trip the build | Bundled docs read first; spikes in M1 before any reading page depends on the answer |
| The shared VPS is short of memory or its IP is throttled | Headroom check before the first deploy; polite per-host fetching; staging can read production's PUBLIC volume to avoid doubling requests |
| Statistics suggest causation | Descriptive only; no p-value hint; a note on what a correlation cannot show |
| The cutover merge is large | Rehearsed on staging; `refresh.yml` retired in the same merge; rollback written down |
| The programme is long | Four releases, each usable; v2.0 alone replaces v1 |

---

## 12. What needs Alex

### Decisions, with recommendations

| # | Decision | Recommendation | Status | Needed by |
|---|---|---|---|---|
| D1 | **Scope staging.** v2.0 replaces v1 and delivers the Explorer, US core series, G20 CPI and FX, claim records with their evidence, the Overview and two topics, and data out. Infrastructure, the rest of the G20 table, trade, disasters and the report-style views follow in v2.1–v2.3 | Approve | **Approved 2026-11-11** | — |
| D2 | **Rights register.** Per source: may v2 store it, show it, offer it for download? In particular FRED (83 v1 entries) and Yahoo (25) | Origin agencies only for storage and display. FRED: not stored, not shown, re-source instead. Yahoo: withheld. Revisit per row if you read the terms differently | **Open.** Interim basis in force (section 6.1): v1's data on local builds and password-protected staging only; nothing from FRED or Yahoo on the production path | First three rows: before M7's job starts. All rows signed: before M28 |
| D3 | **Cutover rule.** What must be live before v1 is switched off | Explorer at v1 feature parity, plus every v1 series either live from its origin or listed as withheld with a reason. Not "all 126 visible" | **Approved as recommended 2026-11-11** | — |
| D4 | **v1's Yahoo exposure today.** The live Pages site embeds Yahoo month-end values | Your call on timing. Options: leave until cutover, or drop the 25 series from v1's public build now (a small v1 change and a merge to `main`) | Open | Any time |
| D5 | **G20 main stock index** (brief amendment) | Amend: show the row as withheld with a link to each exchange. Index levels are licensed from every free channel | Open; the recommendation is the default until you answer | M12 |
| D6 | **Where interim capture runs** | A separate private GitHub repo with a scheduled workflow that commits its captures to itself. Second choice: a cron entry you install on the VPS | Open | Before M7's job starts |
| D7 | **Claims.** (a) Public from the start or draft first. (b) The cutoff rule. (c) Whose statements are recorded. (d) Your own notes on claims | (a) Draft until about ten records have tested the page. (b) Strictly before 00:00 ET on the day unless the claim has a time. (c) Public statements by officials, candidates and named pundits, each with two archived sources. (d) Local only in v2.0; shown publicly, marked as yours, only if you choose (M44). Already settled by the brief: no finding, rating or label from the site | Open | M20 |
| D8 | **Free API keys:** BEA and EIA. Later: api.data.gov; optionally Census, FRED (only if D2 allows it), e-Stat | Register BEA and EIA now; they are needed before M15 can start | Open | M15 |
| D9 | **Server:** deploy user and SSH key, the Caddy snippet, server environment, timer, backup target (may cost money), and whether staging sits behind a password | Staging behind Caddy basic auth so drafts, and v1's data while D2 is open, can be reviewed there | Open | M27 |
| D10 | **The "mydashboards" link in /missions' top bar.** Design is otherwise settled by the brief (system sans, OS theme with a toggle, the six segments) | OK a one-line PR in the mission-dashboard repo when M1 lands | Open | M1 |
| D11 | **Published accounts on topic pages:** an unranked, cited list of what named third parties have published | Leave out of v2.0. Add later per topic only if you want it | Open | Any time |
| D12 | **Bagby's contents page** (1995 first edition) from your softcover, as a guide to laying out the statement views | Optional; send a photo before M40 | Open | v2.3 |
| D13 | **Broadband measure** | C30 communication construction plus NTIA adoption now; BEAD outlays when the account is identified | Open | v2.1 |

### Approvals and stops

Gate 1 (this plan): passed 2026-11-11. Checkpoints A1 after M4 and A2 after M21 (non-blocking).
Starting the capture job (credentials for its host; D2 and D6). API keys for M15. Staging deploy
(M27). Cutover: the signed rights register, the production deploy and the merge to `main` (M28).
Any later production deploy. Milestones that need Alex: M15 (keys), M27 (SSH, Caddy, deploy,
possibly money), M28 (deploy, merge to `main`); in v2.1, M33 reuses the EIA key. Every other
milestone runs without a stop. A few hold one acceptance item for a decision of his, as marked
(the capture job's start in M7, public claims in M20, and M30, M35, M36 and M44 later).

### Money

None planned. The VPS and domain exist; all keys are free; a private repository with a one-minute
daily workflow is within GitHub's free allowance. The only possible cost is an off-host backup
target, which is your choice.

---

## 13. Ideas beyond the brief

None of these is in the plan. Each is independent and names the point after which it could be added.

- **"What changed" page and feed** (after M18): generated from the observation log, listing new
  releases and revisions in plain sentences, with an Atom feed. The site becomes worth a daily look.
- **Revision profile per series** (after M30): how far a first print usually moves and how long it
  takes to settle. It tells a fact-checker how much weight a fresh number can bear.
- **Appropriated, obligated, spent** (after M34): for IIJA and CHIPS, authorised against obligated against spent
  over time. "How much of the money has gone out" is a constant subject of claims.
- **Published accounts** on topic pages: an unranked, cited list of explanations published by
  named third parties, each with a quoted passage. Only if Alex wants it (D11).
- **Shared user notes:** let more than one user keep a marked, personal layer of notes and
  judgments over the neutral data. Needs the login the brief lists as a later option.
- **Claims re-read each year** (after M43): each Edition lists the previous year's claims with
  their *latest* rows, so a reader sees how the figures moved afterwards.
- **Evidence pack** (after M21): one zip per claim with the evidence CSV, lock, manifest and README.
- **Release-calendar-driven runs** (after M15): fetch each series minutes after its scheduled
  release, shrinking the capture gap from hours to minutes.
- **Guided reading mode** (after M23): a topic as a sequence of steps, one figure and its template
  sentence each. Plain links, no scroll effects.
- **"What is in this number" pages** (after M22): from a Highlights row to its quoted definition
  and its components (an accounting breakdown, labelled as accounting and not cause).
- **Print and PDF Edition** (after M43), in Bagby's spirit.
- **Python client and recipes** (after M25); a **Hugging Face mirror** of the public-domain
  resources **[ALEX: account]**.
- **Congress context** (after M39): Voteview and Clerk roll calls linked from events and claims.
- **Claim leads inbox** (after M44): the Data Commons ClaimReview feed filtered to US economic
  claims, as a private reading list. Not republished.
- **Private research profile:** a localhost-only build over the full store for series Alex may
  study but not republish, if their terms allow personal use. A separate build and volume, no route
  in Caddy. Needs D2. (The local profile of section 6.1 is the interim form of this; whether it
  outlives cutover is part of D2.)
- **In-browser query page** with DuckDB-WASM over the Parquet; a **single-file index** per release
  if JSON stops being fast enough (still no database server).
- **In-browser editor behind a login** (the brief's later option).

---

## 14. How this plan was merged

From the research-first draft: the STORE/PUBLIC split, the single TypeScript engine, the adapter
contract with completeness flags, the three evidence rows, the long-lived `v2` branch, claims
early (moved behind the usable site at Gate 1). From the reader-first draft: `CURRENT` as a text file, `STATUS.json`, the withheld list
shown by name, the CSP and JavaScript spikes, the explained figure with silence rules, the
two-layer navigation, content-only releases.

Changed by the brief's added decisions of 2026-11-11, which both drafts predate: no findings,
rubric or labels (claims are records and evidence only); no Letter and no opinion prose; no
explanations written by the site; the theme follows the OS; "report-style views" in place of "the
Annual Report"; the six named segments; window sensitivity moved into the first claim slice; MCP
moved forward to v2.1 in favour of access over editorial content.

Cut or deferred from both drafts: reproduce mode and executable old engine versions, the private
profile, `ClaimReview`, universal no-JavaScript, per-milestone VoiceOver, the 90 KB hard cap, the
unusual-move spike, share images, risk factors, and (to v2.3) statement tables, segment pages and
the frozen Edition. Added: the raw-capture job, the rights register, the stock-index amendment,
the claim record rules, the user-notes layer, the stop and lead-time tables, the VPS headroom
check, timer times set in Eastern time, bulk JSON Lines, and a withdrawal procedure.

Changed at Gate 1 (2026-11-11): Alex approved the plan with one change, usefulness first. The
first eleven PRs of the Gate 1 draft produced one claim page; now the first six produce the site
shell and the Explorer at v1 parity on a local build, reading v1's data through the release
contract. Capture, the vintage store, the rights gate, the agency sources and the claim engine
keep their scope and rules and follow in tracks B and C. Added by the reorder: the legacy
converter, the surface and profile checks of the interim data rule (6.1), the build protocol
(10.1) and M18, which carries the Explorer over to agency data.

---

Codex check on the Gate 1 draft (milestone numbers in this paragraph are the old ones, before the
reorder): three rounds (outline, full review, re-check), all read-only. Outline round raised:
scope deferral needs explicit Gate 1 approval; locks must freeze more than numbers; a pin fixes
data, not the computation; capture needs durable storage and original retrieval times; "hidden"
must mean absent from PUBLIC; same-day refresh is not guaranteed; 26 milestones, not 24; "Python is
the only writer" against a Node step; rights withdrawal; ordering gaps → all adopted (D1, 4.3–4.5,
4.7, ADRs 0002, 0005, 0006, 0012, M1, M9, M11, M24). Full review raised: the plan contradicted the
brief's decisions added on 2026-11-11, which I had not seen (site verdicts and a rubric, a Letter,
site-written explanations, "annual report" framing, the theme rule); M6 and M11 dependencies and an
unassigned transforms spec; later acceptance criteria that could pass without delivering; bulk JSON
missing; "Vintage" used two ways and policy in the glossary; the history claim overstated → all
adopted: findings, rubric, Letter, explanations and risk factors removed, claims are records and
locked evidence with window sensitivity, user notes are a separate layer, ADR 0011 rewritten, OS
theme, report-style views, MCP moved to v2.1, dependencies and criteria fixed, JSON Lines added,
glossary corrected. Re-check found no high-severity issue and raised four smaller ones (the M10
criterion covered the unlocked *latest* row; event descriptions were unrestricted prose; later
criteria assumed monthly data; one "full Report" remnant) → all fixed. Not adopted: nothing. Not
done: the earlier critique's Codex run never wrote its full output, so its section-by-section
answers and top-10 list were never read; and the last four fixes above were not sent back for a
fourth pass.

Codex check on the Gate 1 reorder (2026-11-11, new milestone numbers): three rounds, all read-only.
Outline round raised nine points: the base path is not an access boundary; a `public` label and a
channel list are too weak a gate; CI artefacts, images and build output bypass the reader; early
pages need catalog, annotation and Query contracts; the converter belongs in Python on the release
contract; local releases must be separate and immutable; period-aware schema before a monthly
Explorer; capture delay costs days once D2 and D6 are answered; protections must not expire with
D2 → all adopted (6.1, M0–M2, M9, `$ATLAS_LOCAL`, M6–M7 startable in parallel). Review of the full
text raised eight: v1's own data files in the build context; register approval alone seemed to
re-admit FRED; M5 used a gate built in M6; missing dependencies (M19, M22, M24, M25, M28); capture
promised three sources but built one; the protocol added stops beyond the brief's four; the budget
rule let an unfinished milestone count; totals → all adopted. Third round found one ordering fault
(M2 and M6 both defining `permits()`) → the contract moved to M0. Not adopted: nothing. Not sent
back: that last fix.
