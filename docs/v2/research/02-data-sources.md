# 02 — Data sources for Macro Atlas v2

Research for the v2 plan (see `docs/v2/BRIEF.md`). Scope: free public sources for the expanded
scope (US infrastructure, G20 headline indicators, trade and commodities, disasters and pandemics,
politics and claims context), plus a proper fix for Japan CPI.

**Method.** Every endpoint marked **verified** was fetched with `curl` on 2026-11-11 from a
residential connection, and the response was inspected. Raw responses are not committed; the
exact requests and parsed values for the load-bearing findings are in the evidence ledger (§11).
"Verified" means one of three things, and the text says which where it matters:
*reachable* (endpoint answered, possibly with an auth error), *data returned* (observations
parsed, latest period noted), or *cross-checked* (values compared against a second source).
Items marked **unverified** are from documentation or prior knowledge and need a check before
the pipeline relies on them. "No key" means the request succeeded with no credential of any
kind. Freshness is the latest non-null observation in the response, not a page or feed
modification date, unless stated otherwise.

---

## 1. Summary

### What changed since v1 was built (verified)

| Finding | Impact on v2 |
|---|---|
| **Census Data API data queries now need a key.** VIP, resconst and a trivial ACS query all returned `302 → /data/missing_key.html`. (The discovery catalog `eits.json` still answers keyless.) | Register a free Census key, or use the C30 XLSX downloads and FRED mirrors (both still work with no key). |
| **FRED `fredgraph.csv` failed under concurrency.** 10 IDs fetched in parallel (inside a 12-wide batch) all failed (HTTP/2 `INTERNAL_ERROR`, then 45 s timeouts on retry); 10 IDs fetched one at a time with a 1 s pause each returned 200 in under 1.2 s. | Keep FRED calls serial and throttled (v1 already does). Whether a keyed FRED API tolerates more is untested. |
| **IMF's SDMX 3.0 API at `api.imf.org` returned data without a key** (CPI, ER, LS, WEO, PCPS data-tested; 231 dataflows listed). `dataservices.imf.org` (the old JSON API) did not resolve in DNS today. The DataMapper API returned an Akamai `403 Access Denied` to curl. | Use `api.imf.org` SDMX 3.0 for IMF data; do not depend on DataMapper. |
| **Japan CPI is fixable with no key**: the e-Stat file-download URL serves the 2020-base monthly CSV (1970-01 to 2026-09); the IMF CPI dataflow matches it exactly for all 25 months compared (2024-09 → 2026-09). Every OECD `DF_PRICES_ALL` key I tried for Japan returned `NoRecordsFound`. | See §7. Retire the truncated FRED series `JPNCPIALLMINMEI`. |
| **NOAA's billion-dollar disaster database stopped at 2024.** `events-US-1980-2024.csv` still serves 403 events; NOAA's site now offers no 2025 file (the `-1980-2025.csv` URL returns the 1980-2024 file). Climate Central continues the series "with the same methodology and lead scientist" (Adam Smith) and shows 2025 totals, but I found no CSV download there. | Freeze NOAA through 2024 as a historical source; treat Climate Central as the continuation and add it once a machine-readable export is found or arranged. |
| **OWID's excess-mortality chart for the US ends 2023-W52** (p-scores vs 2015-19 average; other countries and OWID's other excess series not checked). OWID COVID compact data runs to 2026-10-18 for the US. | Use OWID for cross-country COVID history; use CDC NCHS for current US deaths; compute current excess mortality from HMD/NCHS if needed. |
| **EM-DAT forbids redistribution** ("Reproduce, copy, communicate, lend, or otherwise distribute EM-DAT or a substantial part" is listed as unauthorized; registration required; non-commercial only). | Not compatible with v2's bulk downloads. Exclude, or show only cited aggregates. |
| **CHIPS Act money does not show up under its DEF code in USAspending** (DEF `8`, P.L. 117-167, holds about $3M, all DOJ). IIJA is tagged (DEF `Z` and `1`). | Track CHIPS through its federal accounts (013-0520 etc.); account-level outlay extraction is not yet tested. |
| **WTO, FAO API, Ember, Google Fact Check, FCC BDC, EIA all need free keys/accounts now.** FAO bulk ZIPs and UN Comtrade's public preview still work keyless. | One-time key registration list in §9. |

### Ranking (value to the brief × reliability)

Tier 1 = build on it in v2.0. Tier 2 = add in v2.x. Tier 3 = context only, or blocked by terms.

| Rank | Source | Domain | Auth | Why |
|---|---|---|---|---|
| 1 | FRED (fredgraph CSV) | US macro, construction, rail, TSI | none (serial only) | Already in v1; mirrors Census C30 and BTS series with stable IDs |
| 2 | IMF SDMX 3.0 (`api.imf.org`) | G20 CPI, FX, GDP, WEO, commodity prices | none | Monthly CPI current for all 19 G20 countries; FX for all non-euro members; PCPS to 2026-M10 (matrix in §3) |
| 2b | BLS, BEA, Treasury Fiscal Data | US prices/jobs, GDP/income, federal receipts/outlays | BLS v1 none; BEA key; Treasury none | Primary US sources behind many FRED series; direct use gives release-level provenance |
| 3 | BIS SDMX (`stats.bis.org`) | Policy rates, long CPI, effective FX | none | 16 of 19 G20 countries + euro area policy rates in one call |
| 4 | USAspending API | IIJA/CHIPS obligations and outlays | none | Live federal spending with provenance; IIJA totals by agency/state |
| 5 | OpenFEMA | Disaster declarations since 1953 | none | Clean API, daily refresh, clear terms |
| 6 | EIA API v2 | Generation, capacity, prices | free key | The authoritative US grid/energy source |
| 7 | World Bank API | Annual GDP, population, development | none | CC BY 4.0; long history; good for per-capita normalising |
| 8 | OECD SDMX | Unemployment, prices for OECD members | none | Works, but Japan CPI gap and fragile keys |
| 9 | BTS (Socrata) | TSI, Monthly Transportation Statistics, port TEU (annual) | none | 136-column monthly transport table, updated 2026-11-06 |
| 10 | Census C30 XLSX | Construction spending by type, public/private | none | Source of record for construction; FRED mirrors the top lines |
| 11 | e-Stat (file download) | Japan CPI | none (API needs appId) | Fixes the v1 gap; official source |
| 12 | OWID + CDC NCHS | COVID, excess mortality | none | Cross-country history plus current US deaths |
| 13 | House Clerk / Senate XML, Voteview | Roll-call votes | none | Primary records; Voteview adds ideology scores |
| 14 | Congress.gov, GovInfo, FEC | Bills, laws, campaign finance | api.data.gov key (DEMO_KEY works) | Bill status and law text for claims context |
| 15 | MIT Election Data (Dataverse) | Election returns | none, CC0 | Clean county/state results |
| 16 | Data Commons ClaimReview feed | Fact-check index | none | 94,179 ClaimReview items, refreshed daily |
| 17 | UN Comtrade (public preview) | Trade by partner/product | none (key for volume) | Authoritative, but preview caps rows; terms need care |
| 18 | National stats (ECB, Eurostat, ONS, BoC, BCB, BCRA, INDEC, MOSPI, CBR) | G20 cross-checks and gaps | mostly none | Use only where IMF/BIS/OECD fall short |
| 19 | FAO (bulk), World Bank Pink Sheet | Food prices, commodity history | none | Monthly; URLs change per release |
| 20 | NTIA Internet Use Survey, FCC BDC | Broadband adoption/availability | none / account | Biennial survey; BDC needs an account token |
| 21 | NOAA / Climate Central billion-dollar disasters | Disaster costs | none (NOAA, frozen) | High value, but the series has changed custodian |
| — | EM-DAT, WTO API, Google Fact Check API, AAR | — | registration/terms | See notes; not needed for v2.0 |

