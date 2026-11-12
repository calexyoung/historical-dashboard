# v1 overlap: does each Series from its Origin say what v1 said?

M13's third acceptance item: each Series read from BLS, Treasury Fiscal Data and the Federal
Reserve Board "matches v1's value for the overlap within a stated tolerance or the difference
is explained". The statement of tolerances and explanations is `checks/v1-overlap.json`; the
check is `scripts/v1-overlap.mjs`; this page is what the check found when it was run.

**No figure from an agency is on this page or in the repository.** The run below fetched the
14 endpoints into a temporary directory under a register signed only there, compared, and
deleted the store. The table holds counts and differences. No register row is signed (D2), so
the committed capture fixtures are still invented values, and a committed fixture of real
bytes waits for Alex.

## The run of 2026-11-11

- Captured live at 02:11 UTC on 12 November 2026 (the evening of the 11th in New York): 14 of
  14 endpoints whole, 20 requests, 37 seconds.
- Replayed into a vintage store and released with `atlas release --profile public` into a
  temporary root: 38 Series, none withheld, every check of the release writer passed,
  including the spot value `cpi_yoy` 2022-06 (9.06 against the published 9.1, within 0.05).
- v1's side: `atlas legacy-release` of v1's committed output, generated the same day.
- Result: 33 Series match, 1 is different by design, 4 have no v1 counterpart. Exit status 0.

Differences are in v1's unit. "Tolerance" is half a unit of the last decimal v1 kept (two
decimals for a figure in percent, three otherwise) unless the statement says more. The month
in progress, which the engine marks partial, is not compared.

{table}

## What the differences are

- **Exactly equal (largest difference 0).** The BLS series, the federal funds rate, M2,
  consumer credit, the delinquency rate, and the Fed's total assets: the Origin prints no more
  decimals than v1 kept, and FRED had passed the figures on unchanged.
- **Half a unit of v1's last decimal.** The Treasury yields, the exchange rates, the dollar
  index and industrial production: the Origin prints more decimals (or, for daily series,
  the engine's monthly mean has more) than v1's rounded figure. Nothing is further off than
  rounding in any of 322 months.
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
- **`t10y2y`** and the four year-over-year series are computed by the engine from the stored
  Series and agree with v1's (which were FRED's spread and v1's own arithmetic) to rounding.

## One difference of representation: weeks

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

## Three things the live run found that the fixtures now carry

- The Board's download program answers the H.10 daily rates package with an empty body when
  asked for its whole history, and the first time it is asked for a file it has not built. The
  endpoint asks in three spans, and an empty answer is asked for again.
- BLS answers "No Data Available for Series ... Year: ..." for a year with no figure yet. Each
  January that is the current year. The adapter accepts exactly that message, of the last year
  asked about, and no other.
- v1's ranges for the federal funds rate, the two Treasury yields and the yen were for the
  years since 2000. The Board's files go back to 1954, 1962, 1976 and 1971, and the release
  writer refused them until the Catalog's ranges were widened.

## Running it again

```
make v2-legacy-release                                  # v1's values into var/local
node scripts/v1-overlap.mjs --native ROOT --legacy var/local
```

`ROOT` is a release root that `atlas release` built from a capture store, which needs the
three rows signed for `store`. The comparison is of figures fetched within days of each other:
after an Origin revises (a payroll benchmark, a seasonal-factor revision) v1's frozen figures
will differ, and that is not a fault of either.
