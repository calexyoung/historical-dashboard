<!-- GENERATED from schema/rights-register.json by scripts/gen-rights.mjs. Do not edit. -->

# Rights register

Version `2026-11-11.draft-4`. 0 of 30 rows signed. Intermediary Channels cleared: none.

One row per Origin and per intermediary Channel: the terms that were read, the sentences that
matter quoted, a proposal, and Alex's decision (CONTEXT.md, Rights register; PLAN 6 and 6.1;
ADR 0006, ADR 0020). The builder proposes. Only Alex decides, and no decision below was filled
in by the builder.

This page is generated from `schema/rights-register.json`, which is the one table the rights
gate reads in Python and in TypeScript. Edit the table, never this page.

## What a row decides

A decision says yes or no to four things:

- **display**: show the values on a public page.
- **redistribute**: offer them as a download or through the API.
- **store**: keep what the source serves in the capture store.
- **ML use**: describe them as usable for model training.

On the local Surface the gate allows everything (PLAN 6.1, point 3). On staging and production
it allows a value only when all of these hold, and the most restrictive answer wins across
every input of a derived Series:

1. The value is not in the legacy representation. v1's data is refused whatever a row says.
2. Its Origin and dataset have a row, the row is signed, and the decision says yes.
3. If it came through an intermediary Channel (anything but `direct`, or Macro Atlas's own
   computing, hand entry and fixture), that Channel has a row, the row is signed and says yes,
   and the Channel is listed in `cleared_intermediaries` with a dated amendment to ADR 0006.

An Origin, dataset or Channel with no row is unknown, and unknown is refused.

## How Alex signs a row

1. Open the terms link in the row and read it. Rows marked "through a tool that returns short
   extracts" and "not read" need this most.
2. In `schema/rights-register.json`, replace the row's `"decision": null` with, for example,
   `"decision": { "display": true, "redistribute": true, "store": true, "ml_use": false,
   "signed_by": "Alex", "signed_on": "2026-11-20" }`, and change `version` at the top.
3. Add the row's id to `SIGNED_BY_ALEX` in `tests/v2/test_rights_register.py`.
4. Run `npm run gen` and `make v2-check`, and commit. `python -m atlas rights` lists what is
   signed.

Clearing an intermediary Channel (FRED, ALFRED, Yahoo) takes two more things: a section in
`docs/adr/0006-rights-gate-allowlist-releases.md` headed
`## Amendment YYYY-MM-DD: the <channel> channel is cleared (approved by Alex)`, and an entry
with that date in `cleared_intermediaries`.

## Summary

| Row | Kind | Licence class | Terms read | Proposed | Decision |
|---|---|---|---|---|---|
| `bls` Bureau of Labor Statistics | origin | public domain | in part | all four | not decided |
| `bea` Bureau of Economic Analysis | origin | public domain | yes | all four | not decided |
| `census` Census Bureau | origin | public domain | yes | all four | not decided |
| `treasury-fiscal-data` Treasury Fiscal Data | origin | public domain | yes | all four | not decided |
| `fed-board` Federal Reserve Board | origin | public domain | yes | all four | not decided |
| `eia` Energy Information Administration | origin | public domain | yes | all four | not decided |
| `fred` FRED (Federal Reserve Bank of St. Louis), as a channel | channel | permission required | in part | nothing | not decided |
| `alfred` ALFRED (Federal Reserve Bank of St. Louis), as a channel | channel | unknown | no | nothing | not decided |
| `yahoo` Yahoo Finance, as a channel | channel | permission required | yes | nothing | not decided |
| `philadelphia-fed` Federal Reserve Bank of Philadelphia, Real-Time Data Set | origin | unknown | no | nothing | not decided |
| `imf` International Monetary Fund | origin | citation required | in part | display, redistribute, store | not decided |
| `oecd` OECD | origin | unknown | no | nothing | not decided |
| `world-bank` World Bank | origin | CC BY | in part | all four | not decided |
| `bis` Bank for International Settlements | origin | citation required | yes | all four | not decided |
| `eurostat` Eurostat | origin | citation required | in part | all four | not decided |
| `e-stat` e-Stat, Portal Site of Official Statistics of Japan | origin | citation required | yes | all four | not decided |
| `bts` Bureau of Transportation Statistics | origin | unknown | no | nothing | not decided |
| `usaspending` USAspending | origin | public domain | in part | all four | not decided |
| `openfema` OpenFEMA | origin | citation required | in part | all four | not decided |
| `cdc-nchs` CDC, National Center for Health Statistics | origin | public domain | in part | all four | not decided |
| `noaa-ncei` NOAA National Centers for Environmental Information | origin | public domain | yes | all four | not decided |
| `owid` Our World in Data | origin | CC BY | yes | all four | not decided |
| `em-dat` EM-DAT (CRED, UCLouvain) | origin | no redistribution | yes | nothing | not decided |
| `ntia` NTIA Internet Use Survey | origin | public domain | in part | all four | not decided |
| `national-statistics-offices` National statistics offices (placeholder) | origin | unknown | none to read | nothing | not decided |
| `gallup` Gallup (hand-entered presidential approval) | origin | unknown | no | nothing | not decided |
| `wikipedia` Wikipedia (hand-entered election results) | origin | citation required | yes | nothing | not decided |
| `public-record` Hand-entered facts from the public record | origin | public domain | none to read | all four | not decided |
| `macro-atlas-computed` Macro Atlas, computed series | origin | public domain | none to read | all four | not decided |
| `macro-atlas-fixture` Macro Atlas, synthetic fixture | origin | public domain | none to read | all four | not decided |

