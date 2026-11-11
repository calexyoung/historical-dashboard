# Macro Atlas v2 plan: reader first

Draft plan, 2026-11-11. One of two independent drafts for `docs/v2/PLAN.md` (Gate 1). Written against
`docs/v2/BRIEF.md` and the four research notes in `docs/v2/research/`. Nothing here is decided until
Alex approves the merged plan.

**Angle of this draft.** Optimise for a curious member of the public reading on a phone. The site
opens as an annual report of the United States that someone can read top to bottom, with topic pages
that explain how things interact. The research tools (Explorer, Events, Data, API) are one layer
down, always reachable, never in the reader's way. Alex's own research workflow is kept: every
figure is a door into the Explorer, and the Explorer has a direct URL.

Items that need Alex are marked **[ALEX]**. Options beyond the brief are marked **(optional)**.

Vocabulary follows the codebase-design skill: *module*, *interface*, *seam*, *adapter*, *depth*.

---

## 1. Goals and non-goals

### Goals

1. **A phone reader understands the state of the country in ten seconds, and one topic in two
   minutes.** The home page is the cover of the Living edition. A topic page explains one subject,
   what else moved with it, and the competing explanations people give for it.
2. **Every figure explains itself.** A takeaway sentence, a "How to read this" disclosure, units in
   words, a table twin, a source and as-of line, and a door into the Explorer.
3. **Complex interaction over single causes.** Curated competing explanations and "what else moved"
   companions are part of the first reader slice, not a late add-on.
4. **Provenance is a feature.** Every number links to a series page that names the agency, dataset,
   series ID, URL, licence, fetch time and data state.
5. **Claims are checked against the data that was public at the time**, with a small fixed finding
   vocabulary and written reasons. No runtime AI.
6. **Data out for machines**: per-series file twins, a versioned read API, immutable bulk
   snapshots with per-resource licences, `llms.txt`, and an MCP endpoint (optional, late).
7. **Same stack and visual family as /missions**: Next.js in Docker behind Caddy at
   `mydashboards.co/macro-atlas`, daily server-side refresh, no database.
8. **v1 keeps running untouched** on GitHub Pages until Alex approves the cutover.

### Non-goals (v2.0)

- No database, no accounts, no in-browser editor, no runtime AI calls.
- No causal verdicts. Charts never claim "X caused Y". Causal claims are judged on their factual
  premises only.
- No counterfactual baselines unless they come from a named source (CBO). Deferred.
- No intraday data. Daily refresh only.
- No promise that data is "free for ML training". The site says "machine-readable, with per-series
  licence" (research 03 §2).
- No port of the ingest to TypeScript. Python stays; a source moves only if it has a reason to.
- No full vintage browser. v2.0 promises only the vintage coverage the feasibility spike verifies.
- No Editions for every year back to 2000. One retroactive Edition (2025), labelled as such.

### Release boundaries

This is a programme of about 50 PRs, not one launch. A milestone with lettered parts (M10a, M10b, …) is
that many PRs. It has three stopping points, and each leaves
something usable:

| Release | What a reader gets | Ends at |
|---|---|---|
| **R1 Reader preview** (staging) | Living cover, one full topic (Inflation), series pages, a read-only Explorer view, on rights-cleared data | M5 |
| **R2 v2.0 public launch** | Daily ingest from primary agencies, the full Living edition, seven topics, the interactive Explorer, data out, v1 cutover | M21 |
| **R3 Claims and coverage** | Vintages, Claims, infrastructure, G20, the frozen 2025 Edition, MCP | M33 |

Claims are the brief's main purpose for Alex, and they sit in R3 here because they depend on
vintages and on clean primary sourcing. **[ALEX]** If claims matter more than the cutover date, the
claims block (M22–M25) can run before M12–M21. Its prerequisites are M1 (the vintage decision), M2b
(query core), M3 (figures), M6–M8 (ingest, release writer, rights) and M10a (BLS direct), and it
would bring `lib/urlstate` forward from M17.

**Editorial approval is a release gate.** R1 needs Alex's approval of the Inflation explanations
(D9); R2 needs it for each topic and chapter that ships. Unapproved text stays hidden, and a
release with hidden topics is announced as reduced ("four of seven topics"), not as complete.

---

## 2. Information architecture

### 2.1 Two layers

| Layer | Pages | Who it is for |
|---|---|---|
| **Reading** (primary navigation) | Report, Topics, Claims | The phone reader |
| **Research** (one tap down, grouped under "Research") | Explore, Events, Data | Alex, students, machines |

- **Top bar** matches /missions in height, type and behaviour. Left: "Macro Atlas" and a
  breadcrumb. Right: search, data-freshness dot with a word, theme toggle.
- **Tabs**: `Report · Topics · Claims · Research ▾`. "Research" opens a plain list (Explore, Events,
  Data, About and method). On widths from 1024px the three research links show inline, so Alex on a
  laptop sees all six.
- The Claims tab appears only once the first claim is public (see **[ALEX]** decision D3). Until
  then the tabs are `Report · Topics · Research ▾`.
- **Search** covers topics, series, events, claims, glossary terms and people, grouped by kind.
  On a phone it is a full-screen sheet. Without JavaScript it is a normal form that posts to
  `/search?q=`.

### 2.2 URLs

All under `basePath` `/macro-atlas` (staging: `/macro-atlas-staging`).

```
/                              Cover of the Living edition (home)
/report                        Living edition contents
/report/highlights             1/5/10-year change table
/report/who-we-are             Population, households, labour force
/report/statements/federal     Receipts, outlays, deficit, debt (cash basis); accrual balance sheet
/report/statements/national    GDP, income, household net worth
/report/statements/external    Trade, current account, international investment position
/report/segments/<segment>     Six segment chapters
/report/risks                  Dated risk factors with sources
/report/notes                  Definitions, breaks, revisions policy, sources
/report/2025/...               A frozen Edition (same sections; R3)
/topics                        Topic index
/topics/<topic>                Topic page
/claims, /claims/<slug>        Claims file (R3)
/explore?s=...&from=...&to=...&mode=...&layers=...&release=...
/compare?s=...&a=...&b=...&span=...
/events, /events/<slug>
/data                          Catalog, downloads, API documentation
/data/<key>                    Series page, with .csv .json .metadata.json .md twins
/glossary, /glossary/<term>
/about                         Method, sources, rubric, what this site is not
/api/v1/...                    Read API
/mcp                           MCP endpoint (optional, R3)
/llms.txt
```

- Series pages live at `/data/<key>` (research 04), with the file twins from research 03 §3.1.
  `/series/<key>` redirects there, so both research notes' URL shapes work.
- Series keys are public and permanent. Renames go through `aliases:` and redirect.
- A door from a frozen Edition or a claim into the Explorer carries `release=<id>` (and
  `edition=2025-v1.0` where relevant), so the Explorer shows the same data the reader just saw, with
  a banner: "Viewing data as in the 2025 Edition. Show today's figures."

### 2.3 Page designs, phone first

**Cover (home).** In order: the edition line ("Living edition, data to 11 Nov 2026"), six
state-of-the-nation rows (one per segment: label, latest value in words, 1-year change, a 64px
sparkline), a "Read the report" link, three topic links, the search field. No hero, no cards. It
must render complete with no JavaScript.

