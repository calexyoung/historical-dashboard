---
status: proposed (awaiting Gate 1)
---

# Data out: the page address is the API; MCP is a thin later adapter

Machines get data three ways, all answered by the same query module with the same rights and size
limits: a file suffix on any page address (`/data/{key}.csv`, `.json`, `.metadata.json`, `.md`), a
versioned read API under `/api/v1`, and immutable bulk files per release (Parquet, CSV.gz, JSON
Lines and a Frictionless data package split by licence). Every response names its release, engine version,
provenance and rights. HTML and downloads are tested to agree.

An MCP endpoint is planned as one more thin adapter over that query module, with a fixed set of
read-only tools and no free-form query input. It ships as the first milestone after cutover
(v2.1), once the read API has settled, not in v2.0.

## Considered options

- **GraphQL or SQL-over-HTTP.** Flexible, but open-ended queries on a small shared VPS need cost
  controls we do not want to write, and they make rights checks harder to prove.
- **MCP first.** The protocol is still moving; the REST contract underneath it has to exist anyway.

## Consequences

- Rate limiting lives in the app, because the shared Caddy has no rate-limit handler.
- The site says "machine-readable, licence per series". It does not promise "free for ML training".
