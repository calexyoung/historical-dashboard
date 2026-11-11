# 01: Stack and reuse map

Research for the Macro Atlas v2 plan (see `docs/v2/BRIEF.md`). It covers what v1 is, what the sibling
`~/Developer/mission-dashboard` provides, and what v2 can reuse, port or must decide.
Read from the code on 2026-11-11: this repo at `v2-planning` (`4b4a6db`), mission-dashboard at `main` (`6e5c3f9`).
Nothing here is a decision. Where I lean one way, it is marked as a recommendation.

## TL;DR

- **v1 is small and well-tested.** About 780 lines of Python and 840 of front-end JS. 109 catalog entries become
  123 series in `data/atlas.json`, plus 3 injected at render time (approval, two election margins) for 126 (2000-01 to 2026-11), with 83 cited events and hand-entered politics. `make check` gives 0 errors and
  4 known warnings today. There are 49 pytest tests, the JS math is tested under node, and Playwright runs smoke tests.
- **mission-dashboard gives v2 its server skeleton.** Next.js 16.4.5 (App Router, `cacheComponents`), React 19.3,
  Tailwind 4, TypeScript, Vitest 5 (about 760 tests, no network). Standalone output runs on `node:24-alpine` as a
  non-root user. It has `basePath` `/missions`, a `/data` volume (`DATA_DIR`) written atomically, background
  collectors started from `instrumentation.ts`, a cheap `/api/health`, and a well-tested source gateway (TTL,
  last-known-good, single-flight, seed-on-restart). Several of these files can be copied almost unchanged.
- **Main conflict: the ingest language.** v1's ingest is Python (pandas, curl_cffi for Yahoo). The target server is
  Node. Yahoo answers HTTP 429 to non-browser TLS handshakes, and v1 gets past that only through curl_cffi's Chrome
  impersonation, which has no mature Node equivalent. The brief also wants Parquet out, which is easy in Python and
  harder in Node.
  **Recommendation: hybrid.** Keep Python for ingest, QA and the bulk exports, run as a one-shot container that a
  host timer starts daily. It stages a versioned data release, validates it, then promotes it atomically into
  `DATA_DIR`. Next.js only reads the current release and serves the pages and the read API (option analysis in
  section 4). v1 needs two fixes first: its raw cache never expires, and its build writes outputs before QA passes.
  Both are covered in section 1.3.
- **Design conflicts to settle early.** v1 uses Google Fonts (Newsreader + IBM Plex) and the Chart.js CDN, rounded
  cards, and an OS-driven dark theme. /missions uses system fonts only, a `'self'`-only CSP (Report-Only today), no cards
  ("Don't wrap panels in cards"), and light by default with dark only on request. A "family resemblance" means v2
  adopts the /missions token and panel grammar, and bundles any chart library itself.

---

## 1. What v1 is

### 1.1 Pipeline (`atlas/`, Python ≥3.11, uv-managed)

| Module | Lines | Role |
|---|---:|---|
| `cli.py` / `__main__.py` | 67 | `python -m atlas fetch|build|check|serve` (argparse). `fetch` fails soft; `check` exits 1 on errors. |
| `sources.py` | 262 | Fetchers: **FRED** graph CSV (no API key), **Yahoo** v8 chart JSON (monthly bars from 1999), and a generic **`csv_url`** column mapper (Eurostat SDMX-CSV, ONS generator CSV, OECD SDMX). Disk cache in `data/raw/<key>.{csv,json}` plus a `.meta.json` fetch time. Per-source throttle, retries with backoff, and a 429 circuit breaker (2 strikes, then the source is skipped for the run). FRED gets the stock `requests` UA (its CDN resets browser UAs). Yahoo goes through `curl_cffi` with `impersonate="chrome"`. `parse_month` handles `YYYY-MM`, `YYYYMmm` and ONS `YYYY MON`. |
| `transform.py` | 146 | `to_monthly` (mean, or `last` for month-end closes), `yoy` on observed months only (no forward-fill), rounding (2 dp for %/pp, 3 otherwise), clipping to `FIRST_MONTH = 2000-01`, `derived` series (`div` of two series), approval expansion from quarters to months, and a reference forward-fill rule. |
| `build.py` | 197 | `fetch_all` with a three-step fallback chain: primary, then catalog `fallback` (e.g. Eurostat to FRED), then `data/seed/<key>.json`. Writes `data/atlas.json` (577 KB). Injects approval and election-margin series. Renders `web/template.html` with Jinja and fills placeholders with inline JSON (`__DATA__`, `__EVENTS__`, `__PRES__`, `__BANDS__`, `__BUILT__`). Enforces a 2 MB limit and runs `node --check` on the inlined JS. Output: `dist/index.html` (660 KB, one self-contained file). |
| `check.py` | 108 | QA (section 1.4). |

