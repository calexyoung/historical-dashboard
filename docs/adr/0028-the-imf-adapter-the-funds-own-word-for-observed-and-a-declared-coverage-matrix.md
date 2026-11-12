---
status: accepted (M14, 2026-11-11); commits no IMF or e-Stat data (D2 is open, no row is signed)
---

# The IMF adapter takes the Fund's own word for what is observed, and coverage is a declared matrix

M14 adds a fourth adapter, for the International Monetary Fund's SDMX 3.0 API, and with it the
consumer price index of the nineteen G20 countries, their inflation, and a monthly dollar rate
for sixteen currencies: two endpoints, 35 stored Series and 19 Derived series. The plan names
the adapter "with the observed/projected split" and two acceptance items: Japan's index
matches the Statistics Bureau's file for 25 months, and "a coverage matrix page generated from
the catalog shows what exists per country and why anything is missing". The rules are in
`docs/method/capture.md` and `docs/method/catalog.md`; what the Japan check found is in
`docs/v2/japan-cpi-check.md`; the page is `docs/v2/g20-coverage.md`.

## Decisions

1. **Whether a value is observed, an estimate or a projection is the Fund's statement, per
   value, and is never worked out.** The Fund marks every value with a derivation code. `O`
   and `R` are observed, the staff-estimate codes are an estimate, `SP` is projected. Any
   other code, or none, makes the capture incomplete. A date rule alone ("this year and later
   are projections") was rejected: the Fund's projections begin in a different year for each
   country, and an estimate for a year already past would be drawn as observed. A second rule
   backs the first: a value for a Period that had not begun on the day of the fetch is whole
   only as a projection. The replay's vocabulary gains `estimate` and `projected`, which the
   store and the release contract already had.
2. **Fail closed costs a whole endpoint, and that is accepted.** One value under a code the
   adapter does not read stops all nineteen series of the request until someone has looked.
   The alternative, dropping the one value or the one series, would publish an index with a
   hole nobody chose, or let a staff calculation through as a national figure. An endpoint
   per country was rejected for now: 35 requests a run where two do, against a source whose
   terms reserve "automated bulk downloading" and whose row is not signed.
3. **This is not a contract for every IMF dataflow.** The World Economic Outlook's data
   message carries no derivation code at all (seen 2026-11-11), so this adapter refuses it.
   M37 must write its own way of telling actual years from projected ones and say where the
   Fund states it. Nothing in M14 guesses.
4. **A mark with no code list is carried and never interpreted.** The exchange-rate dataflow's
   free-text `STATUS` holds `T` on 39 values at regime changes and redenominations. No code
   list defines it. The endpoint lists the marks that have been looked at; a listed mark is a
   footnote on the parsed value, and any other stops the capture. The letters F, E and P are
   not read as forecast, estimate and provisional: that would be reading a meaning into free
   text. The vintage store keeps period, value and status, so the footnote ends at the
   parsed state; carrying source marks into the store is a change for a later milestone.
5. **The reference period of every index is pinned in the endpoint, and the Catalog states a
   base only where it was checked.** A rebase changes every figure, so a changed label stops
   the capture, as a changed unit stops a Board package (ADR 0027, decision 4). The pin is in
   each Capture's scope, so replay reads an old Capture under the base it was fetched on. To
   accept a rebase: change the pin, and revise the Series' metadata with `earlier_metadata`
   and `metadata_from` so the old unit stays the unit of what was recorded under it. The
   label is not proof of the base: Canada's index reads like 2002 = 100 under the label
   `2014M12`. So the unit of each IMF index is "index" and the description quotes the label;
   only Japan says "2020 = 100", because the Statistics Bureau's file confirms it.
6. **Nulls before a series begins are padding; this is an exception to ADR 0027, decision 3,
   and it is narrow.** The Fund lists Japan's and India's index from 1900 with no number for
   half a century. Recording those as missing months would give Japan's CPI a history that
   starts in 1900. So a null before the first number is no Observation; every other null is a
   missing month, and a Period the Fund does not list is nothing. The cost is one edge: a
   first month that later loses its number is recorded as withdrawn rather than missing. A
   test replays three fetches to hold each case.
7. **Monthly dollar rates from the Fund are new Series, not more history for the Board's.**
   `jp_fx`, `ez_fx` and the rest are the month's average of national currency per U.S. dollar
   as the Fund compiles it. `jpy`, `eurusd` and the Board's other H.10 series are daily noon
   buying rates, some quoted the other way round. They are different representations from
   different Origins and are never spliced. Turkey's rate keeps v1's key, `tryusd`, with the
   alias `tr_fx`, because v1 already showed a monthly average under it; the Catalog note says
   how far the Fund's average sits from the OECD's that v1 read.
8. **The Fund's index for the United Kingdom has its own key.** M12 proposed binding v1's
   `uk_cpi` to the Fund. A comparison in memory on 2026-11-11 showed the Fund's series is not
   the Office for National Statistics' CPI (D7BT) that v1 showed: the two drift apart by up
   to two percent and their twelve-month changes by more than a point. A key's definition
   does not change (ADR 0026), so `uk_cpi` stays a draft on the ONS series, and the Fund's is
   `uk_cpi_imf` with `uk_infl_imf`. Which national index the Fund carries is not established.
   The same comparison found Japan's and China's to be v1's series on another base (a
   constant ratio), which is what their notes now say.
