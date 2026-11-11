---
status: accepted (M8, 2026-11-11); holds no agency data yet (D2 and D6 are open)
---

# The vintage store: rows dated by retrieval time, and a capture log that makes a record whole

ADR 0005 says each stored value carries four clocks and that an unchanged fetch is evidence.
ADR 0012 says the store is built later by replaying kept Captures with their original retrieval
times. M8 builds that store. This records its shape and the places it departs from PLAN 4.3.

## Decisions

1. **Three files per Series.** `obslog/{key}.parquet` is the observation log, `metalog/{key}.ndjson`
   the metadata history, `caplog/{key}.ndjson` the capture log: one line for every complete
   Capture recorded for the Series. A line whose change is `none` is a capture confirmation.
   The capture log is new against PLAN 4.3. It is also the list of what has been recorded, the
   home of the state hash, and what a Capture gap will be computed from (M10).
2. **The state hash is in the capture log, not the fetch log.** PLAN 4.3 put it on the fetch-log
   line. That line is written before anything is parsed and the file is append-only; going back
   to add a hash would break both. The hash is of the Series' whole current state after the
   Capture (Period, value, Status, in Period order); the metadata has its own hash.
3. **The only clock the store keeps is the Capture's retrieval time.** `recorded_from` and
   `recorded_to` are retrieval times and nothing in the store is the time a replay ran. So a
   replay months later, a replay day by day and a replay of the same lines in another order
   write the same bytes. A row is current from `recorded_from` up to but not including
   `recorded_to`. Two Captures in the same second are taken in capture-id order; the first one's
   rows then have an empty interval and are kept as evidence.
4. **A state that is not complete writes nothing.** No row, no tombstone, no confirmation. This
   is stricter than "no tombstones from an incomplete fetch": a partial answer cannot revise a
   value either. The Capture stays in the fetch log, flagged.
5. **A tombstone needs a complete state and a Period inside its scope.** A Period that was
   current, was asked about and is absent is closed and a row with `deleted` set is opened. A
   Period only partly inside the scope, or outside it, was not asked about and stays as it is:
   BLS's ten-year window slides every January and deletes nothing. For the same reason a
   capture confirmation confirms only the Periods inside its scope, and the capture log keeps
   the scope on every line.
6. **Values are text.** The log holds the provider's own decimal text (`"129.250"`), not a
   float: Debt to the Penny runs to sixteen significant digits. Two texts that are the same
   number are the same value, compared on the text with no arithmetic, and the row keeps the
   spelling that opened it. How text becomes a JSON number in a Release, and what a reader in
   JavaScript may assume about precision, is M9's to decide.
7. **A metadata change reopens the rows it covers.** PLAN 4.3 says a change of unit,
   definition, adjustment, source or rights is a revision. Each row carries the hash of the
   metadata it was recorded under (a column beyond PLAN 4.3). When the metadata changes, a new
   line goes in the metadata history and every Period in the Capture's scope gets a new row,
   even with the same number. A Period outside the scope keeps its old hash: nobody has seen
   that value under the new unit, and the log does not pretend otherwise.
8. **Rights over time come from the Capture, not from today's register.** The fetch-log line now
   records what the register row said when the bytes were fetched (licence class, attribution,
   the four grants). A replay cannot ask what a register used to say. This adds a field to M7's
   fetch-log line; no real Capture existed when it was added.
9. **Declared metadata is dated in the series table.** Until the catalog of M12,
   `atlas/vintage/series.json` says which Series each source identifier is recorded under and
   what Macro Atlas declares about it (name, unit, adjustment) as a list of versions, each with
   the instant it takes effect. A version that has been in force is never edited. A replay gives
   each Capture the version in force when it was retrieved, so the metadata history is a
   function of the Captures and the table, and a rebuild does not backdate a change.
10. **`release_id` is empty and `capture_id` is added.** No Release exists in M8 and a replay is
    not one. Each row instead names the Capture that opened it, which leads to the kept bytes.
    A row is opened once and may appear in many Releases, and a Release can fail before it is
    promoted, so "the Release it appeared in" cannot be a column filled at record time; M9
    needs its own record of what each Release published. The three provider-time columns exist
    and stay empty until an adapter supplies provider times.
11. **The capture-log line is written last and makes the record whole.** Order: metadata line,
    observation log (one atomic replacement), capture-log line. If a run dies in between,
    recording the same Capture again finishes it and writes the same line it would have; until
    then the store refuses any other Capture for that Series.
12. **No rebuild in place.** `atlas replay` only adds. To apply a parser fix to history, replay
    the Captures into a new, empty directory and switch to it. The capture log names the
    adapter version that parsed each Capture.
13. **Replay asks the rights gate.** The observation log is a stored copy of what an Origin
    served. Before writing anything, replay asks `may_store` of today's register for every
    Series it would record, and one refusal stops the run. Values invented for a fixture and
    values an agency served are never recorded in the same store.
14. **Statuses use the release contract's words.** An adapter's `observed` is recorded as
    `final`, `unavailable` (BLS's `-`) as `missing` with no value, `preliminary` as itself. A
    status with no entry in that table is refused rather than guessed.

## Considered options

- **Float values.** Simpler and what a Release publishes, but not what the source said.
- **Leave rows alone on a metadata change and join the metadata history by time.** Fewer rows,
  but a value kept from outside a sliding window would be labelled with a unit it was never
  seen under.
- **Record additions and revisions from an incomplete answer.** Keeps more, at the cost of
  states nobody served.
- **Refuse a second Capture in the same second.** Retrieval times are whole seconds; a hand-off
  between two capture hosts could produce a tie, and refusing would lose a Capture.
- **A rebuild flag that swaps directories.** Three directories cannot be replaced in one step
  beside a live lock; a new directory is one decision by the operator.

## Consequences

- With today's register nothing can be captured, so there is nothing to replay. On the first
  real capture store `atlas replay` records the four BLS Series; Treasury and Fed Board
  Captures are reported as waiting and are replayed when M13 adds their parsers.
- A Capture that could not be recorded when its turn came (it no longer parses as whole) is
  passed over with a warning once later Captures are recorded. Including it means a new store.
- M9 reads `vintage(key)` and the state hash for the manifest; M10 reads the three logs for
  as-of answers and Capture gaps, and must count a confirmation only for the Periods in its
  scope.
- pyarrow is a dependency of the writer.