"In part" means at least one page was not read, or was read only as extracts.

## Rows

### Bureau of Labor Statistics

Row `bls`. CPI, payrolls, unemployment, participation, wages. v2.0 (M7, M13).

- Origin, as a Catalog entry names it: "U.S. Bureau of Labor Statistics"; all datasets.
- Licence class: public domain.
- Attribution: Source: U.S. Bureau of Labor Statistics.

Terms: <https://www.bls.gov/bls/linksite.htm> (read on 2026-11-11 through a tool that returns short extracts; check the wording against the page before signing).

> everything that we publish, both in hard copy and electronically, is in the public domain, except for previously copyrighted photographs and illustrations

> You are free to use our public domain material without specific permission

> we do ask that you cite the Bureau of Labor Statistics as the source

Terms: <https://www.bls.gov/developers/termsOfService.htm> (not read). The site refused the automated request (HTTP 403).

Capture endpoints (fetched by `atlas capture` only once this row is signed and allows store):

- `bls-headline`, the `bls` adapter, for "Consumer Price Index", "Current Population Survey", "Current Employment Statistics". CPI-U all items (not adjusted and seasonally adjusted), the unemployment rate and total nonfarm payrolls, monthly, for the thirty years ending this year: three requests without a key, ten years each.
- `bls-coverage`, the `bls` adapter, for "Consumer Price Index", "Current Population Survey", "Current Employment Statistics", "Average Price Data", "Productivity and Costs". Labor force participation, core CPI, rent of primary residence, average hourly earnings of production workers and the average price of eggs (monthly); the labor share index and real median weekly earnings (quarterly). The thirty years ending this year: three requests without a key. Every one of the seven began before 1997 (checked 2026-11-11), so no year of the window is before a series began.

Proposal: allow **all four**. Public domain by the Bureau's own statement. Cite the Bureau on every figure and download.

Open questions:

- The API terms of service and the API FAQ were not read: bls.gov refused the automated request for both (HTTP 403, 2026-11-11). Read them before signing.
- Limits without a key, as far as M7 and M13 could check them on 2026-11-11 by asking the API: a request for more than ten years is cut to ten years from its start year, with a message; an unknown series is left out, with a message; a year with no figure yet (this year, each January) is answered "No Data Available for Series ... Year: ...". The capture job asks for thirty years in three requests per endpoint, accepts only that last message and only of the current year, and treats any other message as an incomplete answer. The daily limit on requests without a key is believed to be 25 and was not confirmed from the page; the job makes six requests per run, two runs a day.

Decision: **not decided**.

### Bureau of Economic Analysis

Row `bea`. GDP, PCE, income, profits, trade balance. v2.0 (M15). Needs a free API key from Alex.

- Origin, as a Catalog entry names it: "U.S. Bureau of Economic Analysis"; all datasets.
- Licence class: public domain.
- Attribution: Source: U.S. Bureau of Economic Analysis.

Terms: <https://www.bea.gov/help/guidelines-for-citing-bea> (read on 2026-11-11, from the page's own text).

> Citations are appreciated and appropriate.

Terms: <https://apps.bea.gov/API/signup/> (read on 2026-11-11, from the page's own text). The sign-up form asks for agreement to published terms of service; the terms document itself was not read.

Proposal: allow **all four**. U.S. federal works are not subject to copyright in the United States (17 U.S.C. 105). That is the basis proposed here; the pages read do not themselves state a licence. Cite the Bureau.

Open questions:

- Read the API terms of service when the key is requested, and record any required notice or request limit here before M15.

Decision: **not decided**.

### Census Bureau

Row `census`. Construction spending (C30 files), retail, housing. v2.0 top lines (M16); v2.1.

- Origin, as a Catalog entry names it: "U.S. Census Bureau"; all datasets.
- Licence class: public domain.
- Attribution: Source: U.S. Census Bureau.

Terms: <https://www.census.gov/data/developers/about/terms-of-service.html> (read on 2026-11-11, from the page's own text).

> This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.

> You may not modify or falsely represent content accessed through the API and still claim the source is the Census Bureau.

Terms: <https://www.census.gov/about/policies/citation.html> (read on 2026-11-11, from the page's own text).

> Use the suggested citation if one is provided with the publication, data, code, or tool.

Proposal: allow **all four**. U.S. federal works are not subject to copyright in the United States (17 U.S.C. 105). That is the basis proposed here; the pages read do not themselves state a licence. The plan uses published files, not the API. If the API is ever used, the API notice quoted above must be shown.

