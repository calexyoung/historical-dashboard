# Capture

How Macro Atlas keeps what a source served, before anything is parsed (PLAN 4.3, 4.7 and M7;
ADR 0012, ADR 0021, ADR 0027, ADR 0029, ADR 0030). The code is `atlas/capture/`; the host kit is `deploy/capture/`.

## What a Capture is

One fetch of one Endpoint: the exact bytes, when they arrived, what was asked, what the server
said in its headers, and evidence that the answer was whole. It is kept whether or not anything
changed, because "nothing changed between these two days" is itself something an As-of answer
relies on.

A Capture says: *this is what the source served no later than this time*. It does not say when
the source first published a value. That is the difference between an Atlas-observed vintage
and a Provider vintage (CONTEXT.md).

## What a run does

1. Reads the endpoint list from the rights register (`capture` on an origin row).
2. Asks the rights gate whether each selected endpoint may be stored. If any may not, the run
   stops: nothing is fetched and the exit status is 1.
3. Locks the store. A second run started meanwhile exits at once.
4. Reports missed days: finished New York days, since the first run that selected an endpoint,
   with no whole capture of it.
5. On a live run, passes over each endpoint whose source wants an API key the run does not
   have ("API keys" below): it is not asked, and is reported stale.
6. Fetches each endpoint in turn, one request at a time, at least a second apart per host,
   retrying a 5xx, a 429 or a network error three times with a growing wait, and leaving a host
   alone for the rest of the run once two requests to it have ended in 429.
7. Writes each response body to `raw/`, then one line to `fetchlog.ndjson`.
8. Writes its finishing line to `runs.ndjson` (the starting line was written before the first
   request) and exits 0 only if every endpoint was captured whole.

Redirects are not followed: a 3xx fails the fetch.

## Whole, incomplete, failed

| Outcome | When | What is kept |
|---|---|---|
| `captured` | Every completeness check passed | Bytes, evidence |
| `incomplete` | The source answered 200 but not with the whole of what was asked | Bytes, evidence with the reasons. Never treated as the state of a Series |
| `failed` | No usable answer: a status other than 200 after retries, or no answer at all | Whatever did arrive, including an error page, and the error |
| `no_key` | The source wants an API key and the run had none, or one of the wrong shape. Nothing was asked | A log line that says which key, and nothing else. What was captured before stands |

What "whole" means per source:

- **BLS** (`bls`): the status is `REQUEST_SUCCEEDED`; every series asked for is present with
  rows; no row is outside the years asked for or repeated; a series is all months or all
  quarters; and the `message` list is empty, with one exception. BLS reports a shortened year
  range, an unknown series and a year with no data there, under a success status. "No Data
  Available for Series X Year: Y" is accepted when X was asked for, Y is the last year asked
  about and the answer lists no row of X for Y: each January that is simply true of the
  current year. The capture records which series it was said of (`no_data_yet`). Any other
  message makes the answer incomplete.
- **Treasury Fiscal Data** (`treasury_fiscal_data`): every page read; all pages agree on
  `total-count` and `total-pages`; the rows read add up to the total; rows are in key order and
  no key repeats (a table that changes while it is paged shows as one of these); and the table
  can be read as its endpoint says (below).
- **Federal Reserve Board** (`fed_board`): the six label rows are present; the columns are
  exactly the series expected, in order; every data row is a Period of the file's kind (a day,
  a month, a quarter) with one cell per series, in order; every cell is a number, one of the
  Board's codes for "no number" (`ND`, `NA`, `NC`) or, only before a series begins or after it
  ends, empty; the unit, multiplier and currency the label rows give a series that is read are
  the ones the endpoint expects; a column that is read has at least one entry; and a package
  asked for in spans answers each span with rows, all inside it.

- **BEA** (`bea`): the answer is JSON with no `Error` (the Bureau reports an error under HTTP
  200); it repeats the data set, table (or indicator and area), frequency and `Year=ALL` it
  was asked for; it has rows, all of that table; each series read has rows on the line the
  endpoint pins, labelled with the unit, multiplier and metric it pins; where a `basis` is
  pinned ("chained (2017) dollars"), the line's description or the table's note holds that
  text; no Period is given twice, each is a Period of the table's frequency and none had not
  begun on the day asked; every value on a line that is read is a number.
