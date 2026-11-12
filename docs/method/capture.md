# Capture

How Macro Atlas keeps what a source served, before anything is parsed (PLAN 4.3, 4.7 and M7;
ADR 0012, ADR 0021, ADR 0027). The code is `atlas/capture/`; the host kit is `deploy/capture/`.

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
5. Fetches each endpoint in turn, one request at a time, at least a second apart per host,
   retrying a 5xx, a 429 or a network error three times with a growing wait, and leaving a host
   alone for the rest of the run once two requests to it have ended in 429.
6. Writes each response body to `raw/`, then one line to `fetchlog.ndjson`.
7. Writes its finishing line to `runs.ndjson` (the starting line was written before the first
   request) and exits 0 only if every endpoint was captured whole.

Redirects are not followed: a 3xx fails the fetch.

## Whole, incomplete, failed

| Outcome | When | What is kept |
|---|---|---|
| `captured` | Every completeness check passed | Bytes, evidence |
| `incomplete` | The source answered 200 but not with the whole of what was asked | Bytes, evidence with the reasons. Never treated as the state of a Series |
| `failed` | No usable answer: a status other than 200 after retries, or no answer at all | Whatever did arrive, including an error page, and the error |

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

The evidence records its *scope*. BLS is asked for the thirty years ending this year, ten
years to a request, so a year that has rolled out of the window was not asked about, and its
absence says nothing. A Board package and a Treasury table are asked for whole, so a Period
that has left one is gone.

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
  small (`0.0000000000114799999999`).

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
arrived; null if the fetch failed), `outcome`, `evidence` (`complete`, `scope`, `checks`,
`problems`), `error`, and `parts`. Each part holds the request (method, URL, headers, body),
the status, the response headers, `received_at`, `sha256`, `bytes`, the `blob` path, and why
any earlier try was repeated.

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
python -m atlas capture --dry-run             what would be fetched, and the gate's answer
python -m atlas capture                       a run into $ATLAS_STORE (default var/store)
python -m atlas capture --only bls            only that row's endpoints
python -m atlas capture --status              last whole capture and missed days per endpoint
python -m atlas capture --verify              every blob present and unaltered
python -m atlas capture --replay fixtures/capture --store /tmp/x --register <a signed table>
python -m atlas capture --export-fixtures DIR write the store's captures as recorded exchanges
```

`python -m atlas.capture` is the same command and needs only `requests`.