**Report section.** Single column. A "Contents" disclosure at the top (a `<details>` element, so it
works without JavaScript; from 1024px it becomes a sticky left list). Previous and next links at the
foot. Statement tables scroll inside their own container with the label column sticky. Each table
header states the entity, the basis (cash or accrual), the period (fiscal or calendar year) and
whether the row is a stock or a flow.

**Topic page.** Top to bottom:

1. Title, one-sentence definition, change strip for 3–6 key series.
2. Main figure with its takeaway and "How to read this".
3. **What else moved**: stacked small multiples on one time axis, curated companions.
4. **Competing explanations**: a sourced list. Each entry has the explanation, evidence for,
   evidence against, and links to figures. No winner unless the evidence is lopsided, and then the
   reasons are written out.
5. Claims about this topic (once claims are public).
6. Events on the shared axis.
7. Series in this topic, each linking to its series page.

**Claim page** (R3). Quote, speaker, date, source link. Finding in a word with written reasons.
One evidence figure at full width showing "then" (data public on the claim date) and "now". Window
sensitivity strip. Everything else below.

**Series page.** Figure of the full history, latest value with reference period and release date,
provenance block, breaks and notes, vintages where they exist, downloads, citation string.

**Explorer** (research layer). v1's workbench, hardened per research 04 §4.1. On a phone: chart at
full width, series picker as a bottom sheet, a soft cap of four series, readout strip above the
chart, long-press to pin. Its URL fully describes its state.

### 2.4 The explained figure (the centre of this draft)

Every figure on a reading page is one component with a fixed anatomy:

```
PANEL LABEL (uppercase, 2px ink rule above)
Takeaway sentence, or nothing.
[ SVG chart, server-rendered ]
Unit and adjustment in words: "Percent change from a year earlier, not seasonally adjusted"
Source: U.S. Bureau of Labor Statistics · data to Sep 2026 · retrieved 11 Nov 2026 · preliminary
▸ How to read this        ▸ Show the table        Open in Explorer →
```

- **Takeaway sentences come from fixed templates, not AI.** For example: "Consumer prices were
  3.1% higher in September 2026 than a year earlier, down from 3.4% in August." The template set is
  small (level, change, comparison of two series, rank within history).
- **Silence beats a misleading sentence.** The template returns nothing when the latest period is
  partial, stale past the series' `max_lag`, estimated, across a series break, or when two series
  are not comparable (different adjustment, real against nominal). The figure then shows the data
  state in words instead.
- **"How to read this"** is a `<details>` block written per figure type, plus optional per-figure
  text from the content files. It says what the axes are, what a mark means, and what the figure
  does not show.
- **Glossary terms** (year over year, seasonally adjusted, real, percentage point, preliminary,
  index, basis point) are links to `/glossary/<term>`. With JavaScript they open as a popover
  anchored to the term; without it they are ordinary links.
- **Data states** each get a mark and a word, never colour alone: preliminary, revised, estimate,
  interpolated, stale, missing, break (research 04 §4.5).
- **Table twin** is real HTML, in the page, inside a `<details>`.

### 2.5 Reader budgets (acceptance criteria on every reading page)

Measured in CI by Playwright against the golden fixture release, using a fixed profile: 360×740
viewport, 4× CPU slowdown, "Slow 4G" network preset, cold cache.

| Budget | Limit |
|---|---|
| Layout | No horizontal page scroll at 320px; 200% zoom keeps all content reachable |
| No-JS | All text, figures, tables, Contents, glossary links and search work with JavaScript off |
| JavaScript | Reading pages ship at most 90 KB gzipped in total, framework included. 90 KB governs. M2 measures the framework floor; if the floor plus 15 KB for our own islands exceeds 90 KB, the build stops and **[ALEX]** chooses a new cap, recorded in an ADR |
| Largest contentful paint | Under 2.5 s in the profile above |
| HTML | Under 150 KB gzipped per reading page, SVG and tables included |
| Hover | No information reachable only by hover |
| Access | axe-core clean; every figure has a table twin and a summary sentence or state line; keyboard order follows reading order |

Lighthouse scores are reported but are not the gate. A manual screen-reader pass (VoiceOver on
iOS Safari) is on the checklist for M4, M13 and M24. **[ALEX]** or Fable with the iOS Simulator.

### 2.6 Visual family and motion

Taken from /missions unchanged: tokens, white ground, ink and hairlines, 2px rule above each panel,
no cards, system sans with tabular figures, Plot Navy as the only interactive colour, light by
default with dark only on request (`?theme=dark`), status as colour plus icon plus word.

