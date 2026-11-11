# Macro Atlas — Implementation Spec for Claude Code

**Purpose:** Rebuild and extend the "Macro Atlas 2000–2026" dashboard as a maintainable repo: a reproducible data pipeline that pulls ~100 monthly economic/financial/political series from public sources, a curated events timeline, and a static, self-contained interactive HTML dashboard for overlaying, rebasing, and correlating series against events.

**Status of the reference build:** a working single-file prototype exists (`macro-atlas.html`, ~0.5 MB, generated 2026-09-20). This spec describes the production version. Where the spec and the prototype disagree, follow the spec.

---

## 1. Goals and non-goals

### Goals
1. One command (`make build` or `python -m atlas build`) refreshes all data and regenerates `dist/index.html`.
2. The dashboard is a single self-contained HTML file: inline CSS/JS, embedded JSON data, only CDN scripts for Chart.js and Google Fonts. It must work offline after first load and when opened via `file://`.
3. Users can overlay up to 8 series over any month range from Jan 2000 to the latest available month, with five scaling modes, event annotations, recession and presidential-term shading, a correlation matrix, a lagged pairwise scatter, a snapshot table, and CSV export.
4. Every series has a provenance record (source, ID, frequency, transform, last observation).
5. Works on a phone (≥360 px wide) and on desktop; supports light and dark themes.

### Non-goals
- No server, database, or auth. No live/streaming data.
- No paid data sources. No scraping of sites that require JS challenges (e.g. stooq.com blocks non-browser clients).
- Not a general BI tool: fixed series catalog, fixed transforms.

---

## 2. Repository layout

```
macro-atlas/
├── README.md
├── pyproject.toml            # python ≥3.11; deps: pandas, requests, pyyaml, jinja2
├── Makefile                  # fetch, build, test, serve, clean
├── atlas/
│   ├── __init__.py
│   ├── cli.py                # `python -m atlas fetch|build|check|serve`
│   ├── sources.py            # FRED + Yahoo fetchers with caching and retries
│   ├── transform.py          # monthly resampling, forward-fill rules, derived y/y
│   ├── catalog.yaml          # series manifest (section 4)
│   ├── events.yaml           # events timeline (section 5)
│   ├── approval.yaml         # presidential approval + terms (section 5)
│   ├── build.py              # renders template with data → dist/index.html
│   └── check.py              # data QA (section 8)
├── web/
│   ├── template.html         # Jinja2 template; placeholders for JSON blobs
│   ├── styles.css            # inlined at build time
│   └── app.js                # inlined at build time (vanilla JS, no bundler)
├── data/
│   ├── raw/                  # cached source responses (gitignored), one file per series
│   └── atlas.json            # built dataset (committed, ~500 KB)
├── dist/
│   └── index.html            # final artifact (committed or published via CI)
└── tests/
    ├── test_transform.py
    ├── test_stats.py         # port of the JS pearson/z-score logic, or run JS via node
    └── test_build.py         # renders template, checks size, lints JS with `node --check`
```

Keep JS/CSS as separate files during development and inline them at build time; the deliverable is still one HTML file.

---

## 3. Data pipeline

### 3.1 Sources

| Source | Endpoint | Auth | Notes |
|---|---|---|---|
| FRED | `https://fred.stlouisfed.org/graph/fredgraph.csv?id=<ID>` | none | Returns `observation_date,<ID>` CSV. Missing values are `.`. Some OECD-derived series end early — record `last_obs` and surface it in the UI. |
| Yahoo Finance | `https://query1.finance.yahoo.com/v8/finance/chart/<SYMBOL>?period1=<unix>&period2=<unix>&interval=1mo` | none, but send a browser `User-Agent` | JSON: `chart.result[0].timestamp[]` and `chart.result[0].indicators.quote[0].close[]`. Timestamps are month-start in exchange TZ; normalize to `YYYY-MM`. Dedupe months (keep last). |

Rules:
- Cache raw responses in `data/raw/<key>.<csv|json>` with a fetch timestamp; `fetch --force` bypasses. Retry 3× with backoff on 5xx/timeouts. Sleep ≥250 ms between FRED calls and ≥400 ms between Yahoo calls.
- Fail soft: a failed series is logged and omitted, and the build still succeeds. `check` reports which series are missing or stale (last observation older than the expected lag; see catalog `max_lag_months`).
- `period1` for Yahoo = 1999-01-01 so that y/y derivations have a 12-month runway before 2000-01.

### 3.2 Canonical monthly grid
- Master axis: every month from `2000-01` to the latest month present in any series (currently `2026-09`).
- Each series is stored as `{ "d": ["YYYY-MM", ...], "v": [number, ...] }`, only observed months (no nulls).
- Aggregation to monthly:
  - Market prices (Yahoo): **month-end close** (`how: last`).
  - Everything else: **mean of the source frequency within the month** (daily/weekly → monthly mean; monthly → identity; quarterly/annual → placed on the observation month).
- Rounding: 3 decimals for levels, 2 for percentages.

