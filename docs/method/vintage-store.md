# The vintage store

How Macro Atlas keeps what it held for each Series, and from when to when (PLAN 4.3 and M8;
ADR 0005, ADR 0012, ADR 0022). The code is `atlas/vintage/`.

## What it answers

"What did Macro Atlas hold for this Series at this instant?" That is an Atlas-observed vintage:
it shows a value was public no later than the time recorded. It does not show when the value
was first reported (CONTEXT.md).

## What is written

```
obslog/{key}.parquet    the observation log: one row per version of each Observation
metalog/{key}.ndjson    the metadata history: one line each time the metadata changed
caplog/{key}.ndjson     the capture log: one line per complete Capture recorded for the Series
vintage-store.json      which kind of values the store holds: an agency's, or invented for a
                        fixture. Written once, before the first row; the two never mix
```

They sit in `$ATLAS_STORE` beside the capture kit's `raw/` and `fetchlog.ndjson`, or in a
directory of their own (`--captures`).

Observation log columns:

| Column | Meaning |
|---|---|
| `key`, `period`, `period_start`, `period_end` | The Series and the Period, with its first and last calendar day |
| `value` | The provider's decimal text, unrounded (`129.250`). Empty for a missing or suppressed Observation and for a tombstone |
| `status` | `final`, `preliminary`, `revised`, `estimate`, `projected`, `partial`, `suppressed` or `missing`. Empty for a tombstone |
| `deleted` | True for a tombstone: the Period was current, was asked about, and a complete answer no longer had it |
| `recorded_from`, `recorded_to` | The retrieval time of the Capture that opened the row, and of the one that closed it. Current from the first up to, not including, the second. Empty `recorded_to` means current now |
| `capture_id` | The Capture that opened the row; it leads to the kept bytes through the fetch log |
| `metadata_hash` | The metadata the row was recorded under; matches a line of the metadata history |
| `channel`, `representation` | The Channel the value came through; always `native` here |
| `provider_from`, `provider_to`, `provider_precision`, `release_id` | Empty in M8 (ADR 0022, decision 10) |

A metadata line holds `recorded_from`, `capture_id`, the `metadata` and its hash. The metadata
is what Macro Atlas declares for the Series (name, unit, seasonal adjustment), the Source
(Origin with dataset and identifier; Channel with adapter and endpoint) and the Rights the
register row gave when the bytes were fetched.

A capture-log line holds the `capture_id`, `retrieved_at`, the `scope` asked about, the
`change`, the Periods `added`, `revised`, `withdrawn` and `relabelled`, the `state_hash`, the
`metadata_hash`, the adapter that parsed the bytes, and whether the bytes were real.

## What recording a Capture does

| The complete state says | What is written |
|---|---|
| A Period not held before | A new row |
| A different value or Status for a Period | The current row is closed; a new row opens |
| A Period in scope is no longer there | The current row is closed; a tombstone opens |
| A Period outside the scope is not there | Nothing: it was not asked about |
| The metadata differs | A metadata line; every Period in scope gets a new row under the new metadata |
| Nothing differs | A capture-log line with change `none`: a capture confirmation. No other byte changes |

A state that is not complete writes nothing at all.

The same number spelled differently (`129.25`, `129.250`) is the same value. Footnotes are
not kept; a footnote that marks a value preliminary shows as its Status.

The scope is what the source was asked about. BLS is asked for whole years, so a month of a
year that has left the ten-year window stays in the log as it was last seen, and later
confirmations say nothing about it.

## Replay

`atlas replay` reads the fetch log, takes the complete Captures in retrieval order, parses the
kept bytes with today's adapter and records each Series the Catalog binds to the endpoint
(`catalog/series`, see `docs/method/catalog.md`). It asks the rights gate first and writes nothing if any Series is
refused. A Capture already recorded is passed by, so it can run after every capture run.

Every time written is a Capture's retrieval time. Replaying a year of Captures today, or the
same Captures one day at a time, gives the same files byte for byte.

What it reports:

| Line | Meaning |
|---|---|
| `key time: first capture; added …` | What changed for a Series |
| `key time: unchanged (capture confirmation)` | The Capture agreed with what was held |
| `SKIPPED capture: the capture is incomplete` | Kept in the fetch log, never a state |
| `SKIPPED endpoint: … has no parser yet` | Treasury and Fed Board Captures wait for M13 |
| `REFUSED key: …` | The rights gate, or a state the log cannot hold. Exit 1 |
| `ALTERED capture` | Kept bytes no longer match their hash. The replay stops. Exit 1 |
| `INCOMPLETE capture` | Today's adapter does not read a Capture as whole. Exit 1 |
| `WARNING key: … passed over` | An older Capture than what is recorded; needs a new store |

## The series table

Since M12 the series table is read from the Catalog (`catalog/series/{key}.json`,
`docs/method/catalog.md`): every stored Series that names an Endpoint and is not a draft. Each
binds one source identifier of one endpoint to a Series key and frequency, and carries the
declared metadata as dated versions. To change a unit or a name, move the version that was in
force into the entry's `earlier_metadata` and give the instant the new one takes effect in
`metadata_from`; do not edit a version that has been in force. Today the table holds the four
Series of the BLS endpoint: `cpi`, `cpi_nsa`, `unrate`, `payems`. `--series` takes another
catalog directory, or a table file of the M8 shape (the fixtures use one).

## Commands

```
python -m atlas replay                          record what $ATLAS_STORE does not hold yet
python -m atlas replay --captures DIR --store NEW   replay kept Captures into another directory
python -m atlas replay --show cpi               the observation log of one Series
python -m atlas replay --show cpi --as-of 2026-04-15T00:00:00Z   what was held at that instant
python fixtures/vintage/demo.py                 the three-fetch fixture, start to finish
```

## To apply a parser fix to history

Replay into a new, empty directory with `--captures` pointing at the kept Captures, compare,
then use the new directory. Nothing is rebuilt in place.
