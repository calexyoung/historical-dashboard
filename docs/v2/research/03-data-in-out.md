# 03 — Data in, data out: design research for Macro Atlas v2

Status: research input for `docs/v2/PLAN.md`. Written 2026-11-11 against `docs/v2/BRIEF.md`,
the v1 code (`atlas/`, `web/`, `data/atlas.json`) and `~/Developer/mission-dashboard`.
Reviewed with Codex before and after drafting. Its main objections (licensing, the meaning of
`as_of`, MCP cost bounds, the verdict scale) are worked into the text. Where a fact was not
checked against a primary source, the text says so.

---

## 0. Summary

1. **Licensing comes first and changes the brief.** The brief says data out is "built for LLM and ML
   use", but two of v1's three sources block parts of that:
   - **Yahoo Finance** forbids redistribution. That covers the 25 v1 Yahoo series: indices, ETFs, gold,
     copper, BTC and DXY.
   - **FRED's current terms** forbid using FRED content to develop or train software, ML systems or
     LLMs. Third-party copyrighted series on FRED (S&P indices, ICE BofA spreads, Case-Shiller and
     others) need the owner's permission for anything beyond personal use.

   v1 already publishes the Yahoo values on GitHub Pages inside `dist/index.html`. v2 needs a
   **rights record** with three separate permissions: display, redistribute, ML use. The record is
   tracked per series *and* per snapshot, because the channel a value actually came through
   carries its own terms. Where possible, pull from the original public-domain agency (BLS, BEA,
   Census, EIA, Treasury, Fed Board H.15/H.10) rather than through FRED. Alex has to decide this
   (see §9).
2. **Data out comes in three layers, all generated from one build:**
   - (a) stable per-series URLs with suffixes, OWID style: `/series/unrate`, `.csv`, `.json`,
     `.metadata.json`;
   - (b) immutable bulk snapshots: a long-format Parquet and a CSV.gz, plus a Frictionless
     `datapackage.json` manifest with licenses and checksums;
   - (c) machine discovery: `/macro-atlas/llms.txt`, a Markdown twin of every page, and
     schema.org `Dataset` JSON-LD.

   Defer DuckDB-WASM and `llms-full.txt`.
3. **Vintages are what make claim-checking honest.** Keep four clocks apart:
   - the observation period;
   - the provider's publication or vintage date;
   - when Atlas retrieved the data;
   - an immutable snapshot ID.

   Store revisions as a **bitemporal observation log**: one row per (series, period, value) with
   `valid_from_snapshot` and `valid_to_snapshot`. Do not store full copies per day. The log stays
   small. It keeps the provider's time axis and Atlas's own retrieval axis as separate columns,
   and records status changes and deletions. Raw responses are kept compressed with a retention
   policy. `as_of` resolves to a
   snapshot. When coverage is missing, it returns *unavailable* and never silently falls back to
   today's data.
4. **MCP** is a thin, read-only, auth-free Streamable HTTP adapter over the same query layer as the
   REST API. It serves 6 tools and 2–3 resource templates, with hard caps on rows, bytes, time and
   concurrency. It never takes arbitrary SQL or URLs. Large requests get a link to a bulk download.
5. **Data in** stays file-based. Keep `catalog.yaml` as one file for now. Add `content/events/`
   and `content/claims/` as Markdown with YAML frontmatter. JSON Schema is the source of truth,
   enforced by `atlas check` in CI and pre-commit. `atlas add series|event|claim` scaffolds a
   *draft* and never commits.
6. **A claim record keeps three things apart:** the numerical finding (per measure, per basis),
   structured context flags, and whether the evidence is sufficient. The display label is derived
   from those fields by a published, ordered rubric. The comparison window is resolved once and
   frozen, so "then vs now" measures revisions, not elapsed time. Evidence numbers are computed at build time from pinned snapshots and frozen in a lock
   file, so a later rebuild cannot quietly change the evidence behind an old verdict. Quoted text,
   including any wrong numbers in it, is stored exactly as spoken.

---

## 1. How serious open-data and stats sites expose data