### 3.3 Derived series
- `*_yoy`: `(x[t] / x[t-12] − 1) × 100`, computed on the monthly grid **before** any forward-fill, so quarterly/annual series produce a y/y value only on observation months.
- Unit for derived series: `% y/y`; note: `"Year-over-year % change, computed"`.

### 3.4 Front-end alignment (done in JS at load, not in the pipeline)
- Map each series onto the master axis; unobserved months are `null`.
- **Sparse-series forward-fill for plotting only:** if a series has < 50 % of grid months (quarterly/annual), forward-fill within the plotted array so it renders as steps, but stop filling 2 months after the last observation for quarterly series and 11 months for annual (i.e. don't invent a future). The unfilled `series(k)` values are what the snapshot table and correlations must use; forward-filled values must **not** enter the monthly-change correlation basis (they'd create runs of zeros).

### 3.5 Output `data/atlas.json`
```json
{
  "generated": "2026-09-20T21:40:00Z",
  "first_month": "2000-01",
  "last_month": "2026-09",
  "series": { "<key>": { "d": [...], "v": [...] } },
  "meta":   { "<key>": { "name": "...", "cat": "...", "unit": "...", "src": "FRED UNRATE", "note": "...", "freq": "M|W|D|Q|A", "last_obs": "2026-08" } }
}
```
Serialize with `separators=(",",":")`; target < 1 MB.

---

## 4. Series catalog (`catalog.yaml`)

Each entry:

```yaml
- key: unrate
  source: fred            # fred | yahoo
  id: UNRATE
  name: US unemployment rate
  cat: US economy         # one of the 10 categories below
  unit: "%"
  agg: mean               # mean | last
  freq: M
  max_lag_months: 2       # for staleness checks
  note: ""
  derive_yoy: false       # if true, also emit <key>_yoy with yoy_name
  yoy_name: ""
```

Categories, in display order:
`US markets`, `Global markets`, `Commodities & energy`, `Currencies`, `Rates & money`, `US economy`, `Housing`, `Europe`, `Asia & other`, `Politics & sentiment`.

The full catalog as of the prototype (18 Yahoo + 64 FRED source series, 13 derived y/y, plus the hand-entered approval series = 96) follows. Reproduce it exactly, then extend per section 10.

### 4.1 Yahoo Finance series (`agg: last`, month-end close)
| key | Yahoo symbol | name | category | unit |
|---|---|---|---|---|
| `spx` | `^GSPC` | S&P 500 | US markets | index |
| `nasdaq` | `^IXIC` | Nasdaq Composite | US markets | index |
| `dow` | `^DJI` | Dow Jones Industrial | US markets | index |
| `rut` | `^RUT` | Russell 2000 | US markets | index |
| `vix` | `^VIX` | VIX (volatility) | US markets | index |
| `dax` | `^GDAXI` | DAX (Germany) | Global markets | index |
| `ftse` | `^FTSE` | FTSE 100 (UK) | Global markets | index |
| `stoxx` | `^STOXX50E` | Euro Stoxx 50 | Global markets | index |
| `nikkei` | `^N225` | Nikkei 225 (Japan) | Global markets | index |
| `shanghai` | `000001.SS` | Shanghai Composite | Global markets | index |
| `hsi` | `^HSI` | Hang Seng (HK) | Global markets | index |
| `kospi` | `^KS11` | KOSPI (Korea) | Global markets | index |
| `sensex` | `^BSESN` | Sensex (India) | Global markets | index |
| `tsx` | `^GSPTSE` | TSX (Canada) | Global markets | index |
| `gold` | `GC=F` | Gold ($/oz) | Commodities & energy | $/oz |
| `copper` | `HG=F` | Copper ($/lb) | Commodities & energy | $/lb |
| `btc` | `BTC-USD` | Bitcoin ($) | Commodities & energy | $ |
| `dxy` | `DX-Y.NYB` | US Dollar Index (DXY) | Currencies | index |

`^STOXX50E` only has history from 2007-02 on Yahoo; `GC=F`/`HG=F` from 2000-08; `BTC-USD` from 2014-09. Record the actual first month; do not backfill.

