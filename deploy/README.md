# deploy

The deploy kit. So far (M1) it is the web image and a `web`-only compose file for your own
machine; the full compose file, the Caddy snippet and the preflight arrive in M26.

Nothing here deploys by itself. A production deploy is always Alex's to start (PLAN 10.1), and
every build is given its Surface explicitly (PLAN 6.1).

| File | What it is |
|---|---|
| `Dockerfile` | The Next standalone server on `node:24-alpine`, non-root, health-checked, with no Release inside. `ATLAS_SURFACE` and `BASE_PATH` are build arguments with no defaults |
| `compose.web.yaml` | Two local-surface builds, one per base path, on `127.0.0.1:3101` and `127.0.0.1:3102`, each with the release root mounted read-only |
| `check-images.sh` | Builds both images, reads every layer for seeded values and v1 data, smoke-tests `docker compose up`, and checks that a build with no Surface or a mismatched one fails |
| `scan_image.py` | The layer reader `check-images.sh` uses |

```
make v2-up            # http://localhost:3101/macro-atlas/explore
                      # http://localhost:3102/macro-atlas-staging/explore
make v2-image-check
```

The compose file's builds are for the **local** Surface. They answer only to this machine's names
(any other `Host` gets 421) and must not be put behind a public reverse proxy. A production or
staging image is a different build of the same commit:

```
docker build -f deploy/Dockerfile --build-arg ATLAS_SURFACE=production --build-arg BASE_PATH=/macro-atlas .
```

Such a build serves only public-profile Releases built against a signed rights register, and
answers 503 on every path, its health check included, when pointed at anything else (ADR 0015).