Open questions:

- The API terms forbid using the data to identify a person or business. Macro Atlas uses published aggregates only; confirm that is enough.

Decision: **not decided**.

### Treasury Fiscal Data

Row `treasury-fiscal-data`. Debt, Monthly Treasury Statement receipts and outlays. v2.0 (M13).

- Origin, as a Catalog entry names it: "U.S. Department of the Treasury, Bureau of the Fiscal Service"; all datasets.
- Licence class: public domain.
- Attribution: Source: U.S. Department of the Treasury, Fiscal Data.

Terms: <https://fiscaldata.treasury.gov/api-documentation/> (read on 2026-11-11, from the page's own text).

> The data is offered free, without restriction, and available to copy, adapt, redistribute, or otherwise use for non-commercial or commercial purposes.

Terms: <https://fiscaldata.treasury.gov/about-us/> (read on 2026-11-11, from the page's own text).

> The data on this site is available to copy, adapt, redistribute, or otherwise use for non-commercial and commercial purposes.

Capture endpoints (fetched by `atlas capture` only once this row is signed and allows store):

- `treasury-debt-to-penny`, the `treasury_fiscal_data` adapter, for "Debt to the Penny". Total public debt outstanding, daily since 1993-04-01, the whole table on each run (one page of about 2.8 MB on 2026-11-11).
- `treasury-mts-summary`, the `treasury_fiscal_data` adapter, for "Monthly Treasury Statement". Table 1 of the Monthly Treasury Statement: receipts and outlays of the U.S. Government by month, each statement listing the months of the last fiscal year and this one. The whole table on each run (3,145 rows in one page of about 1.9 MB on 2026-11-11, statements from March 2015).

Proposal: allow **all four**. Open by the Bureau's own statement, with no condition attached.

Decision: **not decided**.

### Federal Reserve Board

Row `fed-board`. H.15 rates, H.10 exchange rates, H.4.1 balance sheet, Z.1 net worth, through the Data Download Program. v2.0 (M13).

- Origin, as a Catalog entry names it: "Board of Governors of the Federal Reserve System"; all datasets.
- Licence class: public domain.
- Attribution: Source: Board of Governors of the Federal Reserve System.

Terms: <https://www.federalreserve.gov/disclaimer.htm> (read on 2026-11-11, from the page's own text).

> Unless otherwise indicated, information on Board's website is in the public domain and may be copied and distributed without permission.

> Please cite to the Board as the source of the information.

Capture endpoints (fetched by `atlas capture` only once this row is signed and allows store):

- `fed-h15-treasury-yields`, the `fed_board` adapter, for "H.15 Selected Interest Rates". Treasury constant-maturity yields, business daily since 1962, the Data Download Program's own H.15 package, whole history on each run (about 1 MB on 2026-11-11).
- `fed-h15-monthly`, the `fed_board` adapter, for "H.15 Selected Interest Rates". The H.15 package of monthly averages (30 series since 1934, about 115 KB on 2026-11-11), read for the federal funds effective rate.
- `fed-h10-daily-rates`, the `fed_board` adapter, for "H.10 Foreign Exchange Rates". The H.10 package of daily exchange rates (23 currencies since 1971). The whole history is about 2.6 MB and the program answers it with an empty body, so it is asked for in three spans (0.6, 0.9 and 0.8 MB on 2026-11-11).
- `fed-h10-daily-indexes`, the `fed_board` adapter, for "H.10 Foreign Exchange Rates". The H.10 package of daily dollar indexes since 2006 (about 0.2 MB on 2026-11-11), read for the nominal broad index. The program labels the unit "Index:_1997_Jan_100"; the figures are on the base January 2006 = 100 (the mean of January 2006 is 100.0).
- `fed-h41-table5`, the `fed_board` adapter, for "H.4.1 Factors Affecting Reserve Balances". Table 5 of the H.4.1 release, the consolidated statement of condition of all Federal Reserve Banks: 128 series of Wednesday levels since December 2002 (about 0.8 MB on 2026-11-11), read for total assets.
- `fed-z1-households`, the `fed_board` adapter, for "Z.1 Financial Accounts of the United States". The Z.1 package S1M.b (Q), the balance sheet of households and nonprofit organizations, quarterly since 1945 (about 0.13 MB on 2026-11-11), read for net worth.
- `fed-g17-major`, the `fed_board` adapter, for "G.17 Industrial Production and Capacity Utilization". The G.17 package of the major industrial production and capacity utilization aggregates, monthly since 1919 (about 80 KB on 2026-11-11), read for the total index.
- `fed-g19-credit`, the `fed_board` adapter, for "G.19 Consumer Credit". The G.19 package of consumer credit outstanding, seasonally adjusted, monthly since 1943 (about 75 KB on 2026-11-11), read for the total.
- `fed-h6-monthly`, the `fed_board` adapter, for "H.6 Money Stock Measures". The H.6 package of monthly money stock measures in billions, since 1959 (about 0.14 MB on 2026-11-11), read for M2, seasonally adjusted.
- `fed-chgdel-delinquency`, the `fed_board` adapter, for "Charge-Off and Delinquency Rates on Loans and Leases at Commercial Banks". The package of delinquency rates at all commercial banks, quarterly since 1985 (about 23 KB on 2026-11-11), read for credit card loans, seasonally adjusted.