### 4.2 FRED series (`agg: mean`)
| key | FRED id | name | category | unit | derived y/y key | note |
|---|---|---|---|---|---|---|
| `wti` | `MCOILWTICO` | Crude oil, WTI ($/bbl) | Commodities & energy | $/bbl |  |  |
| `brent` | `MCOILBRENTEU` | Crude oil, Brent ($/bbl) | Commodities & energy | $/bbl |  |  |
| `gas` | `GASREGW` | US retail gasoline, regular ($/gal) | Commodities & energy | $/gal |  | Weekly, averaged to monthly |
| `natgas` | `MHHNGSP` | Natural gas, Henry Hub ($/MMBtu) | Commodities & energy | $/MMBtu |  |  |
| `eggs` | `APU0000708111` | Eggs, grade A large ($/dozen) | Commodities & energy | $/doz |  | US city average |
| `unrate` | `UNRATE` | US unemployment rate | US economy | % |  |  |
| `cpi` | `CPIAUCSL` | US CPI (index) | US economy | index 1982-84=100 | `cpi_yoy` |  |
| `corecpi` | `CPILFESL` | US core CPI (index) | US economy | index | `corecpi_yoy` |  |
| `fedfunds` | `FEDFUNDS` | Fed funds rate | Rates & money | % |  |  |
| `gs10` | `GS10` | US 10-year Treasury yield | Rates & money | % |  |  |
| `gs2` | `GS2` | US 2-year Treasury yield | Rates & money | % |  |  |
| `t10y2y` | `T10Y2Y` | US yield curve (10y–2y spread) | Rates & money | pp |  | Negative = inverted |
| `mortgage` | `MORTGAGE30US` | US 30-year mortgage rate | Housing | % |  |  |
| `umcsent` | `UMCSENT` | Consumer sentiment (U. Michigan) | Politics & sentiment | index |  | Survey-based |
| `gdp` | `GDPC1` | US real GDP ($bn, 2017$) | US economy | $bn | `gdp_yoy` | Quarterly |
| `gdp_qoq` | `A191RL1Q225SBEA` | US real GDP growth (annualized q/q) | US economy | % |  | Quarterly |
| `payems` | `PAYEMS` | US nonfarm payrolls (thousands) | US economy | thousands |  |  |
| `claims` | `ICSA` | Initial jobless claims | US economy | persons/week |  | Weekly, averaged |
| `saving` | `PSAVERT` | US personal saving rate | US economy | % |  |  |
| `m2` | `M2SL` | US M2 money supply ($bn) | Rates & money | $bn | `m2_yoy` |  |
| `fedassets` | `WALCL` | Fed balance sheet ($mn) | Rates & money | $mn |  | Weekly |
| `debtgdp` | `GFDEGDQ188S` | US federal debt / GDP | US economy | % |  | Quarterly |
| `debt` | `GFDEBTN` | US federal debt ($mn) | US economy | $mn |  | Quarterly |
| `civpart` | `CIVPART` | US labor force participation | US economy | % |  |  |
| `wages` | `AHETPI` | US avg hourly earnings ($) | US economy | $/hr | `wages_yoy` | Production & nonsupervisory |
| `houst` | `HOUST` | US housing starts (thousands, SAAR) | Housing | thousands |  |  |
| `caseshiller` | `CSUSHPINSA` | Case-Shiller US home price index | Housing | index 2000=100 | `cs_yoy` |  |
| `medhome` | `MSPUS` | US median home sale price ($) | Housing | $ |  | Quarterly |
| `rent_cpi` | `CUSR0000SEHA` | US rent CPI (index) | Housing | index | `rent_yoy` |  |
| `trade` | `BOPGSTB` | US trade balance ($mn) | US economy | $mn |  | Goods & services |
| `retail` | `RSAFS` | US retail sales ($mn) | US economy | $mn |  |  |
| `indpro` | `INDPRO` | US industrial production (index) | US economy | index |  |  |
| `profits` | `CP` | US corporate profits ($bn) | US economy | $bn |  | Quarterly |
| `income` | `MEHOINUSA672N` | US real median household income ($) | US economy | $ |  | Annual |
| `credit` | `TOTALSL` | US consumer credit ($mn) | Rates & money | $mn |  |  |
| `delinq` | `DRCCLACBS` | US credit card delinquency rate | Rates & money | % |  | Quarterly |
| `usepu` | `USEPUINDXM` | US economic policy uncertainty | Politics & sentiment | index |  | Baker-Bloom-Davis |
| `gepu` | `GEPUCURRENT` | Global economic policy uncertainty | Politics & sentiment | index |  | Baker-Bloom-Davis |
| `usrec` | `USREC` | US recession (NBER) | Politics & sentiment | 0/1 |  |  |
| `ez_unemp` | `LRHUTTTTEZM156S` | Euro area unemployment | Europe | % |  | Source series ends Jan 2023 |
| `ez_hicp` | `CP0000EZ19M086NEST` | Euro area HICP (index) | Europe | index | `ez_infl` |  |
| `ecb` | `ECBDFR` | ECB deposit rate | Europe | % |  |  |
| `ez_gdp` | `CLVMEURSCAB1GQEA19` | Euro area real GDP (€mn) | Europe | €mn | `ez_gdp_yoy` | Quarterly |
| `eurusd` | `DEXUSEU` | EUR/USD | Currencies | $ per € |  |  |
| `gbpusd` | `DEXUSUK` | GBP/USD | Currencies | $ per £ |  |  |
| `uk_unemp` | `LRHUTTTTGBM156S` | UK unemployment | Europe | % |  |  |
| `uk_cpi` | `GBRCPIALLMINMEI` | UK CPI (index) | Europe | index | `uk_infl` |  |
| `boe` | `IRSTCI01GBM156N` | UK short-term interest rate | Europe | % |  | Immediate interbank rate, tracks Bank Rate |
| `euepu` | `EUEPUINDXM` | Europe economic policy uncertainty | Politics & sentiment | index |  | Baker-Bloom-Davis |
| `de_unemp` | `LRHUTTTTDEM156S` | Germany unemployment | Europe | % |  |  |
| `de10` | `IRLTLT01DEM156N` | Germany 10-year yield | Europe | % |  |  |
| `it10` | `IRLTLT01ITM156N` | Italy 10-year yield | Europe | % |  |  |
| `fr_unemp` | `LRHUTTTTFRM156S` | France unemployment | Europe | % |  |  |
| `jp_unemp` | `LRHUTTTTJPM156S` | Japan unemployment | Asia & other | % |  |  |
| `jpy` | `DEXJPUS` | USD/JPY | Currencies | ¥ per $ |  |  |
| `cny` | `DEXCHUS` | USD/CNY | Currencies | ¥ per $ |  |  |
| `inr` | `DEXINUS` | USD/INR | Currencies | ₹ per $ |  |  |
| `cad` | `DEXCAUS` | USD/CAD | Currencies | C$ per $ |  |  |
| `jp10` | `IRLTLT01JPM156N` | Japan 10-year yield | Asia & other | % |  |  |
| `ca_unemp` | `LRHUTTTTCAM156S` | Canada unemployment | Asia & other | % |  |  |
| `kr_unemp` | `LRHUTTTTKRM156S` | Korea unemployment | Asia & other | % |  |  |
| `jp_cpi` | `JPNCPIALLMINMEI` | Japan CPI (index) | Asia & other | index | `jp_infl` | Source series ends mid-2021 |
| `cn_cpi` | `CHNCPIALLMINMEI` | China CPI (index) | Asia & other | index | `cn_infl` |  |
| `cn_gdp` | `MKTGDPCNA646NWDB` | China nominal GDP (US$) | Asia & other | $ | `cn_gdp_yoy` | Annual, World Bank |

