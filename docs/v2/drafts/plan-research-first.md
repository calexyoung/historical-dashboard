# Macro Atlas v2 — plan draft: research first

Status: draft, one of two independent plans for Gate 1. Written 2026-11-11 against
`docs/v2/BRIEF.md` and `docs/v2/research/01`–`04`. Nothing here is built. No code was changed.

Angle: build the tool Alex needs to check a claim and study an interaction, and make it
trustworthy before making it pretty. Provenance, vintages, claims, data out and Explorer depth come
first. The annual-report storytelling (the Report, Editions, the Letter) is planned and comes last.

Items that need Alex are marked **[ALEX]** and collected in section 9. Optional, more ambitious
ideas are marked **[OPTIONAL]** and collected in section 10.

---

## 0. The plan in one page

1. **The first thing shipped is one complete fact-check, end to end.** Eleven small PRs take one
   direct-agency series from fetch to a claim page: capture, vintage store, release, as-of
   resolution, a series page with provenance and matching downloads, a locked claim computation,
   and a claim page that shows "then vs now" or says the vintage is unavailable. Breadth
   (126 → 300 series, G20, infrastructure), the Explorer and the Report come after the slice proves
   the contracts.
2. **Start the vintage clock early.** Atlas can only say "this value was public by date X" for
   dates on which it was running. Every day without a capture is evidence lost for good. So the
   daily capture job runs from milestone 5, before the VPS exists **[ALEX: where]**.
3. **One writer, files, no database.** A Python one-shot job is the only writer. It keeps raw
   bytes, a fetch log and a bitemporal observation log, then stages, validates and atomically
   publishes an immutable release. The Next.js app mounts releases read-only.
4. **One analytical engine.** "Resolve the vintage, aggregate, transform, test a claim" is
   implemented once, in a pure TypeScript package (`core`). Pages, REST, MCP, the Explorer in the
   browser, the claim CLI and the bulk export all call it. Python never repeats the mathematics.
5. **Rights decide what leaves the building.** Every series carries a rights record with three
   derived permissions (display, redistribute, ML use), tracked per snapshot by the channel the
   values actually came through. Public releases are built from an allowlist. Unknown rights mean
   the series does not appear on any public surface. Yahoo and FRED-channel data are the hard
   cases, and they need a decision **[ALEX]**.
6. **v1 stays untouched.** All v2 work lands on a long-lived `v2` branch. `main` keeps the weekly
   Pages refresh until Alex approves the cutover.

What this plan trades away: the public-facing Report arrives in the last build phase (M34a/M34b of 40 PRs), and the
first visible pages are plain data pages. If the first impression for outside readers matters more
than the research workflow, the other plan should win on sequencing. The architecture here still
supports it.

---

## 1. Goals and non-goals

### Goals (in priority order)

1. **Check a claim honestly.** Given a quote, a date and a reading, show what the data said before
   the claim was made, what it says now, and the difference, with the basis for each answer stated.
   When the vintage is not known, say so and never substitute today's number.
2. **Trace every number.** From any figure: origin agency, dataset, series ID, URL, channel it came
   through, fetch time, snapshot ID, licence, processing applied, and a copyable citation.
3. **Reproduce any answer.** A permalink or claim lock pins the data state, catalog, recipe and
   semantics version that produced it. A rebuild cannot quietly change old evidence.
4. **Data out for machines.** Stable per-series URLs with `.csv`/`.json`/`.metadata.json`/`.md`
   twins, a versioned read API, immutable bulk snapshots (Parquet, CSV.gz, Frictionless manifest),
   `llms.txt`, and a read-only MCP endpoint. Per-series licence in every response.
5. **Explorer depth.** v1's workbench at parity, then native frequency, as-of and first-reported
   views, revision history, honest statistics, annotation layers, saved queries.
6. **Breadth per the brief.** US in depth including infrastructure; G20 headline indicators; trade
   and commodities; disasters and pandemics; politics context.
7. **Public storytelling.** Topic pages and the Report with frozen Editions, in the /missions
   visual family.

### Non-goals for v2.0

- No runtime AI calls on the site. No embeddings search. Search is lexical over a build-time index.
- No database server. (A single-file index such as DuckDB or SQLite is an optional later ADR.)
- No login, no in-browser editor, no claim submission form.
- No intraday data. Daily capture misses intraday revisions; the method page says so.
- No causal verdicts. Causal claims are checked only on their factual premises.
- No promise of "free for ML training". The wording is "machine-readable, licence per series".
- No full port of ingest to TypeScript. Python stays; a source moves only if it has a reason to.
- No counterfactual baselines, DuckDB-WASM query page or `llms-full.txt` in v2.0.
- No ALFRED backfill unless Alex provides a FRED key and accepts FRED's terms for those rows.

---

## 2. Information architecture

Six tabs, as in research 04, in research-first order of construction:
**Data · Claims · Explore · Events · Topics · Report**. (Display order in the bar can still be
Report first once the Report exists; until then the home page is the Data hub with search.)

```
/macro-atlas
  /                         Home. Until the Report exists: search + latest releases + recent claims
  /data                     Catalog: search, filter by topic/source/frequency/country/rights
  /data/{key}               Series page: chart, provenance, vintages, revisions, notes, downloads
  /data/{key}.csv|.json|.metadata.json|.md
  /claims                   Claims file: filter by person, party, topic, label, sufficiency
  /claims/{id}              Claim page (+ .md, .json, /evidence.csv, /evidence.json)
  /explore?s=…&from=…&to=…&mode=…&as_of=…&pin=…
  /compare?s=…&a=…&b=…
  /events, /events/{id}
  /topics/{topic}
  /report, /report/{year}/…           (last phase)
  /downloads, /downloads/{snapshot_id}/…, /downloads/latest/…
  /docs/method | api | rubric | rights | mcp | changelog   (each with a .md twin)
  /api/v1/…                 Read API
  /mcp                      MCP endpoint (Streamable HTTP, stateless)
  /llms.txt
  /api/health               Liveness + current release id and age
```

Rules that shape every page:

- **The page URL is the API.** Add a suffix, get the data behind the page. HTML and downloads are
  generated from the same query answer and are tested to agree.
- **Every figure is a door** into `/data/{key}` or an Explorer state, carrying the pin
  (`pin={snapshot_id}`) when the page is pinned.
- **A basis badge is always visible** next to any as-of value: `provider`, `atlas_observed`,
  `legacy_git`, `uncertain`, `unavailable`.
- **Data states are drawn and named** (preliminary, revised, estimate, projected, partial period,
  stale, missing, break, suppressed), using /missions' three channels: mark, icon, word.
- Series keys are immutable public identifiers. Renames go through `aliases` and redirect.

What a fact-checker sees on a series page, top to bottom: name, definition in plain words
(population, geography, denominator, percent vs percentage points, SA/NSA, real/nominal), latest
value with reference period and release date, chart, **provenance block**, **vintage table and
revision strip**, method breaks and notes, related claims and events, downloads with a copyable
citation and a "reproduce" snippet (curl and Python).

---

## 3. Architecture

### 3.1 Shape

```
                 host timer (daily)                         Caddy (existing)
                        |                                         |
               +--------v---------+                    +----------v-----------+
               |  ingest (Python) |   one-shot,        |  web (Next.js 16)    |
               |  + node (core)   |   only writer      |  always running      |
               +---+----------+---+                    +----------+-----------+
                   |          |                                   | read-only mount
        writer-only|          | publishes                         |
          +--------v---+   +--v---------------------------+       |
          | STORE      |   | PUBLIC                       <-------+
          | raw/       |   | releases/{snapshot_id}/      |
          | fetchlog   |   | current -> releases/{id}     |
          | obslog/    |   | pins.json                    |
          | snapshots/ |   +------------------------------+
          +------------+
```

Two volumes, on purpose. `STORE` holds everything Atlas has ever fetched, including
rights-restricted values and raw bytes; only the ingest job mounts it. `PUBLIC` holds releases
built from an allowlist; the web container mounts it read-only. The web tier cannot serve what was
never copied into a public release.

