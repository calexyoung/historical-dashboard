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

Contrast and colour-vision deficiency are both tested (`tokens.test.ts`,
`figure/palette.test.ts`). Under protanopia, deuteranopia or tritanopia some of the eight come
close (vermillion, amber and olive; reddish purple and slate; bluish green and sky blue in the
dark theme), which is why a series never relies on colour: it also has a **line style** and a
filled **symbol**, assigned so that any two colours that come close differ in both.

| Series | Line | Symbol |
|---|---|---|
| 1 vermillion, 8 slate | solid | circle |
| 2 bluish green, 5 amber | dashed (6 3) | square |
| 3 sky blue, 7 olive | dotted (1.5 3.5) | triangle |
| 4 reddish purple, 6 ink | dash-dot (9 3 1.5 3) | diamond |

A legend entry is a short piece of the line with the symbol on it. In the wide drawing, two or
more series are named at the ends of their lines instead, where the names fit.

### Colour never judges the data

- **No party colours for data.** Governance bands use muted tints with the party named in words.
- **No up/down colours.** Unemployment rising is not "bad" in red and falling is not "good" in
  green. A change is a number with a sign. The status colours above describe the state of the
  site's own data (current, stale, failed), never the direction of a series.

### Data states

A data state is drawn with a mark and named with a word, never colour alone. The marks are
hollow, 1.5px, in ink (`currentColor`), so they read the same in both themes and cannot be taken
for a series' filled symbol. A withheld series is listed by name with the reason and no values.