Known quirks to encode as `note`/`last_obs`:
- `LRHUTTTTEZM156S` (euro-area unemployment) ends 2023-01. `JPNCPIALLMINMEI` ends 2021-06. `GBRCPIALLMINMEI` ends 2025-03. `CHNCPIALLMINMEI` ends 2025-04. Keep them (history is valuable) and show "to YYYY" in the picker. Open a TODO to find replacements (Eurostat/ONS/e-Stat direct APIs).
- `WALCL` starts 2002-12. `MEHOINUSA672N` and `MKTGDPCNA646NWDB` are annual.
- `IRSTCI01GBM156N` is the UK immediate interbank rate, used as a proxy for Bank Rate.
- The following FRED IDs were tried and do **not** work (HTML error page): `IRSTCB01GBM156N`, `NYGDPMKTPKDWLD`, `NYGDPMKTPKDCHN`, `CPALTT01JPM661N`, `CPALTT01GBM661N`, `CPALTT01CNM661N`, `LRUNTTTTEZM156S`.

### 4.3 Hand-entered series
- `approval` — "Presidential approval (Gallup, approx.)", cat `Politics & sentiment`, unit `%`, src `Gallup (hand-entered)`. Built from `approval.yaml` (quarterly averages, expanded to months; 2000 = 60 for Clinton). Values in section 5.3. Mark clearly as approximate in the footer.

---

## 5. Events and political context

### 5.1 Schema (`events.yaml`)
```yaml
- month: "2008-09"
  title: "Lehman Brothers bankruptcy"
  cat: financial          # political | financial | geopolitical | health | policy
  # optional:
  day: 15
  url: "https://…"        # citation; shown in tooltip/list if present
```
Category colors (CSS tokens): political `#7B4FB8`, financial `#D1495B`, geopolitical `#B5651D`, health `#0FA3B1`, policy `#2E8B57`.

