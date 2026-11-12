# v1 overlap: does each Series from its Origin say what v1 said?

M13's third acceptance item: each Series read from BLS, Treasury Fiscal Data and the Federal
Reserve Board "matches v1's value for the overlap within a stated tolerance or the difference
is explained". M16 extends it to every series of v1's that is live (`docs/v2/v1-coverage.md`):
"the comparison table is attached with every difference explained". The statement of
tolerances and explanations is `checks/v1-overlap.json`; the check is `scripts/v1-overlap.mjs`;
this page is what the check found when it was run.

**No figure fetched from an agency is on this page or in the repository.** The run below fetched the
30 endpoints into a temporary directory under a register signed only there, compared, and
deleted the store. The table holds counts and differences. No register row is signed (D2), so
the committed capture fixtures are still invented values, and a committed fixture of real
bytes waits for Alex. The register used for the run was a scratch copy marked as test data; it
is not a decision and was deleted with the store.

## The run of 2026-11-12

- Captured live at 05:07 UTC on 12 November 2026 (just after midnight in New York): 30 of 30
  endpoints whole, 36 requests, two minutes. The BEA's and the EIA's keys were in the
  environment of that one process; a search of everything the run kept found neither.
- Replayed into a vintage store and released with `atlas release --profile public` into a
  temporary root: 113 Series, none withheld, every check of the release writer passed,
  including the spot value `cpi_yoy` 2022-06 (within 0.05 of the published 9.1). One check
  warned and did not fail: five IMF Series have a value with more digits than a double holds.
- v1's side: `atlas legacy-release` of v1's committed output, generated the same day, into the
  same temporary directory.
- Result: of v1's 51 live series, 50 match and 1 is different by design. Seven more rows are
  Series v1 never had. Exit status 0.

Differences are in v1's unit. "Tolerance" is half a unit of the last decimal v1 kept (two
decimals for a figure in percent, three otherwise) unless the statement says more. The month
in progress, which the engine marks partial, is not compared. "Explained by name" counts
Periods further off than the tolerance that the statement explains one by one.