### 3.2 Modules and seams

Vocabulary from the codebase-design skill: a module is deep when a small interface hides a lot of
behaviour; a seam is real only when two adapters exist.

| Module | Language | Interface (what callers must know) | Hidden behind it | Adapters at the seam |
|---|---|---|---|---|
| **Source adapter** | Python | `fetch(spec, deps) -> RawBlob`; `parse(blob) -> NormalizedState` (observations, metadata, `complete: bool`). Throws on failure; never returns invented or partial-as-complete data. | Per-host throttle, serial requests, backoff, 429 breaker, User-Agent policy, paging, encodings (Shift-JIS), SDMX quirks | One per source family (BLS, FRED, Yahoo, IMF SDMX, …) plus a fixture adapter that replays captured blobs |
| **VintageStore** | Python | `record(state, fetch) -> ChangeSet`; `snapshot() -> snapshot_id`; `export_public(snapshot_id, allowlist) -> staged release` | Raw blob store, fetch log, normalized-state hashing, bitemporal obslog, tombstones, metadata revisions, coverage, retention | Disk store; in-memory store for tests |
| **Release** | contract | A directory validated by JSON Schema (`schema/release.schema.json`): manifest, catalog, per-series files, content, locks, search index, downloads | — (it is the contract between the writer and every reader) | Real release on disk; the committed **fixture release** used by all TS tests and `?mock` previews |
| **Publisher** | Python + Node | `publish(staged) -> promoted | rejected(reasons)` | Stage → Python checks (schema, storage integrity, data QA) → Node checks (`core verify`) → atomic rename → `current` flip → retention honouring pins | — |
| **core** | TypeScript, pure | `resolve(seriesData, asOf, mode) -> VintageAnswer`; `evaluate(request, data) -> Answer`; `runTest(measure, data) -> Result`; `label(assessment) -> Label`; stats functions | Cutoff policy, basis selection, aggregation by measure kind, transform contract, recipe dependency closure, rights intersection, partial periods, claim test ops, rubric | No I/O at all. Runs in Node and in the browser unchanged |
| **ReleaseReader** | TypeScript (Node only) | `open() -> ReleaseHandle` pinned once per request; `series(key)`, `catalog()`, `claims()`… | Filesystem layout, schema validation on open, caching by release id, pin lookup | Disk reader; fixture reader |
| **Query** | TypeScript (Node only) | `query(request) -> Answer` where `request` is a validated, allowlisted object | Reader + core + **RightsGate** + caps (rows, bytes, time) | — |
| **RightsGate** | TypeScript + Python (same table, generated from one JSON file) | `permits(rightsUsed, surface) -> allow | deny(reason)`; surfaces `page`, `download`, `api`, `mcp` | Derivation from status and channel; most-restrictive-wins across inputs | — |
| **Delivery adapters** | TypeScript | Thin: REST routes, suffix twins, MCP tools, page loaders, the `atlas-core` CLI | Parameter parsing and serialisation only | Each is an adapter over Query |

Deletion test on the two modules most likely to be shallow:

- *Query.* Delete it and REST, MCP, twins and pages each re-implement rights checks, caps and
  release pinning. It earns its place.
- *ReleaseReader.* Delete it and core would have to know the filesystem. Keeping it separate is
  what lets core ship to the browser.

### 3.3 Ingest (Python, kept from v1 and corrected)

Kept: v1's parsers and their 49 tests, the fallback chain idea, the QA checks, curl_cffi for
Yahoo. Changed:

- **Adapter contract** replaces the fetch functions in `sources.py`. Every adapter has captured
  fixtures with provenance (capture time, URL, headers, trimming notes), following
  mission-dashboard's `fixtures/README.md`. Tests never touch the network.
