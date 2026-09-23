# Macro Atlas 2000–2026

Historical dashboard of economic, political, and socioeconomic data from the past 26 years.

~125 monthly economic, market, and political series (FRED + Yahoo Finance + hand-entered approval), a curated events timeline, and a single self-contained HTML dashboard for overlaying, rebasing, and correlating them. Spec: `SPEC.md` (kept outside the repo).

```bash
make setup                      # uv venv + deps + headless Chromium
make fetch build check test     # download → dist/index.html → QA → unit tests
make smoke                      # Playwright run over dist/index.html; screenshots in tests/snapshots/
make serve                      # http://localhost:8000
```

`dist/index.html` also works straight from the filesystem (`file://`). The only external requests are the Chart.js 4.4.1 CDN script and Google Fonts.

## Layout

| Path | What |
|---|---|
| `atlas/catalog.yaml` | Series manifest: source, id, unit, aggregation, frequency, staleness lag, sanity range, derived y/y |
| `atlas/events.yaml`, `atlas/approval.yaml` | Events timeline; approval quarters and presidential terms |
| `atlas/sources.py` | FRED CSV / Yahoo chart JSON / generic `csv_url` fetchers, cached in `data/raw/`, with retries and a 429 circuit breaker |
| `atlas/transform.py` | Monthly resampling (mean, or month-end `last` for markets), y/y on observed months, rounding |
| `atlas/build.py` | Writes `data/atlas.json`, injects approval, renders `web/template.html`, runs a size check and `node --check` |
| `atlas/check.py` | QA: missing/stale series, sanity ranges, ordering, future months, spot checks, event validity |
| `web/` | `template.html`, `styles.css`, `stats.js` (pure math, tested under node), `app.js` |

## Data notes

- **Yahoo needs a browser-like TLS handshake.** Plain `requests` gets HTTP 429 (from both a home connection and GitHub's servers), so Yahoo calls go through `curl_cffi` with Chrome impersonation. `requests` stays as a fallback if `curl_cffi` isn't installed.
- **Seed fallback.** If a live fetch fails and nothing is cached, `build` uses `data/seed/<key>.json` and flags the series (`meta.seed`, plus a `check` warning). The seed holds the original 18 Yahoo series, taken from the 2026-09-20 prototype with its month labels corrected (the prototype used UTC instead of exchange time, so its non-US indices were one month early). The corrected seed matches live Yahoo data exactly.
- Series whose source ends early are kept, and the picker shows "to YYYY". Right now that is Japan CPI (OECD, ends 2021-06) and the TED spread (ends 2022-01). They are the only `check` warnings.
- Correlations on the "monthly % changes" basis use observed values only, so quarterly and annual series show "·" there. Use the levels basis for them.
- State (series, mode, range, basis, lag, pair, event filters, toggles) lives in the URL hash, so a view can be shared by its link. It is also mirrored to `localStorage`, and the hash wins when both exist.

## SPEC section 10 status (2026-09-22)

| # | Item | Status |
|---|---|---|
| 1 | Event citations | Done. All 83 events have a `url` (every one returned HTTP 200 on 2026-09-22); 76 have a `day`. |
| 2 | Replace truncated OECD series | Done: euro-area unemployment → Eurostat `une_rt_m`, UK CPI → ONS `D7BT`, China CPI → OECD SDMX. Each keeps its old FRED ID as a `fallback`. Generic `csv_url` source added. **Open:** Japan CPI. e-Stat needs an app ID and OECD also stops at 2021-06. |
| 3 | Political data | Done: presidential and House popular-vote margins; bands for presidential terms, House/Senate control, Fed chair, Treasury secretary, and shutdowns (`atlas/politics.yaml`). **Not done:** right direction/wrong track (RCP can't be scraped and has no licence to reuse), congressional approval, and Gallup economic confidence (no free machine-readable source). |
| 4 | Global data | Done: ECB balance sheet; Japan, Brazil, Mexico, and Turkey short rates; BRL/MXN/TRY; broad dollar index; IMF food index (in place of FAO); gold in euros. ACWI (from 2008) and EEM (from 2003). **Not done:** Baltic Dry, global PMI, freight rates (no free source). |
| 5 | Sector/factor | Done: Nasdaq-100, high-yield OAS (FRED keeps only 3 years), SOFR, TED (ends 2022). XLE, XLF, XLK, SOX, and TLT (from 2002). |
| 6 | Inequality/social | Done: Gini, real median weekly earnings, labor share, life expectancy, birth rate. **Not done:** union membership (BLS blocks scripted clients), overdose deaths (CDC). |
| 7 | Analysis | Done: rolling 24/36-month correlation, drawdown mode, max/min annotations, two-range comparison with a "2008 vs 2020" preset. |
| 8 | Export | Done: chart PNG, all-data CSV, copy link. **Not done:** Parquet (would need a library the page isn't allowed to load). |
| 9 | CI | `.github/workflows/refresh.yml` runs weekly: fetch → build → check → test → smoke, then commits data and deploys `dist/` to GitHub Pages. |

