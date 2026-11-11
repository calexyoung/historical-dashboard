# Design system: Macro Atlas

Macro Atlas is one of the mydashboards sites and should feel like the same place as `/missions`
(ADR 0009). It takes that project's tokens and panel grammar unchanged and adds a small layer of
its own. This file records both: what was copied, and what is Macro Atlas's.

- **Copied from:** `mission-dashboard` at commit `6e5c3f9` (`src/app/globals.css`, `DESIGN.md`).
  A change there does not flow here; re-sync by hand and update this line.
- **Where the tokens live:** `site/src/app/globals.css`. `site/src/lib/tokens.test.ts` checks
  every contrast figure promised below, in both themes.
- **Rules for motion and figures:** `docs/v2/PLAN.md` section 8.

## The family (unchanged from /missions)

- **Ground and ink.** White ground, near-black ink, hairline rules. Panels have no card box: a 2px
  ink rule opens each panel and its label sits at the left margin in 13px bold capitals with
  0.06em tracking. The label is the panel's heading.
- **Flat at rest.** No shadows on the page surface; only overlays (popovers, sheets) lift.
- **Shapes.** 4px corners on controls, none on panels.
- **Type.** One system sans everywhere, no serif, no web font. Tabular figures for the whole body.
  Body 14px, labels 12px, nothing under 12px.
- **One interactive hue.** Plot Navy (`accent`) is the only colour that means "you can act on
  this": links, focus rings, the selected option, the current tab.
- **Three channels.** A state is always a colour, a shape and a word together.
- **Chrome.** The same top bar, tab bar, skip link and focus ring (2px Plot Navy at 2px offset).

| Token | Light | Dark | Use |
|---|---|---|---|
| `void`, `panel` | `#ffffff` | `#0f1318` | page; a surface that must mask what is behind it |
| `raised` | `#f2f5f8` | `#1c2430` | controls, strips |
| `line` | `#dde3ea` | `#2a3544` | row and header rules |
| `line-strong` | `#b4bfcc` | `#55657b` | the tab bar's rule, strong hairlines (decorative only) |
| `ink` | `#111418` | `#e6ebf1` | text, panel rules |
| `ink-2` | `#434d5b` | `#b3bdca` | secondary text |
| `ink-3` | `#5b6676` | `#8d99a9` | tertiary text: units, keys, provenance |
| `accent`, `rule` | `#2f5e95` | `#7fb0ea` | the interactive hue |
| `band` | `#d3e2f2` | `#2f4d70` | selection highlight, pale bands |
| `nominal` | `#1d7a3a` | `#4cc17a` | "current" |
| `delayed` | `#985600` | `#e0a33a` | "stale" |
| `outage` | `#c0392b` | `#ff6b5e` | "failed" |
| `unknown` | `#5b6676` | `#8d99a9` | "unknown" |

Left out because Macro Atlas has no use for them: the map, publication-route, lag, maintenance
and severity colours.

## What Macro Atlas adds

### The theme follows the OS, with an override

The one deliberate difference from /missions (Alex, 2026-11-11). With no choice made, the page
follows `prefers-color-scheme`, and changes with it. The top bar's **Auto / Light / Dark** control
overrides it; the choice is kept for a year in the cookie `atlas-theme`, scoped to the app's base
path, and Auto forgets it.

The server reads the cookie and renders `<html data-theme>`, so there is no inline script, no
flash of the wrong theme, and the control works with JavaScript off (it is a form). Changing the
theme is instant: nothing fades.

The dark tokens appear twice in `globals.css` (once under the media query, once under
`[data-theme="dark"]`); a test fails if the copies differ or if a colour has no dark value. The
dark set is complete from the first page, because many readers will get it without asking.

### A control border that can be seen: `control`

`#7b8797` light, `#66768c` dark, at least 3:1 against the page in both. /missions draws control
borders in `line-strong`, which is 1.9:1 on white: fine as a hairline, too faint to be the only
edge of a button. Controls here use `control`; `line-strong` stays for rules.

### The series palette

Eight colours for data series, based on Okabe-Ito, with no navy (navy means "interactive") and
each at least 3:1 against the page in its theme. Colour is never the only channel: line style is
the second, and a series is labelled at its end where there is room, not in a legend.

| Token | Light | Dark |
|---|---|---|
| `series-1` vermillion | `#d55e00` | `#ff8a4c` |
| `series-2` bluish green | `#007a5a` | `#3fbf95` |
| `series-3` sky blue | `#1f8ac0` | `#56b4e9` |
| `series-4` reddish purple | `#a8528a` | `#d78bbd` |
| `series-5` amber | `#b97700` | `#e69f00` |
| `series-6` ink | `#111418` | `#e6ebf1` |
| `series-7` olive (yellow, darkened for white) | `#7d7400` | `#f0e442` |
| `series-8` slate | `#6b7480` | `#9aa6b5` |

The contrast is tested now. The check for colour-vision deficiency, and the line styles, come
with the explained figure (M3), which may adjust these values.

### Colour never judges the data

- **No party colours for data.** Governance bands use muted tints with the party named in words.
- **No up/down colours.** Unemployment rising is not "bad" in red and falling is not "good" in
  green. A change is a number with a sign. The status colours above describe the state of the
  site's own data (current, stale, failed), never the direction of a series.

### Data states

A data state (preliminary, revised, estimate, projected, partial period, stale, missing, break,
withheld) is drawn with a mark and named with a word, never colour alone. A withheld series is
listed by name with the reason and no values. The marks are specified with the figure in M3.

### The freshness mark (top bar)

| State | Shape | Colour | Word |
|---|---|---|---|
| The release is at most 36 hours old | filled circle | `nominal` | Current |
| Older than that | hollow triangle | `delayed` | Stale |
| A newer release could not be opened | filled diamond | `outage` | Refresh failed |

From 640px the release date sits beside the word; below that it is in the footer, which always
names the release a page was made from.

### Still to be recorded here

Statement-table styles (v2.3) and the explained figure's anatomy (M3) are added to this file by
the milestones that build them.

## Motion (Emil Kowalski's rules, as applied in PLAN section 8)

This is a tool its main reader opens many times a day, so almost nothing moves.

- Chart data, the crosshair and the readout never animate. Nor does any keyboard action, the
  theme change or the skip link.
- A press is answered at once: `scale(0.97)` on `:active`, 120 ms, `cubic-bezier(0.23, 1, 0.32, 1)`
  (the `.press` class).
- Hover changes colour only, 120 ms, and only where there is a fine pointer
  (`@media (hover: hover) and (pointer: fine)`), so a tap never leaves a hover state behind.
- Only `transform`, `opacity` and colour are transitioned; never `transition: all`; CSS
  transitions, not keyframes; no motion library.
- Under `prefers-reduced-motion`, colour fades stay and movement goes.
- Popovers, sheets and the Overview's first-visit stagger are specified in PLAN section 8 and
  arrive with the components that use them.

## Accessibility floor (checked by Playwright on the fixture release)

axe-core clean in both themes; no horizontal page scroll at 320px; everything reachable at 200%
zoom; keyboard order follows reading order, starting with the skip link; text at least 4.5:1,
control borders and data marks at least 3:1; targets at least 24px; reading pages complete with
JavaScript off.