---

## 2. US infrastructure (and the US core behind it)

### US primary sources behind FRED

v1 reads most US series through FRED. v2's provenance goal argues for knowing, per series, the
primary agency and release, and for going direct where FRED adds lag or hides release dates.

| Source | Status | Auth | Notes |
|---|---|---|---|
| BLS Public Data API v1 `api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0` | **data returned** (CPI-U Oct 2026 = 337.511, flagged `latest`) | none for v1; free key for v2 | v1 is capped (documented as 25 queries/day, 10 years per query; **unverified**). v2 key raises limits and adds catalog/calculations. |
| BEA API `apps.bea.gov/api/data?method=GETDATASETLIST` | **reachable**: 200 with an empty body without `UserID` | free UserID | NIPA, GDP by industry, regional (state GDP, personal income). |
| Treasury Fiscal Data `api.fiscaldata.treasury.gov/.../mts/mts_table_5` | **data returned** (record_date 2026-09-30) | none | Monthly Treasury Statement outlays by function; debt to the penny; interest costs. Strong for federal-budget claims. |
| FRED API `api.stlouisfed.org/fred/series` | **reachable**: 400 "api_key is not set" | free key | Adds series metadata, release calendars and ALFRED vintages (what was known when). |

FRED's own terms: series keep their upstream copyright; most federal series are public domain, but some (e.g. ICE, S&P, Moody's) are not. Licence must be recorded per series, not inferred from "on FRED".

### Construction spending (Census C30, "Value Put in Place")

| Item | Detail |
|---|---|
| Census API | `api.census.gov/data/timeseries/eits/vip` — **verified: needs key** (302 to `missing_key.html`). Variables: `cell_value, data_type_code, category_code, time_slot_id, seasonally_adj, program_code, geo_level_code, error_data`. |
| Census XLSX | **verified, no key**: `https://www.census.gov/construction/c30/xlsx/{tot,priv,pub,sl,fed}{sa,}time.xlsx` (e.g. `pubsatime.xlsx`, 129 KB). Linked from `construction/c30/historical_data.html`. |
| FRED mirrors | **verified, no key**: `TTLCONS` (total, 1993-01 → 2026-09), `TLPBLCONS` (public), `TLPRVCONS` (private), `TLWSCONS` (water supply, 2002 →), `TLPWRCONS` (power), `TLHWYCONS` (highway and street), `TLCOMCONS` (commercial). `TLSWCONS` (sewage) is not a valid ID; get sewage/waste disposal from the XLSX. |
| Cadence | Monthly, about the first business day of the month, roughly 2-month lag. Annual revision each July. |
| History | Total from 1993 (current NAICS-based series); by-type detail from 2002 (FRED) or 1993 (Census tables). |
| License | US government work, public domain. |
| Value | High. Public vs private split, plus water, power, highway, sewage, broadband-relevant "communication" category, answers "is infrastructure money showing up in construction?". |

**Water infrastructure spending.** No single "water investment" series exists. Use C30 categories (water supply, sewage and waste disposal) for construction activity, USAspending IIJA EPA lines (State Revolving Funds; EPA obligations $47.5B, outlays $20.4B under IIJA as of 2026-11-11, **verified**) for federal money, and CBO's "Public Spending on Transportation and Water Infrastructure" report (periodic PDF/XLSX, **unverified** URL) for long-run federal/state/local totals.

### Electricity grid, generation, capacity (EIA)

| Item | Detail |
|---|---|
| API | `api.eia.gov/v2/` — **verified: needs key** (`API_KEY_MISSING` without one). `DEMO_KEY` works for testing; it returned `x-ratelimit-limit: 10`. Free key at `eia.gov/opendata/register.php`. |
| Generation | `/v2/electricity/electric-power-operational-data/data/?frequency=monthly&data[0]=generation&facets[location][]=US&facets[sectorid][]=99&facets[fueltypeid][]=ALL` → **verified**, 2026-08 = 449,406 thousand MWh. Breakdown by fuel via `fueltypeid` facet. |
| Capacity | `/v2/electricity/operating-generator-capacity/data/` (EIA-860M generator inventory) → **data returned** with `nameplate-capacity-mw` (297,714 rows for Texas across all months). Each month is a full inventory snapshot: total capacity = sum over generators **within one period**, never across periods. Whether the API can aggregate server-side is untested; plan on the bulk file or paginated pulls plus local aggregation. |
| Not covered | Generation and capacity are not grid investment or reliability. For those, candidates are EIA-861 (utility distribution data, SAIDI/SAIFI reliability) and EIA transmission/distribution capex series (**unverified**). |
| Limits | 5,000 rows per JSON response (warning returned), paginate with `offset`. Key limits are generous (EIA does not publish a hard number; **unverified**). |
| Bulk | `api.eia.gov/bulk/manifest.txt` **verified** (lists bulk ZIPs); good for a nightly full pull instead of many calls. |
| Cadence | Monthly (Electric Power Monthly, about 8-week lag); 860M monthly. |
| History | Generation 2001→; capacity 860M from 2015 (annual 860 longer). |
| License | Public domain. |
| Alternative | Ember monthly electricity API — **verified: needs key** (`{"detail":"No API key set"}`), CC BY 4.0, useful for G20 grid comparisons (unverified coverage). Tier 2. |

