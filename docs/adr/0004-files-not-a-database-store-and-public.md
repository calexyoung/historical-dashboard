---
status: proposed (awaiting Gate 1)
---

# Files, not a database, split into STORE and PUBLIC

The brief says no database at first. Data lives in two directories on two volumes. **STORE** holds
everything fetched: raw bytes (kept for good), the fetch log, the observation log and metadata
history. Only the ingest job mounts it. **PUBLIC** holds immutable release directories, a `CURRENT`
text file naming the promoted release, `STATUS.json` for the last run, and pins. The web container
mounts PUBLIC read-only and nothing else.

A release is staged, checked in full, then promoted by atomically replacing `CURRENT`. A failed run
changes only `STATUS.json`. Each request reads `CURRENT` once and uses that release throughout.

## Considered options

- **One data directory** with private sub-directories beside the releases. Simpler, but the web
  container would mount data it must never serve, and a single path bug would leak it.
- **A `current` symlink.** Fragile across two containers with different mount paths; a text file is
  not.
- **SQLite or DuckDB.** Not needed at this size (megabytes). A single-file index built per release
  can be added later without changing who writes.

## Consequences

- The web tier physically cannot serve withheld series, drafts or raw bytes: they are never copied
  into PUBLIC.
- Retention prunes old releases but never one that is current or pinned. A pruned release answers
  `410 Gone` with a pointer to the current one.
- Withdrawing something published in error means retiring the affected release directories out of
  PUBLIC, which is the one sanctioned exception to "immutable" (see ADR 0006).