**Shape of `atlas.json`:** `{generated, first_month, last_month, series: {key: {d: ["YYYY-MM"...], v: [...]}},
meta: {key: {name, cat, unit, src, note, freq, last_obs, parent?, seed?}}}`. Everything sits on a **monthly grid**.
Daily and weekly sources are aggregated, and quarterly and annual values sit on their observation month.

### 1.2 Catalog and hand-entered data

- `atlas/catalog.yaml`: **109 entries** (80 FRED, 25 Yahoo, 3 `csv_url`, 1 derived), none disabled. 14 have
  `derive_yoy`. Fields: `key, source, id, name, cat, unit, agg, freq (M|W|D|Q|A), max_lag_months, note, range,
  yoy_*, fallback, known_truncated, csv{...}`. There are 10 categories: US economy 22, Rates & money 12, Europe 12,
  Global markets 11, Currencies 11, Asia & other 11, US markets 10, Commodities & energy 10, Housing 5,
  Politics & sentiment 5.
- The output is **123 series in `data/atlas.json`**, and **126 on the page**. `with_approval` and `with_politics` inject
  approval and the two election margins only in memory, at build and check time, so a read API serving today's
  `atlas.json` would miss those 3. By frequency:
  M 85, D 15, Q 12, A 6, W 5. By source label: FRED 92, Yahoo 25, ONS 2, OECD 2, Eurostat 1, computed 1.
- `atlas/events.yaml`: **83 events** with `month, day?, title, cat, url`. Categories: financial 28, policy 21,
  political 15, geopolitical 14, health 5. Every event has an `https` citation (checked HTTP 200 on 2026-09-22).
- `atlas/politics.yaml`: popular votes for president and House 2000–2024, with a Wikipedia URL per row. The bands
  (`fed_chair`, `treasury`, `house`, `senate`, `shutdowns`) are `[from, to_exclusive, label, style]` rows, each block
  with a `source`.
- `atlas/approval.yaml`: approximate Gallup quarterly approval (labelled "approx." on screen) and presidential terms.
- `data/seed/`: 18 Yahoo series as a last-resort fallback.

### 1.3 Known gaps that matter for v2's "provenance is a feature"

- `meta.src` is a label ("FRED UNRATE"), not a URL. There is no per-series fetch time, vintage or licence in the
  output. The fetch time exists in `data/raw/*.meta.json` but is dropped.
- **Some attribution is wrong, not only missing.** When a fallback is used, the parent series' `src` is rewritten,
  but its derived y/y series keeps the primary source's label and loses the `seed` marker (`transform.py`, the
  `derive_yoy` block). v2 needs lineage, so a derived series inherits its parents' provenance before it can back a
  claim check.
- **The raw cache has no TTL.** Fetchers read `data/raw/` whenever a file exists unless `--force` is passed, and
  `make fetch` does not pass it. CI works only because each run starts with an empty checkout. On a persistent
  volume, a daily job would keep reusing old data. v2 needs an explicit refresh policy, and stale-cache fallback
  that shows up as provenance.
- **Build does not gate on QA.** `build_dataset()` overwrites `data/atlas.json` before checks run. `build()` writes
  `dist/index.html` even when `run_checks` reports errors, and `atlas build` exits 0. Only CI's separate
  `make check` step stops a bad deploy. A v2 release needs the order stage → validate → promote, and must keep
  the previous good release.
