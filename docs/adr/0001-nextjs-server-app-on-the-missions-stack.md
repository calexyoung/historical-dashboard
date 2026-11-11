---
status: accepted (Gate 1, 2026-11-11)
---

# Next.js server app on the /missions stack

v1 is a single static HTML file rebuilt weekly on GitHub Pages. v2 becomes a server app so it can
refresh daily, give every series, claim and topic its own address, and serve a read API. We use the
stack the mission dashboard already runs on the same VPS: Next.js 16 (App Router), React 19,
Tailwind 4, TypeScript and Vitest, built as a standalone server in Docker and served under the base
path `/macro-atlas` behind the existing Caddy.

## Considered options

- **Keep the static build and add pages.** No server to run, but no read API with rights checks, no
  as-of queries, and a rebuild for every content change.
- **A Python web app (FastAPI plus templates).** One language with the ingest, but a second stack
  on the VPS and no shared shell, tokens or tooling with /missions.
- **Next.js as on /missions (chosen).** One stack to operate, and the skeleton (base path, Docker
  image, health route, security headers) can be copied.

## Consequences

- Charts are drawn as SVG by the app. There is no chart library and nothing loads from a CDN.
- The base path is fixed at build time, so production and staging are two builds of one commit.
- Next 16 differs from older versions; the build agent reads the bundled docs before writing routes.
