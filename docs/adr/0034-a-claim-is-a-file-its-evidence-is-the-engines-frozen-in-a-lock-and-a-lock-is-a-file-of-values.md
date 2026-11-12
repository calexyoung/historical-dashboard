---
status: accepted (M20, 2026-11-12); D7 is open with Alex (its defaults are applied: Claims are drafts, no real Claim is committed); no real lock can be committed while no register row is signed
---

# A Claim is a file, its evidence is the engine's, frozen in a lock, and a lock is a file of values

M20 builds the claim engine and claim authoring: the Claim schema, Claims in the content
compiler, `atlas add claim`, the closed list of Measures, Window sensitivity, `atlas claims
compute`, lock files, `relock`, and the claim record rules in `atlas check`. ADR 0011 settled
what a Claim is (a record and locked evidence, no verdict). This records the choices the plan
left open. The contract for a person who records a Claim is `docs/method/claims.md`.

## Decisions

1. **A Claim is `content/claims/{id}.md`**: front matter held to `schema/claim.schema.json`
   (unknown fields refused at every level), then the quote, verbatim. The id is `said_on`, then
   a slug, and is permanent. No schema of a Claim, a lock, an Evidence row, a figure or a drift
   entry has a field for a finding, a rating, a label or a context flag, and a figure is a
   number or empty, never true or false. A judgment is a user's own, in that user's notes.
2. **The record rules are held for every Claim, a draft too** (`atlas check`, content layer):
   two or more sources with different addresses and different archived copies, each with a
   locator and a `kind` (recording, transcript, own publication, report); a selection note; a
   correction log that is always present; real days; a time (`said_at`) that falls on
   `said_on` in New York; Readings that are Readings of Series in the Catalog. A Claim's source
   has no `no_archive` exception, unlike an Event's. "Independent" is not something a program
   can establish: two hosts can carry one wire story, and one host two records. So the rule is
   mechanical (different addresses, each saying what kind of record it is), sources that share
   a host get a NOTE, and whether they are different records of the statement is the editor's.
3. **Macro Atlas's own text in a Claim is held to the word list; the quote never is.** The
   selection note and the Readings not measured: an error in a `public` Claim, a NOTE in a
   draft, as for an Event's text (ADR 0033).
4. **A Reading is one Series, one frequency, one Transform, one Measure** from the closed
   list: `value_at`, `change`, `extreme`, `rank`, `difference`. Which fields go with which
   Measure is one table that the engine (`readingProblem`) and `atlas check`
   (`reading_problem`) both apply, held together by `checks/claim-cases.json`. `rebase`, `z`
   and `drawdown` depend on a window, so they go only with a Measure that has one. A yearly
   Transform of a daily or weekly Series needs the Reading to say `freq`.
5. **The Periods are fixed before any value is looked at.** A `change` is between the first
   and the last Period that start inside the window, by the calendar. If one of them has no
   value the figure is empty and says why; no other Period stands in. So the *then*, *now when
   checked* and *latest* rows are about the same Periods, as ADR 0011 promises, and a deleted
   or late value cannot move an endpoint. `extreme` and `rank` are over the Observations in the
   window that have a value, and say how many (`n`, `of`); a tie for the extreme is the
   earliest Period; ranks are competition ranks. A percent change from zero or below is empty.
   A window with fewer than two Periods has no change, and the Reading is refused.
6. **The order is PLAN 4.5's: resolve the Vintage, aggregate, transform, measure.** A row
   rests on `resolve()` or `evaluateRecipe()` exactly as an as-of answer does, so its Basis is
   the weakest of everything it rests on, a stored Series held under more than one unit or
   definition at the Cutoff gives no answer, and an unavailable row holds no figure. Today's
   figure never stands in.
7. **Three rows.** *then*: as of `said_at` if the Claim has a time, else 00:00 New York on
   `said_on` (D7(b), the default). *now when checked*: the own state of the Release the lock
   is computed against, which claims no Basis; the lock says which Release, when it was
   created, when the Claim was checked (`locked_at`) and when each input was last captured.
   An as-of answer for `checked_on` would be "before midnight" and leave out that day's
   figures, so it is not used. `compute` refuses unless `checked_on` is the New York day it is
   run on: the row is today's, and the file says so. *latest*: the own state of each later
   Release, never in a lock.
8. **A lock freezes the record, not only the Readings.** `record_sha256` covers the quote,
   the claimant, the day and time, the venue, the sources, the Readings, the Readings not
   measured, the selection note and `checked_on`. Status, topics and the correction log are
   not frozen: publishing a Claim or logging a correction changes no evidence. A Claim whose
   record is not the one its newest lock froze fails `atlas check` and refuses every release,
   draft or public; the way through is to restore it or `relock`.
9. **A lock is never edited.** It carries `lock_sha256`, the hash of the rest of itself as
   Python serialises it (names sorted, no spaces); Python is the only writer and the only
   checker of that hash. A changed byte fails `atlas check` and refuses the release. A Release
   lists each lock with the hash of its file's bytes, which both release validators check.
   `compute` writes the first lock and refuses when one exists; `relock` needs a lock to
   follow and a reason, and writes the next version beside it. A lock is written whole or not
   at all (a temporary file, linked to its name; a link to a name that exists fails), and the
   Release it names is pinned before it is written.