- The monthly-only grid from 2000 limits "past state" questions (e.g. pre-2000 history, daily market moves).
- Event categories are fixed to 5 in `check.py`. The v2 scope (disasters, pandemics, infrastructure) needs more,
  plus a claims model.
- Hand-entered values (approval, votes) have a citation per block or row, not per value.
- Open items recorded in the README: Japan CPI (ends 2021-06), TED (ends 2022), no free source for Baltic Dry, PMI,
  freight, union membership or overdose deaths. The v2 infrastructure scope will hit similar "no free source" walls.

### 1.4 Checks (`check.py`)

1. Every catalog entry (and its y/y) produced a series.
2. Staleness against `max_lag_months`. An error for Yahoo, a warning for others and for `known_truncated`.
3. Sanity `range` / `yoy_range` per series, with defaults for approval and margins.
4. Structure: `d`/`v` lengths match, months strictly increase, no NaN, nothing before `first_month` or in the
   future, every series has meta.
5. Spot checks: `cpi_yoy` 2022-06 ≈ 9.0 ± 0.3, and S&P 500 in Feb/Mar 2009 between 700 and 850.
6. Events: inside the data range, a valid category and day, an https URL. A missing URL is a warning.
   Seeded or fallback series also produce a warning.

These checks port into a v2 release gate (a release that fails `check` is not promoted). The ordering
problem above still has to be fixed. The spot checks are hard-coded to two series.

### 1.5 Tests and CI

- `tests/test_transform.py` (23): resampling, y/y, rounding, the FRED/Yahoo/CSV parsers, the Yahoo DST/time-zone
  month-label regressions (`ccc1dce`), and the fallback chain.
- `tests/test_stats.py` (16): runs `web/stats.js` under node from pytest. Covers Pearson with lag, z-score
  (population SD), rebase, y/y, sparse fill, p-value, drawdown and rolling correlation.
- `tests/test_build.py` (8): template placeholders, the JS syntax check, the size limit, the dataset passing checks,
  catalog shape, and that `check` flags bad data.
- `tests/test_smoke.py` (2): Playwright desktop and mobile runs over `dist/index.html`, writing screenshots.
- `.github/workflows/refresh.yml`: every Monday at 06:17 UTC, plus on push to main and manual dispatch. Runs
  fetch → build → check → unit → smoke, commits `data/atlas.json` and `dist/index.html` as `macro-atlas-bot`, and
  deploys `dist/` to GitHub Pages. Python comes from uv (locked) and node 22 from the workflow. v1 stays on Pages
  until v2 is approved, so this workflow keeps running alongside v2 work.

### 1.6 Front-end analysis features in `web/app.js` worth keeping

All of these are client-side over the aligned month axis. **`web/stats.js` is pure, framework-free and already
tested, so it ports to a TS module almost line for line, for monthly data.** Two caveats. `changes()` needs
adjacent observed months, so quarterly and annual series get no change-based correlation. And `rollingCorr`
accepts a `minN` argument it never uses (the floor of 8 comes from `pearson`). Decide how mixed-frequency
comparison works (G20 data is often quarterly) before calling the module ready for v2.

- **Shareable state in the URL:** selection (≤ 8 series), mode, range, correlation basis, lag, scatter pair, event
  category filter, highlighted event, toggles, bands, compare start, rolling window. It is mirrored to
  `localStorage`, and the hash wins. v2 should move this into search params, so server-rendered pages and link
  previews see the state too.
- **Six scale modes:** rebase to 100 at range start, z-score, raw on a dual axis, log, y/y %, drawdown from peak.
  Sparse series are step-filled with honest stop rules (Q: +2 months, A: +11, elections hold until the next one).
  The fill is for plotting only and never feeds a statistic.
- **Context layers:** NBER recession shading (`usrec`), background bands (presidential terms by party, Fed chair,
  Treasury secretary, House/Senate control, shutdowns), event markers with category chips and citation links, and
  max/min annotations.
- **"Start from a question" presets:** 11, e.g. COVID shock, 2008, inflation surge, US vs Europe jobs,
  "2008 vs 2020". Presets are the seed of v2 topic pages and claim checks.
