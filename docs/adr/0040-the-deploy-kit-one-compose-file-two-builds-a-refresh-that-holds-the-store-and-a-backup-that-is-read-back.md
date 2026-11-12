---
status: accepted (M26, 2026-11-12); the server's paths, the backup schedule and retention, the headroom budgets and the content in the ingest image are the builder's choices and Alex's to change; D6 and D9 stay open with their recommended defaults applied; nothing is deployed, scheduled or installed by this
---

# The deploy kit: one compose file and two builds, a refresh that holds the store, and a backup that is read back before it counts

M26 builds `deploy/` for the server (PLAN 4.7, 4.8, 6.1 point 5; ADR 0008): compose with `web`
and `ingest`, both builds, the Caddy snippet with a password on staging, timer units in
`America/New_York`, backup and restore, the headroom script, the capture hand-off, the
runbook, the local smoke test behind a throwaway Caddy, and the deploy preflight. The
acceptance: the smoke passes for both paths together; backup then restore reproduces a working
STORE and PUBLIC and a locked Claim shows its original numbers; the production preflight
refuses a local-profile Release, an unsigned register and a legacy Series; containers listen
on loopback only; the runbook lists every manual step. This records what the plan left open.
The steps themselves are `deploy/RUNBOOK.md`.

## Decisions

1. **One compose file; the environment file says which build.** `deploy/compose.yaml` has
   `web` and `ingest` and no default for the Surface, the base path, the port or the
   directories. `deploy/production.env` and `deploy/staging.env` (committed, no secret) give
   them, and a compose project per Surface (`macro-atlas-production`, `macro-atlas-staging`)
   keeps the two apart. `compose.web.yaml`, the local-surface pair, is unchanged.
2. **`web` is published on `127.0.0.1` and `ingest` publishes nothing.** `ingest` is in the
   compose profile `job`, so `up` never starts the writer. Both are read-only, with every
   capability dropped. The keys reach `ingest` through an `env_file` on the server that is in
   no repository; `web` has no environment at all.
3. **`atlas refresh` is the one job, and it holds `REFRESH.LOCK` from the first step to the
   last.** Capture, replay and release each take the store's or the root's lock for their own
   length, so two refreshes could interleave between steps; a lock of the refresh's own stops
   that. A capture that did not end clean does not stop the run (a source that does not
   answer today is tomorrow's retry, and the Release marks what is stale). A replay that
   fails does: the store's record is then not known to be whole, so no Release is written
   and `CURRENT` is as it was. The exit status is red if any step was.
4. **A deploy is a script whose first act is the preflight.** `deploy.sh` builds the writer's
   image from the checkout, so the preflight reads this commit's register and not an older
   image's, runs `atlas doctor --surface <surface>` on the root to be served, and stops
   there if it refuses. Only then is the web image built and started. Staging goes through
   the same preflight and is held to production's rule (ADR 0015 point 5). A production
   deploy asks for the word `production`.
5. **The Caddy snippet is the file Alex imports, and the smoke test loads that file.** Two
   path matchers that cannot overlap, the prefix kept. The upstreams are
   `127.0.0.1:3101` and `:3102` unless a variable says otherwise; only the smoke test sets
   one, because a container cannot dial the host's loopback (which is the point of binding
   to it). Staging has `basic_auth` on its whole handle block, so a page, a twin, a static
   asset and the API are behind it alike, and `X-Robots-Tag: noindex` on every answer
   including the 401. The account is two variables in Caddy's own environment; with either
   unset there is no account and staging answers 401 to everyone.
6. **The timers keep New York's clock.** `OnCalendar=*-*-* 10:45:00 America/New_York` and
   `17:30:00`, `Persistent=true`, as templates by Surface. The backup is nightly at 03:15.
   The two services are not ordered against each other (each after the other is a cycle,
   which systemd breaks by dropping a job; Codex caught the first draft doing that). They
   share `REFRESH.LOCK`, and each script waits for it up to half an hour.
7. **A backup is one archive, taken between runs and read back before it counts.**
   `atlas backup` holds the refresh's lock and then the root's and the store's (the writer's
   order), writes `store/` and `public/` and a list of every file with its SHA-256 into one
   `tar.gz`, lets the locks go, reads the archive back against the list, and only then gives
   it its name, a checksum beside it, and the right to push older ones out. A lock on the
   backup directory is held from start to end, so a second backup never removes the first
   one's unfinished archive. It refuses a run
   in progress, a link in either tree, and a destination inside what it backs up. It leaves
   out the lock files, `.staging/` and `trash/`. Hard links between Releases
   (`--reuse-data`) stay hard links.