### 5.2 Current events list (83)
| month | event | category |
|---|---|---|
| 2000-03 | Dot-com bubble peaks (Nasdaq top, Mar 10) | financial |
| 2000-11 | Bush v. Gore disputed election | political |
| 2001-01 | Fed begins cutting rates | policy |
| 2001-03 | US recession begins (dot-com bust) | financial |
| 2001-09 | September 11 attacks | geopolitical |
| 2001-10 | War in Afghanistan begins | geopolitical |
| 2001-12 | Enron bankruptcy | financial |
| 2002-07 | WorldCom collapse; Sarbanes-Oxley signed | financial |
| 2003-03 | Iraq War begins | geopolitical |
| 2003-05 | Bush tax cuts (JGTRRA) | policy |
| 2004-11 | Bush re-elected | political |
| 2005-08 | Hurricane Katrina | health |
| 2006-06 | Fed ends hiking cycle at 5.25% | policy |
| 2006-07 | US home prices peak | financial |
| 2007-08 | Subprime crisis: BNP freezes funds, credit seizes | financial |
| 2007-12 | Great Recession begins | financial |
| 2008-03 | Bear Stearns rescued | financial |
| 2008-07 | Oil peaks near $147 | financial |
| 2008-09 | Lehman Brothers bankruptcy | financial |
| 2008-10 | TARP bank bailout signed | policy |
| 2008-11 | Obama elected; Fed launches QE1 | political |
| 2009-02 | ARRA stimulus signed | policy |
| 2009-03 | Stock market bottoms (S&P 666) | financial |
| 2009-06 | Great Recession ends | financial |
| 2010-03 | Affordable Care Act signed | policy |
| 2010-04 | Deepwater Horizon spill | health |
| 2010-05 | Flash crash; Greek bailout begins euro crisis | financial |
| 2010-11 | Fed launches QE2 | policy |
| 2011-03 | Fukushima disaster; Arab Spring | geopolitical |
| 2011-05 | Bin Laden killed | geopolitical |
| 2011-08 | S&P downgrades US credit rating | financial |
| 2012-07 | Draghi: 'whatever it takes' | policy |
| 2012-09 | Fed launches QE3 | policy |
| 2012-11 | Obama re-elected | political |
| 2013-05 | Taper tantrum | financial |
| 2013-10 | US government shutdown (16 days) | political |
| 2014-03 | Russia annexes Crimea | geopolitical |
| 2014-06 | Oil price collapse begins (to 2016) | financial |
| 2014-10 | Fed ends QE3 | policy |
| 2015-06 | Greek referendum / bailout crisis | financial |
| 2015-08 | China devalues yuan; global selloff | financial |
| 2015-12 | Fed's first hike since 2006 | policy |
| 2016-06 | Brexit referendum | political |
| 2016-11 | Trump elected | political |
| 2017-12 | Tax Cuts and Jobs Act | policy |
| 2018-02 | 'Volmageddon' VIX spike | financial |
| 2018-03 | US–China trade war begins | geopolitical |
| 2018-12 | Q4 selloff; Fed's last hike of cycle | financial |
| 2019-08 | Yield curve inverts; Fed cuts | financial |
| 2019-12 | First COVID-19 cases reported | health |
| 2020-03 | COVID-19 pandemic; market crash; CARES Act | health |
| 2020-04 | Oil futures go negative | financial |
| 2020-05 | George Floyd killed; nationwide protests | political |
| 2020-11 | Biden elected | political |
| 2020-12 | First COVID vaccines administered | health |
| 2021-01 | Jan 6 Capitol attack; GameStop squeeze | political |
| 2021-03 | American Rescue Plan ($1.9T) | policy |
| 2021-08 | US withdrawal from Afghanistan | geopolitical |
| 2021-11 | Infrastructure Act; Bitcoin peaks ~$69k | policy |
| 2022-02 | Russia invades Ukraine | geopolitical |
| 2022-03 | Fed begins hiking (0.25 → 5.25 by 2023) | policy |
| 2022-06 | US inflation peaks at 9.1% | financial |
| 2022-08 | Inflation Reduction Act; CHIPS Act | policy |
| 2022-09 | UK gilt crisis (Truss mini-budget) | financial |
| 2022-11 | FTX collapse; ChatGPT released | financial |
| 2023-03 | Silicon Valley Bank collapse | financial |
| 2023-06 | Debt ceiling deal | political |
| 2023-10 | Israel–Hamas war begins | geopolitical |
| 2024-03 | Bank of Japan ends negative rates | policy |
| 2024-08 | Yen carry-trade unwind selloff | financial |
| 2024-09 | Fed's first cut of cycle (50 bp) | policy |
| 2024-11 | Trump elected (second term) | political |
| 2025-01 | Trump inaugurated; DeepSeek AI shock | political |
| 2025-04 | 'Liberation Day' tariffs; market plunge & 90-day pause | policy |
| 2025-05 | Moody's downgrades US credit rating | financial |
| 2025-06 | Israel–Iran 12-day war | geopolitical |
| 2025-07 | One Big Beautiful Bill Act | policy |
| 2025-09 | Fed resumes rate cuts | policy |
| 2025-10 | Longest US government shutdown (43 days) | political |
| 2026-01 | Greenland crisis strains NATO ties | geopolitical |
| 2026-02 | Supreme Court strikes down IEEPA tariffs | political |
| 2026-03 | Strait of Hormuz disruption; oil spikes | geopolitical |
| 2026-05 | US–Iran preliminary peace deal; Powell's chair term ends | geopolitical |

Extend with citations (`url`) for every event as a first task; add day-level dates where known.