### Freight and transport (BTS, rail, ports)

| Item | Detail |
|---|---|
| BTS Transportation Services Index | Socrata `data.bts.gov/resource/bw6n-ddqk.json` — **verified, no key**. Columns include `tsi_freight`, `tsi_passenger`, `rail_frt_carloads(_d11)`, `rail_frt_intermodal`, `truck_d11`, `waterborne`, `vmt`, `transit`. Latest `obs_date` 2026-08 (`tsi_freight` 134.4). History from 2000-01. |
| BTS Monthly Transportation Statistics | `crem-w557` — **verified**, 136 columns, updated 2026-11-06: freight rail carloads and intermodal units, truck tonnage index, US-Canada/US-Mexico truck crossings, transborder freight, transport employment by mode, state/local transportation construction. Best single transport table. |
| Rail carloads | FRED `RAILFRTCARLOADSD11` and `RAILFRTINTERMODALD11` (from BTS) — **verified**, 2000-01 → 2026-08. **AAR** weekly rail traffic: `aar.org/data-center/rail-traffic-data/` now redirects to a resource finder; weekly reports are PDFs/press releases with no stable machine-readable file found. Use BTS/FRED; cite AAR as the upstream for carloads. |
| Ports / TEU | BTS `sn74-xpkp` "Top 25 Container Ports by TEU" — **verified**, annual (imports/exports/domestic by port), updated 2026-06. BTS "Monthly TEU Data" `rd72-aq8r` is stale (last updated 2022-12). The "Container / TEU" item `x3fb-aeda` is a story page, not a table (`403 non-tabular`). For monthly TEU use the ports directly: Port of LA (`portoflosangeles.org/business/statistics/container-statistics`, **verified HTML page**, scrape) and Long Beach (unverified). BTS port pages at `bts.gov/ports` returned `403 Access Denied` to curl. |
| Trucking | `truck_d11` in TSI; ATA tonnage index is proprietary (BTS republishes it in MTS as "Truck tonnage index"; check redistribution terms before bulk export). |
| License | BTS/FRED government series public domain; ATA and AAR upstream series carry their own terms (**unverified**). |
| Rate limits | Socrata anonymous calls are throttled per IP; an app token (free) raises limits (**unverified** numbers). |

### Broadband (FCC, NTIA)

| Item | Detail |
|---|---|
| FCC Broadband Data Collection API | `broadbandmap.fcc.gov/api/public/map/listAsOfDates` — **verified: 401 Unauthorized**. Needs a free FCC user account plus API token sent as `username` and `hash_value` headers (spec at `us-fcc.app.box.com/v/bdc-public-data-api-spec`, **verified reachable**). The nationwide download page returned 403 to curl. |
| FCC Open Data (Socrata) | `opendata.fcc.gov` — **verified, no key**, but holds state-level and legacy (Form 477) sets, not a national time series. |
| NTIA Internet Use Survey | `ntia.gov/sites/default/files/data_central_downloads/datasets/ntia-analyze-table.csv` — **verified, no key**, 2.3 MB, waves Nov 1994 → Nov 2023 (about biennial). Adoption by age, income, geography with standard errors. Best adoption series. |
| Census ACS (B28002 internet subscription) | Needs Census key (see above). Annual from 2013. |
| BEAD / federal broadband money | NTIA BEAD program page reachable (HTML only). The FCC's IIJA line in USAspending ($13.8B obligated, **data returned**) is most likely the Affordable Connectivity Program, **not BEAD**; BEAD ($42.45B) sits under Commerce/NTIA. Identify the NTIA BEAD federal account before charting it (**unverified**). |
| Value | Medium. Adoption (NTIA) and money (USAspending) are tractable; availability (BDC) needs the account and heavy processing. Tier 2. |

### Federal infrastructure spending (IIJA, CHIPS) — USAspending.gov

| Item | Detail |
|---|---|
| Auth | **verified, no key** for all endpoints tried. |
| DEF codes | `GET /api/v2/references/def_codes/` → **verified**: `Z` = IIJA emergency, `1` = IIJA non-emergency (P.L. 117-58). |
| IIJA totals | `GET /api/v2/disaster/overview/?def_codes=Z,1` → **verified**: budget authority $807.7B, total obligations $607.5B, total outlays $330.6B (as of 2026-11-11). |
| By agency | `POST /api/v2/disaster/agency/spending/` with `{"filter":{"def_codes":["Z","1"]},"spending_type":"total",...}` → **verified**: DOT $424.1B obligated / $262.4B outlaid; EPA $47.5B / $20.4B; FCC $13.8B / $13.8B. |
| By state | `POST /api/v2/disaster/spending_by_geography/` → responded with per-state rows, but `amount` was 0.0 for every state with `spending_type: obligation` and `scope: place_of_performance` while `award_count` was non-zero. **Treat as unreliable; test `spending_type: "award"` or use award search/bulk download instead.** |
| CHIPS | Not tagged: DEF `8` (P.L. 117-167) holds about $3.06M, all DOJ. Use federal accounts instead: `POST /api/v2/federal_accounts/` keyword "CHIPS" → **verified**: `013-0520` CHIPS for America Fund, NIST ($7.38B budgetary resources FY2026), `013-0521` CHIPS Loan Program Account, `049-0108` NSF Workforce and Education Fund, `019-1159` State ITSI Fund, `097-0403` Defense Fund. |
| IRA | Not checked; IRA has no DEF code either, so it would also need account- or program-level tracking. |
| Cadence | Agencies report monthly/quarterly (File A/B/C via DATA Act); award data near-daily. |
| History | FY2008→ for award search; IIJA from FY2022. |
| License | Public domain. |
| Measures | Keep budget authority, budgetary resources, obligations and outlays as separate series; none of them is construction activity (that is C30). A claim like "only X% of IIJA has been spent" depends on which one is used. |
| Value | Very high for "where did the infrastructure money go" claims. Snapshot daily and keep the history (USAspending revises; the snapshot series itself is a provenance asset). State-level IIJA is **not ready** (see the geography row). |