| Series | Periods compared | Largest difference | At | Tolerance | Beyond it | Explained by name | One side only | Verdict |
|---|---|---|---|---|---|---|---|---|
| `cpi` | 321 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `unrate` | 321 | 0 | — | 0.005 | 0 | 0 | 0 | matches |
| `payems` | 322 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `civpart` | 321 | 0 | — | 0.005 | 0 | 0 | 0 | matches |
| `corecpi` | 321 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `rent_cpi` | 321 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `wages` | 322 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `eggs` | 321 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `labor_share` | 107 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `real_wages` | 106 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `debt` | 106 | 3.53 | 2013-Q3 | 5 | 0 | 7 | 0 | matches |
| `gs10` | 322 | 0.00500 | 2005-11 | 0.005 | 0 | 0 | 0 | matches |
| `gs2` | 322 | 0.00500 | 2020-06 | 0.005 | 0 | 0 | 0 | matches |
| `fedfunds` | 322 | 0 | — | 0.005 | 0 | 0 | 0 | matches |
| `eurusd` | 322 | 0.000500 | 2011-07 | 0.0005 | 0 | 0 | 0 | matches |
| `gbpusd` | 322 | 0.000500 | 2001-05 | 0.0005 | 0 | 0 | 0 | matches |
| `brl` | 322 | 0.000500 | 2000-02 | 0.0005 | 0 | 0 | 0 | matches |
| `cad` | 322 | 0.000500 | 2011-09 | 0.0005 | 0 | 0 | 0 | matches |
| `cny` | 322 | 0.000500 | 2015-10 | 0.0005 | 0 | 0 | 0 | matches |
| `inr` | 322 | 0.000500 | 2012-01 | 0.0005 | 0 | 0 | 0 | matches |
| `jpy` | 322 | 0.000500 | 2016-02 | 0.0005 | 0 | 0 | 0 | matches |
| `mxn` | 322 | 0.000500 | 2001-05 | 0.0005 | 0 | 0 | 0 | matches |
| `usd_broad` | 250 | 0.000500 | 2012-02 | 0.0005 | 0 | 0 | 0 | matches |
| `fedassets` | 288 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `m2` | 321 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `credit` | 321 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `indpro` | 321 | 0.000500 | 2000-12 | 0.0005 | 0 | 0 | 0 | matches |
| `delinq` | 106 | 0 | — | 0.005 | 0 | 0 | 0 | matches |
| `cpi_yoy` | 320 | 0.261 | 2009-05 | 0.5 | 0 | 0 | 0 | different by design |
| `corecpi_yoy` | 320 | 0.00500 | 2022-10 | 0.005 | 0 | 0 | 0 | matches |
| `rent_yoy` | 320 | 0.00498 | 2009-04 | 0.005 | 0 | 0 | 0 | matches |
| `wages_yoy` | 322 | 0.00499 | 2007-12 | 0.005 | 0 | 0 | 0 | matches |
| `m2_yoy` | 321 | 0.00499 | 2017-07 | 0.005 | 0 | 0 | 0 | matches |
| `t10y2y` | 322 | 0.00500 | 2015-06 | 0.005 | 0 | 0 | 0 | matches |
| `jp_cpi` | 258 | 0.0715 | 2007-10 | 0.08 | 0 | 0 | 0 | matches |
| `cn_cpi` | 322 | 0.00452 | 2026-06 | 0.005 | 0 | 0 | 0 | matches |
| `tryusd` | 321 | 0.275 | 2023-06 | 0.0005 + 3.5% | 0 | 0 | 0 | matches |
| `jp_infl` | 258 | 0.134 | 2008-10 | 0.14 | 0 | 0 | 0 | matches |
| `cn_infl` | 322 | 0.00501 | 2022-06 | 0.006 | 0 | 0 | 0 | matches |
| `gdp` | 107 | 3.64e-12 | 2007-Q2 | 0.0005 | 0 | 0 | 0 | matches |
| `gdp_qoq` | 107 | 0 | — | 0.005 | 0 | 0 | 0 | matches |
| `gdp_yoy` | 107 | 0.00498 | 2016-Q1 | 0.005 | 0 | 0 | 0 | matches |
| `profits` | 106 | 4.55e-13 | 2021-Q4 | 0.0005 | 0 | 0 | 0 | matches |
| `saving` | 321 | 0 | — | 0.005 | 0 | 0 | 0 | matches |
| `brent` | 322 | 0 | — | 0.0005 | 0 | 1 | 0 | matches |
| `wti` | 322 | 0 | — | 0.0005 | 0 | 1 | 0 | matches |
| `natgas` | 322 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `gas` | 323 | 0.000500 | 2009-07 | 0.0005 | 0 | 0 | 0 | matches |
| `retail` | 321 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `houst` | 321 | 0 | — | 0.0005 | 0 | 0 | 0 | matches |
| `trade` | 321 | 1.00 | 2001-01 | 1 | 0 | 12 | 0 | matches |
| `cpi_nsa` | — | — | — | — | — | — | — | no v1 counterpart |
| `receipts` | — | — | — | — | — | — | — | no v1 counterpart |
| `outlays` | — | — | — | — | — | — | — | no v1 counterpart |
| `net_worth` | — | — | — | — | — | — | — | no v1 counterpart |
| `construction_total` | — | — | — | — | — | — | — | no v1 counterpart |
| `construction_private` | — | — | — | — | — | — | — | no v1 counterpart |
| `construction_public` | — | — | — | — | — | — | — | no v1 counterpart |

## What the differences are

- **Exactly equal (largest difference 0).** The BLS series, the federal funds rate, M2,
  consumer credit, the delinquency rate, the Fed's total assets; the BEA's growth rate and
  saving rate; the Henry Hub price; retail sales and housing starts: the Origin prints no more
  decimals than v1 kept, and FRED had passed the figures on unchanged. Real GDP and corporate
  profits are equal too, once the Bureau's millions are divided by a thousand (the difference
  shown is a double's last bits).
- **Half a unit of v1's last decimal.** The Treasury yields, the exchange rates, the dollar
  index, industrial production and the weekly gasoline price: the Origin prints more decimals
  (or, for daily and weekly series, the engine's monthly mean has more) than v1's rounded
  figure. Nothing is further off than rounding.
- **`debt`.** v1 took FRED's quarterly series in millions; the Catalog now takes Debt to the
  Penny, each business day, in dollars. The last business day of each quarter agrees with v1
  to within $1 million in 93 of 106 quarters and to within $3.6 million in 99. Seven quarters
  are further off and are explained one by one in the statement. Two are large: v1's figure
  for 2020-Q1 is the total of 31 January 2020 and its figure for 2013-Q4 is the total of 31
  October 2013, so v1 understated those two quarter-ends by about $463 billion and $196
  billion. The Treasury's own daily table is the better record. The other five (from $11.5
  million to $24.4 billion, at most 0.16 percent) match no nearby day and were not traced
  further.
- **`cpi_yoy`.** Another quantity by a recorded decision (ADR 0025): the twelve-month change
  of the unadjusted index, not of the seasonally adjusted one. The two have been within 0.27
  of a percentage point of each other since 2000.
