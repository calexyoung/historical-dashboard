# Macro Atlas deploy runbook

Every step of putting Macro Atlas on the server and keeping it there, in order (PLAN 4.7, 4.8,
6.1, M26 to M28; ADR 0008, ADR 0015, ADR 0040). Each step says who does it:

- **[ALEX]** a manual step. It needs a credential, costs money, changes something outside this
  repository, or is a production deploy. The builder never does these.
- **[SCRIPT]** one command from `deploy/`. On the server a person still starts it.

Nothing in this repository deploys, schedules or installs anything by being merged. The local
test of the whole kit is `make v2-deploy-smoke` (below, "Trying it on your own machine").

## What is still open

These are Alex's and the kit does not settle them. Each has the default the plan recommends,
which is what the files here do.

| | Question | What the kit does meanwhile |
|---|---|---|
| D2 | Which rights-register rows are signed | `server.env.example` lists the rows signed on 2026-11-12 in `ATLAS_CAPTURE_ONLY`. An unsigned row is never asked and never published |
| D6 | Where the interim capture job runs | Nothing runs anywhere. If a capture repository exists by the time staging does, "The capture hand-off" moves it over |
| D9 | A password on staging | `Caddyfile.snippet` asks for one on every staging path |
| | Which Surface asks the agencies | See "One timer captures", below. Decide before the second timer is enabled |
| | The off-host backup target | Not chosen. Until `ATLAS_BACKUP_REMOTE` is set, backups sit on the same disk as the data |

## The files

| File | What it is |
|---|---|
| `compose.yaml` | The server's two services: `web` (always on, loopback only, root read-only) and `ingest` (the writer, run to completion). One file, two builds |
| `production.env`, `staging.env` | Each build's Surface, base path, loopback port and directories. Committed; no secret |
| `server.env.example` | What goes in the server's own environment file: the two API keys and the host's choices |
| `Caddyfile.snippet` | The two routes for the shared Caddy, staging behind a password |
| `systemd/` | Four unit files: the refresh timer and the backup timer, each a template by Surface |
| `deploy.sh` | Preflight, build, start, check. The only way a web container is started on the server |
| `refresh.sh` | The timer's job: capture, replay, release |
| `backup.sh`, `restore.sh` | One checked archive of the store and the root; putting one back |
| `handoff.sh` | The interim Captures into the server's store, once |
| `atlas.sh` | Any `atlas` command in the writer's container (doctor, rollback, withdraw, capture --status) |
| `headroom.sh` | Read-only: is there room on the machine |
| `check-staging-auth.sh` | From outside: does staging ask for the password on everything |
| `smoke.sh`, `smoke/` | The local test of all of the above behind a throwaway Caddy |
| `lib.sh` | Shared by the scripts; not run |
| `Dockerfile`, `ingest.Dockerfile`, `ingest.Dockerfile.dockerignore`, `scan_image.py`, `check-images.sh`, `compose.web.yaml` | The two images and their own test (`README.md`) |
| `capture/` | The interim capture host kit (D6) |

## The server's layout

```
/srv/macro-atlas/
  checkout/                     this repository at the deployed commit
  production/store  production/public      ATLAS_DATA_DIR of production
  staging/store     staging/public         ATLAS_DATA_DIR of staging
  backups/production  backups/staging      ATLAS_BACKUP_DIR
  env/production.env  env/staging.env      the keys and the host's choices (mode 600)
  env/backup.env                           ATLAS_BACKUP_REMOTE (mode 600), optional
```

Variables the kit reads, and where each is set:

