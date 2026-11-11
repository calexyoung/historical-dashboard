# Capture

How Macro Atlas keeps what a source served, before anything is parsed (PLAN 4.3, 4.7 and M7;
ADR 0012, ADR 0021). The code is `atlas/capture/`; the host kit is `deploy/capture/`.

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

- **BLS** (`bls`): the status is `REQUEST_SUCCEEDED`; the `message` list is empty (BLS reports
  a shortened year range and an unknown series there, under a success status); every series
  asked for is present with rows; no row is outside the years asked for or repeated.
- **Treasury Fiscal Data** (`treasury_fiscal_data`): every page read; all pages agree on
  `total-count` and `total-pages`; the rows read add up to the total; rows are in key order and
  no key repeats (a table that changes while it is paged shows as one of these).
- **Federal Reserve Board** (`fed_board`): the six label rows are present; the columns are
  exactly the series expected, in order; every data row is a date with one cell per series, in
  date order.

The evidence records its *scope*. BLS is asked for the ten years ending this year, so a year
that has rolled out of the window was not asked about, and its absence says nothing.

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
again with today's adapter. `ADAPTERS["bls"].parse(capture)` gives, per BLS series id, one
Observation per month: the Period (`2026-10`), the value as BLS printed it (a string, never
rounded), a status (`observed`, `preliminary` when BLS marks it `P`, `unavailable` when BLS
prints `-`), and the footnotes. Any other value that is not a number makes the answer
incomplete and gives no Observation. If anything could not be read the state says `complete: false`.

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
