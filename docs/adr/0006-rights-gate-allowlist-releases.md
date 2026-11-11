---
status: accepted (Gate 1, 2026-11-11); interim data rule added the same day while D2 is open
---

# Rights gate: public releases are built from an allowlist

The site is public and has no password, so a chart is publication. v1 fetches 83 of its 109 catalog
entries through FRED and 25 through Yahoo, and both have terms that limit storing or redistributing
what they serve, whatever the status of the underlying data. So every series carries a rights
record for its origin and for the channel each value came through. Three permissions (display,
redistribute, ML use) are derived from that record; none is typed in. Unknown rights block every
public surface. A derived series takes the most restrictive permission of its inputs.

A public release is built by copying in only what the allowlist permits. Anything else is named in
the release's withheld list with a reason, so the site shows "withheld: licence not settled", not a
silent gap. The agent proposes rights entries with the terms quoted; Alex decides, once, in the
rights register.

## Interim data rule (Alex, 2026-11-11, while D2 is open)

Alex approved the plan before deciding the rights register (D2). His interim basis: local and
staging builds may show v1's current data, which came through FRED and Yahoo, because nothing is
redistributed publicly; the origin-agency allowlist must be in force before anything is deployed to
the public production path. This is a working basis, not a reading of anyone's terms. It is
enforced so that an autonomous builder cannot publish that data:

- Every build has an explicit **surface**: local (loopback on Alex's machine), staging or
  production. A build with no surface, or one that does not match its base path, fails.
- Every release has a **profile**: `public` or `local`. v1's data may exist only in a local-profile
  release, as whole series marked with the legacy representation. Local releases live in their own
  directory, outside PUBLIC, and production containers never mount it.
- A local-profile release may be served on the local surface, and on staging only behind a
  password that covers every route with no direct port open. Staging without a password is a
  public surface.
- Production serves only public-profile releases. A public release needs, for every series and
  every input of a derived series, a register row Alex has signed for that origin, dataset,
  channel and permission. Data converted from v1's `data/atlas.json` is never eligible. An
  intermediary channel becomes eligible only by a signed register row together with a dated
  amendment to this ADR, and is then fetched afresh by an adapter.
- The checks fail closed in the release writer, in the reader of a production build (503 and a
  failing health check, for every release it opens, including pinned and rolled-back ones), in the
  deploy preflight, and in the build (no generated release and none of v1's own data files in the
  Docker context, an image, Next's build output or a CI artefact). Each check has a test.
- The builder may not weaken or bypass these checks; work that seems to need it is parked and
  reported to Alex.
- v2 itself does not fetch from FRED or Yahoo unless a channel has that two-part clearance, and
  nothing converted from v1's output enters STORE or the capture job.

The permission for local and staging use lasts until Alex records his D2 decision. The protections
do not expire; they change only by an amendment to this ADR that Alex approves. v1's own public
exposure today is a separate question (D4 in the plan). The full text is section 6.1 of
`docs/v2/PLAN.md`.

## Considered options

- **Filter at the page.** One missed route (search excerpt, Markdown twin, bulk file) leaks.
- **Treat public-domain origin as enough.** It does not override the terms of the channel the
  bytes came through.
- **Keep v1's data out of every v2 build until D2 is decided.** Safest, but the first usable site
  would wait for the whole data foundation. Alex chose usefulness first, with the rule above.
- **A "local" flag checked only by the pages.** One missed route or a mislabelled build leaks; the
  checks sit in the writer, the reader, the deploy step and the build instead.

## Consequences

- v2.0 may show fewer series than v1 until each is re-sourced from its origin agency.
- Until Alex signs the register, nothing fetched through FRED or Yahoo is kept in v2's store or
  placed in a public release. v1's existing values are read only into local-profile releases.
- **Withdrawal.** If a permission turns out to be wrong, `atlas withdraw <key>` publishes a new
  release without the series and everything derived from it, and retires every retained release
  that contains it. Links pinned to a retired release get an explanatory page. A claim lock that
  used the series keeps its provenance, and shows its numbers as withdrawn until the claim is
  re-locked on a permitted source.