| Variable | Set in | Meaning |
|---|---|---|
| `ATLAS_SURFACE`, `BASE_PATH`, `ATLAS_WEB_PORT` | `deploy/<surface>.env` | The build: `production` at `/macro-atlas` on 3101, `staging` at `/macro-atlas-staging` on 3102 |
| `ATLAS_DATA_DIR` | `deploy/<surface>.env` | Holds `store/` and `public/` |
| `ATLAS_BACKUP_DIR` | `deploy/<surface>.env` | Where archives are written |
| `ATLAS_SERVER_ENV` | `deploy/<surface>.env` | The path of the server's own environment file |
| `BEA_API_KEY`, `EIA_API_KEY` | the file `ATLAS_SERVER_ENV` names | The two free keys. Reach the `ingest` container only |
| `ATLAS_CAPTURE_ONLY`, `ATLAS_CAPTURE_USER_AGENT` | the file `ATLAS_SERVER_ENV` names | Which signed rows to ask; who to name to an agency |
| `ATLAS_BACKUP_REMOTE`, `ATLAS_BACKUP_KEEP` | `/srv/macro-atlas/env/backup.env` | The off-host rsync destination; how many archives stay locally (default 14) |
| `ATLAS_STAGING_USER`, `ATLAS_STAGING_PASSWORD_HASH` | Caddy's own environment | The staging account. Never in this repository |
| `ATLAS_PRODUCTION_UPSTREAM`, `ATLAS_STAGING_UPSTREAM` | nowhere on the server | Only `smoke.sh` sets them. Unset, Caddy dials `127.0.0.1:3101` and `:3102` |
| `ATLAS_STAGING_PASSWORD` | your shell, for one command | Only for `check-staging-auth.sh`'s second half |
| `ATLAS_INGEST_TAG` | nowhere; `deploy.sh` sets it for itself | Which writer image compose names: `candidate` during a deploy, otherwise `latest`, which the timers run |
| `ATLAS_WAIT_SECONDS` | nowhere, normally | How long a refresh or a backup waits for the other (default 1800) |
| `ATLAS_PROJECT`, `HEADROOM_*` | nowhere on the server | Test overrides |

## 1. The server, once

1. **[ALEX]** Log in to the VPS with your own SSH user and key. The builder has neither.
2. **[ALEX]** Make the layout, owned by the writer's user. The `ingest` container runs as uid
   10001 and must be able to write the store, the root and the backups; the `web` container
   runs as another non-root user and only reads `public/`, which the writer leaves readable.

   ```
   sudo mkdir -p /srv/macro-atlas/{production,staging}/{store,public} \
                 /srv/macro-atlas/backups/{production,staging} /srv/macro-atlas/env
   sudo chown -R 10001:10001 /srv/macro-atlas/production /srv/macro-atlas/staging /srv/macro-atlas/backups
   sudo chmod 700 /srv/macro-atlas/env
   ```

   Make them before anything is started: a directory Docker has to make for a mount is
   root's, and the writer could not write to it. `deploy.sh` refuses when one is missing.
3. **[ALEX]** Clone the repository to `/srv/macro-atlas/checkout` and check out the commit to
   deploy (a full SHA from `v2`, later from `main`). Deploy from a commit, never from a moving
   branch.
4. **[SCRIPT]** `deploy/headroom.sh staging`. It prints memory, disk, processors and what
   Docker already runs, and ends `HEADROOM: enough` or `not enough`. Its minimums are budgets
   written in the script, not measurements of this VPS: on a development machine each web
   container used about 75 to 120 MB at rest. If it says no, stop and decide what to move.
5. **[ALEX]** Place the keys. Copy `deploy/server.env.example` to
   `/srv/macro-atlas/env/staging.env` (and later `production.env`), fill in `BEA_API_KEY` and
   `EIA_API_KEY`, set `ATLAS_CAPTURE_ONLY` to the rows that are signed in the commit you
   checked out, and `chmod 600` it. The file is read by Docker as the user who starts the
   job, and its contents reach the `ingest` container only. Do not paste a key anywhere else.

## 2. Caddy

