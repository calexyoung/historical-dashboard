---
status: proposed (awaiting Gate 1)
---

# Python stays for ingest and is the only writer

The web stack is Node, but v1's ingest is tested Python (parsers, QA checks, 49 tests), and Parquet
output is easy in Python and awkward in Node. We keep Python for fetching, the vintage store, checks
and bulk files, and run it as a one-shot job started by a host timer. That job is the only thing
that ever writes data. The Next.js app only reads.

The job has a Node step: the analytical engine (ADR 0003) computes derived series and checks claim
locks. It writes only inside the staging directory the Python publisher created, and the Python
publisher alone promotes a staged release. So "one writer" means one job holding one lock, not one
language.

## Considered options

- **Port ingest to TypeScript.** One language, but it throws away working code and tests for no
  reader-visible gain. A source moves to TypeScript only if it has its own reason to.
- **Collectors inside the web process, as /missions does.** Fine for live polling; wrong for a
  daily batch that must be checked as a whole before anything is published.

## Consequences

- The ingest image carries both Python and Node.
- The contract between the two languages is the release directory and its JSON Schema, tested from
  both sides against one committed fixture release.