- **Refresh policy replaces the never-expiring cache.** Each catalog entry has a `refresh` rule
  (`daily`, `weekdays`, `on_release`, `weekly`). A raw blob is evidence, not a cache: every
  successful fetch is recorded even when nothing changed (that is what proves "still this value on
  date X").
- **Hosts in parallel, requests to one host serial**, with jitter and backoff. FRED failed every
  request of a parallel batch in research 02.
- **Fallbacks are provenance, not disguise.** When the primary fails and a fallback channel is
  used, the snapshot records `via` for that series, and the rights for that snapshot follow the
  fallback channel.
- **Completeness is explicit.** A parse returns `complete: true` only when the adapter can show it
  saw the whole series (expected paging finished, row count plausible against the previous state).
  A period missing from an incomplete response is never treated as withdrawn.
- **Derived series are no longer computed in Python.** v1's `derive_yoy` and `div` become catalog
  recipes evaluated by core (3.6). This removes v1's wrong-attribution bug at the root and makes
  file-order evaluation irrelevant.
- **Build gates on QA.** Nothing is published before checks pass (3.5).

### 3.4 Storage of series and vintages, without a database

```
$ATLAS_STORE/                         writer-only volume, outside git, outside the web root
  LOCK                                exclusive lock; a second run exits with a clear message
  raw/{source}/{key}/{sha256}.gz      exact bytes as fetched
  fetchlog.ndjson                     every attempt: ts, key, url, status, raw sha, state sha, adapter version, complete
  obslog/{key}.parquet                bitemporal observation log (columns below)
  metalog/{key}.ndjson                metadata states over time (unit, definition, SA, base year, source, rights)
  snapshots/{snapshot_id}.json        per-key state sha, via, rights used, catalog sha, code versions, created
  coverage/{key}.json                 which date ranges each basis can answer
  legacy/                             v1 git history imported as its own representation (never spliced in)
  runs.ndjson                         one line per run: started, finished, outcome, promoted id; drives missed-run detection

$ATLAS_PUBLIC/                        read-only for the web container
  releases/{snapshot_id}/
    manifest.json                     ids, hashes, schema version, semantics version, counts, per-source freshness, check report
    catalog.json                      series metadata + rights + recipes (public allowlist only)
    series/{key}.json                 native-frequency observations, the vintage rows for that key, its metadata
                                      history, coverage, and capture confirmations (allowlisted fields only)
    snapshots.json                    index of every snapshot id: created, catalog hash, recipe versions, semantics version
    derived/{key}.json                recipe outputs for the current vintage, materialised by core
    content/events.json, claims.json, topics.json, notes/…
    locks/{claim_id}.v{n}.lock.json
    search.json                       lexical index: series, topics, events, claims, people
    downloads/observations.parquet, observations.csv.gz, vintages.parquet, datapackage.json
  current                             symlink, flipped by atomic rename
  pins.json                           release ids whose bulk files retention must keep (claims, Editions, saved queries)
```

Obslog columns (from research 03, with three additions from review):

| column | meaning |
|---|---|
| `key, period, period_start, period_end, value, status` | The observation state. Value unrounded. Status includes `final`, `preliminary`, `estimate`, `projected`, `partial_period`, `suppressed` |
| `deleted` | Tombstone: the period disappeared from a **complete** response |
| `provider_from, provider_to, provider_precision` | When the publisher says this value was current; `date` or `datetime` precision; null when unknown |
| `recorded_from, recorded_to` | When Atlas held this value: from the first snapshot that had it to the first that did not. `recorded_to` stays null while the value is current. Both null for imported provider vintages. Successful unchanged fetches are logged as **capture confirmations** (per series: timestamps of complete fetches), which is what `recorded_gap` is computed from |
| `closed_in` | The snapshot that set `recorded_to` or `provider_to` on this row. **New.** Under a pin to snapshot S, a row closed after S is read as still open, and capture confirmations after S are ignored, so basis, gaps and values are those known at S |
| `added_in` | The snapshot that wrote this row. **New.** Lets a query answer "using only what Atlas knew at snapshot S", so a later backfill cannot change an old computation |
| `via` | Channel the row came through; drives rights for that row |
| `representation` | `native` or `legacy_monthly_rounded`. **New.** Legacy rows are never mixed into native answers |

Four clocks stay separate: observation period, provider vintage, Atlas retrieval, snapshot ID.

Two as-of modes, kept apart (this resolves a contradiction in the research notes, where provider
vintages are preferred but as-of results are said never to drift):

- **Reconstruct** — the best answer available today to "what was public before date D". It may
  improve when provider vintages are imported later.
- **Reproduce** — the exact answer computed earlier. It pins the knowledge snapshot (`added_in ≤ S`),
  the catalog and recipe hashes, and the `semantics_version`. Claim locks and
  pinned permalinks use this mode. Under the same pins the result must be identical, or the build
  fails; under newer knowledge a difference is reported as "better vintage evidence available" and
  a human decides whether to relock.

Other rules:

- "Changed" is decided by a hash of the full normalized state per series (every period's value,
  status and presence) plus a separate hash of metadata. A unit, definition, adjustment, source or
  rights change is a revision even when values match.
- "First observed by Atlas" is not "first reported". The UI and API use different words for them.
  A first-print series is labelled as a composite of different release dates, not one information
  set.
- **What a pin guarantees.** A pin names a knowledge snapshot, not a release directory. Because
  every release carries all public vintage rows with `added_in`, plus metadata history and
  `snapshots.json`, the *current* release can answer any older pin in reproduce mode. So an
  ordinary `pin=` link keeps working after its release directory is gone. Three limits, stated on
  the method page: a series later removed from the public allowlist stops resolving (the page says
  why); a pin older than a recipe change uses the recipe version recorded for that snapshot
  (recipes are versioned in the catalog and old versions are kept); bulk files under
  `/downloads/{id}/` exist only for retained releases (others return 410 with a pointer to the
  latest).
- **Old mathematics stays executable.** Core carries one `semantics_version` covering vintage
  selection, cutoff policy, aggregation, transforms, claim tests and the rubric. A behaviour change
  adds a new version beside the old one, with the old tests kept; nothing is changed in place. Pins
  and locks record the version and core dispatches on it.
- **What is exact and what is best-effort.** Claim locks are exact for good: they store the
  materialised numbers and results, so they are readable even if recomputation were impossible.
  Pinned links are exact as long as their `semantics_version` is still shipped (the intent is
  always; retiring one is an ADR and needs Alex). Catalog fields that affect an answer (unit,
  measure kind, aggregation, recipe) are part of the per-series metadata history in the release,
  so a pin reads them as of its snapshot; anything else about an old catalog is recoverable from
  the git commit recorded in the snapshot manifest.
- Retention: raw blobs 90 days, then only blobs that revised an existing period **[ALEX: or keep
  all, about 0.6 GB a year worst case]**. Release directories: the last 14 plus everything in
  `pins.json`.
- Backups, off-host nightly **[ALEX: destination]**: `obslog/`, `metalog/`, `coverage/`,
  `snapshots/`, `fetchlog`, `runs`, `pins.json`, every pinned release directory, and the raw blobs
  that retention keeps (revision-bearing ones). The restore drill verifies blob hashes against the
  fetch log. Catalog,
  recipes, content and locks are in git, and each snapshot manifest records the git commit. The
  restore drill rebuilds a release from the backup and requires a pinned claim and a pinned saved
  query to return their original answers.
- Size is small: obslog in low megabytes; a release is a few megabytes of JSON plus bulk files.

### 3.5 Release publication

`atlas release` runs to completion and exits non-zero on any failure:

1. Take `LOCK`. Fetch per refresh policy. `record()` each state into the store.
2. `snapshot()` → `snapshot_id = 2026-11-11T0617Z-ab12cd`.
3. `export_public()` writes a staged release from the rights allowlist.
4. Python stage: release schema, storage integrity (hashes, monotonic periods, no NaN, no future
   observations unless status is `projected`), v1's staleness and sanity ranges on stored series.
5. Node stage, `atlas-core verify --release staged/`: materialise recipes into `derived/`, check
   derived ranges and spot values, check every published claim has a lock whose `spec_hash`
   matches, re-run reproduce-mode rows and require equality, compute each claim's unlocked
   **latest** rows (3.6), build `search.json`.
6. Python serialises the bulk files from stored plus derived tables (no mathematics repeated),
   writes `datapackage.json` with checksums and per-resource licences.
7. Atomic rename into `releases/`, flip `current`, append to `runs.ndjson`, apply retention.

A failed run leaves `current` untouched. The check report of the failed run is kept under
`STORE/rejected/` for diagnosis. Spot checks move from two hard-coded series to a
`checks/spot.yaml` file of independently sourced expected values.

### 3.6 The analytical engine (`packages/core`)

One implementation of the semantics a fact-check depends on.

- **Order:** resolve vintage → aggregate to the target frequency → transform.
- **Aggregation is declared per series by measure kind**, never a generic default:
  `stock` (last or average, declared), `flow` (sum), `rate` (mean, or recomputed from numerator and
  denominator where a recipe says so), `index` (mean or last, declared), `annualized` (not
  summable). An undeclared combination is an error, not a guess.
- **Transforms are an allowlist** using FRED's names: `lin, chg, ch1, pch, pc1, pca, log,
  rebase:{period}, z`. `semantics_version` is echoed in every answer and stored in every lock.
  Lookback, gap handling (no interpolation), daily y/y (aggregate first), partial periods and the
  z reference window are specified once in `docs/method/transforms.md` and tested from that text.
- **Recipes** define derived series: inputs, operation, and the order of aggregation and
  arithmetic ("ratio of quarterly sums" and "quarterly mean of monthly ratios" are different
  recipes). Core computes the dependency closure with cycle detection, resolves **each input's
  vintage separately**, reports the weakest basis among inputs, intersects rights
  (most restrictive wins), and refuses incompatible units.
- **Three kinds of claim evidence row, never confused:**
  - `then` — the as-of vintage before the claim. Locked.
  - `now_when_checked` — the same frozen periods read from the data current on `checked_on`.
    Locked. Together with `then` this is the evidence the label rests on.
  - `latest` — the same frozen periods read from today's release. **Not locked**; recomputed at
    every release, shown in its own row marked "latest data, not part of the assessment", and
    compared with `now_when_checked` by the drift report. A difference never changes the label by
    itself; a human relocks.
- **Claim tests** are a closed list of operations (`is_min_over_window`, `is_max_over_window`,
  `change_at_least`, `level_compare`, `rank_in_window`, `sign_of_change`, …) with tolerances.
- **Rubric:** `label()` is a pure function of the primary measure's as-of result, sufficiency and
  context flags (research 03 §7.2). The vocabulary itself is an open question **[ALEX]**; the two
  research notes propose different word lists and the plan keeps the label set as data so either
  can be used.
- **Statistics:** v1's `stats.js` ported to TypeScript with its 16 tests, minus the features that
  overstate. See 3.9.

Expected results in core's tests are specified independently (hand-computed tables and published
figures), not by comparing two callers of the same code.

### 3.7 Next.js app

- Next 16 App Router, React 19, Tailwind 4, TypeScript, Vitest, copied from mission-dashboard's
  skeleton. Read `node_modules/next/dist/docs/` before writing code: this Next version differs from
  older ones.
- `basePath` from a `BASE_PATH` build argument: `/macro-atlas` and `/macro-atlas-staging` are two
  builds of one commit.
- Server components read through Query. `ReleaseReader.open()` pins the release once per request,
  so a flip mid-request cannot mix two releases.
- Caching: responses keyed by release id. Pinned URLs are `immutable`; latest URLs use `ETag` =
  snapshot id and a short `max-age`.
- **Health:** `/api/health` is liveness plus current release id and age; it never reads upstream.
  `/api/v1/status` reports per-source and per-series freshness from the manifest. A fresh release
  with stale inputs is reported as stale inputs, not as healthy.
- **Security headers:** CSP enforced (not Report-Only) from the first deploy, `'self'` only. No CDN
  scripts or fonts. Origin and Host validated on `/mcp`.
- **Charts:** SVG drawn by the app, using bundled `d3-scale` and `d3-shape` as pure functions (no
  DOM-owning chart library, no Chart.js). Every chart has a data table and a generated summary
  sentence. Values appear in a pinned readout, not only in tooltips.
- **Design:** /missions tokens and panel grammar as-is; Okabe–Ito-based series palette that avoids
  navy; no party colours for series; light by default, dark by `?theme=dark` **[ALEX: confirm
  theme rule and fonts]**. Emil Kowalski's rules for motion: none on chart data or keyboard
  actions; short custom-eased transitions for drawers and popovers only.
- **Search:** `search.json` built at release time; `/` focuses search; results grouped by kind.

### 3.8 Read API, MCP, bulk export

**REST** (`/api/v1`, and the suffix twins, same Query underneath):

| Route | Returns |
|---|---|
| `/api/v1/catalog.json` | All public series: metadata, rights, recipe, coverage |
| `/api/v1/series/{key}` (`/data/{key}.json`) | Metadata, provenance, snapshot, basis, observations with status. Params: `start, end, freq, agg, transform, as_of, pin, mode=reconstruct|reproduce` |
| `/data/{key}.csv` | Same answer as CSV; `Link` and `X-Atlas-Snapshot` headers; full by default |
| `/api/v1/series/{key}/vintages` | Vintage list; with `period=` the value history of one period |
| `/api/v1/series/{key}/revisions` | First-reported vs latest per period, with basis **[OPTIONAL: revision profile statistics]** |
| `/api/v1/events.json`, `/api/v1/claims.json`, `/claims/{id}.json` | Events, claims with locked evidence |
| `/claims/{id}/evidence.csv`, `/evidence.json` | The evidence table and a manifest (snapshot ids, bases, hashes, semantics version) |
| `/api/v1/status` | Release id, per-source freshness, last run outcome |

Every JSON body carries `provenance`, `rights`, `snapshot_id`, `semantics_version`, and for as-of
answers `basis`, `recorded_gap`, `same_day_release`. A series that may be displayed but not
redistributed returns 403 with the reason on its download and API routes while its page still
renders.

**MCP:** stateless Streamable HTTP at `/macro-atlas/mcp`, seven read-only tools over Query
(`search_series`, `get_series`, `get_vintages`, `compare_vintages`, `list_events`, `get_claims`,
`get_download_link`), resource templates under `atlas://`, an optional `check_claim` prompt
template that teaches the method. No SQL, URLs or expressions as inputs. Caps: 600 rows, 256 KB,
2 s, concurrency semaphore. Restricted series are absent.

**Limits** live in the app (per-IP and global token buckets), because stock Caddy has no
rate-limit handler and the Caddy build is shared with other sites.

**Bulk:** `/downloads/{snapshot_id}/` is immutable: long-format `observations.parquet` and
`.csv.gz` (stored and derived series, native frequency, unrounded), `vintages.parquet` (the public
part of the obslog), and a Frictionless v2 `datapackage.json` split into resources by licence
(`public-domain`, `cc-by`, `citation-required`). `/downloads/latest/` redirects.

**Discovery:** `/macro-atlas/llms.txt` generated from the catalog; a Markdown twin for every page;
schema.org `Dataset` JSON-LD on series pages; `ClaimReview` JSON-LD on claim pages as metadata only.

### 3.9 Explorer and statistics, hardened

Kept from v1: URL state (moved from hash to search params), six scale modes, honest sparse fill
for drawing only, recession shading and governance bands, events with citations, two-range
compare, snapshot table, CSV and PNG export, the 11 presets as seeds for topic pages.

Added for research:

- Native frequency per series; forward-filled values drawn as steps and never fed to a statistic.
- As-of control: "latest", "as of date D", "as first observed"; revision strip per period.
- `pin=` in the URL freezes the data state; a banner says so and offers today's figures.
- Mixed units default to small multiples. Rates compare in percentage points.
- **Statistics start descriptive.** Correlation is shown with n, the sample window, the common
  frequency used and the missingness, on changes by default. v1's `p < 0.05` hint is removed, not
  ported: with autocorrelated, trending series, a lag search and many pairs, it misleads. A short
  note says what a correlation on these data cannot show. Effective sample size and a
  multiple-comparison note are a later, separately reviewed addition.
- **Saved queries:** `atlas save "<url>" --note "…"` writes `content/queries/{slug}.md` holding the
  pinned URL and Alex's note; they render at `/explore/saved`. This is the research notebook in its
  smallest form.

### 3.10 Daily refresh and deployment

- **Scheduler:** a host systemd timer runs `docker compose run --rm ingest atlas release` daily at
  a fixed UTC time after the usual 08:30 ET releases (for example 14:30 UTC), with a second run
  later in the day for late releases **[OPTIONAL]**. No scheduler inside a container.
- **Missed-run detection:** the web app reads `manifest.created`; `/api/v1/status` and a footer
  line show "data release N hours old". `atlas doctor` reports gaps in `runs.ndjson`. A gap longer
  than a series' release cadence downgrades as-of answers that span it to `uncertain` (research 03
  §4.4), so a missed day is visible in results, not hidden.
