# deploy

The deploy kit: the two images and their own test (M1, M11), a `web`-only compose file for
your own machine, and, since M26, everything the server needs (ADR 0040). **The steps, in
order and with every manual one marked, are in [`RUNBOOK.md`](RUNBOOK.md).**

Nothing here deploys by itself. A production deploy is always Alex's to start (PLAN 10.1), and
every build is given its Surface explicitly (PLAN 6.1).

| File | What it is |
|---|---|
| `Dockerfile` | The Next standalone server on `node:24-alpine`, non-root, health-checked, with no Release inside. `ATLAS_SURFACE` and `BASE_PATH` are build arguments with no defaults |
| `ingest.Dockerfile` | The one writer (ADR 0002): Python (capture, replay, the release writer) and Node (the engine step) in one image, non-root, with no data inside. `python -m atlas` is its entry point; the store and the release root are mounted at `/store` and `/public`. Nothing schedules it here |
| `ingest.Dockerfile.dockerignore` | Its build context, an allowlist of its own: the `atlas` package without v1's tables, the schema, the spot values, the engine's source |
| `compose.web.yaml` | Two local-surface builds, one per base path, on `127.0.0.1:3101` and `127.0.0.1:3102`, each with the release root mounted read-only |
| `check-images.sh` | Builds both web images, reads every layer for seeded values and v1 data, smoke-tests `docker compose up`, and checks that a build with no Surface or a mismatched one fails. Then builds the ingest image, reads its layers the same way, and writes a whole Release with Derived series inside it from the invented vintage fixture |
| `scan_image.py` | The layer reader `check-images.sh` uses |
| `compose.yaml`, `production.env`, `staging.env`, `server.env.example` | The server: `web` and `ingest`, one file, two builds; what each build is; what the server's own environment file holds |
| `Caddyfile.snippet` | The two routes for the shared Caddy, staging behind a password. For Alex to apply |
| `systemd/` | The refresh timer (10:45 and 17:30) and the backup timer (03:15), in `America/New_York`. Files for Alex to copy |
| `deploy.sh` | Preflight (`atlas doctor --surface ...`), then build, start and check. A refusal starts nothing |
| `refresh.sh`, `atlas.sh` | The timer's job (`atlas refresh`: capture, replay, release), and any other `atlas` command in the writer's container |
| `backup.sh`, `restore.sh`, `handoff.sh` | One checked archive of the store and the root; putting one back; the interim Captures into the server's store |
| `headroom.sh`, `check-staging-auth.sh` | Read-only: is there room on the machine; does staging ask for the password on everything |
| `smoke.sh`, `smoke/` | The local test of all of it behind a throwaway Caddy |
| `lib.sh` | Shared by the scripts |
| `capture/` | The capture host kit: a scheduled workflow to copy into a separate private repository, and its runbook. It starts nothing here (D2 and D6 are Alex's) |

```
make v2-up            # http://localhost:3101/macro-atlas/explore
                      # http://localhost:3102/macro-atlas-staging/explore
make v2-image-check
make v2-deploy-smoke  # both server builds behind a throwaway Caddy, on invented data: SMOKE OK
```

The compose file's builds are for the **local** Surface. They answer only to this machine's names
(any other `Host` gets 421) and must not be put behind a public reverse proxy. A production or
staging image is a different build of the same commit:

```
docker build -f deploy/Dockerfile --build-arg ATLAS_SURFACE=production --build-arg BASE_PATH=/macro-atlas .
```

Such a build serves only public-profile Releases built against a signed rights register, and
answers 503 on every path, its health check included, when pointed at anything else (ADR 0015).

## The proxy in front, and the rate limits (M24)

The app counts requests to the read API, the twins and the export by the **last** address in
`X-Forwarded-For` (`docs/method/api.md`; ADR 0038). That is the reader only when exactly one
proxy stands in front, writes that header itself and drops whatever a client sent (Caddy's
`reverse_proxy` does both by default), and the app listens on loopback. Do not set
`trusted_proxies` so that a client's own header is passed through, and do not put a CDN or a
second proxy in front of Caddy without changing that rule first: every reader would then share
one bucket, or a client could choose its own.