10. **Python computes no figure.** `atlas claims compute` hands the engine the part of a Claim
    it reads and gets rows back (`atlas-core claim --release DIR --request FILE`, which reads
    the Release and writes no file). The engine's answer is held to the lock's schema before
    it is believed.
11. **A lock is a file of values, so where it lives follows the Profile.**
    `--profile public`: `content/claims/locks/`, for a person to commit; the gate must permit
    **display and redistribute**, on production, of every Origin, dataset and Channel the
    numbers came through, the history's included (ADR 0031: a file of values needs
    redistribute). `atlas check` asks again over every lock in the repository and refuses one
    computed on a local-profile Release, so copying a local lock into git does not pass.
    `--profile local`: `{local root}/locks/`, git-ignored with the root, asking no signature.
    That is how a real Claim is tried before any row is signed (Checkpoint A2). No row is
    signed today, so the repository holds no lock but the fixture's invented one.
12. **A Claim's locks come from one place.** A public-profile Release reads the repository's
    locks and never a local root's. A local-profile Release reads the repository's for a
    Claim that has any there, else the local root's; once a Claim is locked in the repository
    the local root's own locks for it are not read (the Release's check report says so) and
    `compute --profile local` refuses it.
13. **A Claim cannot be locked on v1's legacy representation**, or on a Derived series that
    rests on it: refused by the command with the reason, and by the engine.
14. **Release contract 0.4.0.** `content/claims.json` (required): the Claims, each with its
    locks by name. `locks/{id}.v{n}.lock.json`: the bytes that were written. A lock is listed
    `in_release`, or named without its numbers: `withdrawn` (the gate no longer permits what
    they came through, or a Series they rest on was withdrawn: PLAN 4.3's "numbers shown as
    withdrawn") or `not_carried` (the legacy converter, which runs no engine step).
    `evidence/latest.json`: present exactly when a lock has a latest row. Both validators hold
    the three to each other (`duplicate_claim_id`, `claim_lock`, `claim_evidence`) and refuse a
    draft Claim, a public Claim without a lock, and a local lock in a public-profile Release.
    0.1.0 to 0.3.0 Releases still open.
15. **The latest row and the drift report are the Node step's, at every release** (PLAN 4.4
    step 4), also on `--reuse-data` and on the Release a withdrawal promotes. For the newest
    lock of each Claim whose lock is in the Release, the engine computes each Reading's latest
    row and compares: the latest row with the locked *now when checked*, and the *then* row
    computed again on this Release with the locked *then*. Every difference is listed (a
    value, a Period, a Status, an empty reason, the unit, availability; the alternative
    windows too) and no cause is named: a Revision, a withdrawn history and a change of engine
    look the same from there. Drift fails nothing. The release prints `DRIFT` and its check
    report warns; only a person re-locks.
16. **The rights check of a Release asks about locks and latest rows** for as long as the
    Release is kept (`rights_problems`: release, reuse, rollback, pin, `atlas doctor`), and a
    withdrawal sees a Series whose values are held only in a lock or a latest row
    (`holds`), so the Releases that hold them are retired.
17. **`semantics_version` is 0.7.0**: Measures, Evidence rows and drift were added; no
    Transform, aggregation, Recipe or as-of rule changed.
18. **`atlas add claim` writes a draft or nothing**: the record with two archived sources and
    at most one Reading (more are an edit to the file). It has no option for a status or a
    finding.

## Considered and not done

- **Different hosts as the test of two independent sources.** See 2.
- **Hash only the Readings.** A quote or a source could then change under evidence that still
  passed. See 8.
- **Snap a change to the first and last Observations with a value.** Friendlier, and it lets a
  Revision move which Periods are compared. See 5.
- **now when checked as an as-of answer.** See 7.
- **Leave a Claim out of a Release when its lock may not be shown.** PLAN 4.3 promises the
  provenance stays and the numbers go. See 14.
- **A Claim Annotation on the time axis.** Explorer markers are M44's.
- **A second lock home chosen by flag.** The Profile already says what may be held where.

## Consequences

- When Alex signs a row for redistribution, a Claim on its Series can be locked with
  `--profile public` and committed; until then every real lock is local.
- The pin a lock leaves names the lock by hash, not the Claim: a public root holds nothing of
  a Claim that is not published.
- A latest row carries `release_id: "staged"`: it is computed before the Release has its id,
  and is of the Release whose file it is in.
- Changing the engine's semantics changes the fixture's lock and latest rows:
  `python fixtures/claims/make_claim.py` writes them again and a test says when.
- The ingest image holds no `content/` (ADR 0033), so a Release written inside it has no
  Claim. That belongs with M26.
- The claim page, the index, evidence downloads and twins are M21's; `claims.json` in the Read
  API is M24's.

## Tests

`packages/core/src/claim.test.ts` (Measures, edges, Window sensitivity against the
hand-computed `checks/claim-cases.json`, the three rows, what a lock freezes, drift);
`tests/v2/test_content_claims.py` (the file, the record rules, locks, `atlas add claim`);
`tests/v2/test_claims_release.py` (the slice story, compute and relock, a broken lock fails the
release, Profiles, a lock named without its numbers, withdrawal);
`checks/release-cases.json` through both validators (0.4.0); `tests/v2/test_fixture.py` (the
fixture's lock is the engine's answer).
