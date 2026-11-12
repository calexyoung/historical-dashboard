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

The IMF's endpoints (M14) are on the `imf` row and wait for it in the same way. The row has an
open question of its own: whether a daily request counts as the "automated bulk downloading"
its terms reserve. A run can leave a source out: `--only bls --only treasury-fiscal-data
--only fed-board` fetches the first three and does not ask about the IMF's row (on the host:
the variable `ATLAS_CAPTURE_ONLY`, below).

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
| `bls-headline` | `bls` | three POSTs: CPI-U (adjusted and not), unemployment rate, payrolls, the last thirty years | 125 KB |
| `bls-coverage` | `bls` | three POSTs: participation, core CPI, rent, hourly earnings, eggs, labor share, real weekly earnings, the last thirty years | 179 KB |
| `treasury-debt-to-penny` | `treasury-fiscal-data` | one GET: the whole Debt to the Penny table | 2.8 MB (0.26 MB gzipped) |
| `treasury-mts-summary` | `treasury-fiscal-data` | one GET: table 1 of the Monthly Treasury Statement, every statement | 1.9 MB |
| `fed-h15-treasury-yields` | `fed-board` | one GET: the H.15 Treasury yields package, whole history | 1.0 MB (0.25 MB gzipped) |
| `fed-h15-monthly` | `fed-board` | one GET: H.15 monthly averages | 115 KB |
| `fed-h10-daily-rates` | `fed-board` | three GETs: H.10 daily exchange rates, in spans from 1971, 1990 and 2010 | 2.3 MB |
| `fed-h10-daily-indexes` | `fed-board` | one GET: H.10 daily dollar indexes | 0.2 MB |
| `fed-h41-table5` | `fed-board` | one GET: H.4.1 table 5, Wednesday levels since 2002 | 0.8 MB |
| `fed-z1-households` | `fed-board` | one GET: Z.1 balance sheet of households and nonprofits | 127 KB |
| `fed-g17-major` | `fed-board` | one GET: G.17 major aggregates | 79 KB |
| `fed-g19-credit` | `fed-board` | one GET: G.19 consumer credit, seasonally adjusted | 74 KB |
| `fed-h6-monthly` | `fed-board` | one GET: H.6 monthly money stock | 138 KB |
| `fed-chgdel-delinquency` | `fed-board` | one GET: delinquency rates, all commercial banks | 23 KB |
| `imf-cpi-g20` | `imf` | one GET: the consumer price index of the nineteen G20 countries, monthly, whole history | 0.6 MB |
| `imf-er-g20` | `imf` | one GET: national currency per U.S. dollar, monthly average, sixteen currencies, whole history | 0.4 MB |

A run of the first three sources is 20 requests, at least a second apart per host, and took
37 seconds on 2026-11-11; the IMF's two endpoints (M14) add two requests and about 1 MB.
The answers come to about 11 MB before compression. Two runs a day add
at most that much when every source changes; a response that has not changed since earlier
the same day adds a log line and no blob, and git stores identical bytes once however many
days they recur. Most of these files change monthly or quarterly.

BLS without a key: ten years per request (a longer range is cut, with a message, and the job
flags that as incomplete), and a daily limit on requests that is believed to be 25 and has not
been confirmed from BLS's page, which refuses automated readers. The job makes six requests per
run, twelve a day at two runs. A third run on the same day would pass the believed limit: wait
for the next day. If Alex registers a BLS key later, adding it to the adapter is a small
change; nothing needs it now.

The Board's download program sometimes answers 200 with an empty body (a file it has not built
yet). The job asks again, up to three times. An `INCOMPLETE fed-h10-daily-rates` that says a
part "does not begin with the six label rows" on every run means a span has outgrown what the
program will send: add a year to that endpoint's `from_years` in the register.

## Starting it (GitHub, the recommended host)

Steps 1 to 5 are Alex's; the builder does not create repositories, variables or schedules.

1. Sign the rows of the sources the job is to fetch (D2), merge that change into `v2`, and note
   the commit's full SHA. The register lists endpoints on four rows: `bls`,
   `treasury-fiscal-data`, `fed-board` and, since M14, `imf`.
2. Create a **private** repository, for example `macro-atlas-captures`, with a README so it has a
   default branch. Add a `.gitignore` containing the one line `LOCK`.
3. In that repository's settings, under Actions → Variables, add `ATLAS_REF` with the SHA from
   step 1. Optionally add `ATLAS_CAPTURE_USER_AGENT`, for example
   `macro-atlas-capture/1 (contact: you@example.org)`, so an agency can reach a person; without
   it the job sends a generic name and no contact. If a row that lists endpoints is not signed
   yet (the `imf` row has an open question of its own), add `ATLAS_CAPTURE_ONLY` with the rows
   that are, separated by spaces: `bls treasury-fiscal-data fed-board`. Without it the job
   asks for every endpoint the register lists and one unsigned row fails the whole run.
4. Copy `deploy/capture/capture.yml` to `.github/workflows/capture.yml` there and commit.
5. Run it once by hand (Actions → capture → Run workflow) and read the Capture step. A clean run
   prints a `CAPTURED` line for each endpoint selected and commits their blobs, a fetch-log
   line each and two run lines.

To try the rights gate before any of that, on this machine:

```
.venv/bin/python -m atlas capture --dry-run     # lists the endpoints and the gate's answer
```

`ATLAS_REF` is a pin on purpose: the job obeys the register at that commit and uses the adapters
at that commit. After signing another row, changing an endpoint or fixing an adapter, move the
pin. A selected row that is unsigned at the pinned commit fails the whole run, by design: the
job fetches only what Alex has cleared, and `ATLAS_CAPTURE_ONLY` chooses among rows without
clearing any.

## Reading a run

| Line | Meaning | What to do |
|---|---|---|
| `CAPTURED id` | The source answered the whole of what was asked | Nothing |
| `INCOMPLETE id: …` | It answered, but not the whole (a BLS message, a page missing, a column gone). The bytes are kept and flagged; `atlas replay` never treats them as the state of a series | Read the reason. Usually the next run is whole; if the source changed shape, the adapter needs a fix |
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

`atlas replay` then builds the vintage store from these files, using each capture's
original retrieval time.

## Second choice: a cron entry on the VPS

If D6 is answered that way: a checkout of this repository at a pinned commit, a virtual
environment with `requests`, and one crontab line per run time with `CRON_TZ=America/New_York`
(10:45 and 17:30), each running `python -m atlas.capture --store /srv/macro-atlas/store` and
mailing its output. The store then needs its own nightly off-host copy (PLAN 4.3), which the
GitHub option gets for free.