- **Compose:** `web` (always on, read-only mount of `PUBLIC`, non-root, healthcheck), `ingest`
  (job profile, mounts `STORE` and `PUBLIC`, has Python and Node, holds API keys from the server
  environment). One instance only, as in mission-dashboard ADR 0002.
- **Caddy [ALEX]:** two routes on the existing server, no prefix stripping because the app owns
  its base path. Matchers must not overlap: `/macro-atlas-staging` and `/macro-atlas-staging/*`
  to the staging container, `/macro-atlas` and `/macro-atlas/*` to production (a bare
  `/macro-atlas*` matcher would also catch staging). The Caddy config is not in either repo; the
  plan delivers the snippet and a checklist, and Alex or an approved deploy applies it.
- **Staging:** same commit, `BASE_PATH=/macro-atlas-staging`, its own containers and volumes.
  Staging may read production's `PUBLIC` volume read-only to avoid doubling upstream requests from
  one IP **[ALEX: choose]**.
- **CI:** GitHub Actions on the `v2` branch: pytest, Vitest, typecheck, lint, release-schema
  check, Docker build for both base paths, Playwright smoke against `next start`. No deploy step
  until Alex provides SSH access.
- **Before the VPS exists:** the capture job still has to run daily (0.2). Options, all **[ALEX]**:
  (a) a scheduled GitHub Actions job that keeps the store in a **private** data repository or
  release asset; (b) launchd on Alex's Mac, which loses days when it sleeps; (c) wait for the VPS
  and accept the lost days. Recommendation: (a) for public-domain direct-agency series only until
  the rights decision is made. Private storage is an access boundary, not a licence: it does not
  settle whether collecting or keeping Yahoo or FRED-channel data is permitted.
- **Writer handoff:** moving the writer (interim runner → VPS) is a documented procedure: stop the
  old timer, copy the store, verify hashes, run `atlas doctor`, start the new timer. Two writers
  never run at once.

### 3.11 Private research profile **[OPTIONAL] [ALEX]**

Alex may want to study series he cannot republish (Yahoo index levels, third-party FRED series).
If the terms allow personal use, a separate **localhost-only** compose profile builds a private
release from the full store and serves it on `127.0.0.1` with no route in Caddy. It is a different
build and a different volume; no public request can select it and no flag on the public app
enables it. Whether personal use is allowed per source is a judgement for Alex.

---

## 4. Data model

Defined once as JSON Schema 2020-12 in `schema/`, read by Python (`jsonschema`) and turned into TS
types. Terms below go into `CONTEXT.md` (domain-modeling skill) in milestone 1.

**Source** — who produced the data and how Atlas gets it. Two parts, never merged:
`origin {producer, dataset, origin_id, url}` (for example BLS, CPI-U, `CUSR0000SA0`) and
`channel {via, adapter, endpoint, auth}` (direct, or through FRED, IMF, DBnomics…). Plus
`rights {owner, terms_url, status, attribution, reviewed}` with the derived permissions
`display`, `redistribute`, `ml_use`. Rights are recorded per snapshot from the channel actually
used.