- **Two-range comparison:** overlays a second window aligned at its start.
- **Correlation tools:** a matrix over the selection on monthly % changes (observed values only) or levels. The pair
  scatter shows r, r², n and p < 0.05 (normal approximation), and a lag slider of ±24 months. A lag-profile bar
  chart is clickable to set the lag, and there is a 24/36-month rolling correlation.
  These directly serve "complex interactions rather than simple cause-and-effect". v2 should keep the
  "correlation ≠ causation" framing and the n/p disclosure.
- **Snapshot table:** start value, latest value in range with its month, change (percentage points for % units,
  otherwise %), range low and high with months, source, note and last observation.
- **Export:** copy or download CSV of the view, PNG of the chart, an all-data CSV, copy link.
- **Quality floor:** a mobile bottom-sheet picker, `prefers-reduced-motion`, an 8-series cap with an explanatory
  toast, a "to YYYY" marker for series that ended, and a dark theme.

Not worth keeping as they are: the single-file Jinja inlining, the placeholder injection, and the 2 MB limit
(a server app streams data per page). Also the global-state DOM rendering, which becomes React components.

---

## 2. What mission-dashboard is

### 2.1 Framework and configuration

- **Next.js 16.4.5**, App Router, `cacheComponents: true`, `partialPrefetching: true`, Turbopack with the Tailwind 4
  loader. **React 19.3.0**, **TypeScript 5**, **Tailwind 4** (`@theme` tokens in `src/app/globals.css`),
  ESLint 9 with `eslint-config-next`. AGENTS.md warns that this Next version has breaking changes, so read
  `node_modules/next/dist/docs/` before writing code. The same applies to v2.
- **Charts are hand-drawn SVG.** There is no chart library in `package.json` (deps: fast-xml-parser, gcn-kafka,
  satellite.js, topojson-client, world-atlas).
- **`next.config.ts`:** `basePath = "/missions"`, also exported as `NEXT_PUBLIC_BASE_PATH` for URLs built by hand on
  the client. `output: "standalone"`, `poweredByHeader: false`. Security headers on every route: CSP **Report-Only**
  (`default-src 'self'`, `script-src 'self' 'unsafe-inline'`, `font-src 'self'`, `connect-src 'self'`,
  `frame-ancestors 'none'`), plus nosniff, Referrer-Policy, `X-Frame-Options: DENY` and Permissions-Policy.
  The header says the browser talks only to its own origin; every upstream call is made by the server.
- **The page is a static shell.** `page.tsx` renders `<Dashboard/>` in Suspense, and the client polls
  `GET /missions/api/snapshot` every minute. A theme script runs inline before first paint
  (`?theme=dark`). `?mock=1` serves built-in demo data for every state.
- **No `.github/` CI** in mission-dashboard. Checks run locally (`npm test`, `typecheck`, `lint`, `build`).
  Neither repo has the Caddy config (it lives on the VPS), so the `/macro-atlas` route has to be added there.
  That is a server change, outside this research.

### 2.2 Docker

Three stages on `node:24-alpine`: `deps` (`npm ci`), `build` (`npm run build`, telemetry off), `run`.
The run stage copies `.next/standalone` and `.next/static` (there is no `public/` dir), `chown node`, creates
`/data` with `VOLUME ["/data"]`, `USER node`, `EXPOSE 3000`, and
`HEALTHCHECK wget -qO- http://127.0.0.1:${PORT}/missions/api/health`, then `CMD node server.js`.
Env: `PORT=3000`, `HOSTNAME=0.0.0.0`, `DATA_DIR=/data`. `.dockerignore` excludes `.env*`, `.next`, `.git` and
`.claude`. One native-module workaround (librdkafka) is specific to GCN and not needed for v2.

### 2.3 Data persistence and ADR 0002

- There is no database. Durable state is JSON files in `DATA_DIR` (`./.data` locally, `/data` in the image): DSN link
  history, pass log, CelesTrak elements and cooldown, GCN alerts. Each is written atomically (temp file + `rename`).
- If `DATA_DIR` is not writable, the store runs in memory and **says so** (`persistence: "memory"` in the health
  and snapshot payloads). "Losing durability is visible, never silent."