- **`t10y2y`** and the year-over-year series are computed by the engine from the stored
  Series and agree with v1's (which were FRED's spread and v1's own arithmetic) to rounding.
- **`trade`** (M16). v1 took the monthly balance on goods and services from FRED; here it is
  the Census Bureau's own flat file of the FT-900 release. 259 of 321 months are equal. In 50
  months, all before 2017, the two differ by exactly $1 million: the balance is exports less
  imports, each rounded to a million, and can be rounded once or twice. The twelve months of
  2000 differ by $143 million to $1.16 billion, at most 4 percent of a month's balance, and by
  $4 million over the year: the year's total is the same and its division among the months is
  not, as after a revision of seasonal factors that one of the two carries and the other does
  not. Which is the later was not traced. The file gives the balance from January 1996.
- **`brent` and `wti`** (M15's Series, compared here). 321 of 322 months equal the
  Administration's monthly average. For August 2021 v1's figure is $0.14 (Brent) and $0.03
  (WTI) higher. A daily price revised after FRED took the month would do it; not traced
  further.
- **`jp_cpi` and `cn_cpi`** (M14's). The same indexes on another base: v1's (the OECD's) are
  on 2015 = 100 and the Fund's on 2020 = 100. China's is 1.1155 times the Fund's throughout,
  to the rounding of that factor. Japan's are each printed to one decimal on their own base,
  so the ratio runs from 1.0173 to 1.0186 over the 258 months both hold (v1's series ends in
  June 2021); after a factor of 1.018 the two are within 0.08 of an index point. Their
  twelve-month changes, `cn_infl` and `jp_infl`, are within 0.006 and 0.14 of a percentage
  point: the second is what rounding an index to one decimal does to a change over a year.
- **`tryusd`** (M14's). The month's average rate from another compiler: v1 read the OECD's
  through FRED, this is the Fund's. In 95 percent of months the two are within half a percent;
  in months of sharp moves (2006, 2018, 2021, 2023) up to 3.5 percent apart. The statement
  allows 3.5 percent of v1's figure and says why.

## Two differences of representation: weeks

`fedassets` is the Wednesday level of each week. A weekly Observation is named for the ISO
week of its Wednesday (`2026-W45`), and the engine files a week under the month its last day,
a Sunday, falls in. v1 averaged the Wednesday levels dated in each month. So the engine's
monthly mean of `fedassets` is not v1's in any month whose last Wednesday's week runs into
the next month: filed the engine's way, 263 of 286 months differ from v1, by up to $92
billion (March 2020, when the balance sheet grew by hundreds of billions a week). Filed by
their Wednesdays, as the comparison above does for this Series alone, all 288 months equal
v1's exactly. The weekly values are the same either way; what differs is which month a week
that straddles two is counted in. Whether a week should be filed by a reference day is a
question for the engine (PLAN 4.5) and is listed for Alex in the M13 report.

`gas` is the same case with a Monday: the Administration dates each weekly price on a Monday,
v1 averaged the prices dated in each month, and the comparison files the weeks by their
Mondays. Filed that way all 323 months are within v1's rounding.

## What the live runs found that the fixtures now carry

- The Board's download program answers the H.10 daily rates package with an empty body when
  asked for its whole history, and the first time it is asked for a file it has not built. The
  endpoint asks in three spans, and an empty answer is asked for again.
- BLS answers "No Data Available for Series ... Year: ..." for a year with no figure yet. Each
  January that is the current year. The adapter accepts exactly that message, of the last year
  asked about, and no other.
- v1's ranges for the federal funds rate, the two Treasury yields and the yen were for the
  years since 2000. The Board's files go back to 1954, 1962, 1976 and 1971, and the release
  writer refused them until the Catalog's ranges were widened.
- (M16) The Census Bureau's flat file for construction spending holds only unadjusted monthly
  totals; the headline rate is in a workbook, whose column headings carry their footnote
  numbers ("Total Construction1"). The flat files list every month to the end of the year and
  give no row for a month with no figure. Their sections are parted by a bare line feed
  between lines that end in CR LF.

## Running it again

```
make v2-legacy-release                                  # v1's values into var/local
node scripts/v1-overlap.mjs --native ROOT --legacy var/local
```

`ROOT` is a release root that `atlas release` built from a capture store, which needs the
rows signed for `store`. Inside the span a native Series covers, a Period v1 holds and
the native Series does not counts as a value on one side only and fails the Series; so does a
Series with fewer than 100 Periods in common. The comparison is of figures fetched within days of each other:
after an Origin revises (a payroll benchmark, a seasonal-factor revision) v1's frozen figures
will differ, and that is not a fault of either.
