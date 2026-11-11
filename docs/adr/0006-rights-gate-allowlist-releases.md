---
status: proposed (awaiting Gate 1)
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

## Considered options

- **Filter at the page.** One missed route (search excerpt, Markdown twin, bulk file) leaks.
- **Treat public-domain origin as enough.** It does not override the terms of the channel the
  bytes came through.

## Consequences

- v2.0 may show fewer series than v1 until each is re-sourced from its origin agency.
- Until Alex signs the register, nothing fetched through FRED or Yahoo is kept in v2's store.
- **Withdrawal.** If a permission turns out to be wrong, `atlas withdraw <key>` publishes a new
  release without the series and everything derived from it, and retires every retained release
  that contains it. Links pinned to a retired release get an explanatory page. A claim lock that
  used the series keeps its provenance, and shows its numbers as withdrawn until the claim is
  re-locked on a permitted source.