- **ADR 0002, "one instance owns collection and state":** deploy exactly one instance with a persistent volume.
  Replicas are rejected because each would hold its own cache, multiply polite-use upstream requests and race on
  the files. A shared DB plus a separate scheduled collector is the named future shape. A cross-process lock exists
  for CelesTrak because dev and prod may share one IP and one `DATA_DIR`.

### 2.4 Background collectors

`src/instrumentation.ts` `register()` runs once per Node server process. It starts the DSN collector
(`setInterval`, 10 s, `unref()`ed, kept as a singleton on `globalThis`, turned off with `DSN_COLLECTOR=off`), and
the GCN Kafka consumer only when credentials are set. Everything else is collected lazily on request through the
gateway.

### 2.5 The source layer (the most reusable code)

- **`lib/gateway`** answers "give me this value, at most this old". Per-key TTL, `maxStaleMs`, `timeoutMs`,
  `retryMs`, and a bounded `waitMs` on a cold start. It serves last-known-good while one refresh runs
  (single-flight), restores a persisted value through `seed()` with its original fetch time, **never throws**, and
  returns `{value, fetchedAt, stale, error, pending}`. Clock and timers are injectable, so it is fully unit-tested.
- **`lib/sources/contract.ts`** sets the rules for every adapter. There is one `load(deps)` plus a pure `parse…`,
  and all I/O goes through `deps.fetch`, `deps.now()` and `deps.signal`. An adapter **throws on failure and never
  returns fake or partial data**. That is the same philosophy as v1's fail-soft plus seed, stated more strictly.
- **`politeQueue(n)`** caps requests in flight per upstream and is abort-aware.
- **Fixtures:** real captured responses with capture time, URL, request headers and trimming notes
  (`fixtures/README.md`). Parsers are tested against them, and the test suite never touches the network.
  v1 has no committed fixtures. Its parser tests use inline strings, and the smoke test needs the Chart.js CDN.

### 2.6 Health

`GET /missions/api/health` is request-time (`await connection()`). It never builds a snapshot or calls an upstream.
It returns `status`, `startedAt`, `now`, `version` (`APP_VERSION`), the collector state and the persistence state,
with `Cache-Control: no-store`. Upstream health is reported **per source** inside the snapshot, not by the health
check. For v2 the equivalent is per-series and per-source freshness in the data release.

### 2.7 DESIGN.md (the family to resemble)

- **North star "The Summary Plot":** white ground, near-black ink, hairline rules, colour scarce and semantic. It is
  dense and calm, flat at rest, with shadows only on overlays.
- **Tokens:** `void/panel #fff`, `raised #f2f5f8`, `line #dde3ea`, `line-strong #b4bfcc`, `ink #111418`,
  `ink-2 #434d5b`, `ink-3 #5b6676`, `accent #2f5e95` (Plot Navy, **the only interactive hue**). Status and
  severity hues are darkened to at least 4.5:1 on white. A full dark table exists under `:root[data-theme="dark"]`,
  set by `?theme=dark` or the toggle. **The OS setting never changes the theme.**
- **Type:** one system sans with **tabular figures everywhere**, and mono only for raw upstream error text.
  Panel labels are uppercase, 13px, 700, with 0.06em tracking. Body is 14px; labels are 12px, and nothing is smaller.
- **Shapes and components:** 4px corners on controls, none on panels. **A panel opens with a 2px ink rule, has no
  card box,** an uppercase label and a 12px provenance line ("Source: …"). There are segmented controls, tags that
  state provenance, a tab bar with tabs in the URL, source dots (ok/stale/down/loading silhouettes), a right-side
  drawer up to 760px, and a skip link. "/" focuses search.
- **Rules that transfer directly:** the Three Channels rule (colour, icon and word together), stale evidence drawn
  hollow, missing evidence as a dashed "no reading" box, one shared axis so marks compare down the page, and
  "Don't use KPI tiles as status". The last one matters for an "annual report" look: v2 should push back on
  dashboard KPI tiles in favour of panels and plots.

