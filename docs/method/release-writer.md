# The release writer

How a Release is written from the vintage store, checked, promoted and kept (PLAN 4.3, 4.4,
6.1 and M9; ADR 0002, ADR 0004, ADR 0006, ADR 0020, ADR 0023). The code is `atlas/publish/`.

## The order of a refresh

```
python -m atlas capture      fetch the cleared endpoints, keep the bytes          (M7)
python -m atlas replay       record each Capture in the vintage store             (M8)
python -m atlas release --profile public     write and promote a Release          (M9)
```

A release run fetches nothing and records nothing in the store. It reads what the store holds
now. One job that does all three in order, on a timer, is the deploy kit's (M26).

## Two Profiles, two roots

| | `--profile public` | `--profile local` |
|---|---|---|
| Written to | `$ATLAS_PUBLIC` (default `var/public`) | `$ATLAS_LOCAL` (default `var/local`) |
| Holds | Only Series the rights gate permits for display on production | Everything the store holds, plus v1's legacy Series for every key the store does not hold |
| A Series the gate refuses | Withheld: named in the manifest with the reason, no file | Not applicable: the local Surface asks for no signature |
| v1's data | Never | As whole Series marked `legacy_monthly_rounded` |

A key the store holds from an Origin replaces v1's Series of the same key whole. A Series is
never part native and part legacy. `--no-legacy` writes a local Release of the store alone.

Both roots are git-ignored and outside the Docker build context.

## What a public Release publishes

For each Series the series table (`atlas/vintage/series.json`, until M12's Catalog) names and
the store holds, the writer decides one of three things.

**Published.** The gate permits display of exactly what the store holds: its Origin, dataset
and Channel as recorded with the values, in the native representation, on the production
Surface. The Release gets a Catalog entry, `series/{key}.json` and a manifest row with the
file's hash and the store's State hash.

**Withheld.** The Release gets a Catalog entry by name and a line in the manifest's
`withheld` list with the reason. No value of the Series is written anywhere in the root.
Reasons: the gate's own (no row, an unsigned row, a row that does not allow display, an
intermediary Channel that is not cleared); the Series was withdrawn; the source lists no
Observation for it now; or the store holds it under more than one definition or Channel (a
change of unit, name or Channel that has not reached every Period yet), which a Release cannot
show until the contract can.

**The run stops.** The store's own record of the Series is not whole: a record was cut off
part way, or the observation log is not the state the capture log recorded. `atlas replay`
finishes a record that was cut off.

A Series file is the latest Vintage at native frequency. Every Period between the first and
the last is present: one the source no longer lists is an explicit Observation with no value
and Status `missing`.

**Numbers.** The store keeps the provider's decimal text. A Release carries JSON numbers,
which every reader takes as doubles, so the value published is the double nearest the text.
When the shortest decimal that names that double is not the same number as the text (a figure
of more than about sixteen digits, such as a debt to the cent), the check report carries a
warning that names the Series. The exact text stays in the store.