**Series** — a catalog entry. `key` (immutable), `aliases`, `name`, `description`,
`definition {population, geography, denominator}`, `unit`, `short_unit`, `unit_kind`
(`percent`, `percentage_point`, `index`, `currency`, `count`, …), `measure_kind` (stock, flow,
rate, index, annualized), `freq`, `seasonal_adjustment`, `price_basis` (real, nominal, n/a),
`base_year`, `agg`, `allowed_transforms`, `country`, `topics[]`, `source`, `fallback[]`,
`refresh`, `max_lag`, `range`, `breaks[]`, `status` (draft, active, retired),
`recipe` (for derived series: inputs, operation, order), `next_release` when known.

**Observation** — one value for one period of one series, at native frequency:
`key, period, period_start, period_end, value (unrounded), status`. Observed and projected values
are different statuses (IMF WEO mixes them; the adapter splits them).

**Vintage** — a state of knowledge about a series, and the row structure that records it. An
obslog row is an Observation plus `provider_from/to/precision`, `recorded_from/to`, `added_in`,
`via`, `deleted`, `representation`. A **Snapshot** is the immutable set of series states Atlas held
at one moment (`snapshot_id`). A **VintageAnswer** is what a query returns: observations plus
`basis`, `mode`, `cutoff`, `recorded_gap`, `same_day_release`, and the snapshot and engine pins.

**Event** — `content/events/{date}-{slug}.md`: `id, date, end?` (spans for wars, shutdowns,
pandemics), `date_precision`, `title, cat, topics[], related_series[], magnitude?`, `sources[]`
(URL plus archive URL), body. Categories extend v1's five with `disaster`, `infrastructure`,
`legislation`. An event page never says "caused".

**Claim** — `content/claims/{date}-{slug}.md`, as in research 03 §7.1: claimant with role and
party at the time, `said_on`, optional `said_at`, venue, source with locator and archive, verbatim
`quote`, `paraphrase`, `claim_type`, `measures[]` (each with series, reading, a target period and
window resolved once and frozen, and a test), `alternative_readings_not_measured[]`, `evidence[]`
(measure × basis), `assessment` (per-measure results copied from the lock, sufficiency, context
flags, prose context, derived label), reviewer, `checked_on`, `selection_note`, revisions.
**ClaimLock** — `claims/locks/{id}.v{n}.lock.json`: `spec_hash`, resolved periods, knowledge
snapshot, bases, input hashes and rights, catalog and recipe hashes, `semantics_version`, the exact numbers, the result per row. Locks are append-only; a relock needs a reason.

**Annotation** — anything drawn on a time axis that is not a series. One shape for all layers:
`{id, kind, anchor (date | span | period), series[]?, label, ref, source}`. Kinds: `event` and
`claim` (projected from their own records), `recession` (from the NBER series), `governance`
(presidential terms, congressional control, Fed chair, shutdowns, from `politics.yaml`), `policy`,
and `data_note` (breaks, rebasings, methodology changes, discontinuations; always on). Native
annotations live in `content/annotations/*.yaml`. Each carries its own citation.

Supporting records: **Topic** (`content/topics/{topic}.md`: intro, member series, events, claims,
competing explanations), **SavedQuery** (pinned URL plus note), **Edition** (year, version, cutoff,
pinned snapshot, corrections log).

---

## 5. v1 → v2 migration, and keeping v1 live

- **Branching.** `main` is v1 and keeps running `refresh.yml` weekly to GitHub Pages. A long-lived
  `v2` branch takes every milestone PR. Merging `v2` to `main` is the cutover and needs Alex. v1
  fixes, if any, go to `main` and are merged forward.
- **Layout on `v2`.** `atlas/` (Python, restructured into `adapters/`, `store/`, `release/`,
  `checks/`, `cli/`), `packages/core/`, `site/`, `schema/`, `content/`, `checks/`, `fixtures/`,
  `deploy/`, `docs/`. v1's `web/` and the Jinja build stay on `main` only.
- **Catalog.** One migration script rewrites the 109 entries into catalog v2: adds origin and
  channel, `measure_kind`, `unit_kind`, SA and price basis, refresh rule, and a rights block with
  `status: unknown` unless the terms have been read and recorded. The 14 `derive_yoy` flags and
  the one `div` become recipes. The three in-memory series (approval, two election margins) become
  real catalog entries with a `manual` adapter reading `approval.yaml` and `politics.yaml`, with a
  citation per value where one exists.
- **Parity check.** A test regenerates a v1-shaped monthly, rounded view from the v2 store for the
  same fetch fixtures and compares it with v1's `atlas.json` series by series. Differences must be
  explained in a table in the PR (the known ones: derived-series attribution, quarterly placement,
  rounding).
- **Content.** `events.yaml` (83) → `content/events/*.md` by script, with archive URLs requested
  for each citation. Presets become draft topic pages and saved queries.
- **Vintage back-history.** v1's git history of `data/atlas.json` (10 commits since 2026-09-23) is
  imported as `legacy_git`, kept as its own representation and never spliced into native
  observations. It proves "Atlas contained this", not "the public knew this".
- **Known v1 issues that v2 fixes structurally:** never-expiring cache; outputs written before QA;
  derived series keeping the wrong source after a fallback; source as a label instead of a URL;
  Japan CPI ending in 2021 (IMF `JPN.CPI._T.IX.M` primary, e-Stat as source of record);
  `rollingCorr` ignoring `minN`; no change-based correlation for quarterly and annual series.
- **v1's Yahoo exposure [ALEX].** `dist/index.html` on GitHub Pages embeds Yahoo month-end values,
  which Yahoo's terms do not allow redistributing. This exists today and is independent of v2.
  Options: leave it until cutover, or remove the 25 Yahoo series from the public v1 build now.
- **Cutover (last milestone).** GitHub Pages serves a small page that rewrites v1 hash links
  (`#sel=…`) to `/macro-atlas/explore?…` and redirects. `/explore` also accepts a v1-style hash
  directly. `refresh.yml` is retired in the same PR. The old page stays available at a dated URL
  for a period Alex chooses.

---

## 6. Testing strategy (TDD)

Per the tdd skill: one behaviour at a time through the public interface of a module, red then
green then refactor, in vertical slices. Tests describe behaviour a researcher relies on, not
internals.

| Layer | Tool | What is tested, through which interface |
|---|---|---|
| Source adapters | pytest | `parse(captured blob)` gives the expected normalized state; failure modes throw; incomplete responses are flagged. Fixtures are real captured responses with provenance. No network |
| VintageStore | pytest + hypothesis | Through `record()` and the as-of export: a revision opens a new row and closes the old; an unchanged complete fetch adds a capture confirmation and leaves `recorded_to` null; tombstones only on complete states; metadata change is a revision; replaying the same fetches gives the same store; no overlapping validity intervals (property) |
| Publisher | pytest | A malformed or failing stage leaves `current` untouched; a crash between rename and flip recovers; a second concurrent run exits; pinned releases survive retention |
| core | Vitest | `resolve`, `evaluate`, `runTest`, `label` against **independently specified** expected tables (`fixtures/expected/*.json`, hand-computed or from published figures such as CPI y/y 2022-06 ≈ 9.1). Cutoff edge cases: same-day release, gap, uncertain, unavailable never falling back to current |
| Release contract | both | The fixture release validates against `release.schema.json` in pytest and in Vitest. A release written by the Python writer from fixture blobs is read by the TS reader in one CI job (the only cross-language test needed, because mathematics lives in one place) |
| Query, REST, twins | Vitest | For the fixture release: HTML data, `.json` and `.csv` agree for the same request; rights 403; caps; pin and reproduce mode |
| MCP | Vitest | Protocol round-trip with the official SDK client against the route handler; tool schemas; caps; restricted series absent |
| Claims | Vitest + pytest | The slice's acceptance story as one test: after a simulated revision the `latest` row changes, the locked `then` and `now_when_checked` rows are identical, and a drift report is produced; a spec edit after locking fails the build; relock appends a version |
| Site | Playwright | Smoke on both base paths, desktop and 320 px, no console errors, CSP violations fail the test, axe checks, keyboard path through search → series → download |
| Statistics | Vitest | v1's 16 cases ported, plus the two v1 caveats as failing-then-fixed tests |
| Parity | pytest | v2 view vs v1 `atlas.json` (section 5) |
| Network canary | scheduled CI, not on PRs | Each source still answers and parses; link and archive URLs resolve. Reports, never edits |