9. **The United States is in the row from the Fund too.** `us_cpi` and `us_infl` are the
   Fund's copy, so that a G20 comparison reads nineteen countries from one source compiled
   one way. The Bureau of Labor Statistics' own figures stay `cpi_nsa` and `cpi_yoy`, and the
   descriptions point there. The Fund's file has no October 2025, which the Bureau did not
   publish.
10. **Inflation for all nineteen is a Recipe, by the calendar.** `pct_change` with a lag of
    twelve over the index. The engine counts Periods, and a Release holds every Period between
    a Series' first and last with gaps explicit (the release contract), so twelve Periods back
    is the same month a year earlier even across a month the Fund does not list. A test holds
    that on a fixture with such a month.
11. **Coverage is declared in one file and everything else on the page is worked out.**
    `catalog/coverage/g20.json` says which Series fills which cell, or why none does, and
    carries dated notes. The state of each Series, the proposal for a draft, the reason for a
    withheld one and the gate's answer today come from the Catalog and the register when the
    page is written. Deriving the matrix from the Series files alone was rejected: a Series
    has a country and no "indicator", and adding that field to 179 files to draw one table
    would put the table's shape into the Catalog's contract. `atlas check` holds the matrix to
    the Catalog, and a test holds every Series read from the Fund to a cell.
12. **The page is a generated document, not a site route.** The site reads a Release and
    nothing else; a Release holds no drafts and no reasons for what is absent. A
    reader-facing version belongs with the world pages (M23, M36) and needs the Release to
    carry the matrix, which is a change to the release contract and not this milestone's.
13. **e-Stat is a check, not a Source, and the check keeps nothing.** `atlas crosscheck
    japan-cpi --live` asks the Fund and the Bureau once each, compares in memory and writes
    nothing: storing what a source served needs a signed row even on one machine (ADR 0020,
    decision 7), and a comparison needs no storage. The dated result is a page with counts
    and no figures. M13's live run used a store under a register signed in a scratch
    directory; this milestone does not repeat that.
14. **The capture host may choose among signed rows.** With the Fund's endpoints in the
    register, a job that asks for every endpoint would fail until the `imf` row is signed,
    and that row has an open question the first three do not. The workflow template reads a
    variable, `ATLAS_CAPTURE_ONLY`, and passes it as `--only`. It selects and clears nothing:
    a selected row that is unsigned still stops the run before its first request.
15. **The fixtures stay invented, and say so.** The generator answers the adapter's two
    requests with SDMX-JSON of the real shape and the things the live answers were seen to
    do: times in no order, a series padded with nulls, a month not listed, a series that
    begins late, the mark `T`, and a rate printed with all its decimals from before an
    invented redenomination.

## Consequences

- The capture job, once the `imf` row is signed, makes two more requests a run and keeps
  about 1 MB more before compression.
- `atlas capture` with no `--only` now needs four rows signed. `deploy/capture/README.md`
  says how to start with three.
- 54 more Series are "active" with no row signed. As before (ADR 0027, decision 9), active
  means an adapter fetches it; the gate refuses every one at capture, replay and release.
- A rebase at any of nineteen statistics offices stops the CPI endpoint until the pin is
  moved. Japan's 2025-base revision is expected.
- The Fund republishes national figures. Whether a national office's terms add anything to
  the Fund's is an open question on the register row, for Alex.

## Not done here

- No comparison of the IMF Series with v1 through the engine (M13's `v1-overlap` statement):
  that needs a Release built from real captures, which needs the row signed. What an
  in-memory comparison found for the four v1 keys is in their Catalog notes.
- Japan's long history and its twelve-month changes against the Bureau's published headline
  rates, which research 02 also asked for.
- The quarterly index for Australia, whose monthly index begins in April 2024.