Added for Macro Atlas: an Okabe–Ito-derived series palette that avoids navy (validated with the
`dataviz` skill's checker in both themes), statement-table styles, no party colours and no
up/down colours on reading pages.

Motion follows the Emil Kowalski rules in research 04 §6: chart data never animates, keyboard
actions never animate, press feedback is `scale(0.97)`, popovers 150 ms and origin-aware, sheets
240 ms in and 180 ms out, reduced motion keeps opacity fades only. No motion library.

**[ALEX]** design decisions, with this draft's defaults: system sans everywhere (no serif); match
/missions' theme rule; the six segments from research 04; a small "mydashboards" home link in the
top bar.

---

## 3. Architecture

### 3.1 Shape

```
            host systemd timer (daily)
                     │ docker compose run --rm ingest
                     ▼
   ┌──────────────────────────────┐        ┌───────────────────────────────┐
   │ atlas-ingest  (Python, uv)   │        │ atlas-web (Next.js standalone)│
   │ fetch → stage → check →      │        │ reads the current Release     │
   │ promote                      │        │ pages · /api/v1 · /mcp        │
   └──────────────┬───────────────┘        └──────────────▲────────────────┘
                  │ read-write                            │ read-only mount
                  ▼                                       │
   $DATA_DIR  ├── releases/<release_id>/   ◄──────────────┘
              ├── CURRENT                  (text file: the promoted release id)
              ├── STATUS.json              (last run: started, finished, outcome, failed checks)
              ├── pins/                    (release ids that must never be pruned)
              ├── obslog/  raw/  fetchlog.ndjson  locks/  trash/   (ingest-private)
              └── editions/<year>-v<n>/    (frozen rendered artifacts, R3)

   Caddy:  /macro-atlas, /macro-atlas/*  →  atlas-web
```

This is research 01's option A. **The Release directory is the seam between the two languages.**
Python is the only writer. Next.js is a reader. Either side can be rewritten without touching the
other as long as the Release schema holds.

### 3.2 The Release

```
releases/2026-11-11T0617Z-ab12cd/
  manifest.json          schema version, created, code and catalog hashes, transform_version,
                         per-series {state hash, via, rights, checks}, withheld list, QA summary
  series/<key>.json      metadata + provenance + observations at native frequency, unrounded,
                         each with period_start, period_end, value, status
  views/monthly.json     v1's atlas.json shape, derived, for the Explorer's first load
  content.json           compiled, validated topics, events, claims, glossary, report text
  vintages/<key>.json    compact revision list per vintage-enabled series (exported from obslog)
  search-index.json
  bulk/observations.parquet, observations.csv.gz, datapackage.json
```

Rules:

- A Release is **immutable** once promoted. Files are never edited in place.
- **Promotion is one atomic rename** of a new `CURRENT` file. A release is promoted only after
  every check passes. A failed run leaves `CURRENT` alone, and the site keeps serving the last good
  release and says so ("Data last refreshed 9 Nov; the 11 Nov refresh failed").
- **Run status is a separate file.** A failed run cannot write into an immutable release, so every
  run, pass or fail, atomically replaces `$DATA_DIR/STATUS.json`. The reader takes the failure
  date and the failed checks from there. Tested: a failure after a good release shows both dates.
- **Only public-cleared rows enter a Release.** Series whose rights do not allow display are left
  out and listed in `manifest.withheld` with the reason, so the site can show a named "withheld:
  licence not settled" row instead of a silent gap.
- **Retention**: keep the last 30 releases, plus every release named in `pins/`. Pruning never
  touches `CURRENT` or a pinned release. It is deletion-safe in two steps: a release is first
  renamed into `trash/` (one atomic step, so a reader sees all of it or none of it) and deleted a
  day later. A request that names a pruned release, or loses it mid-read, gets `410 Gone` with a
  link to the current release, never a partial page. M7 tests that exact race. Any release id the
  site itself links to durably (claim locks, Editions) is pinned.
- **Content-only changes** (a new topic paragraph) build a new release with
  `atlas release --reuse-data`, which hard-links the previous release's data files. This is safe
  only because release files are immutable; the writer sets them read-only to enforce it.
- The Parquet obslog and raw blobs stay ingest-private. The web tier never reads Parquet; the
  ingest exports the small `vintages/<key>.json` files it needs.

### 3.3 Modules

Each module below is deep: a small interface with the complexity behind it. The interface is also
the test surface.

**Python (`atlas/v2/`, a new package; v1's `atlas/sources.py`, `transform.py`, `build.py` and
`check.py` are not moved, renamed or shadowed, and a test imports them to prove it)**

| Module | Interface | Hides |
|---|---|---|
| `sources` | `fetch(entry) -> Fetched` (raw bytes, URL, retrieved_at, channel) and `parse(entry, raw) -> NativeSeries`. One adapter per provider. Adapters raise; they never invent data. | Throttles per host, serial FRED, the 429 breaker, curl_cffi for Yahoo, SDMX quirks, Shift-JIS, link discovery for versioned URLs, cache with a real TTL |
| `rights` | `resolve(entry, channel) -> Permissions{display, redistribute, ml_use, attribution}` and `combine(inputs) -> Permissions` | The status-to-permission table, channel terms (FRED, Yahoo), most-restrictive-wins for derived series |
| `obslog` | `record(key, state, snapshot_id, via, permissions, provider_vintage?)` and `as_of(key, date) -> VintageAnswer{rows, basis}` | Normalised-state hashing, tombstones, the two time axes, Parquet layout |
| `content` | `compile(content_dir, series_keys) -> CompiledContent` (raises a list of located errors) | Front-matter parsing, JSON Schema validation, referential checks, slug rules |
| `release` | `build(options) -> StagedRelease`, `check(staged) -> Report`, `promote(staged)`, `prune()` | Staging directory, the run lock, derived-series dependency graph, bulk export, atomic promote, retention, pins |
| `cli` | `atlas release`, `atlas check`, `atlas add series|event|claim|topic`, `atlas claims compute`, `atlas fixture` | Argument parsing only |

**TypeScript (`site/`)**

| Module | Interface | Hides |
|---|---|---|
| `lib/release` | `currentReleaseId()`, `openRelease(id) -> Release` with `series(key)`, `monthly()`, `content()`, `vintages(key)`, `manifest` | File layout, schema validation on load, memoisation per release id, the stale and failed-refresh state |
| `lib/query` | `getSeries(release, key, {freq, agg, transform, start, end, as_of}) -> {observations, provenance, permissions, vintage_basis, transform_version}` | The whole transform contract (research 03 §3.1): order of operations, lookback, gaps, partial periods, daily y/y, the z reference window, drawdown from the running peak (v1's sixth scale mode), vintage resolution, and the rights of the rows actually used. No dependency on Next.js. |
| `lib/figure` | `renderFigure(spec, data) -> {svg, table, takeaway, stateLine}`. Pure. | Scales, ticks, layout at any width, data-state marks, takeaway templates and their silence rules, palette assignment |
| `lib/content` | Typed getters over `content.json`; `renderMarkdown(body)` (server only) | Markdown rendering, glossary auto-linking, cross-reference resolution |
| `lib/stats` | v1's `stats.js` ported, with its two caveats fixed (`changes()` on quarterly and annual series; `rollingCorr`'s `minN`) | Correlation, lag profile, rolling correlation, effective n |
| `lib/urlstate` | `parse(searchParams | v1Hash) -> ExplorerState`, `serialize(state)` | v1 hash compatibility, defaults, validation |

Where the seams are, and why there:

- **Release schema** (Python writer, TS reader): two real adapters exist on day one, the ingest and
  the golden fixture builder, so the seam is real.
- **`sources` adapter contract**: about ten providers vary across it.
- **`lib/query`** is the single runtime for transforms. Pages, the REST API, the MCP endpoint and
  claim locks all call it, so a transform cannot differ between a chart and a download.
- **`lib/figure`** is shared by the server (reading pages) and the client (Explorer), so a figure
  looks the same in both.

No chart library. /missions draws SVG by hand, the reading pages must work without JavaScript, and
a canvas library would break both. The Explorer adds pointer handling on top of the same
`lib/figure` scales.

### 3.4 One transform runtime, and the overlap with Python

Transforms run in TypeScript (`lib/query`). Python computes only the ingest-time derivations that
the catalog declares, and that overlap is enumerated and tested:

| Computation | Python (ingest) | TypeScript (query) |
|---|---|---|
| Catalog-derived series: y/y (`derive_yoy`) and ratio (`derived` entries using `div`) | Yes, stored as their own series | Reads them as stored |
| Monthly aggregation for `views/monthly.json` (`mean`, `last`) | Yes | Also implements `freq`/`agg` on request |
| Everything else (`chg, ch1, pch, pc1, pca, log, rebase, z`, drawdown) | No | Yes |

`schema/transform-vectors.json` holds input and expected output for y/y, division and monthly
aggregation, including gaps, partial periods, mismatched frequencies and zero denominators. Both test suites must pass it. The contract
is written in ADR 0004 before either side is implemented, and its version (`transform_version`) is
stamped into every API response and every claim lock.

Claim evidence is computed by a Node script that calls `lib/query` (`atlas claims compute` runs
it). Node is therefore a requirement of the authoring toolchain as well as of the site; the
`Makefile` checks for it.

### 3.5 Next.js app

- Next 16 App Router with `cacheComponents`, React 19, Tailwind 4, TypeScript, Vitest, copied from
  mission-dashboard's configuration. **Read the bundled Next docs before writing route code**: its
  caching APIs have changed (research 01).
- **Caching rule.** Each request resolves `currentReleaseId()` once, outside any persistent cache
  (a `stat` of `CURRENT`, re-read at most every 30 seconds). The id is then passed as an argument
  into cached functions, so it is part of every cache key. Page text, figures, tables and download
  links on one page all use that same id. A promotion or a rollback changes what the site serves
  without a restart; M2 has a test that proves it.
- Reading pages are server components. Client islands are limited to: glossary popover, Contents
  sheet behaviour, search sheet, theme toggle, and the Explorer.
- **Content Security Policy is enforced, not Report-Only**, if the M2 spike shows a nonce or hash
  strategy works with caching, streaming and no-JS rendering. If it does not, v2 ships the same
  Report-Only policy as /missions and records why in an ADR. Either way nothing loads from a CDN.
- `/api/health` reports liveness, the current release id, its age, and whether it loaded and
  validated. It never calls an upstream and never claims the volume is writable.

### 3.6 Read API and file twins (R2)

Research 03 §3 is adopted as written, with `/data/<key>` as the page URL:

- `/data/<key>.csv | .json | .metadata.json | .md`, full series by default, filtered on request
  (`?freq=&agg=&transform=&start=&end=&as_of=`).
- `/api/v1/catalog.json`, `/api/v1/series/<key>`, `/api/v1/series/<key>/vintages`,
  `/api/v1/events.json`, `/api/v1/claims.json`.
- Every response carries provenance, the release id and `transform_version`. Snapshot-addressed
  URLs are `immutable`; latest URLs use `ETag` = release id.
- A series with `redistribute: false` returns 403 on its download routes with the reason.
- Rate limiting lives in the app (a token bucket per IP in memory), because stock Caddy has none.
- JSON-LD `Dataset` on series pages, `<link rel="alternate" type="text/markdown">`, and
  `/llms.txt`.

### 3.7 Bulk export (R2)

`/downloads/<release_id>/observations.parquet`, `.csv.gz` and `datapackage.json` (Frictionless v2,
checksums, per-resource licences), served from the release's `bulk/` directory.
`/downloads/latest/...` redirects. The export is split into a public-domain resource and a
citation-required resource. Nothing is exported until its terms have been read and recorded.

### 3.8 MCP (optional, R3)

A stateless Streamable HTTP endpoint at `/macro-atlas/mcp`, a thin adapter over `lib/query` and
`lib/content`. Seven read-only tools from research 03 §5: `search_series`, `get_series`,
`get_vintages`, `compare_vintages`, `list_events`, `get_claims`, `get_download_link`. Hard caps on
rows, bytes, time and concurrency. No SQL, URLs or expressions as input. Origin validated.

### 3.9 Daily refresh

- A host systemd timer runs `docker compose run --rm ingest atlas release` once a day at 06:15 UTC
  (after most US agency releases of the previous day have settled; morning-of releases land the
  next day, and the site says "data to" plainly).
- A file lock in `$DATA_DIR/locks/` makes a second run exit at once with a clear message.
- Hosts are fetched in parallel; requests to one host are serial with backoff and jitter. The
  User-Agent is set per source (FRED rejects browser agents; Yahoo needs one).
- A source that fails falls back in order: last good raw (within its TTL), catalog fallback
  channel, seed. The fallback is recorded per series as `via`, and the rights are recomputed for
  that channel. If the fallback channel is not cleared for display, the series is withheld from
  that release and the previous value is not silently reused.
- The ingest refuses to start if free disk is under 2 GB and never promotes a release it could not
  fully write.
- Exit code is non-zero on any failed check. systemd's `OnFailure=` writes to the journal;
  **(optional) [ALEX]** a notification hook (email or a push service) can be attached there.
- Keys are read from the VPS environment (`EIA_KEY`, `BEA_KEY`, `API_DATA_GOV_KEY`, …). Every
  keyed source degrades to "stale, last fetched …" when its key is missing. **[ALEX]** registers
  keys; the build agent never does.

### 3.10 Deploy behind Caddy, with staging

- `deploy/compose.yaml`: service `web` (Next standalone on `node:24-alpine`, non-root, `$DATA_DIR`
  mounted read-only, healthcheck on `/macro-atlas/api/health`) and service `ingest` (Python, uv,
  the same volume read-write, run to completion).
- `basePath` is fixed at build time, so production and staging are **two builds of the same commit**
  with `BASE_PATH=/macro-atlas` and `BASE_PATH=/macro-atlas-staging`, each with its own `DATA_DIR`
  and port.
- Caddy matchers must not overlap, because `/macro-atlas*` also matches `/macro-atlas-staging`:

  ```
  @atlas path /macro-atlas /macro-atlas/*
  handle @atlas { reverse_proxy 127.0.0.1:3101 }

  @atlas_staging path /macro-atlas-staging /macro-atlas-staging/*
  handle @atlas_staging { reverse_proxy 127.0.0.1:3102 }
  ```

  The prefix is not stripped. The Caddy config is not in either repo; `deploy/Caddyfile.snippet`
  holds this block for Alex to paste. **[ALEX]**
- The deploy kit is tested locally: compose brings up both builds behind a throwaway Caddy
  container, and a smoke test checks that each path serves its own build.
- Staging sends `X-Robots-Tag: noindex`.
- Backups: `obslog/`, `fetchlog.ndjson`, `CURRENT`, `STATUS.json`, the current release, `pins/`,
  pinned releases and `editions/` are copied off-host nightly. The restore test covers an ordinary
  deployment and one with a frozen Edition
  (**[ALEX]** chooses the target; it may cost money). `raw/` keeps 90 days plus blobs that revised
  data.
- CI: GitHub Actions on pull requests (pytest, Vitest, typecheck, lint, Playwright on the fixture,
  image build). Deploys are manual and are Alex's until he says otherwise. **[ALEX]**

---

## 4. Data model

JSON Schema 2020-12 files in `schema/` are the single source. Python validates with them; TypeScript
types are generated from them. Terms below go into `CONTEXT.md` in M0.

### Source
An organisation that produces data, and separately the channel it was fetched through.

`id, name, kind (agency | intl_org | exchange | aggregator), home_url, terms_url, default_rights_status,
attribution_template, user_agent_policy, rate_policy {serial, min_interval_ms}`

A series has an **owner** (BLS) and a **channel** (`via`: `bls_api`, `fred`, `yahoo`, `seed`). The
two have separate terms.

### Series
`key` (immutable), `aliases[]`, `name`, `description`, `segment`, `topics[]`, `geography`,
`unit`, `short_unit`, `freq` (native: D/W/M/Q/A), `seasonal_adjustment`, `real_or_nominal`,
`base_period`, `has_projections` (a hint only), `agg_default`, `origin {owner, dataset, origin_id, url}`,
`channels[]` (ordered: primary, fallbacks, seed), `rights {owner, terms_url, status, attribution,
reviewed}`, `derived_from[]` and `derivation`, `valid_transforms[]`, `max_lag`, `range`,
`breaks[] {period, note, url}`, `vintage_sources[]`, `next_release`.

`display`, `redistribute` and `ml_use` are **derived** by `atlas.v2.rights` from `status` and the
channel actually used. They are never hand-set. Unknown status blocks every public surface.

### Observation
`key, period` (`2026-09`, `2026-Q3`, `2026`, `2026-09-15`), `period_start, period_end`, `value`
(float64, unrounded), `status` (`final | preliminary | revised | estimate | projected |
partial_period`), `interpolated` (bool).

Stored at native frequency. The monthly grid is a derived view. Rounding happens only at display.
`status` on the observation is the authority for observed against projected: one WEO series holds
both, and a fixture tests the boundary year.

### Vintage
What a value was at a point in time. Four clocks, kept apart (research 03 §4.2): observation
period, provider vintage, Atlas retrieval time, release id.

Obslog row: `key, period, value, status, deleted, provider_from, provider_to, provider_precision,
recorded_from, recorded_to, snapshot_id, via, permissions`.

`permissions` is stored on the row, because rights follow the channel each value came through
(research 03 §2). A vintage export or a claim's evidence takes the most restrictive permission of
the rows it uses, not the series' current one.

Every as-of answer carries `vintage_basis`: `provider | atlas_observed | legacy_git | uncertain |
unavailable`. `atlas_observed` shows a value was public no later than a date; it cannot establish
"as first reported". A query never falls back to current data without saying so.

### Release
`release_id` (UTC time plus short hash), `created`, `schema_version`, `code_version`,
`catalog_hash`, `content_hash`, `transform_version`, `series{key → state_hash, via, permissions,
checks}`, `withheld[] {key, reason}`, `qa {errors, warnings}`, `reused_data_from?`.

### Event
`id` (slug), `date` (ISO, with `precision: day | month`), `end?`, `title`, `category`,
`topics[]`, `related_series[]`, `magnitude? {value, unit, source_url}`, `citations[] {title, url,
publisher, accessed}`, Markdown body. Events are context; an event page never says "caused".

### Annotation
A dated or ranged mark that a figure can draw. One shape, several layers:

`id, layer (recession | event | governance | policy | claim | data_note), start, end?, label,
ref? (event id, claim id or series break), series_scope[]? (omit for all series)`

Recession bands and governance bands (v1's `politics.yaml`) are annotations. Events and claims
project into annotations at compile time. `data_note` annotations come from `Series.breaks` and are
always on.

### Topic
`slug, title, definition, segment, key_series[], main_figure (FigureSpec), companions[]
{series, why}`, `explanations[] {title, summary, evidence_for[], evidence_against[], citations[],
figures[]}`, `events[]`, Markdown body.

### Claim (R3)
Research 03 §7 adopted: `id, claimant {name, role, party?}, said_on` (with time if known),
`venue, source {url, locator, archive_url}, quote` (verbatim), `claim_type`, `measures[]` (each:
series, transform, one frozen target period and window, comparison, tolerance, `primary`),
`context_flags[]`, `sufficiency`, `selection_note`, `assessor`, `assessed_on`, `history[]`.

Results live in `claims/locks/<id>.lock.json`: per measure and per basis (`as_of`, `current`), with
`spec_hash`, `release_id`, `transform_version`. The label is derived by the ordered rubric, never
typed in.

A claim's door into the Explorer is `/explore?claim=<id>&measure=<n>&basis=as_of|current`. The
Explorer resolves series, transform, window, vintage date and release from the lock, so the reader
sees exactly the evidence that was judged. A test opens every "then" and "now" door and compares
the plotted values to the lock.

Finding vocabulary: research 03 and 04 propose different word lists. This draft uses 03's derived
labels (Accurate; Accurate within rounding; Accurate, missing context; Inaccurate; Partly checkable;
Not checkable with this data; Depends on the reading) because they are computed from the record.
**[ALEX]** decides the final wording (D4).

### Edition (R3)
`year, version, cutoff, release_id` (pinned), `renderer_version, transform_version,
template_version, compiled_retroactively` (bool), `letter?`, `corrections[]`.

Pinning the data does not freeze the page: a later change to the renderer or a template would alter
an old Edition. So freezing also writes the rendered figures (SVG and tables) and text to
`$DATA_DIR/editions/<year>-v<n>/`, and the Edition routes serve those artifacts. A correction
publishes a new version; the old one stays at its URL.

---

## 5. v1 to v2 migration, and keeping v1 live

**v1 is not touched until cutover.** `atlas build`, `web/`, `dist/`, the weekly GitHub Actions
refresh and GitHub Pages keep working through every milestone. v2 code is added beside it:

```
atlas/        Python: v1 modules stay as they are
atlas/v2/     v2 ingest: sources/, rights.py, obslog.py, content.py, release.py (new package)
site/         Next.js app (new)
content/      events/, topics/, claims/, glossary/, report/, notes/ (new)
schema/       JSON Schemas and transform vectors (new)
deploy/       compose.yaml, Dockerfiles, Caddyfile.snippet, systemd units, runbook (new)
fixtures/     golden release and captured source responses (new)
web/, dist/   v1, unchanged
```

| v1 thing | v2 path |
|---|---|
| `catalog.yaml` (109 entries) | Stays one file. Gains `origin`, `channels`, `rights`, `topics`, `segment`, `valid_transforms`, `breaks`. Added field by field; v1's loader ignores unknown fields (M6 verifies this with a test). |
| 126 series (123 + approval + two election margins injected in memory) | All 126 become real series in the Release, including the three injected ones, each with rights and provenance. |
| `events.yaml` (83 events) | One-off lossless script to `content/events/*.md`. A test round-trips every v1 field. `events.yaml` stays for v1 until cutover. |
| `politics.yaml`, `approval.yaml` | Kept as hand-entered files. Bands become governance annotations; approval becomes a series with per-value citations. |
| Monthly grid from 2000-01 | Becomes `views/monthly.json`, derived from native-frequency series. |
| `check.py` | Becomes the release gate. Its two hard-coded spot checks move into the catalog as data. |
| `stats.js` and its 16 tests | Ported to `lib/stats.ts` and Vitest, with the two caveats fixed. |
| 11 presets | Seeds for topic pages' main figures and for Explorer presets. |
| `#sel=…&mode=…` hash links | `lib/urlstate` reads a v1 hash on `/explore` and rewrites to query parameters. |
| Seed and fallback chain | Kept, and now visible as provenance (`via`). |

**Compatibility, not parity.** v1 has known defects (rounding, wrong source label on y/y after a
fallback, quarterly values placed on a month). v2 does not reproduce them. The M7 compatibility
test feeds v1's frozen raw inputs through both pipelines and compares `views/monthly.json` to v1's
`atlas.json` after applying v1's rounding at the comparison boundary. Every remaining difference
must be listed in `docs/v2/compat-differences.md` with its reason. An unlisted difference fails the
test.

**Known v1 problems fixed on the way** (research 01 §1.3): cache with no expiry; outputs written
before QA and exit code 0 on failure; derived series evaluated in file order; `meta.src` a label,
not a URL; fetch time and vintage dropped; Japan CPI (switch to IMF `JPN.CPI._T.IX.M`, e-Stat as
source of record, retire `JPNCPIALLMINMEI`).

**v1's licence exposure.** `dist/index.html` on GitHub Pages embeds Yahoo month-end values, which
Yahoo's terms forbid redistributing (research 03 §2). This plan does not change v1. **[ALEX]**
decides whether to act on v1 before cutover (D1).

**Cutover (M21, [ALEX]).** After Alex approves v2 on staging: deploy production; replace the Pages
`index.html` with a small page that redirects to `mydashboards.co/macro-atlas/explore` and copies
`location.hash` across in script (the server never sees the hash), with a plain link for no-JS;
disable the weekly refresh workflow; tag `v1-final`. Rollback is restoring the previous Pages
commit.

---

## 6. Testing strategy

Test-first, using the tdd skill's loop: one failing test through a module's interface, the least
code to pass, refactor, repeat. Vertical slices, not a layer at a time. Tests cross the same seam
callers do; if a test wants to reach past an interface, the module is the wrong shape.

| Layer | Tool | What it proves |
|---|---|---|
| Schemas | pytest and Vitest | Every example and the golden release validate; generated TS types are current |
| Source adapters | pytest with captured fixtures (provenance recorded, as in mission-dashboard `fixtures/README.md`) | Parsing, DST regressions, discovery of versioned URLs, error cases. No network. |
| Rights | pytest table tests | Status × channel → permissions; most-restrictive-wins; unknown blocks all |
| Release writer | pytest on temp directories | Stage/check/promote; failure cases below |
| Transform contract | `schema/transform-vectors.json` run by both pytest and Vitest | The two languages agree on the enumerated overlap |
| `lib/query`, `lib/stats`, `lib/urlstate` | Vitest | Contract cases: gaps, lookback, partial periods, zero denominators, as-of with each basis |
| `lib/figure` | Vitest | Structural assertions on SVG and table output, takeaway text and every silence rule; a few reviewed snapshots |
| Pages | Playwright on the golden release at 360px and 1280px, JS on and off | Reader budgets (§2.5), axe-core, keyboard order, v1 hash links |
| Deploy kit | compose + throwaway Caddy smoke test | Both base paths route to their own build; health; promotion without restart |
| Live sources | `atlas check --network`, nightly and manual, never in PR CI | Endpoints still answer and still parse |

Failure cases the release writer must pass (M7): two overlapping runs; a kill between staging and
promotion; a kill during promotion; disk full while staging; a provider returning stale data, an
empty body, or HTML instead of CSV; rollback by rewriting `CURRENT`; pruning while a reader holds
an older release; restore of `obslog/` from backup.

The **golden fixture release** (`fixtures/release-golden/`) is small, committed, built by
`atlas fixture` from frozen inputs, and contains every data state, a withheld series, a series
break, a stale series and a failed-refresh manifest. All site tests, previews and screenshots use
it. It contains only rights-cleared or synthetic data.

Each milestone PR ends with: all suites green, a Codex review, and the PR body written with the
mattpocock `pr` skill.

---

## 7. Milestones

One PR each. Fable 5.2 builds each autonomously and stops only for the **[ALEX]** items. "AC" =
acceptance criteria. Every milestone also has the standing criteria: v1's offline pytest suite
still passes in the PR gate; no secrets in the repo; reader budgets hold on any reading page it
touches. v1's Playwright smoke test loads Chart.js from a CDN, so it stays in v1's own workflow and
is not part of the offline v2 gate; `make check` (network) is run by hand before each release
boundary.

### R1: Reader preview

**M0 Foundations.** `CONTEXT.md` glossary (domain-modeling skill); ADRs 0001 hybrid ingest and
Release seam, 0002 single writer, 0003 rights model, 0004 transform contract, 0005 native frequency,
0006 no chart library; JSON Schemas for series, source, event, topic, glossary term, annotation and
release manifest; `schema/transform-vectors.json`; `atlas fixture` and the golden release; the v2 CI
workflow.
AC: schemas validate the golden release in both languages; CI runs on the PR and is green; the
golden release contains each data state and a withheld series.

**M1 Spike: vintage feasibility.** A research note and ADR 0007, no production code. For GDP,
payrolls, unemployment and CPI: what the Philadelphia Fed real-time data set can and cannot
establish (first release, arbitrary claim dates), its redistribution terms, what v1's git history
adds, and what ALFRED would add.
AC: a per-series coverage table with `provider | uncertain | unavailable` by date range; a go/no-go
for M22; the exact v2.0 promise in one paragraph. **[ALEX]** only if the recommendation needs a FRED
key.

**M2 Site skeleton and one series page.** `site/` with tokens from /missions, top bar, tabs,
`lib/release`, `/api/health`, Dockerfile with `BASE_PATH`, and `/data/<key>` rendering a plain line
figure, table and provenance block from the golden release. Includes the CSP and caching spikes.
AC: promotion and rollback of `CURRENT` change the served page with no restart (test); page text,
figure and table always come from one release id (test); CSP decision recorded in ADR 0008 with a
passing test for the chosen policy; measured JS floor recorded and the §2.5 budget set; page passes
no-JS, 320px and axe checks.

**M2b Query core.** `lib/query` for current data: `freq`, `agg`, the transform allowlist, drawdown,
lookback, gap and partial-period rules, permissions in the answer. `as_of` returns `unavailable`
until M22. Written as a plain TypeScript package with no Next.js import.
AC: every rule in ADR 0004 has a test; the shared vectors pass; the package runs under plain Node.

**M3 The explained figure.** `lib/figure` for line and multi-line figures, the takeaway templates
with silence rules, data-state marks, "How to read this", table twin, glossary pages and popover,
series palette validated in both themes.
AC: each silence rule has a test (partial, stale, estimate, break, non-comparable); every data
state renders with a mark and a word; glossary works as plain links with JS off; a figure at 320px
has no clipped labels.

**M4 Reader slice: cover, Inflation topic, Explorer handoff.** `atlas.v2.content` (compile and
validate), `content/topics/inflation.md` with companions and at least three sourced competing
explanations, small-multiples figure type for "What else moved", the Living cover as home, and a
server-rendered read-only `/explore` that draws the series and window named in the URL.
AC: a reader can go cover → Inflation → a figure → "Open in Explorer" → series page and back on a
phone with JS off; every explanation has at least one citation for and one against or says none was
found; compile fails on a dangling series or event reference with file and line; manual VoiceOver
pass recorded. The explanation text is drafted by Fable from cited sources and marked
`status: draft` until **[ALEX]** approves it; drafts do not render on a non-local build.

**M5 Deploy kit.** `deploy/` with compose, both base-path builds, `Caddyfile.snippet`, health
checks, runbook, and the local Caddy smoke test. The kit serves a fixed release for now.
AC: local smoke test passes for `/macro-atlas` and `/macro-atlas-staging` together; runbook lists
every manual step. **[ALEX]** SSH user and key, paste the Caddy snippet, licensing stance D1 (which
series may be shown on a public staging URL), first staging deploy.

### R2: v2.0 public launch

**M6 Native observations, provenance, rights, obslog.** `atlas.v2.sources` adapters for v1's
providers behind the contract, cache TTL, `atlas.v2.rights`, per-series native-frequency unrounded
observations with states, source URL and fetch time, and obslog recording from the first run.
Rights fields added to the schema and to every emitted series, including the three injected ones.
AC: every one of the 126 series has an owner, channel and status (possibly `unknown`); a fallback
changes `via` and recomputes permissions (test); a derived series takes the most restrictive
permission of its inputs (test); a re-run with unchanged data appends nothing to the obslog.

**M7 Transactional release writer.** `atlas.v2.release` build, check, promote and prune; the run
lock; pins; derived-series dependency graph with cycle detection; `views/monthly.json`; the ingest
image and compose service; the systemd timer units; `STATUS.json`; the minimal backup and restore
scripts for `obslog/`, `CURRENT` and the current release (M21 extends them).
AC: all failure cases in §6 pass; checks run before promotion and a failed check exits non-zero and
leaves `CURRENT` alone; the compatibility test passes with every difference listed.

**M8 Rights audit and withheld states.** Read and record terms for every owner and channel in the
catalog; set `status` and `reviewed`; the "withheld" row on the site; rights applied to figures,
search excerpts, table twins and Markdown twins.
AC: no series has `unknown` status without a written reason; a withheld series appears by name with
its reason and no values anywhere in the HTML (test greps the page). **[ALEX]** D1: the stance on
Yahoo and third-party index levels. Default until decided: withheld.

**M9 Content pipeline and events.** Lossless `events.yaml` → `content/events/*.md` script; event
schema with spans, topics and magnitude; annotation projection; event pages and the events index;
`atlas add series|event|topic` writing drafts only.
AC: round-trip test covers all 83 events and every v1 field; `atlas add` never commits and its
output passes `atlas check`; an event page shows the event on each related topic's figure.

**M10 Primary-source adapters I (no keys).** Three PRs: **M10a** BLS (CPI, payrolls,
unemployment); **M10b** Treasury Fiscal Data (Monthly Treasury Statement, debt); **M10c** Fed Board
(H.15, H.10, Z.1 household net worth) and IMF Japan CPI. Captured fixtures for each. FRED stays as
a recorded fallback channel.
AC: each re-sourced series matches its FRED twin within a stated tolerance over the overlap
(test on fixtures); provenance shows the agency URL; Japan CPI matches the e-Stat file for the 25
months research 02 checked.

**M11 Primary-source adapters II (keys).** Three PRs: **M11a** BEA (NIPA, international
investment position, current account); **M11b** population and households; **M11c** EIA (headline
energy series). Each degrades to stale when its key is absent. The Census Data API now needs a key
(research 02), so M11b first tries keyless routes (Census population-estimate files, the FRED
twins) and verifies them with fixtures; if none is adequate it needs a Census key.
AC: suites pass with no keys present; with keys in the environment `atlas check --network` passes.
**[ALEX]** register BEA and EIA keys, and a Census key if M11b needs one (all free), and place them
on the VPS.

**M12 Figure types II, catalog and search.** Change strip, statement table, sparkline row; `/data`
catalog with filters; `search-index.json`, the search sheet and the no-JS `/search` page.
AC: statement table keeps its label column sticky and readable at 320px; search returns topics,
series, events and glossary terms grouped by kind; keyboard-only use passes.

**M13 Report shell, Highlights, Who We Are, Notes.** The Living edition contents, cover wired to
real data, the 1/5/10-year Highlights table where every cell is a door, Who We Are, and Notes
generated from the catalog.
AC: Contents works as `<details>` with JS off; every Highlights cell opens the Explorer at that
window; Notes lists every series break and the revisions policy; manual VoiceOver pass recorded.

**M14 The three statements.** Three PRs: **M14a** federal (with ADR 0009), **M14b** national,
**M14c** external. ADR 0009 sets the rules for fiscal against calendar year, stock against
flow, cash against accrual, and cut-off when series end at different dates. Then the federal
(Monthly Treasury Statement; the accrual balance sheet from Treasury's *Financial Report* as a
hand-entered annual table with page citations), national and external statements.
AC: every table header states entity, basis and period; no table mixes bases without a labelled
divider; each cell links to a series page or a cited document page.

**M15 Segment chapters and risk factors.** Three PRs: **M15a** the chapter template and two
chapters, **M15b** the other four, **M15c** risk factors. Six chapters, each with a metrics strip, two to four
figures and notable events; risk factors drawn from named lists (GAO High-Risk, CBO long-term
outlook, FEMA). Chapters whose data arrives in R3 (Infrastructure, The US in the world) ship with
the series v1 already has and say what is coming.
AC: chapter prose is limited to template sentences and sourced notes; anything interpretive is
`status: draft` and hidden outside local builds. **[ALEX]** writes or approves interpretive text.

**M16 Topics batch.** Three PRs of two topics each. Jobs, Housing, Federal budget, Rates and markets, Energy prices, Global
markets (from v1's presets), each with companions and competing explanations.
AC: as M4, per topic. **[ALEX]** approves explanation text; unapproved topics stay hidden.

**M17 Explorer I.** `lib/urlstate` with v1 hash compatibility; the interactive client Explorer on
`lib/figure`: six scale modes with per-series valid transforms, gaps shown, annotation layers,
pinned readout strip, phone bottom sheet, presets.
AC: every v1 preset link and ten recorded v1 hash links open the same selection, mode and range;
the server-rendered view from M4 remains the no-JS fallback; no information is hover-only.

**M18 Explorer II.** Two PRs: **M18a** `lib/stats`, the matrix, scatter, lag and rolling views;
**M18b** compare ranges and export. In detail: `lib/stats`; correlation matrix on the coarsest common frequency, scatter with
n and effective n, ±24-month lag profile, rolling correlation, compare ranges as small multiples on
phones, CSV and PNG export.
AC: the 16 ported v1 tests pass plus tests for the two fixed caveats; the multiple-comparisons note
shows whenever the matrix does; export honours `redistribute`.

**M19 Data out I.** File twins on `/data/<key>`, `/api/v1`, provenance headers, 403 with reason
for restricted series, app-level rate limit, API documentation page.
AC: a twin with no query string returns the full native series; transforms outside the allowlist
return 400; `ETag` equals the release id; the rate limit has a test.

**M20 Data out II.** Bulk Parquet and CSV.gz, `datapackage.json` split by licence, `/downloads`,
`llms.txt`, JSON-LD.
AC: checksums in the datapackage match the files; nothing with `redistribute: false` is in any
bulk file (test); the datapackage validates against the Frictionless v2 schema.

**M21 Cutover kit.** Production runbook, Pages redirect page that carries the hash, backup and
restore scripts with a restore test, the launch checklist.
AC: restore test rebuilds a working `DATA_DIR` from a backup; the redirect page is tested locally
with a v1 hash link. **[ALEX]** approve v2 on staging; production deploy; change the Pages site;
disable the v1 workflow; choose the backup target.

### R3: Claims and coverage

**M22 Vintage import and as-of resolution** (only if M1 said go). Import the Philadelphia Fed
matrices and v1's git history into the obslog; `as_of` in `lib/query`; `vintages/<key>.json`; the
"then and now" figure; "vintage unavailable" and "uncertain" states.
AC: `as_of` never returns current data under another name (test for each basis); the cutoff rule
(public before 00:00 ET on the date) has tests around same-day releases; vintage exports honour the
per-row permissions.
**If M1 says no-go**, M22 shrinks to: `as_of` answers from `atlas_observed` and `legacy_git` only,
and everything earlier is `unavailable`. Downstream changes: in M23 any claim made before the
obslog began is at best "Partly checkable"; in M24 the "then" panel shows the unavailable state; in
M33 the "As first reported" view is omitted for the retroactive 2025 Edition. No other acceptance
criterion changes.

**M23 Claim records, locks and rubric.** Claim schema, `atlas add claim`, `atlas claims compute`
(Node script over `lib/query`), lock files, the ordered rubric, the published rubric page.
AC: the label is a pure function of the lock and the flags (table test of every rubric row); an
uncertain vintage forces "Partly checkable" or "Not checkable"; changing `said_on` invalidates the
lock.

**M24 Claim pages.** The phone-first claim page, claims index with filters (including party, so
readers can audit balance), selection note, history, "Report an error" link to a prefilled GitHub
issue, the Claims tab.
AC: quote, finding and reasons are above the fold at 360×740; manual VoiceOver pass recorded.
**[ALEX]** D3: public from day one, or a private set until about ten cases have tested the rubric.

**M25 Window sensitivity and share images.** The heat strip ("direction holds in N of M valid
windows"), and **(optional)** a static share image per claim and topic, rendered at release time
from `lib/figure`.
AC: the strip makes no statement about the speaker's intent; images contain the source line.

**M26 Infrastructure I.** **M26a** construction spending, public and private, by type, including
water supply, sewage and communication lines (Census C30 and FRED twins); **M26b** freight and
transport (BTS monthly series, rail, trucking, annual port TEU). **M27 Infrastructure II: grid and
energy** (EIA generation and capacity). **M28 Federal infrastructure spending**: **M28a** IIJA
through USAspending (budget authority, obligations and outlays kept as three separate measures, by
agency, with EPA water lines called out); **M28b** CHIPS through its federal accounts. Dated
snapshots for both. Each adds a topic page.
AC for each: captured fixtures; rights recorded before any export; measures never blurred in a
label. State-level IIJA and the BEAD account are out until research 02's open checks are closed.

**M29 G20 I: prices, rates and currencies** (IMF CPI and FX, BIS policy rates, Argentina marked
missing). **M30 G20 II.** **M30a** unemployment (OECD and national fills); **M30b** GDP, with WEO
actual and projected values split by observation status and drawn differently; **M30c** the "US
against the G20 range" figure; **M30d** global trade and commodities (IMF PCPS commodity prices,
World Bank annual trade, the US trade balance from BEA and Census).
AC: a coverage matrix page shows what exists per country; projections are never drawn as observed.

**M31a Spike: unusual-move rule.** Before running anything, write down for 2008-09, 2020-03 and
2022-06 the series that must appear (for example the unemployment rate in 2020-03) and the series
that must not. Then test the z-score rule, including its handling of gaps and short histories.
AC: go only if every "must appear" series is listed and no "must not" series is, in all three
episodes; the result and the rule are recorded in an ADR.
**M31b Unusual-move rows** (only on go). Adds the rows to "What else moved"; on no-go the curated
companions stay as they are.

**M32 MCP endpoint (optional).** As §3.8.
AC: every tool is read-only and capped; a contract test runs each tool against the golden release.

**M33 The 2025 Edition.** Edition freezing (`pins/`, rendered artifacts), the three figure views
("As in this Edition", "As first reported", "Today's estimate"), corrections log, the retroactive
label.
AC: changing the renderer does not change a frozen Edition's HTML (test); a correction creates
v1.1 and leaves v1.0 at its URL. **[ALEX]** writes and signs the Letter (or chooses no Letter).

### Brief scope to milestone

| Brief item | Source | Milestone |
|---|---|---|
| US economy, markets, politics (v1's 126 series) | v1 sources, then primary agencies | M6, M10, M11 |
| Construction spending, public and private | Census C30, FRED twins | M26a |
| Grid and energy production | EIA | M11c, M27 |
| Freight and transport: rail, trucking, ports | BTS (ports annual only; monthly TEU is unverified) | M26b |
| Water investment | C30 water and sewage construction; IIJA EPA lines | M26a, M28a |
| Broadband investment | C30 communication construction. BEAD outlays are deferred until its account is identified. **[ALEX]** accept this as the v2 measure, or wait | M26a |
| Federal infrastructure spending (IIJA, CHIPS) | USAspending | M28 |
| Disasters and pandemics | v1 events; OpenFEMA, CDC and OWID as series are not yet assigned. **[ALEX]** add as M28c, or leave as events for v2 | — |
| G20 inflation, policy rate, FX | IMF, BIS | M29 |
| G20 unemployment, GDP | OECD, national, WEO | M30a, M30b |
| G20 main stock index | Yahoo in v1; licensed products from any channel | Blocked on D1; withheld by default |
| Global trade and commodities | IMF PCPS, World Bank, BEA | M30d |

---

## 8. Decisions and actions for Alex

| # | Item | Needed by | Default if undecided |
|---|---|---|---|
| D1 | Licensing stance: Yahoo and third-party index levels; FRED as a display channel; v1's existing Yahoo exposure on Pages | M5 (first public staging) | Withhold Yahoo and third-party series from every public surface; leave v1 as is |
| D2 | Free API keys: BEA, EIA, possibly Census (M11); api.data.gov (politics context, later); FRED (only if M1 recommends ALFRED) | M11 | Keyed sources show as stale or absent |
| D3 | Claims public from day one, or private until the rubric is tested on about ten cases | M24 | Private first |
| D4 | Finding vocabulary (research 03's derived labels or research 04's six words) | M23 | Research 03's |
| D5 | The Letter: write and sign one per Edition, or none | M33 | None |
| D6 | Design: serif for signed prose, theme rule, segment names, shared "mydashboards" link | M2 | System sans, /missions' theme rule, research 04's segments, add the link |
| D7 | Claims block before or after the v2.0 cutover | After M11 | After |
| D8 | Bagby's contents page and edition year (check the softcover) | M13 | Use research 04's section list |
| D9 | Approve interpretive text: competing explanations, chapter notes, risk factors | M4, M15, M16 | Drafts stay hidden |
| D10 | Server: SSH user and key, Caddy snippet, staging deploy, production deploy, backup target, failure notifications | M5, M21 | Local only |
| D11 | Merges to `main` for every milestone PR | Every PR | PR waits |

Money: nothing in this plan requires spending. Possible costs are an off-host backup target and a
notification service, both optional and both Alex's call.

---

## 9. Ambitious options (flagged, none required)

- **Guided reading mode**: a topic page as a sequence of steps, each step one figure and two
  sentences, with previous and next. Plain links, no scroll-driven animation.
- **"Explain this number" pages**: for each Highlights row, a short page that walks from the
  headline figure to its definition, its components (an accounting decomposition, labelled as
  accounting and not as cause) and its usual misreadings.
- **Print and PDF Edition**: a print stylesheet that turns a frozen Edition into a paginated
  annual report, in Bagby's spirit.
- **Share images** per claim and topic (M25).
- **Weekly "What changed" page**: generated from the obslog, listing new releases and revisions in
  plain sentences, with an Atom feed.
- **Earlier vintage archive**: run the daily ingest from GitHub Actions before the VPS is ready, so
  `atlas_observed` history starts sooner. Needs D1 first, because it stores provider data.
- **DuckDB-WASM query page** over the bulk Parquet, and `llms-full.txt` (both deferred in research
  03).
- **In-browser editor behind a login** (the brief's later option).

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Licensing removes most market series from the public site | Rights gate from M6; withheld rows by name; D1 early; public-domain proxies where they exist |
| Reader budgets fail under Next's framework JavaScript | Measured in M2 before any reading page is built; the budget is set from the measured floor |
| Enforced CSP conflicts with Next's inline scripts | Spike in M2; fall back to /missions' Report-Only policy with an ADR |
| Vintage coverage is thinner than hoped | M1 decides the promise before anything depends on it; "unavailable" is a designed state |
| Two languages drift on transforms | One runtime in TS; the Python overlap is enumerated and pinned to shared vectors |
| The VPS IP is throttled by Yahoo or FRED alongside /missions' traffic | Serial per-host fetching, per-source User-Agent, test from the VPS before depending on it; Yahoo is withheld by default anyway |
| Interpretive text needs Alex and stalls milestones | Drafts are hidden, not blocking; pages ship with template sentences and sourced notes |
| The programme is long | Three release boundaries; each milestone leaves `main` shippable |
| Unverified source facts (research 02 §10, research 03's unverified list) | Each is checked in the milestone that first depends on it, with a captured fixture |