A committed **fixture release** (about six series: one with provider vintages, one with only
observed vintages, one with a gap, one derived, one display-only, one unknown-rights that must
never appear) backs every TS test, `?mock=1` previews and screenshots.

Every milestone PR: tests written first and visible in the commit history, CI green, a Codex
review, and a short "how to see it" note.

---

## 7. Milestones

Each milestone is one PR to the `v2` branch that Fable 5.2 can build without help unless marked.
"AC" = acceptance criteria, all checkable by a test or a command. Sizes: S about a day of agent
work, M two to three, L should be watched for a split.

### Phase A — One fact-check, end to end (the slice)

**M1 · Foundations (S).** ADRs: 0001 one-writer hybrid ingest; 0002 file vintage store, no DB;
0003 one analytical engine in TypeScript; 0004 rights gate and public allowlist releases; 0005
`v2` branch and v1 freeze. `CONTEXT.md` glossary. Repo layout. CI on `v2`. `release.schema.json`
v0 and the hand-written fixture release.
AC: CI runs pytest, Vitest, typecheck, lint; the fixture release validates in both languages; the
v1 workflow on `main` is unchanged.

**M2 · Capture one agency series (M).** Adapter contract, fixture adapter, the BLS adapter for
unemployment rate and CPI-U (SA and NSA), raw blob store, fetch log, refresh policy, completeness
flag. (BLS keyless limits to be confirmed in this PR; flat files as the fallback path.)
AC: `atlas fetch bls:…` against captured fixtures writes a blob and a fetch-log line; a second run
within the refresh window does not refetch but an expired one does; an incomplete response is
flagged and a failure throws.

**M3 · Vintage store (M).** Obslog, metalog, snapshot manifests, normalized-state hashing,
tombstones, `added_in`.
AC: the property tests in section 6 pass; replaying a three-fetch fixture sequence (initial,
revision, withdrawal) yields the expected rows exactly.

**M4 · Publish a release (M).** Stage, Python checks, public allowlist export, atomic promote,
`LOCK`, `runs.ndjson`, retention with pins, `atlas doctor`.
AC: a release from fixtures validates against the schema; an injected failure leaves `current`
unchanged; an unknown-rights series is absent from the public release; a concurrent run exits.

**M5 · Start the clock: interim daily capture (S) [ALEX: where it runs, backup destination].**
Scheduled job, store persistence, backup and restore check, missed-run report, writer-handoff doc.
Limited to rights-clean direct-agency series until the rights decision.
AC: seven consecutive daily runs recorded in `runs.ndjson`; a restore from backup passes
`atlas doctor`; a deliberately skipped day is reported. (The fuller restore drill, with a pinned
claim and saved query returning their original answers, is added in M24 when both exist.)

**M6 · core: vintage resolution (M).** `resolve()` with both modes and all bases, cutoff policy v1
(strictly before 00:00 America/New_York unless `said_at` and datetime precision), `recorded_gap`,
`same_day_release`; the Node `ReleaseReader`.
AC: the expected-table tests pass, including: no coverage returns `unavailable`; a later backfill
changes reconstruct mode and not reproduce mode; a browser bundle of core contains no `fs` import; resolution across a metadata change reports the
metadata in force at the cutoff; `recorded_gap` is computed from capture confirmations.

**M7 · core: aggregation, transforms, one recipe (M).** Measure-kind aggregation, the transform
allowlist with `semantics_version` 1, recipes with dependency closure and rights intersection,
`cpi_yoy` as the first recipe, `atlas-core verify`, the Node stage in the release gate.
AC: transform tests derived from `docs/method/transforms.md` pass; a cyclic recipe fails with a
named cycle; `cpi_yoy` for 2022-06 matches the published figure within tolerance; derived output
carries the weakest input basis and the most restrictive rights.

**M8 · Deployable shell (M).** Next app from the /missions skeleton, both base paths, Dockerfile,
compose with `web` and `ingest`, health and status routes, tokens and panel grammar, enforced CSP,
catalog page with lexical search.
AC: `docker compose up` serves the fixture release at both base paths locally; health returns the
release id and age; Playwright smoke passes with zero CSP violations at 320 px and desktop.

**M9 · Series page and its twins (M).** `/data/{key}` with definition, provenance block, vintage
table, revision strip, breaks, citation copy, reproduce snippet; `.json`, `.csv`,
`.metadata.json`; Query and RightsGate.
AC: for every fixture series the HTML table, JSON and CSV contain the same values; a display-only
series renders but its downloads return 403 with a reason; `?as_of=` on a date without coverage
shows the unavailable state.

**M10 · Claim engine (M).** Claim schema, test operations, `atlas claims compute` (target and
window resolved once and frozen), lock files, `relock`, evidence table and manifest, `atlas check`
layers for claims.
AC: the slice story test passes (a revision changes `latest`; `then` and `now_when_checked` are
identical; a drift report appears); editing a locked
measure fails the build; `compute` refuses to overwrite; uncertain primary evidence forces
sufficiency to partial or insufficient.

**M11 · Claim page and rubric (M).** `/claims/{id}` with quote, source and archive links, label
with reasons, per-measure then/now table with basis badges, the then-vs-now chart, other readings,
method and snapshot ids, evidence downloads, `.md` and `.json` twins; `/docs/rubric`; a claims
index.
AC: every number in the assessment (`then`, `now_when_checked`) comes from the lock (a test swaps
the lock and sees the page change); the `latest` row comes from the release and is visibly marked
as outside the assessment; label equals `label()` output; one fully worked real claim and one "not checkable" claim
are included as drafts for Alex to review.

**Checkpoint A [ALEX, non-blocking]:** Alex tries one real claim end to end and comments on the
rubric vocabulary, the page and the CLI. Work continues on Phase B meanwhile; rubric wording stays
data until he decides. Claims stay `draft` (not public) until he says otherwise.

### Phase B — Fill the store

**M12a · Catalog v2 schema and migration (M).** Needs M7. Series schema, migration script for the
109 entries (origin, channel, measure and unit kind, SA, price basis, refresh, rights block),
recipes for the 14 y/y series and the one ratio, `atlas check` layers schema, referential,
semantic and rights, rights proposals per series for Alex to confirm.
AC: all 109 entries validate; every entry has a rights status and no permission is hand-set;
recipe graph is acyclic; `atlas check` fails on a seeded error of each layer.

**M12b · v1 adapters on the contract (M).** Needs M12a. FRED, Yahoo and `csv_url` fetchers ported
with captured fixtures; manual adapter for approval and election margins; parity test.
AC: parity table attached and explained; all 126 v1 series exist in the store; the public release
contains only allowlisted series.

**M13 · Treasury Fiscal Data adapter (S).** Debt, Monthly Treasury Statement receipts and outlays.
**M14 · Fed Board DDP adapter (S–M).** H.15 rates, H.10 FX, H.4.1 balance sheet, replacing the
FRED channel for those series.
**M15 · BLS coverage (S).** Payrolls, participation, wages, CPI components; FRED remains fallback.
**M16 · IMF SDMX adapter and the Japan CPI fix (M).** Needed by M28 and M32. `api.imf.org` SDMX 3.0, observed vs
projected split, e-Stat cross-check with a discovery test for the file ID.
**M17 · BEA and EIA adapters (M) [ALEX: free API keys].** GDP, PCE, profits; generation, capacity,
prices. Built and tested against fixtures without keys; live only after keys exist.
AC for M13–M17 (each): captured fixtures with provenance; series pass the release gate; rights
recorded from the agency's terms; the series page shows the direct origin; where a FRED twin
exists a cross-check test compares overlapping periods.

