---
status: accepted (M10, 2026-11-11); resolves no agency data yet (D2 is open, no row is signed)
---

# Vintage resolution: two clocks never mixed, a vintage file in the Release, history under the gate

ADR 0005 says every as-of answer states its Basis and an unavailable one is never filled with
today's figure. ADR 0022 built the store those answers come from. M10 builds the resolver in
`packages/core` and gives a Release the rows it reads. This records the choices PLAN 4.3 and 4.5
left open. The contract is `docs/method/vintage-resolution.md`.

## Decisions

1. **A Release carries `vintages/{key}.json`, and the contract moves to 0.2.0.** One file per
   stored Series: every version of every Observation, the metadata history and the complete
   Captures with their scope. The manifest row vouches for it with `vintages_sha256`. 0.2.0 only
   adds, so readers still read 0.1.0, as a Release that holds no vintage file: the Releases
   already kept in a root (and anything pinned later) stay valid. Writers write 0.2.0.
2. **Both validators check the file, as a last stage.** Versions in Period order, never two
   held at once, one current at most, metadata they name, a Channel that is their metadata's,
   and the versions current now equal to the Series' own file once its gaps are written out. A
   vintage file for a withheld Series, a legacy Series or a Series with no file is refused.
3. **Past values are values.** The writer gives a vintage file only to a Series it publishes. In
   a public-profile Release it also asks the gate about every Origin, dataset and Channel the
   history came through. If one is refused, the Series is still published (what is current
   passed on its own) and the history is left out, with a warning in the check report. The
   check over a Release's files that `atlas doctor --surface production`, rollback, pin and
   reuse run reads those lineages from the file too, against today's register. What a register
   said when bytes were fetched is carried as a record and authorises nothing.
4. **Recorded metadata is published as a fixed selection.** Name, unit, adjustment, Source, and
   the licence class and attribution the register gave that day. The store keeps whatever it
   was handed; a Release shows only fields the schema names, so nothing rides along in a line
   of history.
5. **Two clocks, never mixed in one answer.** A retrieval time is an upper bound on a
   publication time, so ordering versions by "whichever time is known" would be wrong: Macro
   Atlas can hold a figure on the 10th and later learn the Origin revised it on the 8th. Inside
   the span the Origin's record is known complete (`provider_coverage`) an answer uses only
   versions the Origin dated. Outside it the answer is what Macro Atlas held.
6. **The Cutoff is strictly before 00:00 New York on the date asked about**, or the instant
   asked about. A version dated only to the day never counts on that day. This is D7's
   recommended default and stays open with Alex.
7. **`uncertain` is decided per Observation, by the Captures that asked about its Period.** Any
   whole New York day unseen between the last such Capture and the Cutoff makes it uncertain,
   and the answer claims the weakest Basis among its Observations. A later Capture that found
   nothing changed does not upgrade the answer; it is reported (`changed_across`).
8. **A legacy Series is dated by the one time a legacy Release has**, when v1 generated its
   output. Later Cutoffs get the `legacy` Basis; earlier ones are unavailable.
9. **`resolve()` is the only reader of the rows**, and it is pure. A test bundles
   `@macro-atlas/core` for the browser and fails if a Node built-in is imported.
10. **No page changes.** The reader opens vintage files and `asOf()` answers; `?as_of=`, the
    vintage table and the Basis badge are M17 and M18.

## Considered options

- **Order versions by one "known" time, the Origin's if present, else Macro Atlas's.** Simpler,
  and wrong whenever an archive is imported after Macro Atlas began watching.
- **Withhold the whole Series when part of its history is not permitted.** Safer to state, but
  it takes down values that pass the gate on their own; ADR 0023 withholds what is refused, no
  more.
- **Publish the store's metadata as it is.** One less mapping, and an open door for whatever a
  future adapter puts in a metadata line.
- **Upgrade `uncertain` when the next Capture is a confirmation.** Usually right, but it rests
  on a figure not having changed and changed back, and PLAN 4.7 says a gap downgrades.
- **Refuse 0.1.0 Releases.** One version to think about, but every Release already kept in a
  local root would fail `atlas doctor` for a change that took nothing away from them.

## Consequences

- A series with periods that have left its source's window is `uncertain` as a whole while its
  recent Periods are `atlas_observed`. A page or a Measure that uses only some Periods should
  claim the weakest Basis among those (M17, M20).
- The Capture gap counts days, not scheduled runs: a failed second run on a day with a first
  one is not seen as a gap.
- The reader holds every vintage file of an open Release in memory. That is small for monthly
  Series; daily Series with long histories will want reading on demand (M17 or M25).
- No adapter supplies provider times yet. The `provider` path is specified, tested and carried
  by the fixture release, and waits for M30.
- Derived series have no as-of answer until M11 resolves each input.
