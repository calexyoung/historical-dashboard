# Capture host kit

A ready-to-copy scheduled workflow, and the runbook for the host that runs the interim capture
job (PLAN 4.7 and M7; ADR 0012, ADR 0021; method in `docs/method/capture.md`).

**Nothing here runs.** `capture.yml` is not under `.github/workflows` and this repository
schedules nothing. Starting the job takes two decisions that are Alex's and are still open:

- **D2**: the rights register rows for the first three sources (`bls`, `treasury-fiscal-data`,
  `fed-board`) are signed and allow `store`. Until then `atlas capture` stops at the rights gate,
  fetches nothing and exits 1. See "How Alex signs a row" in `docs/v2/rights-register.md`.
- **D6**: where the job runs. The plan recommends a separate private GitHub repository whose
  scheduled workflow commits each day's captures to itself. It has not been created, and whether
  GitHub Actions is billed for private repositories on Alex's account has not been confirmed.

Every day between the day both are answered and the day the job starts is a day of
Atlas-observed history that cannot be recovered.

## What the job is

`python -m atlas.capture` reads its endpoint list from `schema/rights-register.json`, asks the
rights gate about each endpoint, fetches each one once, and appends to a store directory:

```
raw/{source}/{yyyy-mm-dd}/{sha256}.gz   exact bytes of each response
fetchlog.ndjson                         one line per capture: time, request, headers, evidence
runs.ndjson                             one line per run
```

It needs Python 3.11 or later and `requests`. No Node, no pandas, no API key, no secret.

| Endpoint | Row | What one run asks for | Size on 2026-11-11 |
|---|---|---|---|
| `bls-headline` | `bls` | one POST: CPI-U (adjusted and not), unemployment rate, payrolls, last ten years | 42 KB |
| `treasury-debt-to-penny` | `treasury-fiscal-data` | one GET: the whole Debt to the Penny table | 2.8 MB (0.26 MB gzipped) |
| `fed-h15-treasury-yields` | `fed-board` | one GET: the H.15 Treasury yields package, whole history | 1.0 MB (0.25 MB gzipped) |

Two runs a day add about 0.5 MB a day when the sources change daily, a few hundred MB a year.
A response that has not changed since earlier the same day adds a log line and no blob, and git
stores identical bytes once however many days they recur.

BLS without a key: ten years per request (a longer range is cut, with a message, and the job
flags that as incomplete), and a daily limit on requests that is believed to be 25 and has not
been confirmed from BLS's page, which refuses automated readers. The job makes one request per
run. If Alex registers a BLS key later, adding it to the adapter is a small change; nothing
needs it now.

## Starting it (GitHub, the recommended host)

Steps 1 to 5 are Alex's; the builder does not create repositories, variables or schedules.

1. Sign the three rows (D2), merge that change into `v2`, and note the commit's full SHA.
2. Create a **private** repository, for example `macro-atlas-captures`, with a README so it has a
   default branch. Add a `.gitignore` containing the one line `LOCK`.
3. In that repository's settings, under Actions → Variables, add `ATLAS_REF` with the SHA from
   step 1. Optionally add `ATLAS_CAPTURE_USER_AGENT`, for example
   `macro-atlas-capture/1 (contact: you@example.org)`, so an agency can reach a person; without
   it the job sends a generic name and no contact.
4. Copy `deploy/capture/capture.yml` to `.github/workflows/capture.yml` there and commit.
5. Run it once by hand (Actions → capture → Run workflow) and read the Capture step. A clean run
   prints three `CAPTURED` lines and commits three blobs, three fetch-log lines and two run lines.

To try the rights gate before any of that, on this machine:

```
.venv/bin/python -m atlas capture --dry-run     # lists the endpoints and the gate's answer
```

`ATLAS_REF` is a pin on purpose: the job obeys the register at that commit and uses the adapters
at that commit. After signing another row, changing an endpoint or fixing an adapter, move the
pin. A row that is unsigned at the pinned commit fails the whole run, by design: the list holds
only what Alex has cleared.

## Reading a run

| Line | Meaning | What to do |
|---|---|---|
| `CAPTURED id` | The source answered the whole of what was asked | Nothing |
| `INCOMPLETE id: …` | It answered, but not the whole (a BLS message, a page missing, a column gone). The bytes are kept and flagged; M8 will not treat them as the state of a series | Read the reason. Usually the next run is whole; if the source changed shape, the adapter needs a fix |
| `FAILED id: …` | No usable answer after four tries | Usually the next run succeeds. A day with no whole capture becomes a missed day |
| `MISSED id: dates` | Finished days (New York time) with no whole capture of that endpoint, counted from the first run that selected it | Nothing can recover them. They become Capture gaps, and as-of answers across them are marked uncertain |
| `REFUSED …` | The rights gate, the register or the store lock stopped the run before any request | Fix what it names |

A run that is not clean ends red, after committing whatever it did fetch. GitHub disables
scheduled workflows in a repository with no activity for 60 days; the daily commits prevent
that as long as the job runs.

### If a push fails

The job commits what it captured and pushes, three times. If the push still fails, the run ends
red and its commits are attached to the run as an artifact, `unpushed-captures-<run id>`, kept
90 days. A capture cannot be made again (a re-run fetches a later observation), so recover it:
download the artifact, and in a clone of the capture repository run
`git pull /path/to/unpushed-captures.bundle HEAD`, then `python -m atlas.capture --store .
--verify`, then push.

`python -m atlas.capture --store DIR --status` prints, per endpoint, the last whole capture and
the missed days, without fetching.

## The hand-off to the VPS

When staging exists (M27) capture moves to the server's timer. Captures must not be lost or
doubled on the way:

1. Disable the workflow in the capture repository (Actions → capture → Disable workflow). Wait
   for a run in progress to finish.
2. Clone the capture repository and run `python -m atlas.capture --store <clone> --verify`. It
   must say every blob is present and unaltered.
3. Copy `raw/`, `fetchlog.ndjson` and `runs.ndjson` into the server's `$ATLAS_STORE`, and run
   `--verify` again there. The two outputs must give the same counts.
4. Start the server's timer. Its first run reports any day missed during the hand-off as
   `MISSED`.
5. Keep the capture repository, read-only, as the off-host copy of the interim captures.

M8's `atlas replay` then builds the vintage store from these files, using each capture's
original retrieval time.

## Second choice: a cron entry on the VPS

If D6 is answered that way: a checkout of this repository at a pinned commit, a virtual
environment with `requests`, and one crontab line per run time with `CRON_TZ=America/New_York`
(10:45 and 17:30), each running `python -m atlas.capture --store /srv/macro-atlas/store` and
mailing its output. The store then needs its own nightly off-host copy (PLAN 4.3), which the
GitHub option gets for free.