---

## 3. G20 headline indicators

G20 = 19 countries + EU + African Union. Plan around the 19 countries plus euro area/EU.

### Multilateral sources (no key)

| Source | Endpoint (verified) | Coverage / notes |
|---|---|---|
| **IMF SDMX 3.0** | `https://api.imf.org/external/sdmx/3.0/data/dataflow/{agency}/{flow}/+/{key}?lastNObservations=N&dimensionAtObservation=TIME_PERIOD` | `IMF.STA/CPI` key `JPN.CPI._T.IX.M` → 2026-M09 = 114.5. `IMF.RES/WEO` key `USA.NGDP_RPCH.A` → Oct 2026 vintage (attribute `9/30/2026`), includes projections. Also `ER` (exchange rates), `LS` (labour), `QNEA`/`ANEA` (national accounts), `MFS_IR` (interest rates), `IMTS` (trade by partner), `BOP`, `FM`. 231 dataflows. JSON is SDMX-JSON 2.0 (series keyed by dimension index; parse with structure). License: IMF terms allow free reuse with attribution (**unverified wording**). Rate limit undocumented in responses. |
| **BIS** | `https://stats.bis.org/api/v1/data/WS_CBPOL/M.{codes}/all?startPeriod=...&format=csv` | Policy rates: one call returned 16 G20 economies + euro area to 2026-09/10 (AU, BR, CA, CN, GB, ID, IN, JP, KR, MX, RU, SA, TR, US, XM, ZA). **Argentina missing** (use BCRA). FR/DE/IT covered by XM. Also `WS_LONG_CPI` (Japan from 1946-08) and `WS_EER` (real effective FX). v2 API (`/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/...`) also works. |
| **OECD** | `https://sdmx.oecd.org/public/rest/data/{agency},{dsd}@{df},{ver}/{key}` with `Accept: application/vnd.sdmx.data+csv` | Unemployment `OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0` works for Japan. Prices `DF_PRICES_ALL` returns `NoRecordsFound` for Japan with every key tried. Keys are long and brittle; OECD has documented per-IP query limits (**unverified** figure). CC BY 4.0. |
| **World Bank** | `https://api.worldbank.org/v2/country/USA;JPN/indicator/NY.GDP.MKTP.CD?format=json&date=2022:2024` | Annual only; `lastupdated` 2026-10-08. CC BY 4.0. No visible rate-limit headers. Best for population, GDP in USD, per-capita normalising. |
| **DBnomics** | `api.db.nomics.world/v22/` | Up (47k datasets) but mirrored OECD/IMF series can be stale or renamed (`OECD/PRICES_CPI/JPN...` → 404). Use as a discovery tool, not a source of record. |

### Country sources (verified unless noted)

| Country | Source | Auth | Note |
|---|---|---|---|
| Euro area | ECB Data Portal `data-api.ecb.europa.eu` | none | First call 504, retry 200. Add retry/backoff. |
| EU | Eurostat `ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr` | none | JSON-stat; CC BY 4.0. |
| UK | ONS `ons.gov.uk/generator?format=csv&uri=/economy/.../d7g7/mm23` | none | CSV includes release date and next release (useful for "as of"). OGL v3. |
| Canada | Bank of Canada Valet `bankofcanada.ca/valet/observations/V39079/json` | none | Policy rate. StatCan WDS needs POST (GET → 405). |
| Brazil | BCB SGS `api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/2` | none | Returned 13.75 dated `08/12/2026` and `09/12/2026` (dd/mm), i.e. **future dates**. Series 432 (Selic target) appears to be carried forward to the next scheduled Copom date, so "last row" is not "latest observed". Filter to dates ≤ today. IBGE SIDRA timed out twice (possible geo/IP block). |
| Argentina | INDEC via `apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26` (CPI to 2026-08); BCRA `api.bcra.gob.ar/estadisticas/v4.0/monetarias` | none | BCRA fills the BIS policy-rate gap. |
| India | MOSPI `api.mospi.gov.in/api/cpi/getCPIIndex` | none | Responded, but returned base-2012 rows; check for the newer base year. RBI DBIE is a JS app. |
| Russia | CBR `cbr.ru/scripts/XML_daily.asp` | none | FX; windows-1251 XML. |
| Korea | BoK ECOS `ecos.bok.or.kr/api/...` | free key (`sample` key works, capped rows) | |
| Mexico | Banxico SIE, INEGI | free token | Banxico: "Token inválido" without a token. INEGI: HTML 404 on my guessed URL (path problem, not an auth result). |
| Turkey | TCMB EVDS | free key | Endpoint now serves an SPA; API path needs re-check. |
| Indonesia | BPS WebAPI | free key | `Missing required parameter: key`. |
| China | NBS `data.stats.gov.cn` | — | **403 Forbidden** to scripts. Use IMF/BIS/OECD for China. |
| Japan | e-Stat, BoJ `stat-search.boj.or.jp/api/v1` (no key, verified) | none / appId | See §7. |
| France | INSEE BDM `api.insee.fr/series/BDM/V1/...` | none (responded) | Optional. Euro-area data substitutes only for the policy rate and currency; French CPI, GDP and unemployment must stay national (IMF/OECD/INSEE). |
| Germany | Bundesbank API | none | Responded (404 for my key; endpoint up). |
| Saudi Arabia, South Africa, Australia | GASTAT (HTML), SARB (404 on guessed path), ABS SDMX (`NoRecordsFound` on guessed key) | — | Use IMF/BIS. |

### G20 coverage matrix (IMF + BIS, data returned 2026-11-11)

Latest non-null period per country. CPI = `IMF.STA/CPI` `{ISO3}.CPI._T.IX.M`. FX = `IMF.STA/ER` `{ISO3}.USD_XDC.PA_RT.M` (period-average national currency per USD). Unemp = `IMF.STA/LS` `{ISO3}.U.PT.M`. Policy = BIS `WS_CBPOL` monthly. GDP = `IMF.RES/WEO` `NGDP_RPCH` (annual; latest period is a **projection to 2031**).

