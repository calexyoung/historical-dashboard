---
status: accepted (M3, 2026-11-11)
---

# The explained figure is drawn on the server at three widths, from a Series' cadence

A reading page must be complete without JavaScript (PLAN section 3), so its chart is drawn on the
server, which does not know how wide the reader's screen is. One SVG scaled to fit would put its
12px labels at 5px on a phone; DESIGN.md allows nothing under 12px, and M3 requires that a figure
at 320px has no clipped labels.

## Decisions

1. **Three drawings, one shown.** `renderFigure` lays every plot out at 256, 448 and 768 px. All
   three are in the HTML, and a CSS container query on the figure's own box shows exactly one:
   under 448px the narrow one, from 768px the wide one. A drawing is therefore only ever scaled
   **up** from the width it was laid out for, so its text is never under 12px, and ticks and
   labels are chosen for that width, not squeezed. 256px is what a 320px phone leaves inside the
   page's and the panel's padding. Where container queries are not supported the narrow drawing
   shows. The two hidden drawings are `display: none`, so they are not in the accessibility tree.
2. **One geometry.** The figure module returns each drawing as a small tree of plain data. One
   function writes it as markup (tests), one generic component maps it to elements (the page).
   Nothing is drawn twice by different code, and the Explorer (M4) can put its interaction on the
   same tree.
3. **How a Series is drawn follows from its Catalog entry, never from how dense it looks.** Held:
   steps, the last value standing until the Release was made. Discrete and monthly or finer: a
   line, broken at every missing Observation. Discrete and quarterly, annual or irregular:
   points only, one per Observation, not joined. Every Observation sits at the start of its
   Period, which is the rule the transform contract already uses for windows. Nothing is filled,
   interpolated or carried forward (v1 filled its sparse series month by month; that is not
   ported).
4. **Colour is one of three channels.** A Series has a palette colour, a line style and a filled
   symbol. Data-state marks are hollow, larger and in ink, so a state is never read as a Series
   and never carried by colour. `palette.test.ts` simulates protanopia, deuteranopia and
   tritanopia in both themes and requires any two palette colours that come close to differ in
   both line style and symbol.
5. **The table rows carry no classes.** A long Series is hundreds of rows, sent twice (HTML and
   React's payload, as ADR 0014 warned). `.figure-table` in `globals.css` styles them.

## Amendment, M4 (2026-11-11)

The generic component now writes a drawing's contents as markup (the figure module's own
`svgString`, which escapes every text and attribute) inside a root element, instead of mapping
every node to an element. The page is the same; React's payload holds the drawing once, as
text, not a second time as elements. It is still one geometry and one writer. The Explorer puts
its interaction on top of the drawings, not into them (ADR 0018): each drawing states its time
axis on its root (`data-t0`, `data-t1`, `data-x0`, `data-x1`), which is all a pointer needs.

## What it costs (measured on a production build, M3)

| Page | HTML | HTML, gzip | of which React's inline payload, gzip |
|---|---|---|---|
| Fixture price index (24 Observations) | 89 KB | 13.8 KB | 8.0 KB |
| The largest of v1's 126 series pages (323 Observations) | 286 KB | 37.3 KB | 21.9 KB |
| Mean of the 126 | | 28.0 KB | |

Script files are unchanged: a series page loads the shell's scripts and none of its own
(`build.test.ts` holds it to ADR 0014's budget). Largest contentful paint on a throttled phone
profile stays under 2.5 s (`e2e/series.spec.ts`). A Vitest on the legacy release fails if the
static markup of any series page passes 100 KB.

## Considered options

- **One drawing, scaled.** Text shrinks below 12px on a phone, or is huge on a desktop.
- **One drawing stretched with `preserveAspectRatio="none"` and labels in HTML.** Symbols and
  marks distort, and label collisions cannot be decided without knowing the width.
- **Measure in the browser and redraw.** Needs script on a reading page, and shifts the layout
  after load.
- **A line through quarterly and annual values.** It is what most charts do, and it draws
  values the Series does not hold; M3's acceptance criterion forbids it. The Explorer may offer a
  reader-chosen connector later, labelled as one.

## Consequences

- A daily Series (M11 onward) will be three long paths. If that grows a page too far, the fix is
  to thin what is *drawn* per layout to the pixels available, never what the table holds.
- The widths are constants of the figure module; changing one means changing the container
  query in `components/Figure.tsx` with it. `e2e/series.spec.ts` checks either side of each
  switch.