- **EIA** (`eia`): no `error` and no `warnings`; the answer says it is the route and frequency
  asked for; every page gives the same `total`, the rows add up to it, each page but the last
  is full and begins where it should; rows are in order of period and series with none
  repeated; every row is of a series asked for, with the other facets as asked and the units
  the endpoint pins; every value is a number in text or `null`; no value is for a Period that
  had not begun; every series asked for has at least one number. At most forty pages are read.
  The order and the totals show data that grew or shrank while it was paged. A figure revised
  between two pages would not show; the next capture sees it.

- **Census Bureau, a flat file** (`census_eits`): the answer is a zip that holds
  `{PROGRAM}-mf.csv`, no larger than 64 MB; the file is UTF-8 and has its sections
  (`CATEGORIES`, `DATA TYPES`, `GEO LEVELS`, `TIME PERIODS`, `DATA`, and `ERROR TYPES` where
  the program has one), each beginning with the header row expected; no index or code is
  given twice in a table of codes; every time period is a month; every row of data has the
  right number of cells and points at things the file lists; each series asked for is found
  by its codes, labelled with the category, data type, unit and geography the endpoint pins,
  and has rows; no series gives a month twice; every value of a series that is read is a
  number; no value is for a month that had not begun.
- **Census Bureau, the construction workbook** (`census_c30`): the answer is a zip with one
  sheet and its strings, neither larger than 32 MB; the title and the line on units are the
  ones pinned; a row of headings begins `Date` and has each heading asked for exactly once;
  the rows under it are months, the newest first, each one month before the row over it, and
  no row below the table is a month; the newest month had begun on the day asked; every cell
  of a column that is read is a number.
- **A hand-entered file** (`manual`): strict JSON of the format, for the Origin and dataset
  of its endpoint, at the frequency pinned, with exactly the series pinned, each in the unit
  pinned; every entry is a Period of that frequency that had begun, given once, with a number
  written as text and a citation (publisher, title, an https address, the day it was read,
  where in the record the figure is); where an entry shows its working, the value is what
  the working gives ("Hand-entered files" below).

The evidence records its *scope*. BLS is asked for the thirty years ending this year, ten
years to a request, so a year that has rolled out of the window was not asked about, and its
absence says nothing. A Board package, a Treasury table, an IMF dataflow, a BEA table and an
EIA route are asked for whole, so a Period that has left one is gone.

An answer of 200 with an empty body is asked for again, like a 5xx: the Board's download
program gives one the first time it is asked for a file it has not built (verified
2026-11-11). If it stays empty the capture is incomplete. A package whose whole history is too
large is always answered empty; its endpoint lists `from_years`, and one more cut there is the
cure when a span outgrows the limit (about 1 MB).

## How each source is read

Reading is the adapter's `parse`, from kept bytes and the scope recorded with them. The value
of an Observation is the source's own text, never rounded and never computed. A Period the
source lists with no number is an Observation with no value (`unavailable`, written to the
store as `missing`); a Period the source does not list is not an Observation.