| Country | CPI | FX | Unemp (IMF LS) | Policy rate | Main index (v1 Yahoo) |
|---|---|---|---|---|---|
| Argentina | 2026-M09 | 2026-M09 | 1997-M10 (stale) | **missing in BIS** → BCRA | not assessed |
| Australia | 2026-M08 | 2026-M10 | 2026-M02 | 2026-09 | not assessed |
| Brazil | 2026-M09 | 2026-M10 | 2025-M02 | 2026-10 | not assessed |
| Canada | 2026-M09 | 2026-M10 | 2026-M02 | 2026-10 | not assessed |
| China | 2026-M10 | 2026-M10 | 2020-M10 (stale) | 2026-10 | not assessed |
| France / Germany / Italy | 2026-M09 | euro: use EUR (`ER` ends 1998 for national codes) | 2026-M02 | euro area (XM) 2026-10 | not assessed |
| India | 2026-M07 | 2026-M10 | none | 2026-09 | not assessed |
| Indonesia | 2026-M10 | 2026-M10 | none | 2026-09 | not assessed |
| Japan | 2026-M09 | 2026-M10 | 2026-M03 | 2026-10 | in v1 |
| Korea | 2026-M10 | 2026-M10 | 2026-M03 | 2026-09 | not assessed |
| Mexico | 2026-M09 | 2026-M10 | 2025-M12 | 2026-10 | not assessed |
| Russia | 2026-M08 | 2026-M07 | 2026-M07 | 2026-10 | not assessed |
| Saudi Arabia | 2026-M09 | 2026-M10 | 2017-M11 (stale) | 2026-09 | not assessed |
| South Africa | 2026-M09 | 2026-M09 | 2007-M09 (stale) | 2026-10 | not assessed |
| Türkiye | 2026-M09 | 2026-M09 | 2026-M01 | 2026-10 | not assessed |
| UK | 2026-M09 | 2026-M10 | 2020-M09 (stale) | 2026-10 | not assessed |
| US | 2026-M09 | (base) | 2026-M08 | 2026-10 | in v1 |

What this shows: **CPI is covered** by IMF for all 19 countries; **policy rates** by BIS for 18 (all but Argentina); **FX** by IMF for all non-euro countries. Two gaps are named but not yet tested: Argentina's policy rate from BCRA (the API answered, but the specific series was not identified) and the EUR/USD series in IMF `ER` (or ECB `EXR`, which returned data) for France, Germany and Italy. **Monthly unemployment is not**: IMF `LS` is stale or absent for Argentina, China, India, Indonesia, Saudi Arabia, South Africa and the UK, and lags 6-8 months for others. Fill from OECD `DF_IALFS_UNE_M` (OECD members), national sources (ONS, INDEC, Stats SA, MOSPI PLFS, BPS), or use WEO annual `LUR` with a clear "annual / IMF estimate" label. **GDP**: WEO mixes actuals and projections in one series; the pipeline must split at the last actual year (WEO publishes this per country; the attribute was not inspected) and label projections. Quarterly GDP growth (`IMF.STA/QNEA` or OECD QNA) was not data-tested. Main stock indices and their redistribution terms (Yahoo) were not assessed here.

**Recommendation.** Build the G20 table from **IMF SDMX (CPI, FX, WEO annual GDP and unemployment), BIS (policy rates) and BCRA (Argentina policy rate)**, with OECD and national sources for monthly unemployment, and the v1 approach for main indices pending a terms review. Use country APIs only to fill named gaps.

---

## 4. Global trade and commodities

| Source | Status | Auth | Cadence / history | Notes |
|---|---|---|---|---|
| **IMF PCPS** (`IMF.RES/PCPS`) | **verified** | none | Monthly, to 2026-M10; history from 1990 (**unverified** start) | Key `G001.POILAPSP.USD.M` = APSP crude ($/bbl, 106.18 in Oct 2026); `G001.PALLFNF.INDEX.M` = all-commodity index. Wildcard keys (`*.POILAPSP.*.M`) return USD, INDEX, PCH, PCHY units. Best commodity source. |
| **World Bank Pink Sheet** | **verified** (XLSX, 778 KB) | none | Monthly; from 1960 | The file URL is versioned per release (the one fetched said "Updated as of: January 6, 2026"), so the pipeline must scrape the current link from the commodity-markets page. CC BY 4.0. |
| **UN Comtrade** | **verified** preview `comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=842&period=2023&partnerCode=0&flowCode=M&cmdCode=TOTAL` (US imports 2023 = $3.168T) | none for preview (row-capped, **unverified** cap of 500); free key for full API | Annual from 1962, monthly from 2010 (**unverified**) | Terms restrict bulk redistribution (**unverified**; check before including in bulk downloads). `getDA` data-availability endpoint works (14.8 MB). |
| **IMF IMTS** (`IMF.STA/IMTS`) | flow listed (not data-tested) | none | Monthly | Successor of DOTS; bilateral goods trade. Simpler than Comtrade for headline partner totals. |
| **WITS** (World Bank) | **verified** SDMX XML | none | Annual | Tariffs and trade summary by reporter. |
| **WTO Timeseries API** | **verified: 401** "missing subscription key" | free key at `apiportal.wto.org` | Annual/quarterly | Tariff profiles, services trade. Tier 3 unless services trade is needed. |
| **FAOSTAT** | API `faostatservices.fao.org/api/v1` → **401 Missing Authorization Header**; bulk `bulks-faostat.fao.org/production/datasets_E.json` → **verified** | bulk none; API token | CPI (`CP`, updated 2026-10-20), producer prices (`PP`), crops (`QCL`), trade (`TCL`) as normalized ZIP | Use bulk ZIPs. FAO Food Price Index page is up (last modified 2026-11-10) but the guessed CSV blob URL 404s; scrape the page link. License CC BY 4.0 (**unverified** for every domain). |
| **US trade** | Census international trade API needs key; FRED `BOPGSTB` etc. keyless | — | Monthly | Use FRED for headline US balance. |

---

## 5. Disasters and pandemics

