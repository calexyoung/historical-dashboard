# Claims: the record, Readings, Evidence rows and locks

How a Claim is recorded, measured and frozen (PLAN 4.5, 5 and M20; ADR 0011, ADR 0034). The
code is `atlas/content/claims.py`, `atlas/publish/claims.py` and the engine's
`packages/core/src/claim.ts`, which is tested from this text.

`semantics_version`: **0.7.0** (M20: Measures, Evidence rows and drift added; no Transform,
aggregation, Recipe or as-of rule changed).

Macro Atlas gives no finding, rating or label on a Claim. A Claim is a record and the figures
needed to examine it; the judgment is the reader's. No file described here has a field that
could hold one.

## What there is

```
content/claims/{id}.md                       a Claim
content/claims/locks/{id}.v{n}.lock.json     a Claim lock kept in the repository (public Profile)
{local root}/locks/{id}.v{n}.lock.json       a Claim lock kept in a local release root
```

## A Claim

```
---
id: "2031-03-04-an-invented-official-on-the-jobless-rate"
claimant:
  name: "An Invented Official"
  role: "Secretary of Examples"
  party: "none"
said_on: "2031-03-04"
venue: "A press conference"
sources:
  - name: "Invented recording"
    url: "https://video.example.org/briefing"
    archive_url: "https://web.archive.org/web/2031/https://video.example.org/briefing"
    locator: "at 12:40"
    kind: "recording"
  - name: "Invented transcript"
    url: "https://example.org/transcript"
    archive_url: "https://web.archive.org/web/2031/https://example.org/transcript"
    locator: "paragraph 9"
    kind: "transcript"
readings:
  - id: "rate-in-january"
    series: "unrate"
    transform: "lin"
    measure: "value_at"
    period: "2031-01"
readings_not_measured:
  - "The rate among people aged 16 to 24."
selection_note: "Kept as an example of the file."
checked_on: "2031-03-06"
corrections: []
topics: []
status: "draft"
---

The jobless rate was 4.1 percent in January.
```

| Field | Rule |
|---|---|
| `id` | `said_on`, a hyphen, a slug. Permanent. The file is `{id}.md` |
| `claimant` | Name, and the role and party held when the statement was made |
| `said_on`, `said_at` | The New York day; and the instant in UTC when it is known, which must fall on that day in New York |
| `sources` | Two or more, with different addresses and different archived copies. Each has `archive_url` (no exception), a `locator` and a `kind`: `recording`, `transcript`, `own_publication`, `report` |
| `readings` | See below. A draft may have none |
| `readings_not_measured` | Other ways the words could be read that are not measured here, a line each |
| `selection_note` | Why this statement was recorded |
| `checked_on` | The New York day the Claim is recorded and its figures computed |
| `corrections` | Always present. Each has a `date` and a `reason` |
| `status` | `draft` or `public`. Only a person makes a Claim public (D7) |
| the text below | The quote, verbatim |

The selection note and the Readings not measured are Macro Atlas's own words and are held to
the word list (`atlas/content/wordlist.py`): an error in a public Claim, a NOTE in a draft. The
quote is the claimant's and is never held to it.

## A Reading

One Series, at one frequency, under one Transform, with one Measure.

| Field | |
|---|---|
| `id` | Names the Reading within the Claim |
| `series` | A key of the Catalog |
| `freq` | Optional: a slower frequency to bring the Series to first (`weekly`, `monthly`, `quarterly`, `annual`), as the Catalog says it combines |
| `transform` | One of the engine's ten (`docs/method/transforms.md`). `rebase`, `z` and `drawdown` only with a Measure that has a window; they are taken over that window |
| `measure` | One of the five below |
| `alternative_windows` | Other windows for the same Measure (Window sensitivity). Only where the Measure has a window |

Period labels are at the Reading's frequency: `2031-01`, `2031-Q1`, `2031`. A yearly Transform
(`pc1`, `ch1`, `pca`) of a daily or weekly Series needs `freq`.

### The closed list of Measures

Each returns numbers, called figures, never true or false.

| Measure | Needs | Figures |
|---|---|---|
| `value_at` | `period` | `value` |
| `change` | `window` | `start`, `end`, `change` (end less start), `pct_change` (100 · change / start) |
| `extreme` | `window`, `which` (`max` or `min`) | `extreme` with its Period, `n` |
| `rank` | `period`, `window`, `order` (`highest` or `lowest`) | `value`, `rank`, `of` |
| `difference` | `periods` (two) | `a`, `b`, `difference` (the second less the first) |

- **The Periods are fixed by the calendar before any value is looked at.** `change` is between
  the first and the last Period that **start** inside the window. A window that opens on 15
  January starts at February. If one of the two has no value, its figure is empty and so are
  the figures computed from it: no other Period stands in. A window in which fewer than two
  Periods start has no change, and the Reading is refused.
- `pct_change` is empty when `start` is zero or below (`start_not_positive`).
- `extreme` and `rank` are over the Observations of the window that have a value (as a
  Transform counts a window: `docs/method/transforms.md`), and `n` / `of` say how many. A tie
  for the extreme is the earliest Period. Equal values share a rank and the next is skipped
  (two values tied at 1, then 3). `rank`'s Period must start inside every window.
- A figure that is one Observation's value carries its Period and its Status. An empty figure
  says why: `no_observation`, `missing`, a Transform's own reason, `operand_empty`,
  `start_not_positive`, `no_values`.
- Nothing is rounded. Rounding happens only at display.

### The order

Resolve the Vintage, aggregate to the Reading's frequency, transform, measure (PLAN 4.5). A
Derived series is computed from the Vintage of each stored Series it rests on.

## Evidence rows