| Site | What it exposes | Lesson for Atlas |
|---|---|---|
| **FRED API** (`api.stlouisfed.org/fred/series/observations`) | Needs a free API key. Formats: xml/json/xlsx/csv (zip). Server-side `units` transforms (`lin, chg, ch1, pch, pc1, pca, cch, cca, log`), `frequency` with `aggregation_method` (`avg, sum, eop`), observation window, paging up to 100k rows. | A small, named, **allowlisted** transform vocabulary works better than free-form expressions. Copy those names (`pc1` = % y/y) so analysts recognize them. |
| **ALFRED** (FRED's real-time side) | Every FRED object carries a real-time period. `realtime_start/realtime_end` (closed interval) or `vintage_dates=` return what was known on a date. `output_type` 1 = by real-time period, 2 = by vintage (all obs), 3 = by vintage (new and revised only), 4 = initial release only. | This is the model for `as_of`. `output_type=4` (first release) and `3` (revisions only) are the two queries a fact-checker needs. API access needs a key, which means Alex's account. The keyless `fredgraph.csv` that v1 uses has no documented vintage parameter (not verified either way). |
| **Philadelphia Fed Real-Time Data Set** | Vintage matrices (rows = observation date, columns = vintage) for output, its components, money, unemployment, CPI and others. First, second and third releases for selected variables. Updated monthly. | Free back-history of vintages for the headline US macro series, with no API key. Check its terms before republishing. This is the best route to "what GDP looked like in 2009". |
| **OWID grapher** | Each chart slug has suffix twins: `.csv` (`csvType=full` default, or `filtered`, which follows the visible `time`/`country`), `.metadata.json` (per-column `unit`, `shortUnit`, `descriptionShort`, `descriptionKey`, `descriptionProcessing`, `citationShort`/`citationLong`, `lastUpdated`, `nextUpdate`, `fullMetadata` link), `.readme.md`, `.zip` (CSV + metadata + README), `.config.json`. Non-redistributable data returns **403** on the download routes. | Copy most of this. **The page URL is the API.** Separate "processing" text from the source description. Say when the next update is due. Refuse the download, while still showing the page, when the rights do not allow redistribution. |
| **OWID ETL / catalog** | A layered pipeline (snapshot → meadow → garden → grapher). Every indicator carries "origins" (producer, title, URL, date accessed, citation). A Python `owid-catalog` package with a charts API, and bulk tables in Feather. | Keep *snapshot* (raw bytes as retrieved) separate from *derived* data. This is the same split the vintage store needs (§4). One provenance record per origin, not one per chart. |
| **World Bank API v2** | `api.worldbank.org/v2/country/{iso}/indicator/{code}?format=json&date=2000:2025&per_page=...`. The response is a two-element array, `[paging metadata, rows]`. Source IDs select databases (2 = WDI). WDI archive vintages exist as a separate source (not verified against the docs). | It works for G20 annual headlines. The paging envelope is clumsy, so Atlas should flatten it. Some indicators carry third-party licences (World Bank terms list exceptions), so the rights field applies here too. |
| **DBnomics** | One aggregator over ~80 providers (IMF, OECD, Eurostat, ECB, BIS, national offices). `api.db.nomics.world/v22/series/{provider}/{dataset}/{series}?observations=1&format=json`, or `series?series_ids=P/D/S,...`. Every series has a stable three-part ID. | It is the realistic way to fill G20 gaps (policy rates, CPI, unemployment) without one scraper per country. Copy the `provider/dataset/series` ID idea into Atlas provenance (`origin_id`). |
| **llms.txt** (llmstxt.org) | Markdown at a site root *or a subpath*. Format: H1 name (required), blockquote summary, prose, H2 link lists, and an "Optional" H2 that agents may skip. Each page has a Markdown twin (`page.md`), linked with `rel="alternate" type="text/markdown"`. `rel="describedby"` points to the llms.txt. | Use `/macro-atlas/llms.txt` (a subpath is allowed, so the domain root is not needed). It lists the API docs, bulk downloads, catalog and claims index. Each series page and claim page gets a `.md` twin. |
| **schema.org `Dataset` JSON-LD** | Google requires `name` and `description`. `distribution` → `DataDownload {contentUrl, encodingFormat}`, `temporalCoverage`, `license`, `creator`, `isBasedOn`, `variableMeasured` and `dateModified` are recommended. Google said in Nov 2025 that Dataset markup only powers **Dataset Search**, not regular results. | It is cheap to emit from the same metadata. Put one `Dataset` on each series page and a `DataCatalog` on the catalog page. Do it for discovery, not SEO. |
| **schema.org `ClaimReview`** | Google **stopped showing ClaimReview rich results** in 2025 (announced 2025-06-12; tooling removed 2025-09-09). Google says use outside Search is unaffected. | Emit it only as machine metadata on claim pages. Do not design around a Google feature. |
| **Frictionless Data Package v2** | `datapackage.json` holds `resources[]` (required), plus `name`, `id`, `licenses[]`, `sources[]`, `contributors[]`, `version` (semver), `created` (RFC 3339) and `$schema: https://datapackage.org/profiles/2.0/datapackage.json`. Resources carry `path`, `format`, `mediatype`, `hash` and a Table Schema. | This is the bulk-download manifest: one file that lists every file, its checksum, its columns and its licence. Tools such as frictionless-py and `datapackage` readers in R and JS read it unchanged. |
| **Parquet / Arrow** | Columnar, typed and compressed. pandas, polars, DuckDB, R arrow and Spark read it unchanged. | The bulk format for ML. A long table of about 123 series × ~300 months is tiny (well under 5 MB). Keep it **long** (key, period, value, …), not wide. |
| **DuckDB-WASM** | Queries Parquet in the browser over HTTP range requests. The host must send CORS, `Accept-Ranges: bytes` and `Content-Length`. There are known range-request problems on Firefox and with pre-signed URLs. | **Defer it.** The dataset is small enough to download whole. A "query in browser" page is a nice demo, not a v2.0 need. The serving requirements (Caddy range support, CORS) are noted here for later. |
| **FRED MCP connector** (`mcp.stlouisfed.org`) | Needs a free FRED MCP account. Five tools: search series, series metadata, observations, download link, graph. | Evidence that a data publisher's MCP server can be small. **"Get a download link" as its own tool** is worth copying: it keeps bulk data out of the model's context. |

---

## 2. Rights and licensing: a blocker for "built for ML"

What the terms say (checked 2026-11-11):

- **Yahoo Finance:** information it supplies may not be redistributed. Some providers behind Yahoo
  (LSEG, CME, OTC Markets, TMX) have stricter terms still.
- **FRED** (Summarized Terms §II): using FRED content "in connection with the development or
  training" of ML systems, including LLMs and generative AI, is prohibited. Copying, scraping and
  storing or caching are restricted in the full terms. Third-party copyrighted series need the
  owner's permission beyond personal use, and FRED cannot grant it. "Citation required" series may
  be used with attribution.
- **World Bank:** CC BY 4.0 by default, with listed third-party exceptions.
- **US federal statistical agencies** (BLS, BEA, Census, EIA, Treasury, Fed Board releases): US
  government works, generally public domain. Attribution is still good practice.

What this means for v2:

1. Add a `rights` block to every catalog entry:
   ```yaml
   rights:
     owner: "U.S. Bureau of Labor Statistics"
     via: fred                      # the channel we fetch through, which has its own terms
     terms_url: "https://www.bls.gov/opub/copyright-information.htm"
     status: public_domain          # public_domain | cc_by | citation_required | permission_required | no_redistribution | unknown
     attribution: "U.S. BLS, Unemployment Rate [UNRATE], via FRED"
     # three separate permissions, all DERIVED by `atlas check` from status + via; never hand-set true when status is unknown
     display: true                  # may appear in public HTML/Markdown charts, tables, claim evidence
     redistribute: true             # may appear in CSV/JSON/Parquet, REST, MCP
     ml_use: false                  # may be advertised as usable for ML training (FRED channel => false)
     reviewed: 2026-11-11
   ```
   The site is public and has no password, so a public chart is publication too. "Charted on site
   but not exported" is a real category only if `display` is allowed while `redistribute` is not.
   That is a legal judgement for Alex, not a technical default.
2. **Unknown rights block everything public.** That covers HTML, Markdown twins, claim evidence,
   REST, bulk files and MCP. A series with `redistribute: false` but `display: true` returns 403
   on its download routes and explains why, as OWID does.
3. **Rights follow the inputs actually used, not only the catalog entry.** A direct-agency series
   that fell back to FRED for a snapshot, or whose vintages come from ALFRED, inherits FRED's
   service terms for those rows. Public-domain status of the underlying data does not override
   FRED's terms of service. So: record `via` and the resulting permissions **per snapshot and per
   vintage source**, and carry the most restrictive permission into derived series (`*_yoy`) and
   claim evidence.
4. **Re-source the core series from the original agencies** so the export is clean:
   - BLS API v2 (CPI, payrolls, unemployment); its keyless tier is rate-limited;
   - BEA API (GDP, PCE, corporate profits); needs a free key, so Alex's credential;
   - Census (construction spending, retail);
   - EIA (energy); needs a free key;
   - Treasury Fiscal Data (debt); no key;
   - Fed Board Data Download Program (H.15 rates, H.10 FX, H.4.1 balance sheet).

   FRED can stay as a fallback and vintage source, but rows obtained through it carry FRED's
   terms (point 3).
5. **Markets:** S&P/Dow Jones, FTSE, Nikkei and the other index levels are licensed products from
   any channel. Options: get a legal view on displaying them (`display`) separately from
   redistributing them; swap them for public-domain proxies where they exist; or leave them out of
   v2 and say why.
6. **Wording for ML:** the site should say "machine-readable, with per-series licence". It should
   not promise "free for ML training". The datapackage `licenses` field is per resource, so the
   bulk export can be split into a `public-domain` resource and a `citation-required` resource.
7. **v1 exposure:** `dist/index.html` on GitHub Pages already embeds Yahoo month-end values,
   which Yahoo's terms forbid redistributing. Not in scope here; flagged for the plan and for
   Alex's decision.

---

## 3. Data out: proposed contract

All paths sit under the Next.js `basePath` `/macro-atlas`, as `/missions` does in mission-dashboard.

### 3.1 URLs

| URL | Returns |
|---|---|
| `/series/{key}` | HTML page (chart, provenance, vintages, related claims), with JSON-LD `Dataset` and a `<link rel="alternate" type="text/markdown">` |
| `/series/{key}.md` | Markdown twin: name, definition, unit, source, rights, latest value, last 24 obs, links |
| `/series/{key}.csv` | `period,value` (native frequency); `?freq=M&agg=mean`, `?transform=pc1`, `?start=&end=`, `?as_of=` |
| `/series/{key}.json` | `{series: {...metadata}, provenance: {...}, snapshot: {...}, observations: [{period, value, status}]}` |
| `/series/{key}.metadata.json` | Metadata only (OWID-style field names where they fit) |
| `/api/v1/catalog.json` | Every series' metadata plus rights; the same data as `datapackage.json` but series-centric |
| `/api/v1/series/{key}` | Same body as `.json`; the versioned home for programmatic clients |
| `/api/v1/series/{key}/vintages` | The snapshot list for that series: `[{snapshot_id, retrieved_at, provider_vintage, basis, changed_periods}]` |
| `/api/v1/events.json`, `/api/v1/claims.json`, `/claims/{id}` (+ `.md`, `.json`) | Events and claims |
| `/downloads/` | Index of bulk snapshots |
| `/downloads/{snapshot_id}/observations.parquet` and `.csv.gz` | Immutable. `snapshot_id = 2026-11-11T0617Z-ab12cd` (UTC time + short hash) so same-day rebuilds never collide |
| `/downloads/{snapshot_id}/datapackage.json` | Frictionless v2 manifest with checksums and per-resource licences |
| `/downloads/latest/…` | Redirect (302) to the newest snapshot; never cached as content |
| `/llms.txt` | See 3.4 |

Rules:

- **Full by default, filtered on request.** OWID's `csvType` lesson: a URL with no query string
  returns the whole series at native frequency, with no transform.
- **Transforms are an allowlist:** `lin, chg, ch1, pch, pc1, pca, log, rebase:{period}, z`, plus
  frequency `M|Q|A` with `agg=mean|last|sum`. Use FRED's names where they exist. There are no
  expressions.
- **Transform semantics are a versioned contract** (`transform_version` in every response and
  every claim lock). It is written once, in one module shared by REST, MCP, the UI and claims.
  It must define:
  - the order: resolve the vintage → aggregate to the target frequency → transform;
  - the lookback: a `pc1` or `ch1` request fetches 12 months, 4 quarters or 1 year of history
    before `start`, so the first output period is not null;
  - missing periods: no interpolation; a gap stays a gap; y/y needs exactly period t−12 present;
  - daily y/y: aggregate first, then compare months; never compare day t with day t−365;
  - the `z` reference window: the requested window by default, or `z_ref=start:end` given
    explicitly, always echoed back;
  - `partial_period` rows: excluded from transforms unless `include_partial=true`.
- **Every response carries provenance.** JSON puts it in the body. CSV gets `Link:` and `X-Atlas-Snapshot`
  headers, plus a sidecar `.metadata.json`.
- **Version the API path (`/api/v1`) and the bulk schema** (datapackage `version`). Series keys
  are immutable. Renames go through `aliases:`, which redirect.
- **Caching:** snapshot-addressed URLs are `immutable, max-age=31536000`. Latest URLs use a short
  `max-age` plus `ETag` = snapshot ID.

### 3.2 Long-format observation table (bulk and internal)

| column | type | note |
|---|---|---|
| `key` | string | Atlas series key |
| `period` | string | `2026-09`, `2026-Q3`, `2026`, `2026-09-15` (native) |
| `period_start`, `period_end` | date | Explicit boundaries, so quarterly and annual data never get "placed on a month" ambiguously (v1's `to_monthly()` does this) |
| `value` | float64 | **Unrounded** (v1's `rounded()` loses precision; round only for display) |
| `status` | string | `final`, `preliminary`, `partial_period` (for example, a month in progress for a daily series) |
| `snapshot_id` | string | The snapshot this row comes from |
| `valid_from`, `valid_to` | timestamp | Bitemporal validity in the vintage log (null `valid_to` = current) |
| `provider_vintage` | date, nullable | ALFRED or Philly Fed vintage date, when known |

The monthly-aggregated view (v1's `atlas.json` shape) becomes a **derived** product computed from
this table. It is not the stored truth.

### 3.3 Metadata record per series (superset of v1 `meta`)

`key, name, description, cat, topic[], unit, short_unit, freq, seasonal_adjustment, agg_default,
origin {producer, dataset, origin_id, url, retrieved_via}, rights {...}, processing (text: what
Atlas does to it), first_period, last_period, last_updated, next_release (when known), related[],
aliases[]`.

### 3.4 `/macro-atlas/llms.txt` sketch

```markdown
# Macro Atlas

> The United States in global context, presented like an annual report: ~150 economic,
> political and infrastructure series with full provenance, dated vintages, cited events, and
> structured fact-checks of public claims. Read-only; no account needed.

Every number links to its origin. Licences vary per series; check `rights.redistribute` and `rights.ml_use` before reuse.

## Data
- [Catalog (JSON)](https://mydashboards.co/macro-atlas/api/v1/catalog.json): all series, units, sources, licences
- [Bulk download](https://mydashboards.co/macro-atlas/downloads/latest/datapackage.json): Parquet + CSV, Frictionless manifest
- [API guide](https://mydashboards.co/macro-atlas/docs/api.md): URL patterns, transforms, as_of

## Claims
- [Claims index](https://mydashboards.co/macro-atlas/claims.md): checked claims with evidence and verdict rubric
- [Verdict rubric](https://mydashboards.co/macro-atlas/docs/rubric.md)

## Connect
- [MCP server](https://mydashboards.co/macro-atlas/docs/mcp.md): Streamable HTTP endpoint and tool list

## Optional
- [Events timeline](https://mydashboards.co/macro-atlas/events.md)
- [Methodology](https://mydashboards.co/macro-atlas/docs/method.md)
```

Generate it at build time from the catalog, so it can never drift.

---

## 4. Vintages and revisions

### 4.1 Why they matter for fact-checking

Headline US statistics are revised, sometimes heavily:

- GDP: advance estimate, then second and third estimates, then annual and comprehensive revisions;
- payrolls: two monthly revisions, then the annual benchmark;
- CPI: seasonal factors are revised every year, though NSA CPI is not revised.

A politician who said "the economy grew 3% last quarter" may have been right about the advance
estimate and wrong about today's number, or the other way round. A fair check asks two separate
questions:

1. **What did the data say when the claim was made?** This checks honesty and use of the data
   available at the time.
2. **What does the data say now?** This checks whether the claim was true as history.

The gap between the two answers is the **revision delta**. It is itself a finding, and it should
be shown, never hidden.

### 4.2 Four clocks: never collapse them into one `vintage` field

| Clock | Example | Where it comes from |
|---|---|---|
| Observation period | `2026-Q2` | The data |
| Provider vintage | 2026-07-30 (advance GDP release) | ALFRED `realtime_start`, Philly Fed column header, agency release calendar |
| Atlas retrieval | 2026-07-31T06:17Z | Our fetch log |
| Snapshot ID | `2026-07-31T0617Z-9f3e1a` | Our build |

Every as-of answer carries `vintage_basis`:
- `provider`: we have the publisher's own vintage (ALFRED or Philly Fed). This is the strongest.
- `atlas_observed`: we saw this value at retrieval time, so it was public *no later than* then.
- `legacy_git`: rebuilt from v1's weekly commits of `data/atlas.json` (10 commits since
  2026-09-23). These values are monthly-aggregated and rounded. They are evidence that "Atlas
  contained this", not that "the public knew this".
- `unavailable`: no vintage covers the requested date. **Return this explicitly. Never fall back
  to current data.**

### 4.3 Store design (files, no database)

```
$DATA_DIR/                          # Docker volume, outside git and outside the web root
  raw/{source}/{key}/{sha256}.gz    # exact bytes as fetched, compressed
  fetchlog.ndjson                   # every attempt: ts, key, url, http status, raw sha, normalized sha, parser version
  obslog/{key}.parquet              # bitemporal log, one row per (period, state), see columns below
  snapshots/{snapshot_id}.json      # manifest: per-key normalized-state sha, via/rights, catalog sha, code version, created
  coverage/{key}.json               # which date ranges each basis can answer (provider vintages are sparse)
  index/asof.parquet                # compact lookup over BOTH time axes for fast as_of resolution
```

Obslog columns. These keep two time axes separate, rather than naming four clocks and storing one:

| column | meaning |
|---|---|
| `key, period, value, status` | the observation state (`status` changes count as revisions) |
| `deleted` | true when a period disappears from the source (withdrawn or redefined); an explicit tombstone, never a silent gap |
| `provider_from, provider_to` | when the *publisher* says this value was current (ALFRED real-time period, Philly Fed vintage); null when unknown |
| `provider_precision` | `datetime` (release time known, e.g. from the agency calendar) or `date` (day only, the ALFRED norm) |
| `recorded_from, recorded_to` | when *Atlas* held this value (from the first snapshot that had it to the first that did not) |
| `snapshot_id, via` | the snapshot that introduced the row, and the channel it came through (rights, §2) |

- **The full normalized state decides "changed", not the raw bytes and not just the value.** Raw
  responses carry volatile bytes such as headers and timestamps. Parse first, then hash the
  complete normalized state per series: every period's value, status and presence. A change of
  status (preliminary → final), a withdrawn period or a redefinition opens a new row, the same
  as a value revision does. Deletions are tombstones.
- **Size:**
  - *Obslog.* Appends are about one row per series per period; revisions add a few rows. That is
    roughly 123 × 300 periods plus revisions: low megabytes, growing slowly.
  - *Raw blobs.* These are the cost. About 40 daily-updating series × ~40 KB gzipped × 365 is
    about 0.6 GB a year, worst case. Codex's cruder upper bound, every response changing every
    day uncompressed, came to about 4.5 GB a year.
  - *Policy.* Keep all raw blobs for 90 days. After that, keep raw blobs only for snapshots that
    *revised* an existing period, not ones that only appended. Back up `obslog/`, `snapshots/` and
    `fetchlog` off-host; `raw/` is optional.
- **One writer.** The refresh job writes into a staging directory and swaps it in atomically
  (rename), as in mission-dashboard ADR 0002 ("one instance owns collection and state"). Readers
  only ever see complete snapshots.
- **Bootstrap:** import the v1 git history as `legacy_git` snapshots. Import Philly Fed real-time
  matrices for GDP, payrolls, unemployment and CPI as `provider` vintages. If Alex agrees to get a
  FRED API key, backfill ALFRED for public-domain series only, given FRED's caching and ML terms.

### 4.4 `as_of` semantics

- `as_of=YYYY-MM-DD` means **the data public strictly before 00:00 America/New_York on that
  date**. Most US releases come out at 08:30 or 10:00 ET, and a claim dated only by day cannot
  show it came after a same-day release. The response includes a `same_day_release: true`
  warning when a provider vintage falls on the claim date. The claim record can then set
  `said_at` with a time, to opt into the later vintage, but only when `provider_precision` is
  `datetime`. Otherwise the answer is flagged `ambiguous_same_day`.
- **Resolution order:**
  1. Use the provider axis (`provider_from ≤ cutoff < provider_to`) wherever coverage says it
     can answer: `basis: provider`.
  2. Otherwise use the Atlas axis (`recorded_from ≤ cutoff` and (`recorded_to` is null or
     `cutoff < recorded_to`)): `basis: atlas_observed`. A tombstone row in force at the cutoff
     means the period did not exist then, and is answered as such, not skipped. This only
     shows the value was public *by* then. A later release before the cutoff that Atlas missed
     (a polling gap, or downtime) would not show. So the response also gives `recorded_gap`, the
     time from the last fetch before the cutoff to the cutoff. A gap longer than the series'
     release cadence downgrades the answer to `uncertain`.
  3. Otherwise `unavailable`.
- **Sparse provider vintages are not continuous.** Philly Fed vintages are monthly, and ALFRED's
  coverage varies by series. Between two known vintages the value is assumed to be the earlier
  vintage only if the provider defines vintages as complete, as ALFRED does. Otherwise the answer
  is `uncertain`, with both bracketing vintages shown.
- **Aggregation happens after resolution.** A monthly mean for a daily series is computed from the
  native observations *in that vintage*. If the month was incomplete at the cutoff, that period is
  flagged `partial_period`. If a monthly series' last period was not yet released at the cutoff,
  it simply does not appear. This is the reason to store native frequency (§3.2).
- Daily polling misses intraday revisions. That is acceptable; state it in the method notes.

### 4.5 Rendering

On a claim page, and as an optional series-page mode, show:

- **"Then vs now":** two lines (the vintage at the claim date, and current), or a small table:
  period · value then · value now · Δ.
- **A revision-history strip:** for the cited period, one dot per vintage (advance → second →
  third → annual), like ALFRED's "first release vs latest" view.
- The `vintage_basis` badge, always visible. A `legacy_git` or `atlas_observed` badge links to an
  explanation.

---

## 5. MCP server (read-only, no auth)

### 5.1 Shape

- **Transport:** Streamable HTTP at `/macro-atlas/mcp`, stateless (no session ID): one POST per
  JSON-RPC message, JSON responses, no server-initiated streams. Return 405 on GET and DELETE.
  The 2026-07-28 MCP revision moves further toward stateless HTTP (secondary sources). Pin the
  protocol version and the official TypeScript SDK version, and test against Claude Desktop and
  Claude Code before launch. A Claude Code issue reported tools dropped when a server returned
  `outputSchema` or annotations; it is closed, but check current behaviour.
- **Where it runs:** a route handler in the same Next.js app, calling the **same query module** as
  the REST routes. MCP is an adapter, not a second implementation.
- **Capabilities:** `tools`, `resources` (no `subscribe`; `listChanged` is not needed). Prompts
  are optional (see 5.3).

### 5.2 Tools (all `annotations: {readOnlyHint: true, idempotentHint: true, openWorldHint: false}`)

| Tool | Input | Output (`structuredContent`, with an `outputSchema`) |
|---|---|---|
| `search_series` | `query`, `topic?`, `country?`, `limit≤25` | `[{key, name, unit, freq, first_period, last_period, redistribute, ml_use}]` |
| `get_series` | `key`, `start?`, `end?`, `transform?` (allowlist), `freq?`, `agg?`, `as_of?`, `limit≤600` | `{metadata, provenance, snapshot, vintage_basis, observations[], truncated, download_url}` |
| `get_vintages` | `key`, `period?` | `[{snapshot_id, retrieved_at, provider_vintage, basis, value_for_period?}]` |
| `compare_vintages` | `key`, `period_range`, `as_of_a`, `as_of_b` | `[{period, a, b, delta}]`, with both bases |
| `list_events` | `start?`, `end?`, `cat?`, `limit≤100` | `[{id, date, title, cat, url}]` |
| `get_claims` | `id?`, `claimant?`, `series_key?`, `limit≤25` | Full claim records, including frozen evidence |
| `get_download_link` | `scope: series|all`, `key?`, `format: csv|parquet` | `{url, bytes, sha256, license_summary}`; keeps bulk data out of context (the FRED MCP pattern) |

Each tool result also includes a short `text` content block (a one-line summary with the citation
string), for clients that ignore `structuredContent`.

Resources (templates, RFC 6570):

- `atlas://series/{key}`: the `.md` twin (`text/markdown`)
- `atlas://claims/{id}`: the claim `.md`
- `atlas://catalog`: `catalog.json`

Use a custom scheme: the spec says to use `https://` only when the client can fetch the URL
itself, so the `https` links appear in tool output instead.

### 5.3 Prompts (optional, no runtime AI on our side)

A `check_claim` prompt template that fills in a *method* for the client's model:

1. find the series;
2. pull the vintage at the claim date;
3. pull the current value;
4. state the revision delta;
5. say what the number cannot show.

This teaches the method without the site calling any model.

### 5.4 Abuse and cost bounds on a small VPS

- **No arbitrary inputs.** No SQL, no URLs, no expressions. Every parameter is validated against
  enums and regexes. Keys must exist in the catalog.
- **Hard caps:** `limit` caps rows; a response is at most 256 KB, beyond which it returns
  `truncated: true` and a download link; 2 s per call; concurrency capped by a semaphore with a
  global limit as well as a per-IP one.
- **Rate limiting** lives in the app (token bucket per IP plus global). Stock Caddy has no
  rate-limit handler; it needs a third-party module, which would change the shared Caddy build.
- Everything served is precomputed or memory-mapped from the current snapshot. The refresh job
  runs in its own process, so a request never triggers an upstream fetch.
- Validate `Origin`/`Host`, as the MCP transport spec requires against DNS rebinding.
- `readOnlyHint` is a description, not enforcement. The server is read-only because it has no
  code that writes.
- Restricted-rights series do not appear in MCP at all, consistent with §2.

---

## 6. Data in: file catalog, annotations, `atlas add`

### 6.1 Layout

```
atlas/catalog.yaml          # keep as ONE file for now (~150 entries; splitting is organisational, not needed)
content/
  events/2008-09-15-lehman.md        # YAML frontmatter + optional Markdown body (context, links)
  claims/2026-03-04-cpi-lowest.md    # frontmatter = Claim record (§7); body = the written analysis
  notes/{series-key}.md              # optional long-form series notes and caveats, rendered on the series page
  topics/{topic}.md                  # topic pages: intro text + which series/events/claims belong
schema/
  series.schema.json, event.schema.json, claim.schema.json   # JSON Schema 2020-12: the source of truth
claims/locks/{id}.lock.json          # frozen evidence (§7.3), generated, committed
```

- `events.yaml` (83 events) migrates to `content/events/*.md` with a one-off script. The
  frontmatter keeps v1's fields (`month, day, title, cat, url`) and adds `id`, `date` (ISO; `day`
  becomes optional precision), `tags`, and `related_series`.
- **Schema single source:** JSON Schema files, read by Python (`jsonschema`) for `atlas check` and
  turned into TS types (for example `json-schema-to-typescript`) for the Next.js app. One schema,
  two languages, no drift.
- **Fix before growing the catalog:** v1 `assemble()` evaluates derived series in file order.
  Build an explicit dependency graph with cycle detection first (a Codex finding, confirmed by
  reading `atlas/transform.py`).

### 6.2 `atlas add`: CLI UX

Principles:

- It writes a **draft file** and opens nothing remote except a metadata lookup.
- It never commits.
- It prints the next command to run (`atlas check`).
- It is safe to re-run.

```console
$ atlas add series fred:TTLCONS
Looking up FRED TTLCONS … Total Construction Spending: Total Construction in the United States
  units: Millions of Dollars, SAAR · freq: Monthly · source: U.S. Census Bureau · 2002-01 → 2026-09
Suggested key [ttlcons]: construction_total
Category [US economy]: Infrastructure
Aggregation: monthly series, no aggregation needed.
Rights: Census is public domain. Prefer the direct Census source? [Y/n] y
  → origin census:VIP/total (fallback fred:TTLCONS)
Wrote draft to atlas/catalog.yaml (entry construction_total, status: draft)
Next: atlas fetch construction_total && atlas check
```

```console
$ atlas add claim --url "https://www.c-span.org/…" --who "Jane Doe" --date 2026-03-04
Fetching page title … "Remarks at …"
Requesting Wayback snapshot … archived 2026-11-11 (https://web.archive.org/web/2026…)
Paste the exact quote (end with an empty line):
> Inflation is the lowest it has been in five years.
Related series (search): cpi
  1  cpi_yoy        US CPI inflation, % y/y
  2  corecpi_yoy    US core CPI inflation, % y/y
Pick [1]: 1
Wrote content/claims/2026-03-04-jane-doe-inflation-lowest.md (status: draft, no lock, label: unset)
Next: edit the evidence block, then `atlas claims compute 2026-03-04-jane-doe-inflation-lowest`
```

Subcommands: `add series <source:id>`, `add event --date --title --url`, `add claim`,
`add note <key>`, `claims compute <id>` (writes the lock), `claims relock <id> --reason "…"`,
`check [--changed]`, `fetch [key]`.

- **Prefill is only a suggestion.** Metadata lookups cannot choose aggregation semantics,
  seasonal-adjustment pairing or topic. The CLI asks, and stores `status: draft` until a human
  sets `active`.
- `atlas add` from FRED needs either the FRED API key (series metadata endpoint) or scraping the
  series HTML page. Prefer the original agency's metadata API where one exists.

### 6.3 Validation layers (`atlas check`, in pre-commit and CI)

1. **Schema:** JSON Schema per file type.
2. **Referential:**
   - IDs and keys are unique;
   - aliases point to existing keys, with no cycles;
   - every `related_series` and evidence key exists;
   - topics exist;
   - derived-series dependencies are acyclic.
3. **Semantic:**
   - units compatible with the transform (no `pc1` on a rate already in %, unless allowed);
   - frequency consistent with `agg`;
   - claim `said_on` ≤ `checked_on`;
   - evidence windows end on or before the claim date when `basis: as_of`;
   - every quote has a source URL *and* an archive URL with a capture date.
4. **Rights:** `rights.status` is present. `display`, `redistribute` and `ml_use` are derived and must be false when the status
   is unknown or restricted.
5. **Data:** v1 checks continue (staleness, sanity ranges, ordering, no NaN). New: vintage
   coverage for every series a claim cites.
6. **Network** (CI nightly only, not pre-commit): source and archive URLs still resolve, and
   flagged ones are reported, never auto-edited. v1 already did this once for event citations.

---

## 7. Claim-checking without runtime AI

### 7.1 The Claim record

```yaml
---
id: 2026-03-04-jane-doe-inflation-lowest
status: published                 # draft | published | retracted
claimant:
  name: Jane Doe
  role: "Senator (D-XX)"          # role at the time of the claim, not now
  party: D
said_on: 2026-03-04
said_at: null                     # optional "HH:MM America/New_York" to resolve same-day releases
venue: "Floor remarks, US Senate"
source:
  url: "https://…"
  locator: "00:14:32"             # timecode, page or paragraph
  archive_url: "https://web.archive.org/web/20261111…/https://…"
  archived_on: 2026-11-11
quote: "Inflation is the lowest it has been in five years."   # verbatim; never corrected
paraphrase: "CPI inflation in early 2026 is at a five-year low."
claim_type: comparative          # level | change | comparative | trend | causal | forecast
topics: [inflation]
# Illustrative only: the person, the outcomes and every number below are invented to show the shape.
measures:                         # each reading of the claim is its own measure; m1 is the primary reading
  - id: m1
    primary: true
    series: cpi_yoy
    reading: "Latest released 12-month headline CPI change is the lowest of the prior 60 months"
    target: {period: latest_released_at_as_of}   # resolved ONCE at compute time (here: 2026-01), then frozen
    window: {months_before_target: 60}           # likewise resolved once: 2021-01..2025-12
    test: {op: is_min_over_window, tolerance: 0.05}
  - id: m2
    series: corecpi_yoy
    reading: "Same test on core CPI"
    target: {period: same_as: m1}
    window: {same_as: m1}
    test: {op: is_min_over_window, tolerance: 0.05}
alternative_readings_not_measured:
  - "PCE price index (the Fed's target measure): not in catalog at claim time"
# 'current' re-reads the SAME target period and window from today's vintage. It measures revisions,
# not what happened afterwards. "What happened since" is a separate, explicitly named measure if wanted.
evidence:                         # one row per (measure, basis); computed results live in the lock
  - {measure: m1, basis: as_of}   # as_of = data public before the claim
  - {measure: m1, basis: current}
  - {measure: m2, basis: as_of}
  - {measure: m2, basis: current}
assessment:                       # human judgement on top of the locked results
  per_measure:                    # copied from the lock by `claims compute`; never hand-edited
    m1: {as_of: holds, current: holds}
    m2: {as_of: does_not_hold, current: does_not_hold}
  sufficiency: sufficient         # sufficient | partial (coverage gaps) | insufficient
  context_flags:                  # structured materiality, so the label can be derived
    - {kind: alternative_measure_differs, measure: m2, material: true}
  context: >                      # "context and limitations", prose for readers
    The primary reading (headline CPI) holds on the data released before 4 March, and still
    holds after revisions. Core CPI, which excludes food and energy, was not at a five-year low.
  label: accurate_missing_context # DERIVED by the rubric (7.2); `atlas check` rejects a mismatch
reviewer: "C. Alex Young"
checked_on: 2026-11-11
selection_note: "Picked because it was widely repeated in March 2026 coverage."
revisions:
  - {on: 2026-11-11, note: "Initial check"}
---
Optional Markdown body: the written analysis, with figure shortcodes such as {{chart m1 as_of}}.
```

### 7.2 Verdict model: keep the three axes apart

The label is a pure function of the primary measure's `as_of` result, `sufficiency` and
`context_flags`, applied in this order. The first rule that matches wins.

| # | Condition | → `label` |
|---|---|---|
| 1 | `sufficiency: insufficient`, or the primary result is `not_testable` / `unavailable` | **Not checkable with this data**. This is never an adverse verdict. |
| 2 | `sufficiency: partial` | **Partly checkable** (say what is missing) |
| 3 | Primary `does_not_hold` | **Inaccurate** |
| 4 | Primary `holds` or `holds_within_tolerance`, and any `context_flags` entry `material: true` | **Accurate, missing context** |
| 5 | Primary `holds_within_tolerance`, no material flags | **Accurate within rounding** (state the tolerance) |
| 6 | Primary `holds`, no material flags | **Accurate** |

- **Uncertainty constrains the label.** Any primary `as_of` row resolved as `uncertain` or
  `ambiguous_same_day` sets `sufficiency` to at least `partial` (rule 2). If the uncertainty
  could flip the test result, because the bracketing vintages disagree, it sets `insufficient`
  (rule 1). `atlas check` enforces this. A reviewer cannot mark such a claim `sufficient` by hand.
- The **`as_of` result drives the label**, because it reflects what the speaker could know. The
  `current` result is always shown next to it. A difference between the two adds an automatic
  context flag `revised_since: material: true|false`. Materiality is the reviewer's call, recorded
  in the flag, so a revision cannot quietly flip the label.
- If no measure is marked `primary`, because the claim is genuinely ambiguous, the label is
  **Depends on the reading**, and each measure's result is shown.
- Context flag kinds (closed list): `alternative_measure_differs`, `cherry_picked_window`,
  `nominal_vs_real`, `seasonal_adjustment`, `revised_since`, `base_effect`, `units_or_scope`,
  `causal_overreach`.

- **Causal claims** ("X caused Y") get `claim_type: causal`. They may only be labelled for their
  factual premises, plus a context note on what the data cannot show. This fits the brief's
  dislike of "overly simple cause-and-effect", and keeps the site from ruling on causation with a
  chart.
- **Compound claims are split** into several measures, each with its own row.
- **Neutrality safeguards:**
  - publish the rubric at `/docs/rubric`;
  - record `selection_note` (why this claim was chosen);
  - list alternative readings;
  - keep a revisions log;
  - a claims index that can be filtered by party, so readers can audit balance themselves.

  No emotive ratings ("Pants on Fire").

### 7.3 Evidence is computed, then frozen

- `atlas claims compute <id>` first resolves `target` and `window` **once**, from the `as_of`
  vintage. Then it evaluates every (measure, basis) row on those same frozen periods, runs the
  allowlisted test, and writes `claims/locks/{id}.v{n}.lock.json`. The lock holds:
  - `spec_hash`: a hash of the claim's measures, evidence and test blocks, plus `said_on`,
    `said_at` and the cutoff-policy version (§4.4), so a corrected claim date invalidates the lock;
  - the resolved target period and window;
  - the resolved snapshot IDs and `vintage_basis` per row;
  - the input normalized-state hashes and the `via`/rights per input;
  - the catalog hash and `transform_version`;
  - the exact numbers used (illustrative: "2026-01 y/y 2.41%; min over 2021-01..2025-12 = 2.43%");
  - the test result per row.
- **Lock rules, enforced by `atlas check` and the build:**
  - A published claim must have a lock whose `spec_hash` matches the current file. If the
    measure, tolerance or reading was edited after locking, the build fails. Nothing renders
    stale evidence.
  - `compute` refuses to overwrite an existing lock. `claims relock <id> --reason "…"` writes
    lock `v{n+1}`, keeps every earlier version, and appends to `revisions`. The page links to
    the history.
- The **build reads the lock and does not recompute.** A nightly job recomputes the `current`
  rows and **reports** drift, for example "the current-data result for claim X changed from holds
  to does_not_hold after the 2026 annual revision". A human then relocks. The `as_of` rows should
  never drift; if they do, it is a bug in the vintage store.
- Every number on a claim page comes from the lock. Only the quote is typed by hand, and it stays
  verbatim even when the number in it is wrong.

### 7.4 How a claim renders

```
┌───────────────────────────────────────────────────────────────────────┐
│ "Inflation is the lowest it has been in five years."                  │
│ Jane Doe, Senator (D-XX) · Senate floor · 4 Mar 2026 · source ↗ archive ↗│
├───────────────────────────────────────────────────────────────────────┤
│ ACCURATE, MISSING CONTEXT   [how we rate]                              │
│ Primary — headline CPI: holds (data before 4 Mar, provider) · now: holds│
│ Also checked — core CPI: does not hold · now: does not hold             │
├───────────────────────────────────────────────────────────────────────┤
│ [chart: cpi_yoy over the frozen window, vintage as of claim (solid) vs │
│  current vintage (dashed), target period marked, min annotated]       │
├───────────────────────────────────────────────────────────────────────┤
│ Evidence table  measure · reading · then · now · Δ · basis badge       │
│ Context and limitations (prose)                                        │
│ Other readings considered                                              │
│ Method · snapshot IDs · download evidence (CSV) · revisions log        │
└───────────────────────────────────────────────────────────────────────┘
```

- The claim also appears as a marker on every related series chart, in the same layer as events,
  with its own category colour. This connects claims to the "see complex interactions" goal.
- Outputs: `/claims/{id}.md` and `.json` twins, ClaimReview JSON-LD (`claimReviewed`,
  `itemReviewed.author`, `datePublished`, `reviewRating.alternateName` = label), and an MCP
  `get_claims` entry.

---

## 8. What to build first (suggested ordering for PLAN.md)

1. Rights block with derived `display`/`redistribute`/`ml_use` per snapshot, and the re-sourcing decision (§2). This blocks every export
   surface.
2. A native-frequency, unrounded long table plus snapshot manifests, written by the refresh job
   (§3.2, §4.3). The v1 `atlas.json` shape becomes a derived view.
3. Per-series pages with `.csv/.json/.metadata.json/.md` twins, `catalog.json`, `datapackage.json`
   bulk snapshots, `llms.txt`, and JSON-LD (§3).
4. The obslog, `as_of` resolution, the legacy-git and Philly Fed import, and the "then vs now"
   view (§4).
5. Content migration (events → Markdown), JSON Schemas, `atlas check` layers, and `atlas add`
   (§6).
6. Claims: schema, `claims compute` with locks, rendering, rubric page (§7).
7. MCP adapter over the existing query module (§5).
8. Later: DuckDB-WASM query page, `llms-full.txt`, the in-browser editor (per the brief),
   ALFRED backfill.

## 9. Decisions for Alex

1. **Licensing stance:**
   - re-source core series from the original agencies (recommended);
   - exclude Yahoo and S&P-family series from every public surface until their display rights are settled (recommended);
   - and decide how to describe ML suitability, given FRED's AI/ML training ban.
2. **API keys** (each is Alex's credential, so an explicit OK is needed):
   - FRED: for ALFRED backfill and catalog metadata;
   - BEA and EIA: for direct sourcing.

   BLS works keyless at low volume.
3. **Fact-checking scope:** will claims be public with labels from day one, or start as a private
   or draft set until the rubric has been tested on ~10 cases?
4. **The `as_of` cutoff rule:** use start-of-day ET, the strict and recommended rule, unless the
   claim has a time.
5. **Raw-blob retention:** 90 days plus revision-bearing blobs (recommended), or keep everything
   (about 0.6 GB a year, worst case).

## Sources

- FRED API, series/observations parameters: https://fred.stlouisfed.org/docs/api/fred/series_observations.html
- FRED real-time periods: https://fred.stlouisfed.org/docs/api/fred/realtime_period.html
- FRED legal / terms of use: https://fred.stlouisfed.org/legal/
- FRED MCP connector: https://fred.stlouisfed.org/help/data/connecting-fred-to-ai-services/fred-mcp-connector
- Philadelphia Fed Real-Time Data Set: https://www.philadelphiafed.org/surveys-and-data/real-time-data-research/real-time-data-set-for-macroeconomists
- OWID Chart API: https://docs.owid.io/projects/etl/api/chart-api/
- World Bank API basics: https://datahelpdesk.worldbank.org/knowledgebase/articles/898581 ; terms: https://data.worldbank.org/summary-terms-of-use
- DBnomics web API: https://docs.db.nomics.world/web-api/
- llms.txt: https://llmstxt.org/
- Google Dataset structured data: https://developers.google.com/search/docs/data-types/dataset ; Nov 2025 clarification (via ppc.land): https://ppc.land/google-phases-out-practice-problem-and-dataset-structured-data/
- Google simplifying search results (ClaimReview phase-out), 2025-06-12: https://developers.google.com/search/blog/2025/06/simplifying-search-results
- Frictionless Data Package v2: https://datapackage.org/standard/data-package/
- MCP resources spec (2025-11-25): https://modelcontextprotocol.io/specification/2025-11-25/server/resources ; transport future: https://blog.modelcontextprotocol.io/posts/2025-12-19-mcp-transport-future/
- DuckDB-WASM known issues and troubleshooting: https://duckdb.org/docs/current/clients/wasm/known_issues
- Yahoo Finance data redistribution: https://uk.help.yahoo.com/kb/SLN2352.html
- Caddy rate-limit module (non-standard): https://caddyserver.com/docs/modules/http.handlers.rate_limit

Not verified against primary docs (treat as "check before building"):
- whether `fredgraph.csv` accepts any vintage parameter;
- the World Bank WDI archive source ID;
- the exact 2026-07-28 MCP stateless transport text;
- Philadelphia Fed redistribution terms;
- the current status of the Claude Code `outputSchema` issue.