Proposal: allow **all four**. Public domain by the Board's own statement, unless a release says otherwise. Cite the Board.

Open questions:

- Some releases carry data the Board marks as coming from a non-Board source. Checked in M13 (2026-11-11) for each series read under this row: the label rows of the downloaded files carry no source mark for any of them. Two things for Alex to weigh before signing: the H.15 Treasury constant-maturity yields are the U.S. Treasury's figures and the federal funds effective rate is calculated by the Federal Reserve Bank of New York, both published by the Board in H.15; the H.10 exchange rates are noon buying rates in New York collected by the Federal Reserve Bank of New York. None is a private vendor's series. The H.15 package also holds commercial paper and bank prime rates, which are captured in the file and not read into any Series.

Decision: **not decided**.

### Energy Information Administration

Row `eia`. Energy prices; generation and capacity. v2.0 headline (M15); depth in v2.1. Needs a free API key from Alex.

- Origin, as a Catalog entry names it: "U.S. Energy Information Administration"; all datasets.
- Licence class: public domain.
- Attribution: Source: U.S. Energy Information Administration (with the publication date).

Terms: <https://www.eia.gov/about/copyrights_reuse.php> (read on 2026-11-11, from the page's own text).

> U.S. government publications are in the public domain and are not subject to copyright protection.

> You may use and/or distribute any of our data, files, databases, reports, graphs, charts, and other information products

> you should use an acknowledgment, which includes the publication date

Proposal: allow **all four**. Public domain by the Administration's own statement. The acknowledgement carries the publication date.

Open questions:

- API rate limits are still unverified (PLAN 6).

Decision: **not decided**.

### FRED (Federal Reserve Bank of St. Louis), as a channel

Row `fred`. Was v1's main channel (83 entries). Not fetched, stored or shown publicly by v2 (PLAN 6, 6.1).

- Intermediary Channel: `fred`. A value that came through it needs this row, its Origin's row, and a dated amendment to ADR 0006.
- Licence class: permission required.
- Attribution: none proposed, because nothing is to be shown.

Terms: <https://fred.stlouisfed.org/legal/> (read on 2026-11-11 through a tool that returns short extracts; check the wording against the page before signing). The same page lists, among the things a user may not do: storing, caching or archiving any portion of the content; republishing or distributing it; and using it to develop or train software. Those items are paraphrased here, not quoted.

> you are free to use FRED for your own non-commercial, educational, and personal uses

> Series with a copyright notice are owned by third parties and have special restrictions.

Proposal: allow **nothing**. Do not clear. The terms as read forbid storing and republishing what FRED serves, whatever the status of the underlying series. v2 re-sources every series from its origin instead. Clearing this row would also need a dated amendment to ADR 0006.

Open questions:

- Whether to ask the Bank for written permission is D2, Alex's decision.
- v1's public site and committed data file already hold values fetched through FRED. That exposure is the separate question D4.

Decision: **not decided**.

### ALFRED (Federal Reserve Bank of St. Louis), as a channel

Row `alfred`. Would give provider vintages. Not used by v2.

- Intermediary Channel: `alfred`. A value that came through it needs this row, its Origin's row, and a dated amendment to ADR 0006.
- Licence class: unknown.
- Attribution: none proposed, because nothing is to be shown.

Terms: <https://alfred.stlouisfed.org/legal/> (not read). The request did not complete. ALFRED is served by the same Bank; its terms are assumed, not confirmed, to match FRED's.

Proposal: allow **nothing**. Do not clear. Treat as FRED until the page is read. Vintages come from v2's own capture (M7, M8) and, later, the origin agencies' archives.

Open questions:

- Read the page and record whether its terms differ from FRED's.

Decision: **not decided**.

### Yahoo Finance, as a channel

Row `yahoo`. Was v1's channel for index levels, exchange rates and commodities (25 entries). Withheld from every public surface (PLAN 6).

- Intermediary Channel: `yahoo`. A value that came through it needs this row, its Origin's row, and a dated amendment to ADR 0006.
- Licence class: permission required.
- Attribution: none proposed, because nothing is to be shown.

