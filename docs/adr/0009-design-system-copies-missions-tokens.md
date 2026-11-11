---
status: accepted (Gate 1, 2026-11-11)
---

# Design system: copy the /missions tokens, add a small local layer, follow the OS theme

Macro Atlas should feel like the same site as `/missions`. It takes that project's tokens and panel
grammar unchanged: white ground, ink and hairlines, a 2px rule above each panel and no cards, one
system sans with tabular figures and no serif, Plot Navy as the only interactive colour, and status
shown by colour, icon and word together. The tokens are copied into this repo, with the source
commit noted, not shared as a package; two apps do not justify one. Both apps carry a small
"mydashboards" home link in the top bar.

Macro Atlas adds only what /missions has no need for, recorded in its own `DESIGN.md`: a series
palette based on Okabe-Ito that avoids navy, statement-table styles, the explained figure, and no
party colours or up/down colours for data. Motion follows Emil Kowalski's rules: none on chart data
or keyboard actions, short transitions on overlays only.

One deliberate difference, decided by Alex on 2026-11-11: the theme follows the OS setting
(`prefers-color-scheme`) with a manual toggle that overrides it. /missions is light by default and
ignores the OS.

## Considered options

- **Keep v1's look** (serif headings from Google Fonts, rounded cards). It breaks the family
  resemblance and needs third-party font requests.
- **Match /missions' theme rule exactly.** More uniform, but a reading site opened at night should
  respect the reader's setting; Alex chose the OS rule.
- **A shared design package.** Premature; revisit if a third dashboard appears.

## Consequences

- A token change in /missions does not flow here automatically; the copy is re-synced by hand.
- The dark token set must be complete and tested from the first page, since many readers will get
  it without asking.
- The "mydashboards" link in /missions is a change in that other repo and needs its own small PR.
