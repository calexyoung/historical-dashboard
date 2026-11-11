---
status: accepted (Gate 1, 2026-11-11); where the job runs is still open (D6)
---

# Start the vintage clock with a raw-capture job that is separate from the store

For most series Macro Atlas can only say "this value was public by date X" for days on which it
fetched; a provider's own archive covers a few headline series at best. Waiting
for the vintage store, the release writer and the VPS would lose months. So the first thing that
runs daily is a tiny job that fetches a fixed list of rights-cleared origin-agency endpoints and
keeps the exact bytes, with the retrieval time, request, response headers and paging evidence. It
has no store, no release and no Node. The vintage store later replays those captures using their
original retrieval times.

The job cannot live on the `v2` branch (ADR 0010). Alex chooses where it runs; the recommendation
is a separate private GitHub repository with a scheduled workflow that commits each day's captures
to itself, which is also the durable copy.

At Gate 1 Alex put a usable local site first, so the capture kit is milestone M7, after the rights
register (M6), not the second PR. Both can be built beside the site at any time, and should be the
day Alex has cleared the first three sources (D2) and named the host (D6): until then no capture
could run anyway; after that every day's delay is lost for good.

## Considered options

- **Start capture when the store is finished.** Puts a wall-clock wait on the critical path.
- **Capture everything v1 fetches.** FRED and Yahoo terms limit storing what they serve; private
  storage is an access boundary, not a licence.
- **Run it on Alex's Mac.** Loses days whenever the machine sleeps.

## Consequences

- The endpoint list comes from the rights register and starts small (BLS, Treasury Fiscal Data,
  Federal Reserve Board).
- A missed day is permanent and shows later as a capture gap; the job reports misses.
- Moving capture to the VPS at staging is a written hand-off: stop one, copy, verify hashes, start
  the other.
