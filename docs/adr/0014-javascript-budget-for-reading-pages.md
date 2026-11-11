---
status: accepted (M1 measurement, 2026-11-11)
---

# JavaScript budget: the framework floor plus 15 KB for reading pages

Reading pages (overview, topic, claim, series) are complete without JavaScript, so the JavaScript
they still send is overhead for most readers and should stay near what the framework itself
costs. The plan (4.6) asked M1 to measure that floor and set the budget at the floor plus 15 KB.

## The measurement

`site/scripts/measure-js.mjs` fetches a page from a production build and adds up the gzip size of
every script file its HTML references, each counted once (the `nomodule` polyfill, which modern
browsers do not fetch, is left out). Measured on the M1 shell, Next 16.4.5 with Turbopack, React
19.3:

| | gzip bytes |
|---|---|
| **Framework floor**: every chunk that holds none of this app's client code | **131,395** (128.3 KB) |
| The M1 shell's own client code (the theme control and what it pulls in) | 4,070 |
| The M1 shell in total | 135,465 |
| **Budget for a reading page** = floor + 15 KB | **146,755** (143.3 KB) |

The floor is measured apart from the shell on purpose: the app's own chunks are recognised by a
string only they contain, so the theme control counts against the 15 KB, not inside the floor.

The inline scripts are not in these figures. They are the page's own content in React's wire
format (about 3.5 KB gzip on the M1 page), and they grow with the page, not with the code.
`measure-js.mjs` reports them separately; M3 should watch that number when the first long table
is rendered, since a page's data is then sent twice (HTML and payload).

## Decision

- A reading page may load at most **146,755 gzip bytes of script files**. The figure is the
  constant `JS_BUDGET` in `measure-js.mjs`, and `site/tests/built/build.test.ts` fails the build
  when a reading page goes over it.
- The same test fails if the measured floor moves more than 10% from the recorded one, which is
  what a framework upgrade will do. Re-measure, and amend this ADR with the new figures; do not
  just raise the constant.
- The Explorer, search and popovers are interactive and are not reading pages. They get their own
  budget when they are built (M4), recorded here.
- This is not a stop for Alex. A page that cannot fit moves code behind an interaction or renders
  it on the server.

## Considered options

- **No framework JavaScript on reading pages at all.** Next's App Router does not offer that
  without giving up the shared shell and client islands. Revisit if the floor grows.
- **A budget on total bytes including inline data.** It would punish a page for having content.
- **A fixed round number (150 KB).** Easier to remember, but it hides a framework regression
  inside the slack.