**M18 · Provider vintages: Philadelphia Fed RTDS (M, spike first).** Day-one go/no-go on format,
coverage and terms **[ALEX if terms are unclear]**; then an importer for GDP, payrolls,
unemployment and CPI as `provider` rows with `provider_precision: date`, coverage files, and the
`legacy_git` importer as a separate representation.
AC: for a known revised quarter the vintage table reproduces the advance, later and current
values; imports do not change any reproduce-mode result; if no-go, the PR ships the coverage
machinery and documents why.

### Phase C — Data out

**M19 · Read API (M).** `/api/v1` routes, parameters, validation, caps, rate limiting, status,
`/docs/api`.
AC: contract tests per route; over-limit requests get a clear 429; invalid transforms and unknown
keys get 400 with the allowlist; responses carry the provenance fields listed in 3.8.

**M20 · Bulk snapshots (M).** Derived materialisation, Parquet and CSV.gz, `vintages.parquet`,
Frictionless `datapackage.json` with per-licence resources, `/downloads`.
AC: files load in pandas, polars and DuckDB in a CI job; checksums match; restricted series absent;
row counts equal the release's series files.

**M21 · Discovery (S).** Markdown twins for every page, `llms.txt`, JSON-LD, `/docs/method` and
`/docs/rights`.
AC: `llms.txt` is generated and every link in it resolves in the smoke test; JSON-LD validates.

**M22 · MCP (M).** Route handler, seven tools, resources, optional prompt, `/docs/mcp`.
AC: SDK client round-trip tests; caps enforced; a manual check from Claude Code against the local
container is recorded in the PR.

### Phase D — Explorer depth

**M23a · Explorer chart (M).** Needs M9 and M12b. SVG multi-series chart component, six scale
modes, small multiples for mixed units, sparse-fill drawing rules, readout strip, table equivalent,
recession shading.
AC: geometry and scale functions unit-tested; each mode renders the fixture series with a matching
data table; keyboard-only operation; no animation on data.

**M23b · Explorer state and export (M).** Needs M23a. URL search-param state, series picker with
search, v1 hash shim, snapshot table, CSV and PNG export, presets.
AC: each of v1's 11 presets renders from a v1 hash link; the snapshot table matches Query output;
a copied link reproduces the view in a fresh session.

**M24 · Vintages in the Explorer (M).** As-of control, first-observed vs latest, revision strip,
`pin=` permalinks, saved queries and `atlas save`.
AC: a pinned link shows identical values after a newer release is promoted, after its release
directory is deleted by retention, and after a new `semantics_version` is added; unavailable
periods are drawn as unavailable; the restore drill (3.4) passes.

**M25 · Statistics, honestly (M).** `stats.ts` port; correlation on changes with n, window,
frequency and missingness disclosed; lag profile and rolling correlation with guard text; compare
ranges with anchors; no p-value hint.
AC: ported tests pass; quarterly and annual pairs get a correlation at their common frequency;
`minN` is honoured.

**M26 · Events and annotations (M).** Content migration, new categories and spans, annotation
layers, event pages, `atlas add series|event|note`.
AC: 83 events migrated with citations and archive URLs or a listed exception; layers toggle from
the URL; `atlas add` writes drafts only and `atlas check` validates them.

**M27 · Claims depth (M).** Window sensitivity strip ("direction holds in N of M valid windows"),
claim markers in the Explorer, index filters by person, party, topic and label, ClaimReview
JSON-LD, nightly drift report, "Report an error" prefilled issue link, `atlas add claim`.
AC: sensitivity counts match a hand-computed fixture; a `latest` row that differs from the locked
`now_when_checked` row produces a drift report and leaves the assessment and label unchanged.

### Phase E — Breadth

Each milestone names the minimum it must deliver. Dropping a named item needs Alex's approval
**[ALEX]**; it cannot pass by listing the item as a gap.

**M28 · G20 headline matrix (M).** Needs M16. Minimum: IMF CPI for all 19 countries; IMF FX for
all non-euro members plus EUR; BIS policy rates for 18 countries and the euro area; GDP from WEO
with observed and projected split and a dated snapshot per WEO release.
**M29 · G20 gaps (M).** Needs M28. Minimum: monthly unemployment for Argentina, China, India,
Indonesia, Saudi Arabia, South Africa and the UK from OECD or national sources, or a documented
"no free monthly source" finding per country for Alex; Argentina policy rate from BCRA. Main stock
indices only if rights allow **[ALEX: index rights]**.
**M30 · Construction, water, transport (M).** Needs M12b. Minimum: Census C30 total, public,
private, water supply, sewage and waste, power, and highway and street (direct XLSX, FRED twins
`TTLCONS`, `TLPBLCONS`, `TLPRVCONS`, `TLWSCONS`, `TLPWRCONS`, `TLHWYCONS` as cross-check); BTS
tables `bw6n-ddqk` and `crem-w557` (freight TSI, rail, trucking); annual port TEU.
**M31 · Federal infrastructure spending and broadband (M, spike first).** Needs M4. Minimum:
USAspending IIJA by DEF code (Z, 1) and agency with dated snapshots; CHIPS through federal account
013-0520 and related accounts; budget authority, obligations and outlays as three separate series,
never blended; NTIA Internet Use Survey adoption series; broadband programme outlays through
USAspending if the BEAD account can be identified in the spike. State-level data only if the
endpoint proves usable.
**M32 · Trade and commodities (M).** Needs M16. Minimum: IMF PCPS commodity price indices; US
goods and services trade balance, exports and imports (Census/BEA, FRED twin as cross-check);
World Bank trade as a share of GDP for the G20 (annual, CC BY); World Bank Pink Sheet with a
link-discovery test.
**M32b · Disasters and health (M).** Needs M4. Minimum: OpenFEMA declarations; NOAA billion-dollar
series to 2024 with its end stated; CDC `r8kw-7aab` and OWID COVID series; EM-DAT as link-only.
AC for M28–M32b (each): every named minimum series passes the release gate from captured fixtures
with rights recorded; a coverage matrix page generated from the catalog shows what exists and what
is missing per country or topic, with the reason; any named item not delivered is listed in the PR
as needing Alex's approval.

### Phase F — Storytelling

**M33 · Topics and unified search (M).** Needs M26, M27 and, for the peer band, M28. Topic pages
from `content/topics`, competing explanations, "what else moved" with curated companions (the
unusual-move rule only after its spike passes), US vs G20 peer band, search across kinds.
AC: on the fixture release one query returns grouped hits for a series, an event, a claim, a topic
and a person; a fixture topic page renders its member series, events, claims and at least two
competing explanations, each with a citation; "what else moved" shows the curated companions on
one shared time axis with a table equivalent; the peer band matches a hand-computed min, median
and max for a fixture month; first topics shipped: inflation, jobs, housing, energy and grid,
freight, federal budget, G20 growth.

**M34a · Report shell and Highlights (M).** Needs M33. Living edition, Edition model (year,
version, cutoff, pinned snapshot, corrections log), table of contents, Highlights (1/5/10-year
table), Who We Are, notes, print stylesheet. Letter only if Alex wants to write one **[ALEX]**.
AC: every figure links to its series with the Edition pin; a frozen fixture Edition renders
identically after a later release is promoted; a retroactive Edition is labelled as compiled later.

**M34b · Statements, segments, risks (M).** Needs M34a, M13 and M17. Three separate statements
(federal on Monthly Treasury Statement cash basis plus the accrual balance sheet; national;
external), six segment chapters, risk factors.
AC: each statement line maps to a catalog series or is marked "no free source"; no total is
computed across statements; the 2025 Edition is produced as a draft for Alex to review.

