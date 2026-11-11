---
status: accepted (M4, 2026-11-11)
---

# The Explorer is drawn on the server from its address

v1's Explorer was one script: it held the state, drew the chart on a canvas and wrote the state
after a `#`. The plan (section 3) allows v2's Explorer to need JavaScript, and asks that its
address fully describe what is shown, that a copied link reproduce the view, that nothing be
hover-only, and that nothing animate on data.

## Decisions

1. **The address is the state, and the server draws every view.**
   `/explore?s=spx,unrate&mode=z&from=2019-06&to=2022-06&layers=rec,ev.policy,gov.pres&at=2020-04-01&event={id}`.
   `lib/explorer/state.ts` reads and writes it; `lib/explorer/view.ts` turns it into everything
   the page shows, through Query; the figure module draws it (ADR 0017), with what M4 added to
   it: one time axis shared by every plot, Annotation layers, a pinned date, a logarithmic axis.
   There is no second copy of the state in the browser to drift from the address, and no
   `localStorage` (v1 restored the last view; v2 opens what the address says).
2. **Every control is a GET form or a link**, so the Explorer works with JavaScript off: mode and
   window are form fields, the layer switches are fields of the same form, the picker is a form
   in a `<dialog>` that `?pick=1` opens, presets and "remove" are links. "Not said" and "none"
   are different things in the address (`layers` absent is the defaults; `layers=none` is none),
   because a form with every box cleared must not come back with the defaults ticked.
3. **Five small client components make it quick, and hold no state the address lacks.** A change
   is applied at once by a client-side navigation that keeps the scroll position (a step in the
   history, so Back undoes it). A pointer previews the readout; a click, a tap or the arrow keys
   pin it, which writes `at=` (replacing the history entry; a run of key presses asks the server
   once). The picker opens as a modal sheet. v1's hash links are translated and replaced.
   If a navigation is answered from a newer Release than the page's frame, the page reloads, so
   one page is still one Release (ADR 0015).
4. **Mixed units are small multiples**, one plot per unit of what is drawn, never two axes on one
   plot (v1 drew a second axis). In `rebase`, `z`, `pc1` and `drawdown` every Series shares one
   unit, so there is one plot.
5. **The copied link says everything outright**: the resolved Series, mode, both ends of the
   window and the layers. It opens the same view whatever the defaults are and however far the
   data has moved on. It reproduces the *view*; the *data* is that of the Release being served.
   Pinning a link to a Release (`pin=`) arrives with vintages in M18.
6. **v1's links.** `v1HashToQuery` reads a hash the way v1's `applyParams` did, quirks included
   (checks/v1-links.json was recorded by driving v1's own page). What a v1 link asks of features
   that arrive in M5 (`cmp`, `basis`, `lag`, `sx`, `sy`, `roll`, `ext`) is kept in the address
   untouched and the page says so in one line. (M5: they are real parameters now; ADR 0019.)
7. **Motion** (PLAN section 8). Nothing in a drawing, the readout or the lists moves. The picker
   sheet slides by `transform` only, 240 ms in and 180 ms out, with CSS transitions and
   `@starting-style`; opened from the keyboard it does not move, and under reduced motion it
   fades. "Copied" crossfades in 200 ms. The 150 ms crossfade the plan allows for layer toggles
   is not used: a layer is redrawn at once, like the data it sits behind.

## What it costs (production build, measured in M4)

| | |
|---|---|
| Server time to draw a view | 15 to 90 ms on v1's data (one to eight Series over 27 years) |
| HTML, v1's opening view (four Series, 83 Events) | 565 KB, 102 KB gzip |
| HTML, eight Series over the whole axis | 960 KB, 154 KB gzip |
| The same with the table asked for | 1.66 MB, 204 KB gzip |
| Script files | 147 KB gzip, of which 15.7 KB is this app's (ADR 0014) |

Three things keep it there. A drawing's contents are sent as markup, not as React elements
(`components/Svg.tsx`): as elements each node is sent twice, the second time at several times
the size. All Event ticks in a plot are one path. And the table, hundreds of rows a Series, is
sent only when asked for (`table=1`). Links between views do not prefetch: there are about a
hundred on the page and each is a whole drawing.

## Considered options

- **Draw in the browser from a JSON answer.** Fewer bytes per interaction and no round trip, but
  a second renderer beside the figure module, no page without JavaScript, and state that can
  drift from the address. Revisit if daily data (M11) makes a server-drawn view too heavy; the
  fix would be to thin what is drawn per layout, as ADR 0017 already says.
- **Full page loads for every change.** Simplest, but each change would reset the scroll
  position, which is unusable for the layer switches under the chart.
- **A dual axis for two units**, as v1 had. Two scales on one plot invite reading crossings that
  mean nothing.

## Consequences

- A view costs a server render. The Explorer is not a reading page and has its own JavaScript
  budget (ADR 0014).
- M5's features (statistics, compare ranges, export) are further parameters of the same address
  and further panels of the same view. The `carried` parameters become real ones there.
- M18 adds `as_of` and `pin` to the address; nothing here stands in their way.

## Tests

`lib/explorer/state.test.ts`, `view.test.ts` (fixture), `lib/legacy/explorer.test.tsx` (v1's
presets, links, layers and dates, on a legacy release made in a temporary directory),
`lib/figure/explorer.test.ts`, `e2e/explorer.spec.ts` (a real browser, JavaScript on and off,
360 px and 1280 px, both themes), `tests/built/build.test.ts` (the budget).