| Source | Status | Auth | Cadence / history | Terms / notes |
|---|---|---|---|---|
| **OpenFEMA Disaster Declarations** `fema.gov/api/open/v2/DisasterDeclarationsSummaries` | **verified** (latest DR-4955, FL hurricane, declared 2026-10-27) | none | Data refreshed daily (`lastDataSetRefresh` 2026-11-11); 70,599 records, 1953-05 → | Terms require the statement "This product uses the Federal Emergency Management Agency's OpenFEMA API, but is not endorsed by FEMA..." plus access date; no FEMA logos. Supports `$filter`, `$select`, `$top` (max 10,000 per page, **unverified**), and full-file CSV/Parquet downloads. Also `FemaWebDisasterSummaries` (dollars per disaster, verified), Public Assistance projects, NFIP claims. |
| **NOAA billion-dollar disasters** `ncei.noaa.gov/access/billions/events-US-1980-2024.csv` | **verified**, 403 events, last = 2024 drought/heat wave | none | Final through 2024 | Public domain; DOI 10.25921/stkw-7w73. No 2025 file. |
| **Climate Central** (continuation) | page **verified**, shows 2025 monthly cumulative costs ($118.48B by Dec 2025) | — | Ongoing | No CSV found; only an app link (`app.climatecentral.org/dataviz`). Ask Climate Central or scrape cautiously; licence unknown. Tier 2. |
| **EM-DAT** | site and API **verified** (`api.emdat.be` needs `Authorization`) | registration | Global, 1900 → | **Terms forbid redistribution and derivative databases**, non-commercial only. Incompatible with bulk export. Tier 3. |
| **OWID COVID** `catalog.ourworldindata.org/garden/covid/latest/compact/compact.csv` | **verified**, 185 MB, US to 2026-10-18 | none | Weekly | CC BY 4.0 (OWID-produced; upstream WHO data keeps WHO terms). The old GitHub CSV (`owid/covid-19-data`) ends 2024-08-04; do not use it. |
| **OWID excess mortality** grapher CSV `.../excess-mortality-p-scores-average-baseline.csv?...&country=USA` | **data returned**, ends 2023-W52 for the US (other countries/series not checked) | none | Appears no longer updated | Grapher `.metadata.json` endpoint gives citation and description (good provenance pattern to copy). |
| **CDC NCHS** Socrata `data.cdc.gov` | `r8kw-7aab` (provisional COVID deaths) to 2026-10-31 **verified**; `xkkf-xrst` (excess deaths) ends 2023-09-16 | none | Weekly | Public domain. |
| **Human Mortality Database STMF** | page **verified** | free registration for downloads (**unverified**) | Weekly deaths, ~38 countries | CC BY 4.0 (**unverified**). Source for computing current excess mortality ourselves. |

---

## 6. Politics and claims context

| Source | Status | Auth | Notes |
|---|---|---|---|
| **Congress.gov API** `api.congress.gov/v3/bill` | **verified**: 403 `API_KEY_MISSING`; `api_key=DEMO_KEY` works | free api.data.gov key (5,000 req/hr, **unverified**) | Bills, actions, members, votes (House votes endpoint is newer; **unverified**). |
| **House Clerk roll calls** `clerk.house.gov/evs/2025/roll001.xml` | **verified** | none | Primary record; one XML per vote. |
| **Senate roll calls** `senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00001.xml` | **verified** | none | Primary record. |
| **Voteview** `voteview.com/static/data/out/votes/H119_votes.csv` | **verified**, 7.9 MB | none | Every member's vote, plus DW-NOMINATE; 1789 →. Academic, free; cite Lewis et al. |
| **GovInfo** `api.govinfo.gov/collections` | **verified** with DEMO_KEY | api.data.gov key | Public laws, Congressional Record, Budget of the US Government. |
| **FEC** `api.open.fec.gov/v1/candidates/` | **verified** with DEMO_KEY (54,847 candidates) | api.data.gov key (1,000 req/hr, **unverified**) | Campaign finance. |
| **MIT Election Data + Science Lab** (Harvard Dataverse, e.g. `doi:10.7910/DVN/42MVDX`) | **verified**, license **CC0 1.0** | none | Presidential/House/Senate returns by state and county; versioned. Best election source. |
| **OpenElections** (GitHub) | **verified** | none | Precinct-level, uneven coverage. Tier 3. |
| **Census CPS Voting and Registration** | page **verified** | none for XLSX tables | Turnout by demographic, biennial. |
| **Data Commons ClaimReview feed** `storage.googleapis.com/datacommons-feeds/claimreview/latest/data.json` | **verified**, 201 MB, 94,179 items, `dateModified` today | none | Top publishers: FACTLY, PolitiFact (7,251), Fact Crescendo, dpa. Global and multilingual; filter by publisher/country/language. Some `datePublished` values are malformed (earliest parses as year 710). Licence of the feed is **unverified**; the review text belongs to each fact-checker, so store claim, rating, publisher, URL and date and link out rather than republishing text. |
| **Google Fact Check Tools API** `factchecktools.googleapis.com/v1alpha1/claims:search` | **verified: 403** unregistered caller | free Google Cloud API key | Search over the same ClaimReview corpus. Only needed for live search; the feed is enough for a nightly index. |
| **Google Civic Information API** | **verified: 403** | key | Not needed. |
| **PolitiFact** direct API | guessed path 404 | — | Use ClaimReview feed instead. |

**Claims workflow suggestion.** Store claims in repo YAML (per the brief), each with `claim`, `speaker`, `date`, `checks: [series_key, period]`, and optional `claimreview_url` from the feed. The site then shows the claim next to the series it refers to. Fact-check corpora are context; the atlas's own series are the evidence.

---

## 7. Japan CPI: the proper fix

v1 uses FRED `JPNCPIALLMINMEI` (OECD MEI), which ends 2021-06; OECD's own SDMX still returns `NoRecordsFound` for Japan CPI. Three working routes, all verified 2026-11-11:

| Route | Request | Result | Auth |
|---|---|---|---|
| **A. e-Stat file download (official)** | `https://www.e-stat.go.jp/en/stat-search/file-download?statInfId=000032103842&fileKind=1` | Shift-JIS CSV, 287 KB: 2020-base national CPI, monthly **1970-01 → 2026-09**, all items (code `0001`) plus core (`0161`, less fresh food), core-core (`0178`), and ~600 groups/items. 2026-09 all items = 114.5. | none |
| **B. IMF SDMX 3.0** | `api.imf.org/external/sdmx/3.0/data/dataflow/IMF.STA/CPI/+/JPN.CPI._T.IX.M` | 2026-M07 114.2, M08 114.3, M09 114.5 (matches e-Stat exactly). | none |
| **C. e-Stat API v3** | `api.e-stat.go.jp/rest/3.0/app/json/getStatsData?appId=...&statsDataId=...` | Only the auth path was tested: without appId it returns `STATUS 100`, "authentication failed, check application ID". Not a tested data route. | free appId |