### Phase G — Ship

**M35 · Staging (S) [ALEX: SSH user and key, Caddy change, server env keys, timer].** Deploy
checklist, compose on the VPS, timer, backups, writer handoff from the interim runner.
AC: `/macro-atlas-staging` passes the smoke suite from outside; three consecutive daily releases
promoted on the VPS; restore drill done.

**M36 · Cutover (S) [ALEX: approval, merge to main, production deploy].** Production at
`/macro-atlas`, GitHub Pages redirect shim, `refresh.yml` retired, v1 archived at a dated URL.
AC: v1 preset links land on the equivalent v2 Explorer state; production smoke passes.

Order notes. Hard prerequisites are stated on each milestone. Beyond those: Phases C and D can
interleave after M12b. M13, M14, M15, M16 and M17 are independent of each other. M30, M31, M32 and
M32b are independent of each other and can be reordered by what Alex wants to study first. M28
needs M16, and M29 needs M28. Total: 40 PRs.

---

## 8. Risks and how the plan contains them

| Risk | Containment |
|---|---|
| Rights decision removes many v1 series from public view (25 Yahoo, third-party FRED) | Direct-agency re-sourcing early (M13–M17); public-domain proxies where they exist; a visible "not shown: licence" row in the catalog instead of silent absence; private profile if Alex wants it |
| Vintage coverage thinner than hoped (RTDS terms, no FRED key) | The `unavailable` and `uncertain` states are built first and are honest outputs; the clock starts at M5 so observed coverage grows daily |
| Two languages drift | Mathematics only in core; one cross-language test on the release contract; schema is the single source |
| Autonomous PRs too large | Slice-first sizing; L milestones have named split points; every AC is a test or a command |
| Shared VPS IP gets throttled | Serial per host, backoff, breaker, per-source User-Agent policy, staging reading production's release |
| Statistical tools imply causation | Descriptive first; no p-value hint; accounting views labelled as accounting; causal claims judged on premises only |
| Claim file read as partisan | Selection note, published rubric, alternative readings, revisions log, index filterable by party; claims stay draft until Alex opens them |
| Next 16 API differences trip the agent | Read bundled docs first (AGENTS.md rule copied from mission-dashboard); shell milestone is small and smoke-tested |

---

## 9. Needs Alex

Decisions (none cost money; all sources and keys are free):

1. **Licensing stance.** Re-source core series from agencies (recommended). Keep Yahoo and
   S&P-family series off every public surface until display rights are settled (recommended).
   How to word ML suitability given FRED's terms. Whether to act on v1's existing Yahoo exposure
   on GitHub Pages now.
2. **Interim capture host** before the VPS (private GitHub repo and scheduled Actions, the Mac, or
   wait), and the off-host **backup destination**.
3. **Claims:** public from day one or draft until about ten cases have tested the rubric
   (recommended: draft). Label vocabulary (research 03's six labels or research 04's six
   findings). The as-of cutoff rule (recommended: strictly before 00:00 ET unless the claim has a
   time).
4. **Raw retention:** 90 days plus revision-bearing blobs (recommended) or everything.
5. **Design:** theme rule and fonts (recommended: match /missions; serif for signed prose only if
   a Letter exists); segment names; whether to write a Letter.
6. **Private research profile:** wanted or not.

Credentials and accounts (each a stop-and-ask for the build agent):

- Free API keys in the server environment, never in the repo: **EIA**, **BEA**, **api.data.gov**
  (Congress.gov, GovInfo, FEC); optional **FRED** (ALFRED vintages and metadata, with FRED's terms
  attached to those rows), **Census**, **e-Stat appId**, **Socrata app token**.
- **VPS:** deploy user and SSH key, the Caddy route change, the systemd timer, volumes.
- **GitHub:** a private data repository or storage for the interim store if option (a) is chosen;
  permission to add workflows on the `v2` branch.

Approvals: Gate 1 (this plan), merges to `main`, the staging deploy, the production deploy and
cutover.

Money: none planned. The VPS and domain already exist. If the store's backups need paid storage,
that is a separate ask.

---

## 10. Optional, more ambitious

Each is independent and can be added after the phase named.

- **Revision profile per series** (after M18): mean absolute revision from first to latest value,
  typical direction, time to settle. Tells a fact-checker how much weight a fresh number can bear.
- **Evidence pack** (after M11): one zip per claim with the evidence CSV, lock, manifest and a
  README. The table and manifest ship in the base plan; the zip is the extra.
- **Research notebooks** (after M24): saved queries grouped into a dossier page with notes, a
  reading list and a claim list; the working form of a topic page before it is public.
- **Python client and recipes** (after M20): a small `macro_atlas` package or documented
  `pandas`/`polars`/DuckDB one-liners reading the datapackage.
- **Hugging Face dataset mirror** of the public-domain resources (after M20) **[ALEX: account]**.
- **ClaimReview leads inbox** (after M27): the Data Commons feed filtered to US economic claims as
  a private list of claims other checkers have looked at. Not republished; terms unread.
- **Release calendar** (after M17): next release date per series from agency calendars, and a
  second daily run timed after 08:30 and 10:00 ET releases to tighten `recorded_gap`.
- **ALFRED backfill** (after M18) for public-domain series **[ALEX: FRED key and terms]**.
- **Single-file index** (later ADR): DuckDB or SQLite built per release if JSON files stop being
  fast enough. Still no database server.
- **In-browser query page** with DuckDB-WASM over the Parquet (deferred in research 03).
- **Congress and votes context** (after M32): Voteview and Clerk roll calls linked from events and
  claims; MIT election returns.

---

## 11. Open points this draft does not settle

- BLS keyless limits for daily use, and whether BLS flat files are a better channel (M2 confirms).
- Philadelphia Fed redistribution terms (M18 spike).
- Whether display of index levels is defensible separately from redistribution (legal judgement).
- USAspending state-level IIJA data and the BEAD account (M31 spike).
- The MCP transport text of the 2026-07-28 revision and current client behaviour with
  `outputSchema` (M22 checks before building).
- Bagby's actual section list, from Alex's copy, before the Report's structure is fixed (M34a).

Codex check (two rounds). Outline review raised: keep core free of file access; derived series
must stay in bulk exports; recipes need explicit aggregation and rights rules; "as-of never
drifts" conflicts with preferring provider vintages; tombstones need a completeness test; metadata
changes are revisions; the foundation phase was too long and several milestones too large;
p-values should not be ported; early capture and the private profile needed harder boundaries →
all adopted: ReleaseReader split from core (3.2), Node-materialised derived tables (3.5), measure
kinds and recipe rules (3.6), reconstruct vs reproduce modes with `added_in` (3.4), completeness
flag (3.3), metalog (3.4), slice-first Phase A (7), descriptive statistics (3.9), allowlist
releases and a localhost-only profile (3.1, 3.11). Draft review raised: locked evidence vs a "now"
that changes; pins expiring with release retention and engine upgrades; metadata history and fetch
evidence missing from the public release; backups missing pinned artefacts; `recorded_to`
semantics; Phase E able to pass by listing gaps, with trade, water and broadband unassigned; false
independence between milestones; no acceptance criteria for topics and search; undecided PR splits
→ all fixed: three evidence rows `then` / `now_when_checked` / `latest` (3.6), pins as knowledge
snapshots answered from the current release and versioned mathematics kept executable (3.4),
release contents extended (3.4), backup list and restore drill (3.4, M24), capture confirmations
(3.4), named minimum datasets and a trade milestone (M28–M32b), explicit prerequisites, M33
criteria, and fixed splits M12a/b, M23a/b, M34a/b. A third pass raised four more: pin isolation when rows are
closed later, unversioned parts of the engine, raw blobs missing from backups, and a stale row name
in M27 → fixed with `closed_in`, a single `semantics_version` with a stated exactness guarantee,
the backup list, and M27's wording. Those last four fixes were not sent back for a fourth review.