### 5.3 Presidential approval (approximate Gallup quarterly averages, Q1–Q4)
```
2001: [58, 55, 72, 87]
  2002: [82, 75, 68, 65]
  2003: [60, 66, 56, 54]
  2004: [51, 48, 49, 51]
  2005: [52, 47, 42, 39]
  2006: [40, 36, 38, 36]
  2007: [35, 33, 32, 33]
  2008: [31, 29, 30, 28]
  2009: [63, 62, 53, 51]
  2010: [49, 47, 45, 45]
  2011: [47, 45, 41, 43]
  2012: [46, 47, 48, 51]
  2013: [51, 48, 44, 42]
  2014: [42, 43, 42, 42]
  2015: [46, 46, 46, 46]
  2016: [49, 51, 52, 55]
  2017: [41, 39, 37, 37]
  2018: [39, 40, 41, 40]
  2019: [41, 42, 41, 42]
  2020: [45, 42, 42, 41]
  2021: [56, 54, 46, 42]
  2022: [41, 40, 41, 41]
  2023: [40, 40, 40, 38]
  2024: [40, 39, 40, 39]
  2025: [45, 41, 39, 38]
  2026: [38, 37, 37, None]
```
`null` = not yet available. Replace with a real quarterly table from Gallup's published presidential approval center when convenient; keep the "approx." label until every value is sourced.

### 5.4 Presidential terms (`approval.yaml → terms`)
```
2000-01 → 2001-01: Clinton (D)
  2001-01 → 2009-01: Bush (R)
  2009-01 → 2017-01: Obama (D)
  2017-01 → 2021-01: Trump (R)
  2021-01 → 2025-01: Biden (D)
  2025-01 → 2029-01: Trump (R)
```
Shading tokens: Democrat `rgba(31,95,191,.08)`, Republican `rgba(209,73,91,.08)` (dark theme: `.12` alpha with lighter hues).

### 5.5 Recession shading
From FRED `USREC` (1 = recession month). Shade contiguous runs. Do not hand-enter.

---

## 6. Front-end specification

Vanilla JS (ES2020), Chart.js **4.4.x** UMD from `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js`, fonts from Google Fonts (`Newsreader` for the title, `IBM Plex Sans` for everything else, with system fallbacks). No other dependencies, no build tooling for the front end.

### 6.1 Layout
```
┌─────────────────────────────────────────────────────────────┐
│ Title + subtitle                    [Dark/light] [Copy CSV] │
├─────────────────────────────────────────────────────────────┤
│ Presets (chips)                                             │
├────────────┬────────────────────────────────────────────────┤
│ Series     │ Main chart card: controls · chart · legend     │
│ picker     ├────────────────────────────────────────────────┤
│ (sticky    │ Events card: category chips · event list       │
│ rail,      ├───────────────────────┬────────────────────────┤
│ grouped,   │ Correlation matrix    │ Pairwise scatter + lag │
│ searchable)├───────────────────────┴────────────────────────┤
│            │ Snapshot table                                 │
│            ├────────────────────────────────────────────────┤
│            │ Footer: sources, caveats, build date           │
└────────────┴────────────────────────────────────────────────┘
```
- ≥ 900 px: two-column grid, 280 px rail sticky with its own scroll.
- < 900 px: single column; the rail becomes a bottom sheet opened by a fixed "Choose series" button; chart height 340 px; matrix/scatter stack.
- Left-aligned throughout. One accent for controls; series colors are a fixed 8-color palette: `#1F5FBF #D1495B #E09F3E #2E8B57 #7B4FB8 #0FA3B1 #B5651D #5C6B7A`.

### 6.2 State
```js
S = { sel: [key...] (ordered, max 8), mode: 'rebase'|'z'|'raw'|'log'|'yoy',
      i0, i1 (month indices, i1 − i0 ≥ 6), evcats: Set<cat>, hi: eventIndex|null,
      basis: 'chg'|'lvl', sx, sy (scatter pair keys), lag: −24..24, theme }
```
Persist `theme` and (new) the full state to `localStorage` under `atlas-*` keys, wrapped in try/catch; also encode state in the URL hash (`#sel=spx,unrate&mode=z&from=2019-06&to=2022-06`) so views are shareable. Hash wins over localStorage on load.

### 6.3 Controls
- **Scale mode** (select):
  - `rebase`: `x[t] / x[first non-null in range] × 100`. Y title "Index (range start = 100)".
  - `z`: `(x − mean) / sd` over the visible range (population sd). Y title "Standard deviations"; draw the zero gridline in ink color.
  - `raw`: left axis = unit of first selected series; series with any other unit go to a right axis. Right-axis title = that unit if all "other" series share it, else "other series (mixed units)".
  - `log`: as raw with logarithmic axes.
  - `yoy`: `(x[t] / x[t−12] − 1) × 100` computed on the fly for any series.
- **From / To** month selects; enforce ≥ 6 months apart by nudging the other bound.
- **Toggles:** Recessions (default on), Presidential terms (default off), Event lines (default on).
- **Presets** (chips) set `sel`, `mode`, `from`, `to`, then scroll to the chart:

| Preset | series | mode | range |
|---|---|---|---|
| COVID shock | spx, unrate, wti, umcsent, m2 | rebase | 2019-06 → 2022-06 |
| Financial crisis 2008 | spx, caseshiller, unrate, fedfunds, vix | rebase | 2006-01 → 2012-12 |
| Inflation surge 2021–24 | cpi_yoy, fedfunds, gas, wages_yoy, umcsent | raw | 2020-01 → last |
| Oil, gas & the pump | wti, brent, gas, natgas | raw | 2000-01 → last |
| Housing | caseshiller, mortgage, houst, medhome | rebase | 2000-01 → last |
| US vs Europe jobs | unrate, ez_unemp, de_unemp, uk_unemp, jp_unemp | raw | 2000-01 → last |
| World stock markets | spx, dax, nikkei, shanghai, sensex, ftse | rebase | 2000-01 → last |
| Politics & sentiment | approval, umcsent, usepu, spx | z | 2000-01 → last |
| Rates & yield curve | fedfunds, gs2, gs10, t10y2y, mortgage | raw | 2000-01 → last |
| 2026 oil shock | wti, gas, cpi_yoy, spx, vix | z | 2025-06 → last |

Default view on first load: `spx, unrate, wti, cpi_yoy`, mode `z`, full range.

### 6.4 Main chart
- Chart.js line chart, `animation:false`, `interaction: {mode:'index', intersect:false}`, `pointRadius:0`, `borderWidth:1.8`, `tension:0.15`, `spanGaps:true`, legend disabled (custom legend below with a × to remove each series).
- X ticks: category axis over visible months, `autoSkip:false`, custom callback:
  - span ≤ 30 months: label every 3rd month "Mon YYYY";
  - ≤ 72: label Jan and Jul;
  - else: label January only, every 1 / 2 / 3 years for spans ≤ 150 / ≤ 240 / > 240 months.
- Tooltip: title = month; one line per series showing the **raw** value with unit and, when a transform is active, the transformed value in parentheses; footer lists events in that month (filtered by active categories).
- **Background plugin** (`beforeDatasetsDraw`), in this order: presidential-term bands with the president's name (only if band ≥ 44 px wide) → recession bands → event markers.
- **Event markers:** span ≤ 132 months: full-height dashed vertical lines at 45 % alpha; wider spans: 10 px solid ticks along the bottom edge (avoids clutter). The highlighted event (`S.hi`) is always a full solid 2 px line with a labeled flag at the top, flipped left if it would overflow the chart area.
- Empty state: "Pick a series from the list to start plotting."