8. **A restore puts back everything or nothing, and never over anything.** It refuses a
   destination that holds a file, unpacks beside it, checks every file against the list,
   moves the two directories into place (taking the first back out if the second cannot be
   placed), and then runs `atlas capture --verify` and `atlas doctor`. The wrapper mounts the
   parent directory, not compose's two mounts, because a mount point cannot be replaced; and
   it refuses while the web app runs, because a running container keeps the directory it was
   started on.
9. **The capture hand-off is a command, checked at both ends.** `atlas handoff` refuses a
   source with an unfinished run or a held lock (asked for through a read-only descriptor
   when the clone is mounted read-only) and a store that holds anything but its lock files,
   asked again once the store is locked. It copies
   `raw/` and the two logs and nothing else of the clone, verifies both, and compares the
   counts.
10. **`content/` goes into the ingest image.** ADR 0033 and ADR 0034 left it to this
    milestone: without it a Release written by the timer holds no Event, no Claim and no
    Topic. The image's allowlist lets in `content` and nothing more, and `check-images.sh`
    now checks that the image's `content/` is exactly the tracked files and that a Release
    written inside it has Events. Content holds no value but in committed public-Profile
    locks, which exist only where the register allows redistribution.
11. **The smoke test uses the real images, the real snippet and the real scripts on invented
    data.** It cannot run `refresh.sh` (that asks the agencies), so the writer's image
    promotes a second Release from the fixture store and both web apps must serve it with the
    same container ids. It runs `deploy.sh` to see it refuse, and `backup.sh` then
    `restore.sh` to see them agree. CI runs it in the `images` job.

## Considered options

- **Two compose files, one per Surface.** Two files that must stay the same but for four
  values, and nothing to stop them drifting.
- **Cron or a loop inside the ingest container.** ADR 0008 already chose a host timer.
- **Stopping the refresh when the capture fails.** A single agency's bad day would stop
  every other source's values from being published, and the missed day cannot be made up.
- **Going on to release when the replay fails.** The release writer's checks do not show
  that a replay finished. Codex raised this; the run stops instead.
- **`rsync` or `restic` as the backup itself.** Incremental and cheaper on a store that only
  grows, but nothing in them knows the writer's locks, and a restore could not say that what
  it put back is what was taken. One full archive a night is simple and can be checked; with
  raw Captures already compressed it costs disk in proportion to the store, which
  `--keep` bounds. Revisit when an archive is slow enough to delay a refresh.
- **Ordering the two units with `After=`.** It cannot be said both ways round, and one way
  round only covers jobs queued together. A bounded wait on the lock they already share
  serializes them however they were started.
- **Letting the builder's smoke test dial `127.0.0.1:3101` through host networking.** It
  works on Linux and not on a Mac, so the test would differ by machine.
- **Relaxing the staging build for a local-profile Release behind the password now.** The
  plan allows it (6.1 point 3) and ADR 0015 point 5 leaves it to a deploy step that can prove
  the password, which is M27's on the real host. `check-staging-auth.sh` is that proof,
  built and tested here; the relaxation itself is Alex's.

## Consequences

- Nothing is deployed, and no timer, repository, secret or schedule exists because of this
  milestone. Every such step is in the runbook as Alex's.
- Each Surface has its own store and its own timer, and each refresh asks the agencies. Two
  capturing Surfaces would use 24 of the 25 requests a day BLS is believed to allow without
  a key. Which Surface captures is to be decided before the second timer is enabled (M27,
  M28); `refresh --no-capture` exists for the other.
- A backup is as private as the root it came from. One taken before a withdrawal still holds
  the withdrawn Series, and the runbook says to delete or guard it. The off-host copy is one
  variable Alex sets; until then backups are on the same disk.
- The headroom script's minimums (1536 MB of available memory, 10 GB of disk) are budgets
  from one development machine, where a web container used 75 to 120 MB at rest. They are
  not measurements of the VPS.
- The ingest image is rebuilt by every deploy, and the timers use whatever the last deploy
  built: code, register, Catalog and content move together, by commit.
- The preflight had its three refusals since M9. M26 adds a test for each that starts from a
  root the preflight passes and changes one thing, so a refusal for some other reason cannot
  pass for the one named.