| Source | Period | Value | No number |
|---|---|---|---|
| BLS | `M01`–`M12` → `2026-10`; `Q01`–`Q04` → `2026-Q3` | `value` as printed. `preliminary` under footnote P, else `revised` under footnote R | `-` |
| Treasury, `daily_rows` (Debt to the Penny) | `record_date`, one row a day | the field named, in dollars and cents | `null` |
| Treasury, `mts_summary` (Monthly Treasury Statement, table 1) | the calendar month of a month row | receipts and outlays of the month | `null` |
| Board, by day | the date | the cell | `ND`, `NA`, `NC` |
| Board, by week (`period: week`) | the ISO week of the date (`2026-11-04` → `2026-W45`) | the cell: the level on that day | the same |
| Board, by month or quarter | `2026-10`; `2026Q2` → `2026-Q2` | the cell | the same |
| IMF (SDMX 3.0) | `2026-M09` → `2026-09`; `2026-Q3`; `2026` | `OBS_VALUE`, the Fund's text. `observed`, `estimate` or `projected` by the Fund's own derivation code | `null` after the series' first number |
| BEA | `2026M09` → `2026-09`; `2026Q3` → `2026-Q3`; `2026` | `DataValue` with its thousands commas taken out (`23,650,213` → `23650213`) and nothing else changed. Always `observed` | not seen; anything that is not a number makes the capture incomplete |
| Census, flat file | `Sep-2026` → `2026-09` | `val`, the file's text. Always `observed`: the file marks nothing | not seen; a code such as `(S)` in a series that is read makes the capture incomplete. A month listed with no row is no Observation |
| Census, workbook | `Sep-26p` → `2026-09`, the century from the day asked | the cell as the workbook's XML prints it. `preliminary` under `p`, `revised` under `r` | not seen; an empty cell makes the capture incomplete |
| Hand-entered | the entry's `period`, a Period of the file's frequency | the entry's `value`, text. Always `observed`; the citation is its footnote | an entry is a value; there is no empty entry |
| EIA | `2026-10`; a weekly row's date names its ISO week (`2026-11-09` → `2026-W46`); a day; `2026-Q3`; `2026` | the data column's text. A figure printed without a zero before its point is given one (`.995` → `0.995`); nothing else changes | `null` |