| Row | What it is | Where it lives |
|---|---|---|
| *then* | The Reading as of the Cutoff: `said_at` if the Claim has a time, else 00:00 New York on `said_on` (`docs/method/vintage-resolution.md`). It has a Basis, the weakest of everything it rests on | the lock |
| *now when checked* | The Reading on the own state of the Release the lock was computed against. It claims no Basis. The lock names the Release, when it was created, when the Claim was checked, and when each input was last captured | the lock |
| *latest* | The Reading on the own state of the Release being served | `evidence/latest.json` of each Release |

A row that cannot be answered says why (`unavailable`: no coverage before the Cutoff, no
vintages, more than one unit in force, the Series is not in the Release) and holds no figure.
Today's figure never stands in for *then*.

Each row carries its **Window sensitivity**: the same Measure over each alternative window, in
the order declared.

## Recording a Claim

```
python -m atlas add claim 2031-03-04 "An invented official on the jobless rate" \
    --name "An Invented Official" --role "Secretary of Examples" --party none \
    --venue "A press conference" --quote "The jobless rate was 4.1 percent in January." \
    --source https://video.example.org/briefing --kind recording \
        --archive-url https://web.archive.org/web/2031/https://video.example.org/briefing --locator "at 12:40" \
    --source https://example.org/transcript --kind transcript \
        --archive-url https://web.archive.org/web/2031/https://example.org/transcript --locator "paragraph 9" \
    --selection-note "Kept as an example of the file." \
    --series unrate --measure value_at --period 2031-01
python -m atlas check
python -m atlas claims compute 2031-03-04-an-invented-official-on-the-jobless-rate --profile local
python -m atlas release --profile local --reuse-data
```

`add claim` writes one draft file and never overwrites; it takes one Reading (`--series`,
`--measure`, `--period` once or twice, `--from`/`--to`, `--which`, `--order`, `--freq`,
`--transform`, `--alt-window FROM:TO`). More Readings, and `status: public`, are edits to the
file. It has no option for a finding.

`claims compute` has the engine compute every Reading's *then* and *now when checked* rows on
the root's current Release and writes the first lock. It refuses when:

- the Claim already has a lock (use `relock`);
- `checked_on` is not today in New York (the row is today's: set it);
- a Reading's Series is not in the Release, or is held there in v1's legacy representation
  (`legacy_monthly_rounded`), or a Derived series rests on one that is;
- the Release gives a Reading no figure at all;
- with `--profile public`, the rights gate does not permit display and redistribution of
  everything the numbers came through.

`claims relock ID --profile P --reason WHY` records the Claim afresh: version *n* + 1 beside
the others, which stay as they were. `claims list --profile P` shows every Claim, its status
and its locks.

## Where a lock lives

| | `--profile public` | `--profile local` |
|---|---|---|
| Written to | `content/claims/locks/`, for a person to commit | `{local root}/locks/`, never committed |
| Computed on | the public root's current Release | the local root's |
| Rights | display **and** redistribute, on production, for every Origin, dataset and Channel the numbers came through, history included. A lock in the repository is a file of values (ADR 0031) | no signature asked |

No row of the rights register is signed today, so no real lock can be written to the
repository yet: a real Claim is tried with `--profile local`.

A public-profile Release reads only the repository's locks. A local-profile Release reads the
repository's for a Claim that has any there, else the local root's.

## What a lock freezes

`format`, `claim_id`, `version`, `locked_at`, `reason` and `supersedes` (a relock);
`record` (the claimant, day and time, venue, sources, quote, Readings, Readings not measured,
selection note, `checked_on`) and `record_sha256`; `release` (id, created, Profile);
`semantics_version`; `rights_used`; and for each Reading what it resolved to (Series,
frequency, unit, Transform, Measure, the Recipe and what it rests on, the Periods, the window
and its two Periods, the alternative windows) with its *then* and *now when checked* rows:
Basis, Cutoff, inputs with their Capture gap and last Capture, unit, figures and Window
sensitivity. `lock_sha256` is the hash of all of that.

- **A lock is never edited.** A changed byte fails `atlas check` and refuses every release.
- **A Claim's record is frozen with it.** Changing the quote, a source, a Reading or
  `checked_on` after locking fails `atlas check` and refuses every release until the file is
  restored or the Claim is re-locked. Status, topics and the correction log are not frozen.
- The Release a lock names is pinned: retention keeps it.

## In a Release

| File | Holds |
|---|---|
| `content/claims.json` | The Claims (public Profile: the `public` ones only; a draft is in no file), each with its locks by name |
| `locks/{id}.v{n}.lock.json` | Each lock that is in the Release, as the bytes written |
| `evidence/latest.json` | For the newest lock of each Claim: the *latest* row of every Reading, computed by the engine in the release run, and the drift |

A lock is listed `in_release`; or `withdrawn`, named without its numbers, when the gate no
longer permits what they came through or a Series they rest on was withdrawn; or
`not_carried` in a Release the legacy converter wrote (`make v2`), which runs no engine step.
`atlas release --profile local` carries it.

## Drift

At every release the engine compares, for each Reading of each Claim's newest lock:

- `latest_differs`: the *latest* row with the locked *now when checked* row;
- `then_differs`: the *then* row computed again on this Release with the locked *then* row.

Every difference is listed: a figure's value, Period, Status or empty reason, the unit, and
whether the row can be answered at all, for the declared window and each alternative. No cause
is named. Drift fails nothing: the release prints a `DRIFT` line, its check report warns, the
lock stays as it is, and only a person re-locks.

## See it

```
make v2-claim-demo      # an invented Claim on invented data: compute, a revision, drift, relock
.venv/bin/python -m pytest tests/v2 -q -k claim
npx vitest run packages/core/src/claim.test.ts
```