### 2.8 PRODUCT.md (tone)

- Say what is known and how. Every verdict carries its reasons, threshold and confidence, and an inference is
  labelled as one.
- Silence is not health. A failing source is a source failing, never a fake value.
- Public signals first, provenance always.
- Plain, exact, unhyped copy. It records owner decisions with dates, and lists what is absent and must not be
  fabricated (usage data, endorsements).
- Accessibility: WCAG 2.0 AA is the working bar, with keyboard tables, skip links and reduced motion.

This fits the Macro Atlas purpose (facts over spin, provenance as a feature) closely. v2's PRODUCT.md can borrow the
structure (Users, Purpose, Positioning, Principles, Evidence on Hand, Absent and not to be fabricated) outright.

### 2.9 Testing setup

Vitest 5, `environment: "node"`, includes `src/**/*.test.ts(x)`, aliases `@` for `src` and `@fixtures`. About
760 tests, no network. Pure geometry and format helpers sit next to their components (`*.test.ts`). There are no
DOM or component tests and no e2e in the repo; visual checks were done by hand or through gstack browse.
v2 would gain by keeping v1's Playwright smoke test (desktop + mobile, console-error capture, screenshots),
pointed at `next start` instead of `file://`.

---

## 3. Reuse and porting map

| v2 need | Take from | How | Effort |
|---|---|---|---|
| Next app skeleton, `basePath`, security headers | md `next.config.ts` | Copy and set `basePath: "/macro-atlas"`. Staging needs its own build, because `basePath` is fixed at build time (a `BASE_PATH` build arg giving `/macro-atlas-staging`). | S |
| Container | md `Dockerfile`, `.dockerignore` | Copy and drop the librdkafka line. Add the Python layer if the hybrid is chosen (section 4). Health path follows `basePath`. | S–M |
| Health endpoint | md `api/health/route.ts` | Copy the shape. Report process liveness, plus the current release id, built-at time, age and whether it loaded. Do not report a writable-volume flag, since the reader's mount is read-only. | S |
| Atomic JSON persistence | md `lib/linkHistory` pattern | Copy the write-temp-then-rename helper for the **writer** (ingest). Do not copy the writability probe and "memory" fallback into a reader on a read-only mount: it would misreport the mount, and it can rename corrupt files. The web tier checks instead that the current release is readable and valid against its schema. | S |
| Background refresh in-process (if the Node side fetches anything) | md `instrumentation.ts` + gateway | A daily timer singleton on `globalThis`, `unref()`ed, with an env switch to turn it off. | S |
| Fetch with TTL, last-known-good, single-flight, seed on restart | md `lib/gateway`, `politeQueue`, `contract.ts` | Copy as-is (pure, tested). It maps onto v1's cache plus fallback plus seed chain. | S |
| Captured fixtures discipline | md `fixtures/README.md` | Adopt for every v2 source. The parsers in v1's tests become fixture-backed. | M |
| Tokens, panel grammar, dark table, tab bar, segmented controls, source dots, drawer | md `globals.css`, DESIGN.md, `components/ui` | Copy the tokens. Re-derive an 8-colour series palette that holds contrast on white and dark (v1's `--c1..c8` were tuned for its paper colour). Keep event-category colours separate from series colours. | M |
| Analysis math | v1 `web/stats.js` + `test_stats.py` | Port to `lib/stats.ts` and turn the 16 tests into Vitest cases. If Python also computes stats for exports, keep a cross-language golden-file test. | S |
| Interactive chart | v1 `app.js` (Chart.js 4.4.1 plus a custom background plugin) | Either hand-drawn SVG (/missions' way: full control, matches the look, more work for zoom, tooltips and log axes), or a **bundled** library (CSP `'self'` forbids the CDN). The choice belongs to the planners. | M–L |
| URL state | v1 `stateToParams/applyParams` | Move it to search params read on the server, so `/macro-atlas/compare?sel=…` renders the same view server-side and in link unfurls. Keep backward compatibility for v1 hash links if v1 links should redirect. | M |
| Catalog, events, politics, approval | v1 YAML | Keep the files and extend the schema: source URL, licence, vintage or fetch time, per-value citations, and new event categories. `atlas add` writes these files. | M |
| QA | v1 `check.py` | Keep it as the release gate. Add the staleness of each source to the page's source panel (like /missions' Sources panel). | S |
| Seed and fallback chain | v1 `data/seed`, `fallback:` | Keep. Seeds and fallbacks show on screen as provenance ("from fallback FRED …"), the way /missions marks stale evidence. | S |
| Bulk downloads, read API | new | CSV and JSON from either side. Parquet is easiest from Python (pyarrow); in Node it needs `parquet-wasm` or DuckDB. | M |
| Weekly CI | v1 `refresh.yml` | Leave v1's running for Pages. v2 CI is new (mission-dashboard has none): typecheck, lint, Vitest, pytest, a container build and a smoke test. | M |

---

## 4. Python ingest vs Node server

What has to happen daily on the server: fetch ~100 to 300 series (more once the infrastructure and G20 scope
lands), resample and derive, run QA, write the release (JSON for the site and API, plus CSV, Parquet and JSON
bundles), and swap it in atomically. The site reads the release.

**Facts that weigh on the choice:**

- **Yahoo needs a browser TLS fingerprint.** Plain clients get HTTP 429 from both a home connection and GitHub's
  servers. curl_cffi solves it in Python. Node's `fetch` (undici) cannot impersonate. The options are curl-impersonate
  binaries or dropping Yahoo for other sources: Stooq CSV, central-bank and exchange files, FRED's own index
  series where they exist (FRED's S&P 500 covers only 10 years).
  Whatever the choice, the VPS IP has to be tested against Yahoo before anything depends on it.
- **pandas is used lightly** (groupby month mean/last). That is easy to port. The real Python value is in
  pyarrow/Parquet, SDMX tooling if more OECD, IMF or Eurostat sources arrive, and Alex's existing familiarity.
- **ADR 0002's single-writer rule** holds under every option as long as there is one ingest writer and the site
  only reads.
- **Test assets:** 49 pytest tests (parsers including the DST regressions, the fallback chain, QA) cover Python.
  The TS side would start fresh or port them.

| Option | Shape | For | Against |
|---|---|---|---|
| **A. Keep Python for ingest, as a one-shot container** | An `atlas-ingest` image (uv, Python ≥3.11 per pyproject) runs to completion: fetch → stage → check → promote. A **host** cron or systemd timer starts it daily (`docker compose run --rm ingest`), so no scheduler runs inside a container. It writes `DATA_DIR/releases/<id>/`, and only after checks pass does it atomically flip `DATA_DIR/current`, keeping the last N releases. The always-running Next container mounts the volume read-only. | Reuses v1's parsers, transforms, QA and tests. The release ordering (section 1.3) and the cache TTL still need work. curl_cffi works and Parquet is free. One writer, in the spirit of ADR 0002, which separates collection from the web tier (ADR 0002 names a shared DB plus a collector; here a file volume plays the DB's role). There is no long-running ingest process to supervise, and the web tier stays small. | Two images and a compose file instead of one container. Code in two languages, so the stats need a cross-language golden test. "Is ingest alive?" needs its own health signal: the release age in `/api/health`. |
| **B. Port everything to TypeScript** | Node adapters on the gateway contract, a daily collector in `instrumentation.ts`, the same container as /missions. | One language, one image, one test runner. Identical to /missions' operations. The gateway, fixtures and contract are already proven there. | Yahoo is the blocker (above). Parquet needs WASM or DuckDB. Rewrites tested parsers and the DST fix (regression risk). A slow or failing fetch shares a process with the web server. Big up-front cost before any v2 feature. |
| **C. Hybrid in one image** | Python and Node in one container. Next's `instrumentation.ts` schedules a daily `child_process` run of `python -m atlas release`, or supercronic runs both under a small init. | One deployable. Keeps Python's strengths. | A heavier image (Node + Python + pandas + curl_cffi). Process supervision inside a container, with failure modes mixed together. Harder to reason about than A for little gain. |
| **D. Staged: A now, port adapters later** | Start as A. Port sources to TS one at a time behind the same release format whenever a source benefits from it (e.g. intraday markets), or retire Python if it ends up with only easy CSV sources. | Delivers v2 features first and keeps options open. The release format becomes the stable seam that both sides test against. | Living with two languages for a while. |

**Recommendation: A (one-shot, host-scheduled). Keep D open, but do not require it.** Nothing in the brief forces
eventual TS migration. Port a source only when that source has a reason to move. Make the data release (a directory with a manifest of series, provenance,
checks and build info, plus per-series files and bulk exports) the contract between ingest and site. Python owns
writing it; Next owns reading and serving it. This keeps v1's tested pipeline and QA gate and solves Yahoo and
Parquet. It also matches the "one writer, volume, visible persistence" rules /missions already uses. Mark Python as
replaceable per source, not permanent. The daily cadence (versus /missions' seconds-to-minutes) means scheduled batch
ingest is a better fit than a request-driven gateway for primary data.
The gateway remains useful on the Node side for anything fetched live, if v2 adds any.

---

## 5. Conflicts and decisions the plan needs to settle

1. **Fonts.** v1 uses Newsreader serif headings plus IBM Plex via Google Fonts. /missions uses system sans only, and
   its CSP has `font-src 'self'`. Options: system-only (strongest resemblance), or self-hosted font files (keeps the
   "annual report" serif voice for headings while staying within `'self'`). A serif display face would break
   /missions' "no display face" rule, so this is a deliberate design call for Alex.
2. **Theme.** v1 follows the OS (`prefers-color-scheme`). /missions never does: light is the default and dark is
   explicit. Pick one for the family. Following /missions is the lower-friction default.
3. **Cards versus rules.** v1 uses rounded 12px cards. /missions says "Don't wrap panels in cards". Adopt rules.
4. **Chart library and CSP.** /missions sends its CSP as *Report-Only*, so today nothing is blocked. Inheriting
   it gives no guarantee, and enforcing it is extra work. Under an enforced `script-src 'self'` the Chart.js CDN
   would fail, so bundle a library or draw
   SVG. Chart.js's canvas also makes keyboard and screen-reader access harder; /missions' SVG approach pairs every
   mark with text.
5. **Series colours.** /missions has one interactive hue and semantic status hues. Macro Atlas needs up to 8
   categorical series colours plus event-category colours plus party bands. Party red and blue clash with
   /missions' status red. The palette needs its own design pass (the `dataviz` skill has a validator).
6. **Time grid.** v1 is monthly from 2000. The v2 scope ("past and current state", G20 headline rates, disasters)
   will want annual history before 2000 and some daily or weekly data. Decide whether the release stores native
   frequency and resamples on read, or keeps the monthly grid as the canonical view.
7. **basePath per environment.** `/macro-atlas` and `/macro-atlas-staging` need separate builds (basePath is fixed
   at build time), or a staging subdomain. This affects the Dockerfile and CI.
8. **v1 hash links.** v1 state links use `#sel=…`. Decide whether v2 accepts or redirects them so old shared links
   keep working.
9. **Same-VPS neighbours.** /missions' CelesTrak note says dev, smoke and prod share one IP. Macro Atlas ingest
   adds FRED, Yahoo, Eurostat, ONS and OECD traffic from the same VPS. Keep v1's polite throttles and 429 breaker,
   and make the User-Agent policy explicit per source (FRED rejects browser UAs; Yahoo needs one).
10. **CI home.** mission-dashboard has no CI. v2 needs one: GitHub Actions for tests and the image build. Deploys
    stay manual until Alex provides SSH (brief).

## 6. Small things worth copying verbatim

- The md README's env-var table, and the "Run exactly one instance" deploy note.
- `?mock=1` demo data covering every state. For v2: a fixed small release committed for tests, previews and
  screenshots.
- Request-time routes with `await connection()` and `Cache-Control: no-store` for live endpoints. For a daily
  release, the read API can instead send `ETag` and `Cache-Control: public, max-age=…` keyed to the release id.
- The DESIGN.md front-matter token block, so the impeccable and `design-system` tooling can read v2's design system
  the same way.