**Cross-check done.** IMF and e-Stat all-items indices match exactly for all 25 overlapping months (2024-09 → 2026-09, zero differences at one decimal). Y/y from the e-Stat index: 2026-04 1.3%, -05 1.5%, -06 1.7%, -07 2.1%, -08 2.0%, -09 2.2%. Still to do: compare those y/y figures with the Statistics Bureau's published headline rates (computed from unrounded indices, so ±0.1 pt differences are expected) and check a long stretch of history, not just the last two years.

Also checked: BIS `WS_LONG_CPI` `M.JP.628` runs from 1946-08 (962 months) but does **not** track the official series: the same index value for 2026-08 and 2026-09 (120.649) while the official index rose 114.3 → 114.5, and BIS y/y for 2026-07 is 1.90% vs 2.1% from e-Stat. The cause (different definition, interpolation, or lag) was not investigated. Do not use BIS as the headline series, and do not splice its pre-1970 history onto e-Stat without understanding that difference.

**Recommendation.**
1. **Primary: IMF SDMX** (route B) for the headline index. Same parser as the other G20 IMF series, no key, matches the official file. Derive y/y from the index as v1 does, and label it "computed from index".
2. **Provenance and depth: e-Stat CSV** (route A) as the source of record, cited as Statistics Bureau of Japan, with core and core-core measures that the BoJ and press quote. Parse with `encoding="shift_jis"`; rows are `YYYYMM`, columns are item codes on row 3.
3. **Hardening:** the `statInfId` was serving current data, so it looks like a file updated in place, but this is **unverified across a release**. Re-check after the October CPI release (around 2026-11-20). Japan rebases CPI every five years (2020 base now; a 2025 base is due), which will likely change both the file ID and the index level, so the pipeline should (a) assert the base year from the header and (b) fail loudly if the latest month stops advancing (v1's `max_lag_months` already does this).
4. **e-Stat appId (route C)**: register on e-Stat (email account, then "API機能 (アプリケーションID発行)"; the app URL can be a placeholder such as `http://localhost/`). Up to three appIds per account (**unverified**). Store as `ESTAT_APP_ID` in the server env, never in the repo. Worth doing only if v2 wants other Japanese series (labour, GDP detail); for CPI alone, routes A + B are enough.
5. Retire `JPNCPIALLMINMEI` and the `known_truncated: 2021-06` note; keep the old series in history as superseded with a pointer.

Licence: e-Stat data are under the Government of Japan Standard Terms of Use (2.0), compatible with CC BY 4.0 (**unverified** version number).

---

## 8. Cross-cutting notes for the pipeline

- **Serial fetching per host plus backoff.** FRED failed every request in a parallel batch but answered serial requests; ECB returned a transient 504; IBGE timed out. Fetch hosts in parallel but requests to one host serially, with retry and jitter.
- **Keys live in the server environment.** The brief says no secrets in the repo; the VPS `.env` (or Docker secrets) holds `CENSUS_KEY`, `EIA_KEY`, `API_DATA_GOV_KEY` (Congress.gov, GovInfo, FEC share one), `ESTAT_APP_ID`, etc. Every source should still have a keyless fallback or degrade to "stale, last fetched X".
- **Licence gate on bulk export, per dataset and upstream owner.** Add `licence`, `upstream_owner` and `redistribute` fields to each catalog entry (not per provider: FRED, BTS and OWID all republish third-party series with their own terms, and a CC0 label on one MEDSL dataset says nothing about the others). Default to **not exported** until the terms for that dataset have been read and recorded. Define what each level permits before using it (e.g. `full` = raw observations in bulk files; `derived` = only our computed aggregates, if the terms allow derived works; `link` = metadata and a link to the source, no values). EM-DAT would be `link` at most; Comtrade and ClaimReview are undecided until their terms are read.
- **Required attribution strings** (FEMA's exact sentence, World Bank/OECD CC BY, OWID CC BY) should be data in the catalog and rendered on series pages and in download headers.
- **Versioned URLs** (World Bank Pink Sheet, FAO FFPI, possibly e-Stat after rebase) need a "discover link from landing page" step and a test that fails when discovery breaks.
- **Snapshot volatile sources.** USAspending totals, FEMA records, ClaimReview feed and WEO vintages change over time. Storing dated snapshots lets v2 show "what was known when", which helps with claim checking.
- **Keep comparison metadata with every series**: source unit, seasonal adjustment, real/nominal, base year, geography definition, observed vs projected, and revision/vintage. Claims are often wrong only because they compare SA with NSA, nominal with real, or a forecast with an outcome.
- **Observation date ≠ fetch date ≠ publication date.** BCB's Selic series carries future dates; WEO carries projections; feed `dateModified` says nothing about the newest observation. Store all three dates.
- **Size.** OWID compact CSV is 185 MB and the ClaimReview feed 201 MB; filter at ingest (US + G20; US-relevant fact-checks) rather than caching raw files in the repo.

## 9. Keys to register (all free)

| Key | Unlocks | Needed for v2.0? |
|---|---|---|
| Census API key | C30 via API, ACS broadband, trade API | Optional (XLSX + FRED cover construction) |
| EIA API key | Generation, capacity, prices | **Yes** |
| api.data.gov key | Congress.gov, GovInfo, FEC | **Yes** (DEMO_KEY is too limited for a daily job) |
| e-Stat appId | Japanese API data | Optional |
| FRED API key | FRED API (metadata, vintages/ALFRED) | Optional, useful for release dates and real-time vintages |
| Socrata app token | Higher limits on BTS, CDC, FCC open data | Optional |
| Ember, WTO, Comtrade, Google Fact Check, FCC BDC, Banxico/INEGI, ECOS, BPS, EVDS | Specialist data | v2.x |

Registering keys needs Alex's own accounts and email, so per the brief it is a stop-and-ask item for the build agent.

## 10. Still unverified (check before relying on)

- Exact rate limits for EIA (beyond DEMO_KEY's 10), OECD, IMF, Socrata, api.data.gov tiers.
- Whether the e-Stat `statInfId=000032103842` survives the next monthly release and the 2025 rebase.
- UN Comtrade and Data Commons ClaimReview redistribution terms; IMF data-reuse wording.
- USAspending state-level IIJA amounts (geography endpoint returned zeros).
- Climate Central machine-readable export and licence for 2025+ billion-dollar disasters.
- Monthly TEU for LA/Long Beach in a machine-readable form.
- IMF `QNEA` quarterly GDP coverage (CPI, ER, LS, WEO, PCPS were data-tested; see §3 matrix).
- WEO last-actual-year attribute per country.
- NTIA BEAD federal account in USAspending; CHIPS account-level outlay extraction.
- Yahoo main-index coverage and terms for all G20 markets.

## 11. Evidence ledger (2026-11-11, curl, no credentials unless stated)

| Finding | Request | Parsed result |
|---|---|---|
| FRED serial OK | `GET fred.stlouisfed.org/graph/fredgraph.csv?id={TTLCONS,TLPBLCONS,TLPRVCONS,TLWSCONS,TLPWRCONS,TLHWYCONS,TLCOMCONS,RAILFRTCARLOADSD11}` one at a time, 1 s apart | All 200. `TTLCONS` 1993-01 → 2026-09 (2,186,145); `TLPBLCONS` → 546,815; `TLPRVCONS` → 1,639,330; `TLWSCONS` 2002-01 → 37,141; `RAILFRTCARLOADSD11` 2000-01 → 2026-08 (990,805). `TLSWCONS` 404. |
| FRED parallel fails | same host, 10 IDs in a 12-wide parallel batch | first run: `curl (92) HTTP/2 stream not closed cleanly`; second run (HTTP/1.1): all `curl (28)` 45 s timeouts |
| Census key | `GET api.census.gov/data/timeseries/eits/vip?get=cell_value,data_type_code,category_code,seasonally_adj&time=2026-08` (also `eits/resconst`, `2023/acs/acs1`) | `302 location: /data/missing_key.html` |
| IIJA totals | `GET api.usaspending.gov/api/v2/disaster/overview/?def_codes=Z,1` | funding Z $440.74B + 1 $366.99B; total obligations $607.51B; total outlays $330.55B |
| IIJA by agency | `POST /api/v2/disaster/agency/spending/` `{"filter":{"def_codes":["Z","1"]},"spending_type":"total","pagination":{"limit":3,"sort":"outlay","order":"desc"}}` | DOT 069 obl $424.14B / outlay $262.43B; EPA 068 $47.48B / $20.39B; FCC 027 $13.81B / $13.76B |
| IIJA by state | `POST /api/v2/disaster/spending_by_geography/` `geo_layer: state, spending_type: obligation, scope: place_of_performance` | rows returned, every `amount` 0.0 (e.g. OH award_count 11,843) |
| CHIPS DEF | `GET /api/v2/disaster/overview/?def_codes=8` | total obligations $3.06M; agency breakdown: DOJ only |
| CHIPS accounts | `POST /api/v2/federal_accounts/` `{"filters":{"fy":"2026"},"keyword":"CHIPS","limit":10}` | 013-0520 ($7.38B budgetary resources), 013-0521, 049-0108 ($50.9M), 019-1159 ($100.7M), 097-0403 ($0) |
| IMF WEO | `GET api.imf.org/external/sdmx/3.0/data/dataflow/IMF.RES/WEO/+/USA.NGDP_RPCH.A?lastNObservations=8` | 8 annual values (2.95 … 1.755), series attribute `9/30/2026` |
| IMF PCPS | `.../IMF.RES/PCPS/+/G001.POILAPSP.USD.M?lastNObservations=2` | 2026-M09 103.39, 2026-M10 106.18 |
| Japan CPI match | IMF `JPN.CPI._T.IX.M?lastNObservations=25` vs e-Stat `statInfId=000032103842` CSV | 25/25 months equal; e-Stat file 1970-01 → 2026-09 (681 months) |
| BIS policy rates | `GET stats.bis.org/api/v1/data/WS_CBPOL/M.AR+AU+…+US+XM/all?startPeriod=2026-08&format=csv` | 16 areas returned, AR absent (values in §3) |
| IMF G20 coverage | `{G20}` = `ARG+AUS+BRA+CAN+CHN+FRA+DEU+IND+IDN+ITA+JPN+KOR+MEX+RUS+SAU+ZAF+TUR+GBR+USA` (BIS uses ISO2: `AR+AU+BR+CA+CN+IN+ID+JP+KR+MX+RU+SA+ZA+TR+GB+US+XM`). Requests: `IMF.STA/CPI` `{G20}.CPI._T.IX.M`, `IMF.STA/ER` `{G20}.*.*.M`, `IMF.STA/LS` `{G20}.*.*.M`, `IMF.RES/WEO` `{G20}.NGDP_RPCH+LUR+PCPIPCH.A`, each `lastNObservations=1` | see §3 matrix |
| NOAA final year | `GET ncei.noaa.gov/access/billions/events-US-1980-2024.csv` and `…-1980-2025.csv` | both return the 1980-2024 file; 403 events; last "Southern/Eastern/Northwestern Drought and Heat Wave (2024)" |
| Climate Central | `GET climatecentral.org/billion-dollar-disasters` (→ `/climate-services/billion-dollar-disasters`) | page text: "Continuing NOAA's dataset … same methodology and lead scientist, Adam Smith"; 2025 cumulative to $118.48B (Dec); no CSV link found |
| OpenFEMA | `GET fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=2&$orderby=declarationDate desc`; `OpenFemaDataSets?$filter=name eq 'DisasterDeclarationsSummaries'` | latest DR-4955 FL Hurricane 2026-10-27; 70,599 records; temporal 1953-05-01/; lastDataSetRefresh 2026-11-11 |
| OWID / CDC | OWID compact CSV; grapher excess CSV (USA); CDC `r8kw-7aab` `max(end_date)`; `xkkf-xrst` `max(week_ending_date)` | US compact last row 2026-10-18; excess last 2023-W52; r8kw-7aab 2026-10-31; xkkf-xrst 2023-09-16 |
| ClaimReview feed | `GET storage.googleapis.com/datacommons-feeds/claimreview/latest/data.json` | 201 MB, 94,179 `dataFeedElement`; first item datePublished 2026-11-11 |
| EM-DAT terms | `GET doc.emdat.be/docs/legal/terms-of-use/` | lists distribution and derivative databases as unauthorized use |
