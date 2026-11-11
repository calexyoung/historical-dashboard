---
status: accepted (Gate 1, 2026-11-11)
---

# Deploy: two containers, a host timer, two base-path builds behind the shared Caddy

On the VPS, `web` (Next.js, always on, PUBLIC mounted read-only, non-root) and `ingest` (Python plus
Node, run to completion, mounts STORE and PUBLIC, holds the API keys) are separate containers. A
host systemd timer starts the ingest; no scheduler runs inside a container. The timer is set in
`America/New_York` so the main run lands after the 08:30 and 10:00 ET releases in both daylight
regimes, with an optional late-afternoon run.

Staging (`/macro-atlas-staging`) and production (`/macro-atlas`) are two builds of the same commit
with their own containers and volumes. The app owns its base path, so Caddy does not strip the
prefix, and the two matchers must not overlap (`/macro-atlas*` would also catch staging). The Caddy
configuration lives outside both repos; this repo ships a snippet and a runbook for Alex.

## Considered options

- **A staging subdomain.** Cleaner routing, but new DNS and certificates; the brief names a path.
- **Cron inside the ingest container, or collectors in the web process.** Harder to see, restart
  and reason about than a host timer and a job that exits.

## Consequences

- One instance only. Two writers never run at once; moving the writer between hosts is a written
  hand-off.
- Production deploys, the Caddy change and the server environment are Alex's.
- Each build is given its surface (local, staging or production) explicitly and listens on
  loopback behind Caddy; a production build refuses any release that is not public-profile
  (ADR 0006).