Terms: <https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html> (read on 2026-11-11, from the page's own text). The same terms forbid collecting data from the services by automated means without prior permission (paraphrased).

> Unless you have explicit written permission, you must not reproduce, modify, rent, lease, sell, trade, distribute, transmit, broadcast

Proposal: allow **nothing**. Do not clear. Exchange rates and interest rates are re-sourced from the Federal Reserve Board. Index levels (S&P 500, Dow, Nasdaq and others) have no free publishable source and stay withheld.

Open questions:

- The index providers (S&P Dow Jones Indices, Nasdaq and others) own the index levels whatever the channel; a publishable source would need their licence.

Decision: **not decided**.

### Federal Reserve Bank of Philadelphia, Real-Time Data Set

Row `philadelphia-fed`. Provider vintages for GDP, payrolls, unemployment, CPI. v2.1, after a spike.

- Origin, as a Catalog entry names it: "Federal Reserve Bank of Philadelphia"; all datasets.
- Licence class: unknown.
- Attribution: none proposed, because nothing is to be shown.

Terms: <https://www.philadelphiafed.org/> (not read). No terms-of-use page was found at the addresses tried (HTTP 404). The site footer reads: Copyright 2026. All rights reserved.

Proposal: allow **nothing**. No proposal to allow until terms for the data set are found and read. The footer reserves all rights, so nothing is assumed.

Open questions:

- Find the terms that apply to the Real-Time Data Set for Macroeconomists, or ask the Bank (PLAN 6: terms unclear).

Decision: **not decided**.

### International Monetary Fund

Row `imf`. Japan CPI fix; G20 CPI and exchange rates (SDMX 3.0), v2.0 (M14): two requests a run. Later WEO GDP and commodity prices, v2.2.

- Origin, as a Catalog entry names it: "International Monetary Fund"; all datasets.
- Licence class: citation required.
- Attribution: Source: International Monetary Fund.

Terms: <https://www.imf.org/en/About/copyright-and-terms> (read on 2026-11-11 through a tool that returns short extracts; check the wording against the page before signing). As summarised from the page: data may be downloaded, copied, published and distributed with attribution; commercial reuse needs permission; automated bulk downloading needs explicit permission; use to train large language models needs explicit permission.

> Distributed or reproduced Data must appear accurately with attribution to the IMF as the source.

> Users shall not infringe upon the integrity of the Data

Capture endpoints (fetched by `atlas capture` only once this row is signed and allows store):

- `imf-cpi-g20`, the `imf_sdmx` adapter, for "Consumer Price Index". The all-items consumer price index of the nineteen G20 countries, monthly, whole history in one request (about 0.6 MB on 2026-11-11). The reference period of each index is pinned as the Fund labelled it that day: a rebase keeps the capture from being whole until the pin and the Series are changed. The adapter reads a value as observed (the Fund's derivation codes O and R), an estimate (SE, SEME, SEHI) or projected (SP); on 2026-11-11 every value here was O. One value under any other code, or under none, keeps the whole answer from being whole.
- `imf-er-g20`, the `imf_sdmx` adapter, for "Exchange Rates". National currency per U.S. dollar, monthly period average, for the fifteen G20 countries outside the euro area that are not the United States, and for the euro area (the Fund's G163), whole history in one request (about 0.4 MB on 2026-11-11). The mark T sat on 39 Observations that day, at changes of exchange-rate regime and redenominations; the dataflow's structure gives it no meaning, so it is carried as a footnote and read as nothing.

Proposal: allow **display, redistribute, store**. Allow display, download and storage with attribution, for a non-commercial site. Do not describe as usable for model training: the terms as summarised reserve that.

Open questions:

- Does a daily request to the SDMX API count as automated bulk downloading, which the terms as summarised reserve? What M14 would ask for is two requests a run (35 series, about 1.1 MB, whole history each time). That is a fact about the job, not an answer: confirm with the page or with the Fund before the row is signed for storage.
- The wording was read through a tool that returns short extracts. Open the page before signing (PLAN 6: IMF reuse wording still unverified).
- The Fund republishes national figures. The CPI Observations read here are all marked 'reported official data' and the exchange rates 'raw data'; whether a national statistics office's own terms add anything for its index is not looked into.

Decision: **not decided**.

### OECD

Row `oecd`. G20 unemployment and gaps (SDMX). v2.2.

- Origin, as a Catalog entry names it: "Organisation for Economic Co-operation and Development"; all datasets.
- Licence class: unknown.
- Attribution: Source: OECD.

Terms: <https://www.oecd.org/en/about/terms-conditions.html> (not read). The site refused the automated request (HTTP 403).

Proposal: allow **nothing**. No proposal to allow until the page is read. The builder's understanding, not confirmed here, is that OECD data have been under CC BY 4.0 since July 2024; if the page says so, the proposal becomes allow with attribution.

Open questions:

- Read the terms page in a browser and record the licence and any exceptions for third-party data.

Decision: **not decided**.

### World Bank

Row `world-bank`. Annual GDP, population, trade share. v2.2.

- Origin, as a Catalog entry names it: "World Bank"; all datasets.
- Licence class: CC BY.
- Attribution: Source: World Bank (CC BY 4.0), with the indicator name and code.

Terms: <https://datacatalog.worldbank.org/public-licenses> (read on 2026-11-11 through a tool that returns short extracts; check the wording against the page before signing).

> licenses datasets under the Creative Commons Attribution 4.0 International license (CC-BY 4.0)

> is the default license for all Datasets produced by the World Bank itself

Terms: <https://www.worldbank.org/ext/en/legal/terms-conditions> (read on 2026-11-11, from the page's own text).

> Other parties may have ownership interests in some of the Materials contained on the Site.

Proposal: allow **all four**. CC BY 4.0 for data sets the Bank produces itself. Give credit and say if values were changed.

Open questions:

- Some catalogue data sets come from third parties under other licences. Each indicator added is checked on its own catalogue page before it is listed under this row.

Decision: **not decided**.

### Bank for International Settlements

Row `bis`. Policy rates for 18 G20 economies and the euro area. v2.2.

- Origin, as a Catalog entry names it: "Bank for International Settlements"; all datasets.
- Licence class: citation required.
- Attribution: Source: Bank for International Settlements.

Terms: <https://data.bis.org/help/legal> (read on 2026-11-11, from the page's own text).

> The use of the statistics is unrestricted, provided that:

> if the statistics are reproduced, the BIS must be cited in your publication or product as the source of the statistics;

> No other use is permissible.

Proposal: allow **all four**. Unrestricted with citation. Macro Atlas is free, so the condition that inclusion must not add a charge is met. The use must not suggest endorsement by the BIS.

Decision: **not decided**.

### Eurostat

Row `eurostat`. Named in the plan's register list; euro-area context for the G20 table. v2.2.

- Origin, as a Catalog entry names it: "Eurostat"; all datasets.
- Licence class: citation required.
- Attribution: Source: Eurostat.

Terms: <https://ec.europa.eu/eurostat/web/main/help/copyright-notice> (read on 2026-11-11 through a tool that returns short extracts; check the wording against the page before signing).

> for commercial or non-commercial purposes is authorised provided the source is acknowledged

> The permission granted above does not extend to any material whose copyright is identified as belonging to a third-party

Proposal: allow **all four**. Reuse is authorised with the source acknowledged. Changes to the data must be stated.

Open questions:

- Some data sets are marked as third-party or non-commercial only; each one added is checked for that mark.

Decision: **not decided**.

### e-Stat, Portal Site of Official Statistics of Japan

Row `e-stat`. Japan CPI source of record, as a cross-check. v2.0 test only.

- Origin, as a Catalog entry names it: "Statistics Bureau of Japan"; all datasets.
- Licence class: citation required.
- Attribution: Source: Portal Site of Official Statistics of Japan (https://www.e-stat.go.jp/), Consumer Price Index (Statistics Bureau of Japan).

Terms: <https://www.e-stat.go.jp/en/terms-of-use> (read on 2026-11-11, from the page's own text).

> may be freely used, copied, publicly transmitted, translated or otherwise modified on condition that the user complies with provisions 1) to 6) below. Commercial use of Content is also permitted.

> numerical data and data in Simple tables, graphs, and so forth are not subject to copyright

Proposal: allow **all four**. Free use with source citation; edited content must say that it was edited.

Open questions:

- The plan uses e-Stat only in a test in v2.0. Whether the file ID survives a rebase is still unverified (PLAN 6).

Decision: **not decided**.

### Bureau of Transportation Statistics

Row `bts`. Freight TSI, rail, trucking, annual port TEU (Socrata). v2.1.

- Origin, as a Catalog entry names it: "U.S. Bureau of Transportation Statistics"; all datasets.
- Licence class: unknown.
- Attribution: Source: U.S. Bureau of Transportation Statistics.

Terms: <https://www.bts.gov/copyright> (not read). The site refused the automated request (HTTP 403).

Proposal: allow **nothing**. No proposal to allow until the page is read. The Bureau's own series are expected to be public domain as federal work.

Open questions:

- BTS republishes series owned by others, such as the American Trucking Associations' tonnage index and the Association of American Railroads' carloads. Those need their owners' terms and may have to be withheld.
- Socrata rate limits are still unverified (PLAN 6).

Decision: **not decided**.

### USAspending

Row `usaspending`. IIJA by DEF code; CHIPS by federal account. v2.1.

- Origin, as a Catalog entry names it: "USAspending.gov (U.S. Department of the Treasury)"; all datasets.
- Licence class: public domain.
- Attribution: Source: USAspending.gov.

Terms: <https://api.usaspending.gov/> (read on 2026-11-11, from the page's own text).

> allows the public to access comprehensive U.S. government spending data

Terms: <https://www.usaspending.gov/about> (not read). The page is drawn by script and returned no text to the request.

Proposal: allow **all four**. U.S. federal works are not subject to copyright in the United States (17 U.S.C. 105). That is the basis proposed here; the pages read do not themselves state a licence.

Open questions:

- Find and record the site's own statement on reuse.
- State-level IIJA and the BEAD account are still unverified (PLAN 6).

Decision: **not decided**.

### OpenFEMA

Row `openfema`. Disaster declarations. v2.2.

- Origin, as a Catalog entry names it: "Federal Emergency Management Agency"; all datasets.
- Licence class: citation required.
- Attribution: This product uses the Federal Emergency Management Agency's OpenFEMA API, but is not endorsed by FEMA. (With the endpoint, its version and the date retrieved.)

Terms: <https://www.fema.gov/about/openfema/terms-conditions> (read on 2026-11-11 through a tool that returns short extracts; check the wording against the page before signing). As summarised from the page: cite the endpoint and its version and the date the data were retrieved; no FEMA or DHS logo or seal without written authorisation.

> This product uses the Federal Emergency Management Agency's OpenFEMA API, but is not endorsed by FEMA.

> You may not modify or falsely represent content accessed through FEMA's API and still claim the source is FEMA or FEMA.gov.

Proposal: allow **all four**. Allow, with the required statement shown wherever the data appear and in every download.

Decision: **not decided**.

### CDC, National Center for Health Statistics

Row `cdc-nchs`. Deaths. v2.2.

- Origin, as a Catalog entry names it: "CDC National Center for Health Statistics"; all datasets.
- Licence class: public domain.
- Attribution: Source: Centers for Disease Control and Prevention, National Center for Health Statistics.

Terms: <https://www.cdc.gov/other/agencymaterials.html> (read on 2026-11-11 through a tool that returns short extracts; check the wording against the page before signing).

> is in the public domain, and may be freely used or reproduced without obtaining copyright permission

> Attribution to the agency that developed the material must be provided in your use of the materials.

Terms: <https://www.cdc.gov/nchs/policy/data-user-agreement.html> (not read). The site refused the automated request (HTTP 403).

Proposal: allow **all four**. Public domain with attribution, for published aggregates.

Open questions:

- The NCHS data user agreement was not read. It is expected to forbid attempts to identify individuals; Macro Atlas uses published national and state totals only. Read it before v2.2.

Decision: **not decided**.

### NOAA National Centers for Environmental Information

Row `noaa-ncei`. Billion-dollar disasters, frozen at 2024 and shown with its end stated. v2.2.

- Origin, as a Catalog entry names it: "NOAA National Centers for Environmental Information"; all datasets.
- Licence class: public domain.
- Attribution: NOAA National Centers for Environmental Information (NCEI) U.S. Billion-Dollar Weather and Climate Disasters, DOI: 10.25921/stkw-7w73.

Terms: <https://www.ncei.noaa.gov/access/billions/> (read on 2026-11-11, from the page's own text). The quotation is the citation the page asks for. The page states no licence.

> NOAA National Centers for Environmental Information (NCEI) U.S. Billion-Dollar Weather and Climate Disasters (2025). https://www.ncei.noaa.gov/access/billions/, DOI: 10.25921/stkw-7w73

Proposal: allow **all four**. U.S. federal works are not subject to copyright in the United States (17 U.S.C. 105). That is the basis proposed here; the pages read do not themselves state a licence. Use the citation the page gives.

Open questions:

- The continuation of the series by Climate Central has no known licence and is not covered by this row.

Decision: **not decided**.

### Our World in Data

Row `owid`. COVID history. v2.2.

- Origin, as a Catalog entry names it: "Our World in Data"; all datasets.
- Licence class: CC BY.
- Attribution: Source: Our World in Data (CC BY), with the upstream provider named.

Terms: <https://ourworldindata.org/faqs> (read on 2026-11-11, from the page's own text).

> Data produced by us falls under our permissive CC BY license; you have permission to use, reproduce, and distribute it, provided that you cite us.

> Most of the data on Our World in Data comes from third-party providers (such as the WHO, UN, and World Bank) and is subject to the license terms of those providers.

Proposal: allow **all four**. Allow only for data that Our World in Data marks as produced or collated by itself. Data it passes on from another provider is that provider's, and needs that provider's row.

Open questions:

- The COVID series rest on WHO data. Decide whether the series wanted counts as collated by Our World in Data or needs a WHO row.

Decision: **not decided**.

### EM-DAT (CRED, UCLouvain)

Row `em-dat`. Disasters. Link only.

- Origin, as a Catalog entry names it: "EM-DAT, CRED / UCLouvain"; all datasets.
- Licence class: no redistribution.
- Attribution: none proposed, because nothing is to be shown.

Terms: <https://doc.emdat.be/docs/legal/terms-of-use/> (read on 2026-11-11, from the page's own text). Both quotations are items in the page's list of things users declare they will not do.

> Reproduce, copy, communicate, lend, or otherwise distribute EM-DAT or a substantial part of EM-DAT.

> Create substitute or derivative databases of EM-DAT.

Proposal: allow **nothing**. Do not clear. Link to EM-DAT; hold and show none of its values.

Decision: **not decided**.

### NTIA Internet Use Survey

Row `ntia`. Broadband adoption. v2.1.

- Origin, as a Catalog entry names it: "National Telecommunications and Information Administration"; all datasets.
- Licence class: public domain.
- Attribution: Source: NTIA Internet Use Survey.

Terms: <https://www.ntia.gov/data/explorer> (read on 2026-11-11 through a tool that returns short extracts; check the wording against the page before signing). The quotation is the source label on the page's own charts. The page states no reuse terms.

> Source: NTIA Internet Use Survey.

Terms: <https://www.ntia.gov/page/web-policies> (read on 2026-11-11, from the page's own text). Read; it says nothing about reuse of data.

Proposal: allow **all four**. U.S. federal works are not subject to copyright in the United States (17 U.S.C. 105). That is the basis proposed here; the pages read do not themselves state a licence.

Open questions:

- Find and record NTIA's own statement on reuse, if there is one.

Decision: **not decided**.

### National statistics offices (placeholder)

Row `national-statistics-offices`. G20 unemployment gaps the OECD does not fill (ONS, INDEC, Stats SA, MOSPI, BPS and others). v2.2.

- Origin, as a Catalog entry names it: "National statistics offices (not yet listed)"; all datasets.
- Licence class: unknown.
- Attribution: none proposed, because nothing is to be shown.

Terms: No office has been chosen yet, so no terms have been read. This row matches no real origin; each office gets its own row before any of its data is fetched.

Proposal: allow **nothing**. Nothing to allow. A placeholder so that the plan's source is not forgotten.

Open questions:

- Add one row per office when v2.2 chooses them.

Decision: **not decided**.

### Gallup (hand-entered presidential approval)

Row `gallup`. Presidential approval, quarterly averages, entered by hand in v1. v2.0 hand-entered files (M16).

- Origin, as a Catalog entry names it: "Gallup"; all datasets.
- Licence class: unknown.
- Attribution: none proposed, because nothing is to be shown.

Terms: <https://www.gallup.com/> (not read). No terms-of-use page was found at the addresses tried (HTTP 404).

Proposal: allow **nothing**. No proposal to allow. Gallup is a private company and its figures are its own; nothing is assumed from an unread page. Consider a source with clear terms for approval ratings, or written permission.

Open questions:

- Read Gallup's terms, or choose another source for approval ratings, before M16.

Decision: **not decided**.

### Wikipedia (hand-entered election results)

Row `wikipedia`. Election popular-vote margins, entered by hand in v1 from election infoboxes. v2.0 hand-entered files (M16).

- Origin, as a Catalog entry names it: "Wikipedia election infoboxes" or "Wikipedia"; all datasets.
- Licence class: citation required.
- Attribution: Source: Wikipedia, with the article and the date read (CC BY-SA 4.0).

Terms: <https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use> (read on 2026-11-11, from the page's own text). Text on Wikipedia is under CC BY-SA 4.0, which asks that adaptations carry the same licence.

> Reuse of content that we host is welcome, though exceptions exist for content contributed under "fair use" or similar exemptions under applicable copyright law. Any reuse must comply with the underlying license(s).

Proposal: allow **nothing**. Do not clear; re-source instead. Election results are public facts with official records (the Federal Election Commission, the Clerk of the House, the National Archives). M16 should enter them from those, each with its citation, which avoids a share-alike condition on Macro Atlas's downloads.

Open questions:

- Choose the official source for presidential and congressional results in M16 and give it its own row.

Decision: **not decided**.

### Hand-entered facts from the public record

Row `public-record`. Terms of government (who held the presidency and each chamber, and when), each entry with a citation. v2.0 hand-entered files (M16).

- Origin, as a Catalog entry names it: "Macro Atlas, from the public record"; all datasets.
- Licence class: public domain.
- Attribution: Each entry carries its own citation.

Terms: There is no single terms page: each entry cites the official record it was taken from.

Proposal: allow **all four**. Dates and office-holders are facts of public record, entered by hand with a citation each. A file that takes its figures from a private compiler does not belong under this row.

Open questions:

- M16 decides which hand-entered files qualify and names the record each one cites.

Decision: **not decided**.

### Macro Atlas, computed series

Row `macro-atlas-computed`. Derived series the engine computes (M11). The row covers the computation only: every input is asked about on its own row, and the most restrictive answer wins.

- Origin, as a Catalog entry names it: "Macro Atlas"; all datasets.
- Licence class: public domain.
- Attribution: Computed by Macro Atlas from the sources named.

Terms: Macro Atlas's own work; there are no outside terms to read.

Proposal: allow **all four**. Allow. This adds nothing to what the inputs allow and cannot widen it.

Decision: **not decided**.

### Macro Atlas, synthetic fixture

Row `macro-atlas-fixture`. The made-up release used by tests, previews and CI (fixtures/public).

- Origin, as a Catalog entry names it: "Macro Atlas fixture (synthetic)"; all datasets.
- Licence class: public domain.
- Attribution: Synthetic data, not a measurement of anything.

Terms: Macro Atlas's own synthetic numbers; there are no outside terms to read.

Proposal: allow **all four**. Allow, when a milestone needs fixture values on a public Surface in its tests (the release writer, M9). Until it is signed the fixture, like everything else, is refused by the gate on staging and production, and the site's tests of the production Surface expect that; signing this row is done together with changing those tests.

Decision: **not decided**.