**The Monthly Treasury Statement.** Each statement (one `record_date`, the last day of its
month) lists the months of the last fiscal year and of this one: a header row per fiscal year
(`record_type_cd` `SL`, `parent_id` `null`, "FY 2026"), a row per month (`MTH`, its `parent_id`
the header's `classification_id` in the same statement, named for the month) and a
"Year-to-Date" total, which is not read. The fiscal year begins in October, so FY 2026's
October is `2025-10`. Later statements revise earlier months, so a month is read from the
latest statement that lists it. A row that is none of the three kinds, a month listed twice in
one statement, a month after the statement's own, a statement with no month row, or a
statement not dated on the last day of a month makes the capture incomplete. The statement's date decides which statement is later.
It says nothing about when Macro Atlas knew a figure: that is the Capture's retrieval time.

**Units.** A value is kept in the unit the source prints, and the Catalog entry says what that
is: Debt to the Penny in dollars, the Board's Z.1 and G.19 figures in millions, M2 in billions.
For a Board series the endpoint pins the label rows (`labels`), so a change of multiplier
stops the capture instead of changing every figure by a thousand. Only a column with pinned
labels is read, and `atlas check` refuses a Series bound to a Board package whose endpoint
pins no label for it.

**The IMF's SDMX API.** One request per endpoint asks one dataflow for a named list of series
(full SDMX keys such as `JPN.CPI._T.IX.M`), whole history. The answer is SDMX-JSON in which a
series is a string of positions (`11:0:0:0:0`) into the answer's own lists of codes, a time is
a position into a list that is in no order, and an attribute is a position or a text. It is
read by name, never by place: a series by the `keyPosition` of each dimension, an attribute by
its `id`. It is whole when it is one data set of the dataflow asked for and holds exactly the
series asked for, each with a number.

- **Observed, estimated, projected.** The Fund marks how each value was derived
  (`DERIVATION_TYPE`; its code list was read on 2026-11-11). `O` (reported official data) and
  `R` (raw data) are `observed`. `SE`, `SEME`, `SEHI` (IMF staff estimates) are `estimate`.
  `SP` (IMF staff projections) is `projected`. A value under any other code, or under none,
  makes the capture incomplete: nothing is guessed. So does a value for a Period that had not
  begun on the day of the fetch (New York) unless the Fund calls it a projection. The
  consequence is deliberate and should be known: one value the Fund marks otherwise stops
  the whole endpoint, all its series, until someone has looked. A dataflow that does not
  mark its values at all (the World Economic Outlook) cannot be read this way; it needs a
  contract of its own (M37).
- **Marks.** `STATUS` is free text with no code list behind it. The exchange-rate dataflow
  carries `T` on 39 Observations at changes of regime and redenominations (2026-11-11). An
  endpoint lists the marks someone has looked at (`marks`); a listed mark is carried as a
  footnote in the parsed state and read as nothing, and any other mark makes the capture
  incomplete. The footnote is not kept in the vintage store, which holds period, value and
  status.
- **Reference periods.** For an index the endpoint pins the reference period the Fund labels
  each series with (`reference`, such as `2020A`). A rebase changes every figure, so a
  capture whose label differs is incomplete until the pin and the Series are changed. The pin
  in force is part of each Capture's scope, so an old Capture is replayed under the base it
  was fetched on. `atlas check` refuses an index bound to an IMF endpoint that pins none. The
  label is pinned so that a change is seen; it is not always what the level suggests (Canada's
  reads like 2002 = 100 under the label `2014M12`), and the Catalog states a base only where
  it has been checked (Japan, against the Statistics Bureau's file).
- **Nulls.** The Fund lists some series from 1900 with no number until they begin. A null
  before a series' first number is padding and no Observation. A null after it is a Period
  the Fund lists and prints no number for: `missing`. A Period it does not list is nothing.
  One edge follows: if the first month of a series later becomes a null, it joins the padding
  and is recorded as withdrawn, not as missing.
- **Scale.** Every series read must say scale 0 (units). Figures are kept as printed, with all
  their decimals; rates from before a redenomination are printed in today's unit and are very
  small (ten zeros after the point, then a dozen digits).

**The BEA's API.** One request asks for one whole thing, every year (`Year=ALL`): a table of
the National Income and Product Accounts with all its lines, or one indicator of the
International Transactions Accounts. A series is the Bureau's code (`A191RX`); because one code
can sit on two lines of a table, it is read from the line the endpoint pins.

- **Units.** The API gives dollar figures in millions (`UNIT_MULT` 6) where the table's own
  note says "Billions of dollars". The multiplier is pinned and the Catalog says millions:
  the figure kept is the one the API printed.
- **The reference year.** Nothing in a row says which year's dollars a chained series is in.
  The table's note does ("Billions of chained (2017) dollars"), as does the line's description
  for real disposable income. The endpoint pins that text (`basis`), so a rebase stops the
  capture until the pin and the Series are changed, as a changed IMF reference period does.
- **Preliminary figures.** The Bureau's advance, second and third estimates of a quarter are
  not marked in the data. Every value is `observed`; a later estimate is a revision, and the
  vintage store records it as one. The note's "LastRevised" date and the time the answer was
  produced are kept in the capture's checks.
- **Every answer is different bytes.** The answer carries the time it was produced, so two
  fetches of an unchanged table never share a blob. The vintage store compares Observations,
  not bytes, and records the second as a capture confirmation.
- **The monthly trade balance is not here.** The international accounts are quarterly and
  annual in this API. `trade_q` is the quarterly balance on goods and services, a quarterly
  rate, not annualized. The monthly FT-900 figure v1 showed waits for the Census files (M16).

**The EIA's API v2.** An endpoint is one route (`petroleum/pri/spt`) at one frequency, one
column of data and the series one facet names. Where rows have a series id that facet is
`series` (`RWTC`); the electricity route has none, so the fuel type names the series (`ALL`)
and the endpoint holds location and sector to one value each. Every Period is asked for, 5,000
rows to a page, sorted by period and then by the facet. The units printed on each row are
pinned. The answer is read so that a number is kept as the characters it was sent in, whether
the Administration quotes it or not.

**The Census Bureau's files.** Two kinds, both published with no key (ADR 0030).

- *A flat file of the Economic Indicators* (`https://www.census.gov/econ_getzippedfile/?programCode=MARTS`):
  one program, every series and month it has, as a CSV in a zip beside a README. The CSV is
  tables under headings parted by blank lines; a row of `DATA` points into the tables of codes
  by index. A series is named by the Bureau's own codes, joined: category, data type,
  geography and `SA` or `NSA` (`44X72:SM:US:SA`). It is found by code in each file, never by
  index. Only an estimate is read: a row whose `et_idx` is not 0 is the sampling error of one.
  The file lists every month to the end of the year; a month with no row for a series is no
  Observation. The time under `DATA UPDATED ON` is kept in the capture's checks.
- *The construction workbook* (`.../construction/c30/xlsx/totsatime.xlsx`): the seasonally
  adjusted annual rate by type. The flat file for this program holds only unadjusted monthly
  totals. A series is the heading of its column as printed, with the line break taken out and
  the footnote number left in (`Total Private Construction2`). A month is `Sep-26p`: the
  century of the year is not in the file, so the newest row is taken to be the latest month
  of that name and year that had begun on the day asked and lies in the last fifty years, and
  each row under it must be the month before. The day asked is in the scope, so the same
  bytes are read the same way whenever they are replayed.

A zip is read in memory: one named member, under a size limit, never extracted.

## Hand-entered files

Some figures are not served as data by anyone: an election's vote totals are in a published
report, a term of office on an official page. They are typed in, each with its citation, into
a file of the repository, and read through the capture kit like any source (ADR 0030; the
format is `atlas/manual.py`).

```
catalog/manual/{name}.json           a series file: Observations of one or more Series
catalog/manual/terms/{office}.json   a terms file: who held an office and when
catalog/manual/spans/{name}.json     a spans file: the dated stretches of a layer (M19)
```

**A series file** names its Origin (the producer of the record and the dataset), the
frequency of its Periods, and its series by a name of its own; each series has a unit and a
list of entries:

```json
{"period": "2020-11-03", "value": "4.00",
 "working": {"formula": "two_party_margin", "democratic": "5200", "republican": "4800"},
 "citation": {"publisher": "...", "title": "...", "url": "https://...",
              "accessed": "2026-11-10", "locator": "page 5, table A, the row \"Total\""}}
```

- **The citation** says where a person can check the entry. All five fields are required; an
  `archive_url` may be added. The day a record was read is not a retrieval time.
- **The working** is for a value the record does not print but follows from figures it does.
  One formula exists: the two-party margin, Democratic minus Republican votes over their sum,
  in percentage points. The value entered must be what the working gives at the decimals it
  is written with (a half goes away from zero), or the file is incomplete. The working checks
  the value and never replaces it.
- **How it is captured.** An endpoint on the register row of the Origin names the file, the
  frequency, the series and their units, with the adapter `manual` and the Channel
  `hand_entered`. A live run reads the file from the working tree: the fetch log records a
  request whose method is `READ` and whose address is `repo:catalog/manual/{name}.json`, and
  no request leaves the machine. The bytes are kept as a blob. A replay answers from its
  recording and never looks at a file. Only a file directly under `catalog/manual` is read.
- **A correction is a revision.** Change an entry and the next capture keeps the file as it
  now is; the vintage store then holds what was entered before, from when to when, and what
  replaced it. An entry taken out is a Tombstone.
- **Rights.** The gate treats `hand_entered` as Macro Atlas's own route; the row that must be
  signed is the Origin's. A capture of a hand-entered file is `real_bytes`.
- **Nothing is typed in ahead of a decision.** The repository is public, so a committed file
  is a public copy. `atlas check` refuses a file under `catalog/manual` whose Origin's row is
  not signed for `store` and `redistribute`, and a file no endpoint reads. Today the
  directory is empty.

**A terms file** names an office and lists its terms: holder, start and end as days (both
inclusive; an end still to come is `null`), the party where the record states it, and a
citation each. Terms are in order and do not overlap. A term of government is an Annotation,
not a Series, so a terms file is not captured; `atlas.manual.load_terms` reads it, and the
content compiler projects it into a Release's Annotations (M19; `docs/method/content.md`).

**A spans file** (M19) is the same for a layer of dated stretches, today recessions: a layer,
a label, and spans of days in order, each with a citation. It is not captured either.

To enter a Series by hand, once its Origin's row is signed: write the file; add its endpoint
to that row; name the endpoint in the Series file and make it active; run `atlas check`.

## API keys

Two sources want a free key, sent as a query parameter: the BEA (`UserID`, from the environment
variable `BEA_API_KEY`) and the EIA (`api_key`, from `EIA_API_KEY`). ADR 0029 has the reasons.

- **Where a key is.** In the environment of a live run, and in the one request as it leaves.
  An adapter builds its URLs without the key and says only which key the request wants. The
  Session adds it as it sends. The request that is recorded, in the fetch log and in an
  exported fixture, is the one without it.
- **Where a key is not.** In anything kept. The BEA repeats the key in every answer, so the
  Session replaces every copy of every key of the run, in the body, the headers and the text
  of a network error, with `REDACTED`, before the bytes are hashed, stored or examined. This
  is the one exception to "the exact bytes": the blob, its hash and its length are of the
  answer with that replacement and no other change. Nothing is parsed and written out again.
  The search ignores letter case, because the BEA repeats what it was asked in capitals. An
  answer that repeats a key in an encoded spelling (a JSON `\u` escape, a percent-encoding)
  cannot be cleaned that way, so it is refused whole: the fetch fails and nothing of the
  answer is kept or printed.
  The fetch-log part says how many copies were replaced (`key_removed`), and the line names
  the key it needed (`key`), never its value.
- **What a key looks like.** Letters, digits and hyphens, 16 to 128 of them. Such text is the
  same in a URL, in a header and inside JSON, so one literal search finds every copy. A value
  of any other shape is not sent, and its endpoint is treated as having no key.
- **Without a key.** The endpoint is not asked. Its line has the outcome `no_key`, the run
  prints `STALE id: stale, last fetched TIME (KEY is not set; nothing was asked)`, or `never
  fetched`, goes on to the other endpoints, and ends with exit status 1, because not everything
  selected was captured. The rights gate comes first all the same: a selected row that is not
  signed stops the run whether or not its key is there. The release writer marks such a source
  `stale`, not `failed` (`docs/method/release-writer.md`).
- **A replay needs none.** `--replay` sends each request as it was recorded and takes no key
  from the environment. The committed fixtures were made without one, and CI has none.

## What is written

```
raw/{source}/{utc day}/{sha256}.gz    one response body, gzipped, named by the SHA-256 of the
                                      bytes as received (after HTTP content decoding)
fetchlog.ndjson                       one JSON line per Capture attempted
runs.ndjson                           two JSON lines per run: started, finished
```

A fetch-log line holds `capture_id`, `run_id`, `endpoint`, `source` (the register row),
`origin`, `datasets`, `channel`, `adapter` (name and version), `register` (version and file
hash), `rights` (what the register row said then: licence class, attribution and the four
grants; the vintage store keeps Rights over time from it), `transport` (`live` or `replay`), `real_bytes` (whether a source served them, now or when
they were recorded), `started_at`, `retrieved_at` (when the last part
arrived; null if the fetch failed), `key` (the name of the API key the endpoint wants, when it wants one), `outcome`, `evidence` (`complete`, `scope`, `checks`,
`problems`), `error`, and `parts`. Each part holds the request (method, URL, headers, body),
the status, the response headers, `received_at`, `sha256`, `bytes`, the `blob` path, why
any earlier try was repeated, and `key_removed` when copies of a key were taken out of the answer.

Times are UTC, whole seconds, rounded up. Cookie values are replaced with `(not kept)`. The
files are append-only; a line cut short by a crash is passed over, reported, and the next line
starts clean.

## Reading captures back

`atlas replay` builds the vintage store from these files (`docs/method/vintage-store.md`).

`atlas.capture.replay.load_capture(store, line)` returns the bytes (checked against their
hashes), the recorded evidence and the original retrieval time. `reexamine` judges completeness
again with today's adapter. `ADAPTERS[name].parse(capture)` gives, per identifier of the
source, one Observation per Period as "How each source is read" describes: the Period, the
value as printed (a string), a status (`observed`, `preliminary`, `revised`, `unavailable`)
and the footnotes. Anything that cannot be read makes the state `complete: false` and gives no
Observation; such a state is never recorded.

## Commands

```
python -m atlas capture --dry-run             what would be fetched, the gate's answer, and
                                              whether each key an endpoint needs is set
python -m atlas capture                       a run into $ATLAS_STORE (default var/store)
python -m atlas capture --only bls            only that row's endpoints
python -m atlas capture --status              last whole capture and missed days per endpoint
python -m atlas capture --verify              every blob present and unaltered
python -m atlas capture --replay fixtures/capture --store /tmp/x --register <a signed table>
python -m atlas capture --export-fixtures DIR write the store's captures as recorded exchanges
```

`python -m atlas.capture` is the same command and needs only `requests`.