### 6.5 Series picker
- Grouped by category in `<details>` (first group open), each row = checkbox · name · right-aligned unit (or "to YYYY" if the series ends more than 18 months before the last month).
- Search box filters rows across groups and auto-opens groups with matches.
- Cap at 8 selected: block the 9th with an inline message (not `alert()` — replace the prototype's alert with a small toast).
- "Clear all" and (mobile) "Done".

### 6.6 Events card
- Category chips toggle drawing/listing per category.
- List of events within the visible range (date, dot, title, optional citation link). Clicking toggles highlight; highlighted row and chart line stay in sync.

### 6.7 Correlation matrix
- Requires ≥ 2 selected series. Basis select: **monthly % changes** (default) or **levels**.
- Monthly change basis: `(x[t]/x[t−1] − 1) × 100` on observed values only; treat consecutive equal values as a true 0 % change only for genuinely monthly series (never for forward-filled quarterly/annual data).
- Pearson r over months in the visible range where both series are non-null; require n ≥ 8, else show "·".
- Cell color: blue for positive, red for negative, alpha `0.08 + 0.82·|r|`; white text when |r| > 0.5. Clicking a cell sets the scatter pair.
- Add (new): a "significance" hint — show `p < 0.05` marker using t = r·√((n−2)/(1−r²)) with a normal approximation.

### 6.8 Pairwise scatter
- X/Y selects (only from selected series), lag slider −24..+24 months where positive lag means X leads Y (`pair x[t] with y[t+lag]`).
- Subtitle states pair, basis, and range. Below the chart: `r`, `r²`, `n`, and lag if non-zero.
- Add (new): a lag-correlation mini-chart (bar per lag from −24..24) so the user can see the peak lag without scrubbing.

### 6.9 Snapshot table
Per selected series: name, unit, value at range start, latest value in range (with its month), change (percentage points for `%`/`pp` units, else percent), range low/high with months, source + note.

### 6.10 CSV export
Copies `month,<series names…>` for the visible range to the clipboard using raw values; button text flips to "Copied" for 1.5 s. Add (new): a real download via a Blob link for browsers where clipboard is blocked.

### 6.11 Theme
CSS custom properties on `:root`, overridden under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`. Toggle button flips `data-theme`. Chart colors read tokens via `getComputedStyle` at render time so a theme flip re-renders correctly. Respect `prefers-reduced-motion` (only the bottom-sheet slide is animated anyway).

### 6.12 Accessibility & quality floor
- Keyboard-reachable controls with visible focus; labels associated with inputs; `aria-pressed` on chips.
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; safe-area padding on `:root`.
- No horizontal page scroll; tables and matrix scroll inside their own containers.
- Number formatting: ≥1e6 → "1.23M", ≥1e4 → 0 decimals, ≥100 → 1 decimal, else 2, with locale thousands separators.

---

## 7. Build step (`atlas/build.py`)
1. Load `data/atlas.json`, `events.yaml`, `approval.yaml`.
2. Expand approval quarters to months and inject as series `approval`.
3. Render `web/template.html` with Jinja2, inlining `styles.css` and `app.js`, and replacing `__DATA__`, `__EVENTS__`, `__PRES__`, `__BUILT__` (ISO date).
4. Write `dist/index.html`; assert size < 2 MB; run `node --check` on the extracted script (or `new Function(src)` via node) and fail the build on syntax errors.
5. Print a summary: series count, first/last month, events count, size.

`make serve` → `python -m http.server -d dist 8000`.

---

## 8. Data QA (`atlas/check.py`) — run in CI and before every build
- Every catalog entry produced a series; list failures.
- Staleness: `last_obs` older than `now − max_lag_months` → warning (error for market series).
- Sanity ranges (per key, in catalog as `range: [lo, hi]`): e.g. `unrate` 2–16, `fedfunds` 0–7, `wti` −40–160, `gas` 0.8–6, `cpi_yoy` −3–10, `approval` 20–95. Values outside → error.
- No duplicate months; months strictly increasing; no NaN.
- Derived y/y spot checks: `cpi_yoy` at `2022-06` ≈ 9.0 ± 0.3; `spx` at `2009-02`/`2009-03` in 700–850.
- Event months all lie within `[first_month, last_month]`; categories valid.

---

## 9. Tests
- `test_transform.py`: monthly mean vs last aggregation; y/y math; forward-fill stop rules; rounding.
- `test_stats.py`: Pearson on known vectors (r=1, r=−1, r≈0), n<8 guard, lag alignment (X leads Y), z-score, rebase with leading nulls.
- `test_build.py`: template renders; all placeholders replaced; size limit; JS syntax check.
- Optional smoke test with Playwright (already used for the prototype): load `dist/index.html` in headless Chromium at 1300×900 and 390×844, assert zero page errors, 96+ picker rows, matrix cells present, click a preset and an event, toggle theme, screenshot both viewports to `tests/snapshots/`.

---

## 10. Extensions (prioritized backlog)
1. **Citations** for every event (`url`), rendered as small links in the event list.
2. **Replace truncated OECD series** with direct sources: Eurostat (`une_rt_m`, `prc_hicp_midx`), ONS (CPI `D7BT`), e-Stat (Japan CPI), NBS China. Add a generic `csv_url` source type with a column mapper.
3. **More political data:** election results (presidential/House/Senate margins by cycle), "right direction / wrong track" (RealClearPolling average), congressional approval, Gallup economic confidence, Fed chair and Treasury secretary tenure bands, government shutdown bands, party control of Congress bands.
4. **More global data:** Baltic Dry Index, global PMI (S&P Global, if licensing allows), MSCI ACWI proxy (`ACWI` ETF from 2008), emerging markets (`EEM`), Brazil/Mexico/Turkey rates and FX, ECB balance sheet, Bank of Japan rate, gold in EUR, global food price index (FAO CSV), freight and container rates.
5. **Sector and factor indices:** S&P sector ETFs (XLE, XLF, XLK…), Nasdaq-100, semiconductors (SOX), treasury total return proxies (TLT), high-yield spreads (FRED `BAMLH0A0HYM2`), TED/SOFR spreads.
6. **Inequality and social series:** Gini (FRED `SIPOVGINIUSA`), real median wages, union membership, labor share, drug overdose deaths (CDC), life expectancy, births.
7. **Analysis features:** rolling correlation (24/36-month window) line for the scatter pair; drawdown mode; annotate max/min; compare two ranges side by side ("2008 vs 2020").
8. **Export:** PNG of the chart (Chart.js `toBase64Image`), full-dataset CSV/Parquet download, permalink.
9. **CI:** GitHub Actions workflow that runs `fetch → check → build → test` weekly and commits `data/atlas.json` + `dist/index.html`; publish `dist/` to GitHub Pages.

---

## 11. Acceptance criteria for v1
- `make build` from a clean checkout completes in < 5 minutes with network, produces `dist/index.html` < 2 MB, and `make test` passes.
- Opening `dist/index.html` from the filesystem shows the default view with four series, recession shading, and event ticks; no console errors.
- All ten presets render; switching all five modes works with 1, 2, and 8 series; raw mode assigns axes by unit.
- Correlation matrix and scatter agree (same r for the same pair at lag 0); changing basis changes both.
- Mobile viewport (390 px): no horizontal scroll, bottom sheet opens and closes, chart readable.
- `check` reports zero errors; warnings only for known truncated OECD series.

---

## 12. Suggested Claude Code kickoff prompt
> Read SPEC.md end to end. Scaffold the repo in section 2, implement the pipeline (sections 3–5) with the exact catalog and events, then port the front end (section 6) from the prototype `macro-atlas.html` into `web/` files. Run `make fetch build check test`, fix anything red, and take Playwright screenshots at desktop and mobile widths. Work through section 10 in order only after v1 acceptance criteria (section 11) pass.

Attach the prototype file `macro-atlas.html` alongside this spec so the front-end port starts from working code.