**Not written yet.** `derived/` (the engine's, M11), `vintages/` (M10), search and bulk files
(M22, M25), and content other than an empty Annotations list (M19). A local Release carries
v1's Derived series and Annotations as the legacy converter writes them.

## The manifest

| Field | What the writer puts there |
|---|---|
| `profile`, `created`, `release_id` | The Profile; the time of the run; that time plus a hash of the files |
| `rights_register` | The register's `version` and the SHA-256 of the file's bytes, read once at the start of the run. `signed` is true when that register can be trusted and every Series published is permitted by it for display on production. It is false for any Release that holds a legacy Series. It authorises nothing: readers ask their own gate |
| `series` | One row per file: kind, hash, State hash, Channel, rights status, representation |
| `withheld` | Key and reason |
| `sources` | One line per Origin and Channel published from: the time of its last recorded Capture, and `ok`, `failed` (the last fetch of its Endpoint did not come back whole) or `stale` (a Capture not yet replayed, or a last Period older than `max_lag`) |
| `checks` | The report below |
| `inputs` | A local Release: v1's files, as the legacy converter records them |
| `reused_data_from` | A `--reuse-data` Release: the Release whose data files it links |

## Checks

Any `fail` rejects the Release: nothing is promoted, `CURRENT` is unchanged, and the report is
kept in `$ATLAS_STORE/rejected/{release_id}.json`.

| Check | Outcome when it finds something |
|---|---|
| Release contract (`schema/release.schema.json` and its cross-file rules) | fail |
| Rights, public Profile: every Series in the staged files, and every input of every Derived series to any depth, is native and permitted by the gate for display on production | fail |
| No Observation whose Period begins after the Release was written, unless projected | fail |
| Values within the Catalog's `range` | fail |
| No file for a withdrawn Series | fail |
| Staleness: the last Period is older than `max_lag` allows | warn |
| Values as doubles (above) | warn |

The rights check is asked of the staged files, not of what the export meant to write. In
normal running it finds nothing, because the export already withheld what the gate refuses.
It is there for the day the export is wrong.

## A release root

```
{root}/LOCK             held for the length of any change to the root
{root}/root.json        the root's Profile, and whether its values are an agency's or invented
{root}/CURRENT          the promoted release id
{root}/STATUS.json      the last run: started, finished, outcome, failed checks, reason
{root}/pins.json        releases retention must keep, each with what names it
{root}/withdrawn.json   Series taken down: reason, date, the releases retired
{root}/releases/{id}/   the Releases
{root}/trash/{id}/      pruned Releases; deleted a day after trash/{id}.json says
{root}/.staging/        a Release being written

$ATLAS_STORE/LOCK            the store's lock, shared with capture and replay
$ATLAS_STORE/runs.ndjson     release runs are lines marked "job": "release"
$ATLAS_STORE/rejected/       check reports of rejected Releases
$ATLAS_STORE/retired/        Releases moved out of a root by a withdrawal
```

A root is for one Profile and one kind of value from its first Release (`root.json`). A
Release of invented values, or one decided by a register other than the committed
`schema/rights-register.json`, is never written into `$ATLAS_PUBLIC` or `$ATLAS_LOCAL`: it
needs `--out` with another directory. That is how the tests and the demo run.

A root must stay apart from the store and from the other Profile's root, by any name; links
are resolved.

## What a run leaves when it fails

| What happened | What is left | The next run |
|---|---|---|
| Another run holds the root or the store | Nothing changed; the command exits 1 at once | — |
| Nothing may be published, the store is not whole, the register cannot be trusted | STATUS `refused` with the reason | — |
| A check failed | STATUS `rejected`, the report in `rejected/` | — |
| The disk filled while staging | Staging removed, STATUS `failed` | — |
| Killed while staging | Files in `.staging/`, STATUS `running` or `promoting` | Removes them |
| Killed after the rename into `releases/`, before `CURRENT` | A Release nothing names, STATUS `promoting` | Moves it to the trash |
| Killed, or the disk filled, after `CURRENT` was replaced | The Release is live; the run's record is missing | Records it as promoted |

`CURRENT` is replaced in one atomic step, and that step is the commit point. Before it,
`CURRENT` names the last good Release whatever happens. After it the Release is live, so a
failure to write the status or the journal is reported with exit status 1 and cannot be called
a rejection.

A provider that answers with an empty body or a page of HTML never reaches a Release: the
capture kit flags the answer, replay records nothing from it, and the Release is written from
the last good state with the source marked `failed`. A provider that goes on serving old data
gives a Release whose source is `stale`.

## Retention, pins, rollback

After each promotion the newest 30 Releases are kept, with `CURRENT` and every pinned Release.
The rest are renamed into `trash/` and deleted by the first run a day later. A reader that
opened a Release before it was pruned goes on serving it.

```
python -m atlas pin ID --profile public --reason "claim lock cpi-2022"
python -m atlas unpin ID --profile public
python -m atlas rollback ID --profile public
```

A rollback, a pin and `--reuse-data` each check the Release they point at as if it were new:
it is a real directory inside this root with no link in it, it passes the contract, it has the
root's Profile, it holds no withdrawn Series, and on a public root today's register permits
everything in it. A local-profile Release cannot be brought into a public root by any of the
three.

`python -m atlas release --profile P --reuse-data` writes a new Release that hard-links the
current one's data files and writes its content afresh. Until M19 the only content is the
Annotations file.

## Withdrawal

```
python -m atlas withdraw KEY --profile public --reason "the terms forbid redistribution"
```

For a permission that was wrong. In this order:

1. The withdrawal is written to `withdrawn.json`. From then on no release, rollback, pin or
   reuse takes a Release that holds the Series, and every later Release withholds it with the
   reason, whatever the register says.
2. A new Release, the current one without the Series and without anything computed from it,
   is promoted. If it cannot be, `CURRENT` is removed: the site answers 503 rather than go on
   serving the Series, until the next `atlas release` succeeds.
3. Every Release in the root that holds the Series, the trash included, is moved to
   `$ATLAS_STORE/retired/`.

Running the command again finishes a withdrawal that was cut off; `atlas doctor` fails while
one is unfinished. To allow the Series again, remove its entry from `withdrawn.json` by hand.

Un-signing a register row is not a withdrawal. The next `atlas release` then publishes nothing
of that Origin, but earlier Releases in the root still hold its values; `atlas doctor
--surface production` fails on each of them until `atlas withdraw` retires them.

## atlas doctor

`python -m atlas doctor` reports on this machine's roots and store and changes nothing: what
`CURRENT` names, whether every Release is valid and of the root's Profile, pins, a run that
did not finish, an unfinished withdrawal, the trash.

`python -m atlas doctor --surface production` is the preflight before a production deploy
(PLAN 6.1 point 5). It looks at `$ATLAS_PUBLIC` and exits 1 unless **every** Release in
`releases/` (a reader opens any of them by id):

- is public-profile, with a manifest that names a signed register;
- holds no Series in v1's legacy representation;
- has every Series, and every input of every Derived series, permitted for display on
  production by the **committed** rights register as it reads today. There is no option to
  name another register, and what the Release's own manifest says is not asked;
- holds no withdrawn Series;

and the root is a public-profile root of agency values, apart from `$ATLAS_LOCAL`, with no
link in it. `--surface staging` applies the same rule. Proving that a password covers staging
before a local-profile Release is served there is the deploy step's (M27).

With today's register, where no row is signed, the preflight cannot pass for any root that
holds a value.

## See it work

```
.venv/bin/python fixtures/release/demo.py
.venv/bin/python -m pytest tests/v2 -q -k publish
```

The demo runs the real commands over M8's three-fetch fixture (invented values of a made-up
Origin, under the fixture's own test register) in a temporary directory.