| State | Word | Mark |
|---|---|---|
| preliminary | Preliminary | hollow circle |
| revised | Revised | hollow square |
| estimate | Estimate | hollow diamond |
| projected | Projected | cross |
| partial | Partial period | half-filled circle |
| stale | Stale | hollow triangle (the top bar's Stale shape) |
| missing | Missing | dashed bar |
| break | Break | dashed upright line |
| withheld | Withheld | barred circle |
| (a status) suppressed | Suppressed | solid bar |

The word is a link to its glossary entry wherever it stands alone. Rules for where each mark
goes in a drawing are in `docs/method/explained-figure.md`.

### The explained figure

One component (`components/Figure.tsx`) with a fixed anatomy, top to bottom:

```
PANEL LABEL
Takeaway sentence (16px, medium), or the reason there is none (14px, ink-2)
[ the drawing: one of three, chosen by the figure's own width ]
unit · adjustment · cadence                                   12px ink-2
[mark] Word: periods                                          one line per state present
Source: origin, how obtained · data to … · …                  12px ink-3
▸ How to read this     ▸ Show the table     Open in Explorer →
```

- **The drawing.** Hairline grid in `line`, baseline in `line-strong`, tick labels 12px `ink-2`,
  series at 1.75px with round joins. No frame, no fill under a line, no gradient, no legend for
  one series. Values keep 4px clear of the plot's edges. It is laid out at 256, 448 and 768px and
  only ever scaled up (ADR 0017), to at most 1024px wide.
- **Cadence is visible.** Monthly or finer is a line; quarterly, annual and irregular are
  points; a held series is steps. Nothing is drawn between values that the series does not hold.
- **Disclosures** are native `<details>`: the browser's own triangle, keyboard and state. They
  do not animate (PLAN section 8: nothing on data moves).
- **The table** (`.figure-table`): 14px, tabular figures, hairlines between rows, values right
  aligned, state in a third column. If it outgrows a phone it scrolls inside its own region.
- **Latest value** on a series page: 30px semibold tabular figure, then unit, period and state
  in 14px `ink-2`. It is a figure with a label, not a KPI tile: no box, no colour, no arrow.

### Series pages and the glossary

A series page is panels in reading order: the name (the page's one `h1`) with description and
latest value; the figure; Definition and Provenance side by side from 1024px, stacked below.
Facts are label and value pairs on hairlines, stacked on a phone. Origin and Channel are separate
groups and are never merged into one "source" row. The glossary lists terms in four panels; each
term also has its own page, and the footer of every page links to the list.

### The freshness mark (top bar)

| State | Shape | Colour | Word |
|---|---|---|---|
| The release is at most 36 hours old | filled circle | `nominal` | Current |
| Older than that | hollow triangle | `delayed` | Stale |
| A newer release could not be opened | filled diamond | `outage` | Refresh failed |

From 640px the release date sits beside the word; below that it is in the footer, which always
names the release a page was made from.

### The local-release strip

On every page of a local-profile release, between the tab bar and the content, one line in the
`delayed` tint (10% ground, 50% rule) and bold 12px ink: "Local build · v1 data via FRED and
Yahoo · not for publication" when the release holds v1's series. It is a note, not an alert: it
is on every load, so it never moves, flashes or animates. A public-profile release has none.

### The catalog page's filter bar

/missions' control grammar: a search field and selects in a wrapping row, 4px corners, `raised`
ground, labels for assistive technology only (each select's first option names it: "All
segments"). Controls are 36px high here, not 32px, and use the `control` border. The one filled
button is Plot Navy with the ground colour as its text. It is a GET form with no script: the
address is the state, and nothing on the page animates. Below 768px the table's other columns
fold into the first cell so the page never scrolls sideways and no value is lost.

### The Explorer

The workbench (ADR 0018). Panels in reading order: Explore (presets, as link chips in one row
that scrolls on a phone), View, Chart, Layers, Events in the window.

- **View.** "Choose series" and "Copy link" are 36px controls; the selected Series are chips, each
  with its colour, line style and symbol, its name (a door to its series page) and a 32px "×"
  that removes it. A Series that is selected but not drawn has a dashed chip and a line under
  the chart that says why. Mode is a select; the window is two month fields.
- **The readout** sits above the chart: a 24px line (date, then "latest in the window",
  "under the pointer" or "pinned", then "Unpin"), and one two-line row per selected Series
  (name and value; unit, Period and the value as drawn). Rows have fixed heights and there is
  always one per Series, so the strip never changes height as the date moves. The pointer
  previews with a dashed ink line; a click, a tap or the arrow keys pin, with a solid Plot Navy
  line (the one place navy is drawn on a chart: it marks the reader's own choice).
- **Pinned, and as of a date** (ADR 0032). Both are notes, not alerts: a line of text with a
  rule at its left edge, there on every load, never moving. The pinned note sits above the
  first panel and names the Release, when it was made, that today's engine draws it, and the
  way to the current Release. The as-of note sits under the controls: the date, the view's
  Basis as a mark and a word (the weakest among what is drawn), "Show today's values", and one
  line per Series with its own Basis. "Frequency" and "As known before" are fields of the view
  form like the window. A Series the Release does not hold is a line under the chart ("Not in
  this release · name: reason · Remove"), never a chip: it was not selected from this Release.
- **Small multiples.** One plot per unit, stacked, on one time axis and one left edge, each with
  its Series named under it. No second axis.
- **Layers.** Recessions are ink at 10%. A set of bands (terms of government, policy periods) is
  the `band` tint at two strengths, with a hairline where each begins and the holder's name at
  the top where it fits; a party is written in words, "Obama (Democratic)", and the tint never
  stands for it. One set of bands at a time. Events are ink ticks at the foot of the plot, all
  alike: an Event's category is a word in the list under the chart, not a colour. Choosing an
  Event in the list draws it as an ink line the height of the plot with its name.
- **The picker** is a `<dialog>`: a sheet across the bottom of a phone (85% of its height at
  most), a 400px drawer at the left from 1024px, where the chart is not dimmed so a ticked box
  is seen to take effect. "Done" takes focus when it opens, not the search field, so a phone
  does not raise its keyboard. More than four Series on a phone gets a line of advice, not a
  limit.
- **Motion.** The sheet: 240 ms in, 180 ms out, `transform` only, `cubic-bezier(0.32, 0.72, 0, 1)`;
  none when a key opened it; opacity only under reduced motion. "Copied": a 200 ms crossfade.
  Nothing else moves.

Explorer II (M5, ADR 0019) adds two panels after Chart, and controls to View:

- **View, more.** "Download CSV", "Copy CSV" and "Save chart as PNG" sit beside "Copy link", the
  same 36px controls; a pressed one answers with the same 200 ms crossfade ("Copied", "Saved").
  A 12px line under them says files are stamped "not for publication" and links to every series
  as one CSV. Where export is refused there are no buttons, only the reason. "Compare with the
  range from" is a third month field; "Mark highest and lowest" is a checkbox drawn as the layer
  switches are.
- **A second range** is the same Series again in its own colour, line style and symbol, told
  apart by weight: 4px at 45% for the line, hollow symbols. Never by colour alone, and never a
  ninth colour. Its dates are in the readout row under its Series, in the table and in the
  file; the axis keeps the first range's dates.
- **Marks at the extremes**: a 4.5px ring in the Series' colour and a 12px ink label with a
  panel-coloured halo, "max 109.9 · Dec 2025" (the fixture's).
- **Snapshot.** One `data-table`: Series (name over unit), first and latest in the window, change,
  low, high, source. Figures are right-aligned tabular numerals, each with its Period beside it
  in 12px ink-3. The change is a signed number in ink: no green, no red (colour never judges
  the data). The table scrolls inside its own region on a phone.
- **Relationships.** The matrix is numbers, each a link that chooses the pair; the chosen cell
  has the accent border and the `band` ground, like a switched-on layer. v1's red-to-blue heat
  map is gone: a tint would rank the pairs, and r is already a number. Below it the pair's own
  form (X, Y, basis, lag, rolling window), the answer in 16px semibold numerals, the facts it
  rests on, and three small drawings, each 256 units wide so its 12px text is only ever scaled
  up: a scatter (ink dots at 55%), r at each lag (ink-2 bars, up or down from the zero line; the
  lag in hand is the one accent mark, a dashed hairline and its bar), and r over a rolling
  window (an ink line, broken where there is no answer). The sign of r is its side of the zero
  line, not a colour. Each drawing has a table behind a disclosure. The guard text closes the
  panel as a plain list and is there whether or not there is an answer.
- **Motion.** None in either panel. The lag is typed and applied on Enter or on leaving the
  field, so stepping through lags does not redraw at every step.

Tokens are declared with `@theme static`, so that every series colour reaches the stylesheet:
drawings name colours in SVG attributes, which Tailwind cannot see.

### Claim pages

A Claim's page (ADR 0035) is panels in reading order: Claim, one panel per Reading, Readings not
measured, Sources, Correction log, Evidence downloads, and on a local build Notes.

- **Claim.** The quote is the largest text on the page: 18px medium with a 2px ink rule at its
  left, never cut. Under it the page's one `h1`, 14px semibold: the claimant and the day. Then
  role, party (a word; never a colour) and venue in 14px `ink-2`, and one short line of
  sources, each named by its kind ("recording", "transcript") with its archived copy; their
  full names and locators are in the Sources panel. The quote is 16px on a phone and 18px from
  640px, so the first figures stay above the fold. A draft has the same bordered "Draft" word the Events index uses.
- **A Reading** opens with a sentence: the Series (a door to its page), what is measured, the
  unit (under the table once there are figures). Its table (`.data-table.evidence`) has the Measure's figures down and three columns
  across, always in this order: Then, Now when checked, Latest. A figure is a 14px semibold
  tabular numeral with its Period and its Data state (mark and word) stacked under it in 12px.
  The three columns are the same weight and the same ink: nothing marks one as the answer. An
  empty figure is its reason in `ink-3`; a row with no answer is "No figure". The table fits
  360px; headers wrap.
- **Where each state comes from** is a list under the table: Then with its Basis mark and
  word, Now when checked with the day and the Release, Latest with "It is not part of the lock."
- **The drawing** is 256 units wide and at most 320px: the locked then values as hollow circles
  on a dashed line, now when checked as filled circles on a solid line, both in ink, set side by
  side at each Period so equal values do not hide each other. Hairline grid, three ticks, no
  frame, no series colour. It does not animate.
- **Window sensitivity** repeats the table once per declared window, each under a `raised`
  band that names the window and says whether it is the Reading's own or an alternative.
- **No verdict has a place.** No tick, cross, meter, tint or coloured figure; a difference
  between two columns is two numbers. Motion: none (a reading page).
- **Notes** (local builds): a `control` rule at the left, a 12px semibold line "Note by
  {user} · {day} · {user}'s own, not Macro Atlas's", then the text.

The Claims index uses the catalog page's filter bar (three selects and "Show"), a line
"Recorded, by party" of words and counts, and a list: day, claimant, role and party in `ink-2`,
then the quote as the door.

### The Overview, Highlights and search (M22, ADR 0036)

- **The Overview** is one panel of six rows, one per Segment, in a fixed order; no hero, no
  cards, no tiles. A row is three columns from 640px: the Segment (14px semibold, a door to its
  Series in the catalog), the headline Series (its name as a door; the latest value in words at
  16px medium with its Data state as a mark and a word; the change from a year earlier at 14px
  as a door to the Explorer at that window), and the sparkline at the right. On a phone the
  sparkline sits beside the Segment's name and the rest runs under it. The panel's meta line
  names the Release's day. A Segment with no headline Series says so in one line. Then a
  Search panel: a field, the one filled button, and a line that leads to Highlights.
- **The sparkline** is 120 by 28 units, ink (`currentColor`), a 1.25px line with a 2px dot on
  the latest value; points for a quarterly, annual or irregular Series and steps for a held
  one, as in the explained figure; a gap is a gap. No axis, no fill, no series colour. It is a
  door to the Series in the Explorer and its accessible name says what it spans.
- **Highlights** is a table per Segment: Series, Latest, 1 year, 5 years, 10 years. A cell is
  one link, at least 44px high: the figure at 14px semibold in the accent ("+5.2%", "−0.2
  pts"), and under it at 12px `ink-3` the value and Period it is taken from. The sign is the
  only direction: no green, no red, no arrow. Where there is no figure the cell holds the Data
  state's mark and word and the reason, or "No data" and the Period. Below 640px each Series
  is a block (name, latest, then the three cells side by side under their own labels), so the
  page never scrolls sideways.
- **The change strip** on its own (`components/ChangeStrip.tsx`, for Topic pages) is the
  latest value in words and the same three cells in a row under 12px labels.
- **The search sheet** is a `<dialog>` under the top bar, 640px at most: field, "Search",
  "Close", then hits grouped under `raised` bands with a count. A hit is its name in the
  accent, a mark where its values are held back, and one line of its own words. The page
  behind is dimmed at 35%. The door in the top bar is a 32px control, "Search", with the key
  ("/") shown from 640px.
- **Motion.** The sheet has none, opening or closing. Highlights and `/search` have none. The
  Overview has the one flourish of PLAN section 8, on a first visit only: each row fades up
  6px over 320 ms on the press curve, 40 ms after the row before; opacity only under reduced
  motion.

### Topic pages (M23, ADR 0037)

- **The index** is one panel of rows, a Topic to a row: its name at 16px semibold as the door,
  its Segment at 12px `ink-3`, the definition it quotes behind a 2px `line-strong` rule with
  the source under it, and its main Series.
- **A Topic page** opens with a "Topic" panel: the name as the page's one `h1`; the definition
  as a `blockquote` behind a 2px ink rule at 16px medium (18px from 640px), 60 characters wide,
  with its source and "archived copy" (or the reason there is none) in the `figcaption`; then,
  under a hairline, the main Series' name as a door and its change strip.
- **The main figure** is the explained figure over ten years; the panel is titled with the
  Series' name and its meta line gives the window.
- **What else moved** lists each Companion (name as a door, the relation's fixed words under
  it at 12px `ink-3`, the reason where it has no values), then one explained figure in which
  every Series has a plot of its own. A plot of several is lower than a plot on its own (150,
  170 and 190 units for the three widths), all share one time axis and one left edge, and each
  is named under it with its swatch. A sentence above says the scales at the left differ.
- **Against the range** is one plot: the compared Series and the median as lines in the series
  colours, and the band from the lowest to the highest value as ink at 12% with no outline,
  behind them. Where a Period has no range the band stops; a Period on its own is a 3px
  upright stroke. The band's two edges are in the table and are one entry of the legend (a
  12% ink swatch), never lines. Above the plot, one sentence at 16px medium states the latest
  figures; under it, what the band is, as a short list; a disclosure holds the count of
  members in each Period; then every member, two columns from 640px, its country code at 12px
  `ink-3` before its name.
- **Claims, Events and Series** are plain lists of doors. A draft carries the small bordered
  "Draft" word used on the Events index.
- **The tab bar** now holds five tabs (Topics · Claims · Explore · Events · Data). Below 640px
  a tab's side padding is 6px and the gap 2px, so the five fit a 320px phone without the bar
  scrolling; from 640px they are 12px and 4px as before. The fold under "Research" (PLAN
  section 3) comes with a sixth tab.
- **Motion.** None: these are reading pages, and charts and data get no animation.

### Still to be recorded here

Statement-table styles (v2.3) are added to this file by the milestone that builds them.

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
- Popovers are specified in PLAN section 8 and arrive with the components that use them. The
  Overview's first-visit stagger and the search sheet are recorded above (M22).

## Accessibility floor (checked by Playwright on the fixture release)

axe-core clean in both themes; no horizontal page scroll at 320px; every link and button in view
and hit-testable at 320 CSS px (a 640px window at 200% zoom); largest contentful paint under
2.5 s on a throttled phone profile; keyboard order follows reading order, starting with the skip link; text at least 4.5:1,
control borders and data marks at least 3:1; targets at least 24px; reading pages complete with
JavaScript off.