6. **[ALEX]** Make the staging account. `caddy hash-password` asks for a password and prints
   a bcrypt hash. Put `ATLAS_STAGING_USER` and `ATLAS_STAGING_PASSWORD_HASH` in Caddy's own
   environment (its unit's `Environment=` or its environment file), not in a file here.
7. **[ALEX]** Apply the snippet: inside the existing site block of the host, add
   `import /srv/macro-atlas/checkout/deploy/Caddyfile.snippet` (or paste its directives).
   Run `caddy validate` on the whole configuration, then reload Caddy. The Caddy
   configuration lives outside this repository and outside the /missions one.
   - Keep exactly one proxy in front, and set no `trusted_proxies`: the app counts requests
     by the last address in `X-Forwarded-For` (`README.md`, "The proxy in front").
   - With the two variables unset there is no account, and staging answers 401 to everyone.
8. **[SCRIPT]** `deploy/check-staging-auth.sh https://HOST/macro-atlas-staging`, from a machine
   that is not the server. It must end
   `STAGING AUTH OK`. With `ATLAS_STAGING_USER` and `ATLAS_STAGING_PASSWORD` in your shell it
   also checks that the password lets you in. Before the web app is started every path
   answers 401 without the password and 502 with it; that is expected at this step.
9. **[ALEX]** Check from outside that the container ports are closed:
   `curl -m 5 http://HOST:3101/` and `:3102` must fail to connect. They are bound to
   127.0.0.1 by `compose.yaml`; this checks the firewall agrees.

## 3. The first Release and the first deploy (staging)

10. **[SCRIPT]** `deploy/deploy.sh staging`. The first time it **stops at the preflight, as it
    should**: there is no Release to serve. It has built the writer's image, which the next
    steps need. (On every later deploy the writer the timers run is replaced only once the
    deploy has succeeded.)
11. **The capture hand-off**, only if a capture repository exists (D6). Captures cannot be
    made again, so none may be lost or doubled:
    1. **[ALEX]** In the capture repository: Actions → capture → Disable workflow. Wait for a
       run in progress to finish. From here until step 13 no Capture is being made anywhere.
    2. **[ALEX]** Clone it on the server, for example to `/srv/macro-atlas/handoff`.
    3. **[SCRIPT]** `deploy/handoff.sh staging /srv/macro-atlas/handoff`. It checks every blob
       of the clone, refuses a store that already holds Captures, copies `raw/`,
       `fetchlog.ndjson` and `runs.ndjson`, checks the store the same way, and compares the
       counts. It must end `handoff: N captures and M blobs are in ...`.
    4. **[SCRIPT]** `deploy/refresh.sh staging --no-capture` replays them under their
       original retrieval times and writes the first Release.
    5. **[ALEX]** Keep the capture repository, read-only, as the off-host copy of the interim
       Captures. Do not enable its workflow again: two capture jobs would double every day.
12. **[SCRIPT]** `deploy/refresh.sh staging`. The first run that asks the agencies. Read its
    output: `CAPTURED`, `INCOMPLETE`, `FAILED`, `STALE`, `MISSED` and `REFUSED` mean what
    `capture/README.md` ("Reading a run") says. It ends `refresh: a Release was promoted`.
13. **[SCRIPT]** `deploy/deploy.sh staging` again. Now the preflight has a Release to read. It
    refuses a local-profile Release, an unsigned register and a legacy Series, in any Release
    in the root; when it refuses, nothing is built for the web app and nothing is started. When it passes
    the script builds the web image, starts it, waits for its health check and asks it over
    loopback which build it is.
14. **[ALEX]** Open `https://HOST/macro-atlas-staging/` with the password, and run step 8
    again. All seven paths must now answer 200 with the password.

## 4. The timers

15. **[ALEX]** Install and start them. The builder never does this.

    ```
    sudo cp /srv/macro-atlas/checkout/deploy/systemd/macro-atlas-*@.* /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now macro-atlas-ingest@staging.timer macro-atlas-backup@staging.timer
    systemctl list-timers 'macro-atlas-*'
    ```

    The refresh runs at 10:45 and 17:30 and the backup at 03:15, by New York's clock in winter
    and summer alike; a run missed while the machine was down is made up at start-up. The
    units expect the layout above and run as root. To run them as another user, add `User=`
    in a drop-in and give that user Docker and the files in `env/`.
16. **[ALEX]** **One timer captures.** The store of each Surface is its own, and each `refresh` asks the
    agencies. BLS without a key is believed to allow 25 requests a day, and one store asking
    twice a day uses 12, so two Surfaces capturing would sit at the limit. Before enabling a
    second `macro-atlas-ingest@...timer`, decide which Surface asks. The other can publish
    what its store holds with `deploy/refresh.sh <surface> --no-capture`, but its store is
    then only as new as its last restore or hand-off. This is open for M27 and M28.
17. **Reading a failure.** `systemctl status macro-atlas-ingest@staging.service` and
    `journalctl -u macro-atlas-ingest@staging.service -n 200`. A red run means one of three
    things, and its last line says which: a source did not answer whole (what the store
    holds was still published, and the next run asks again); no Release was promoted
    (`CURRENT` is as it was); or a Release was promoted and the run failed after that (the
    new Release is being served; read the lines above it). Also: `deploy/atlas.sh staging doctor`, `deploy/atlas.sh staging capture --status`,
    `/srv/macro-atlas/staging/public/STATUS.json`, and `/api/health` on the site, whose
    `age_seconds` is the age of the Release being served.

## 5. Backups

18. **[ALEX]** Choose the off-host target (this may cost money, and its credential is yours).
    Put one line in `/srv/macro-atlas/env/backup.env`, mode 600:
    `ATLAS_BACKUP_REMOTE=user@host:/path` (anything `rsync` accepts). `backup.sh` then copies
    the backup directory there after each backup and never deletes anything there; pruning
    the remote is yours. Until this is set every backup ends with a note that it is on the
    same machine as what it backs up. M27's restore drill needs the off-host copy.
19. **[SCRIPT]** `deploy/backup.sh staging` by hand once, to see it. A backup and a refresh
    share a lock in the store: whichever comes second waits for the first, up to half an
    hour (`ATLAS_WAIT_SECONDS`), and is refused after that. The archive is read back and checked before it gets
    its name, and the newest 14 stay.
20. **What a backup holds, and does not.** It holds `store/` and `public/` whole: every
    Capture, the vintage store, every kept Release with its Claim locks, pins and saved
    queries. An archive is as private as the root it came from: a backup of a local-profile
    root holds v1's data, and a backup taken before a withdrawal still holds the withdrawn
    Series (see "Withdrawing a Series"). It does **not** hold the code, the rights register,
    the Catalog or `content/`, which are this repository at the commit in
    `deploys.log`; nor the keys and the staging password, which are yours; nor the Caddy
    configuration.

## 6. Restore

The drill and the real thing are the same steps. Do the drill on staging before production
exists (M27).

21. **[ALEX]** Stop the timers of that Surface:
    `sudo systemctl stop macro-atlas-ingest@staging.timer macro-atlas-backup@staging.timer`,
    and wait for a run in progress (`systemctl status macro-atlas-ingest@staging.service`).
22. **[ALEX]** Stop the web app: `docker compose -p macro-atlas-staging down`. A running
    container keeps the directory it was started on and would go on serving the old one;
    `restore.sh` refuses while it runs.
23. **[ALEX]** Move what is there aside, and make the parent writable by the writer:

    ```
    sudo mv /srv/macro-atlas/staging/store /srv/macro-atlas/staging/store.before
    sudo mv /srv/macro-atlas/staging/public /srv/macro-atlas/staging/public.before
    sudo chown 10001:10001 /srv/macro-atlas/staging
    ```

    A restore never writes over a store or a root. If you are restoring from the off-host
    copy, fetch the archive and its `.sha256` into `/srv/macro-atlas/backups/staging` first.
24. **[SCRIPT]** `deploy/restore.sh staging /srv/macro-atlas/backups/staging/macro-atlas-....tar.gz`.
    It checks the archive against its checksum, unpacks beside the destination, checks every
    file against the list inside the archive, moves the two directories into place, and then
    runs `atlas capture --verify` and `atlas doctor` on the result. It puts back everything
    or nothing. It must end `doctor: nothing wrong` and `RESTORED`.
25. **[ALEX]** Check out the commit that was deployed when the backup was taken
    (`deploys.log` in the data directory, or your own note), if it is not the one checked out.
26. **[SCRIPT]** `deploy/deploy.sh staging`: the preflight reads the restored root, and the
    web container is started on it.
27. **[ALEX]** Start the timers again (step 15's `enable --now`). The next refresh reports
    the days between the backup and now as `MISSED`; they cannot be recovered.
28. **[ALEX]** Open a Claim page and compare its locked rows with the lock file in
    `content/claims/locks/`: they are the numbers written when the Claim was checked. Remove
    `store.before` and `public.before` when you are satisfied.

## 7. Updating the code

29. **[ALEX]** `git -C /srv/macro-atlas/checkout fetch` and check out the new commit.
30. **[SCRIPT]** `deploy/deploy.sh staging`. It builds the writer's image first, as a
    candidate, so the preflight reads the new code and the new rights register, then rebuilds
    and restarts the web app. Only when the web app has answered does the candidate become
    the writer the timers run. A deploy the preflight refuses changes nothing: the old web
    app and the old writer stay. A deploy that fails after the preflight (the new web app
    does not come up healthy, or answers as another build) has already replaced the web app
    and has not replaced the writer: read `docker compose -p macro-atlas-staging logs web`,
    and roll the code back (step 35). The site is down for the seconds the container takes
    to start.

## 8. Production (M28)

31. **[ALEX]** Only after the staging soak checklist, the signed rights register (D2) and the
    cutover rule (D3). Steps 5 and 10 to 15 again with `production` in place of `staging`.
    `deploy/deploy.sh production` asks you to type the word `production`.
32. The preflight is the gate (PLAN 6.1 point 5). If it refuses, do not work around it: read
    the `FAIL` lines. A legacy Series or a local-profile Release in the production root means
    something was copied there by hand and the root must be rebuilt from the store; an
    unsigned row means the register at this commit does not allow what the root holds, and
    either the row is signed first or `atlas withdraw` takes the Series down.
33. Production never serves a local-profile Release, with or without a password. A
    local-profile Release on **staging** behind the password is allowed by the plan (6.1
    point 3) and is not switched on by this kit: a staging build refuses one today (ADR 0015
    point 5), and relaxing that is Alex's decision in M27, after step 8 has passed.

## 9. Rolling back

34. **The data.** **[SCRIPT]** `deploy/atlas.sh production rollback RELEASE_ID --profile public`
    names an earlier Release in `CURRENT`; the web app serves it on the next request, with
    no restart. The ids are the directory names in `public/releases/`.
35. **The code.** **[ALEX]** Check out the previous commit from `deploys.log`, then
    **[SCRIPT]** `deploy/deploy.sh production`.
36. **Everything.** Stop the web app (`docker compose -p macro-atlas-production down`) and
    the timers. Before M28's cutover the public site is still v1 on GitHub Pages and is not
    touched by anything here.

## 10. Withdrawing a Series

37. **[SCRIPT]** `deploy/atlas.sh production withdraw KEY --profile public --reason "..."`
    takes it down and retires every Release that held it.
38. **[ALEX]** Backups taken before the withdrawal still hold it. Delete those archives, here
    and at the off-host target, or keep them where nobody else can read them.

## Trying it on your own machine

```
make v2-deploy-smoke
```

needs Docker and about four minutes. It builds the production and the staging image from
`compose.yaml`, puts both behind a throwaway Caddy that loads `Caddyfile.snippet`, and checks
on invented data: a deploy the preflight refuses starts nothing; each container is published
on 127.0.0.1 only; `/macro-atlas` is the production build and `/macro-atlas-staging` the
staging build; staging answers 401 without the password on a page, a twin, a static asset and
the API; the writer promotes a Release and both web apps serve it with no restart; and
`backup.sh` then `restore.sh` give back the same store and root. It ends `SMOKE OK` and
removes everything it made. CI runs it on every pull request into `v2`.
