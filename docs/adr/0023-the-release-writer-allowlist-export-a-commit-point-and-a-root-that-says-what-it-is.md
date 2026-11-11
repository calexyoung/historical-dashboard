---
status: accepted (M9, 2026-11-11); has written no agency data yet (D2 is open, no row is signed)
---

# The release writer: an allowlist export, one commit point, and a root that says what it is

PLAN 4.3 and 4.4 describe a publisher that exports from the vintage store, checks, and promotes
by replacing `CURRENT`. PLAN 6.1 says where it must fail closed. M9 builds it (`atlas/publish/`).
This records the choices the plan left open and the places M9 departs from it.

## Decisions

1. **Withholding is the export's; refusing is the publisher's.** The export leaves out every
   Series the rights gate does not permit for display on production and names it on the
   withheld list. The publisher then asks the gate again about the staged files themselves:
   every Series file and every input of every Derived series, to any depth. In normal running
   the second check finds nothing. A Release that fails it is rejected, not trimmed.
2. **Rights are asked about what the store holds, row by row.** A Series is published under one
   Origin, dataset and Channel only when every current row was recorded under them. ADR 0022
   lets rows outside a Capture's scope keep older metadata; a Series held under two
   definitions or two Channels is withheld until a Release can show that. The Rights recorded
   at each Capture are history and are not compared.
3. **The store must be whole.** Before export, `VintageStore.problem(key)` checks that no
   record was cut off and that the observation log hashes to the State hash the capture log
   recorded. Otherwise the run stops: a lock does not make a half-written record whole.
4. **A JSON number is the nearest double** (ADR 0022 decision 6 left this to M9). The contract
   stays at numbers in `0.1.0`. When the shortest decimal naming that double differs from the
   provider's text, the check report warns and names the Series. A text that is not a finite
   double stops the run. A contract field for the exact text can come with a later version.
5. **Two locks, in a fixed order: the root's, then the store's.** PLAN 4.3 names one `LOCK`,
   in the store. That does not serialise two stores writing one root, nor a rollback or a
   legacy conversion. Every command that changes a root holds `{root}/LOCK`, and then the
   store's, which capture and replay also take. `atlas legacy-release` now takes the root's
   lock too.
6. **`CURRENT` is the commit point, and STATUS.json is the intent record.** A run writes
   `promoting` with the release id before the rename into `releases/`. The next run reads it:
   if `CURRENT` names that Release, the promotion happened and is recorded; if not, a Release
   nothing names is moved to the trash. After the commit point a failed write is reported with
   exit status 1 and outcome `promoted`, never as a rejection. Rollback, pin and withdrawal
   run the same recovery first, so a Release a killed run left unnamed cannot be pinned into
   staying. The journal line is written before the status, and recovery writes the line a
   cut-off promotion never got: a duplicate line is possible, a missing one is not.
7. **A root says what it is, once** (`root.json`): its Profile and whether its values are an
   agency's or invented. A Release of the other kind is refused from then on. A Release of
   invented values, or one decided by a register other than the committed file, is never
   written into this machine's `$ATLAS_PUBLIC` or `$ATLAS_LOCAL`. Tests and the demo therefore
   run the real commands with `--register` and `--out`, and cannot reach the real roots.
8. **Rollback, pin and reuse check the Release as if it were new**: a real directory inside
   the root, no link, the contract, the root's Profile, nothing withdrawn, and on a public
   root the register as it reads now. `--reuse-data` takes this root's `CURRENT` and nothing
   else.
9. **`signed` in the manifest follows from the gate.** It is true when the register read for
   the run can be trusted and every published Series is permitted by it for display on
   production; so it is false for any Release with a legacy Series, and true for a public
   Release that publishes nothing. It stays what ADR 0020 made it: a second check that
   authorises nothing.
10. **A Release that publishes no Series is written only to replace one that publishes some.**
    That is how values leave `CURRENT` when a row is unsigned. With nothing to replace, a
    public release run with nothing permitted is refused and creates nothing.
11. **Withdrawal is recorded before it is carried out, and fails closed.** `withdrawn.json` is
    written first and is honoured by release, reuse, rollback, pin and doctor. If no
    replacement Release can be promoted, `CURRENT` is removed and the site answers 503.
    Retired Releases go to the store, which no web container mounts. After the first write
    nothing stops the rest: a journal that cannot be written is reported and passed over.
    The legacy converter refuses a root with a withdrawal. And the site's reader now serves
    a Release from memory only while its directory is still in `releases/`: before M9 a
    Release that had been opened once was served until the process restarted, which would
    have kept a withdrawn value up. This also means a pruned Release is gone for the next
    request, where M1's reader went on serving it.
12. **The preflight asks the committed register and checks every Release in the root.**
    `atlas doctor --surface production` has no register option and does not read a manifest's
    word for what was allowed. A reader opens any Release by id, so one unfit Release anywhere
    in `releases/` fails the root. A root with no `root.json`, or one of invented values, fails.
13. **Release runs share `runs.ndjson` with capture**, as lines marked `"job": "release"`,
    with a start and a finish line and the root and store they used. Capture's readers skip
    them. The finish line of a promotion lists each published key with its State hash: the
    record ADR 0022 decision 10 asked M9 to keep of what each Release published.

## Not in M9

- Fetching and recording inside the release run (PLAN 4.4 step 1). The three commands are run
  in order; one job that does so is the deploy kit's (M26).
- The Node step, `derived/`, spot checks, claim locks and search (M11, M20, M22).
- `vintages/`, bulk files and `datapackage.json` (M10, M25).
- The page a pinned link to a retired or pruned Release shows (`410 Gone`): the site's.
- Proving a password on staging (M27).

## Considered options

- **Refuse a public release when any Series lacks a signed row.** The acceptance criterion
  reads that way for a staged Release, and decision 1 does that. Applied to the store it would
  stop every release until every source is signed, and the withheld list would have no use.
- **One lock in the store.** As planned; see decision 5.
- **Trust the manifest's `signed` in the preflight.** It is written by the code under check.
- **Keep retired Releases in the root, unlinked.** "Hidden" must mean absent (PLAN 4.3).

## Consequences

- With today's register `atlas release --profile public` refuses and creates nothing, and the
  production preflight cannot pass for a root that holds a value.
- `atlas release --profile local` can replace `atlas legacy-release` once a real store exists:
  it writes the same Release plus the Origin's own Series for the keys captured. Until then
  `make v2` is unchanged.
- The series table gains a `catalog` block per Series (Measure kind, Segment, continuity, the
  range and staleness limits). It is outside the dated metadata, so adding it revises nothing.
- Un-signing a row takes its values out of the next Release but not out of earlier ones in the
  root; `atlas withdraw` does that, and the preflight fails until it has.
