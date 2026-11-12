---
status: accepted (M22, 2026-11-12); the choice of headline Series is an editor's and is Alex's to change; twins of the Overview and Highlights are not built (see Deferred)
---

# Headline Series are an editor's list, search is a projection, and a row is what the gate allows

M22 builds the Overview as the front door, Highlights, the sparkline and change-strip figure
types, `search.json`, the search sheet and a `/search` that needs no script. The plan fixed the
pages and the acceptance criteria. This records the choices it left open.

## Decisions

1. **Which Series are headline Series is a file an editor writes**, `content/highlights.json`
   in the repository: for each Segment, Series keys in order. The first is the Segment's row
   of the Overview; all are rows of Highlights. It names Series, holds no value and grants
   nothing. `atlas check` holds it to the Catalog (every key exists, sits in the Segment it is
   listed under, is listed once, is not retired). It is not derived from the Catalog because
   "headline" is a judgment about what a reader looks for first, and a judgment belongs in a
   file with a history.
2. **A Release carries its own projection of that file** (`content/highlights.json`, contract
   0.5.0): all six Segments in the Overview's order, each with the declared Series that this
   Release's Catalog holds in that Segment. A key the Release does not hold is left out and
   named in the check report; it is not an error, because a Release of part of the Catalog is
   normal while rows of the rights register are unsigned. A Segment may be empty and the
   Overview then says so. The site never reads the repository's file.
3. **`search.json` is a projection and nothing else** (0.5.0): one entry per Series of
   `catalog.json`, then per Event, then per Claim, each the entry's id, its name, its own
   descriptive text and a few keywords. It is written by one function (`search_document`),
   last of all on every writer path, and both validators recompute it and refuse a Release
   whose file differs. **The guarantee is about where it comes from, not about digits:** no
   Observation, lock or Evidence row is read to make it, so no value of a Series can enter it
   from data. A description, an Event's text and a Claim's quote are editorial content that is
   already public on the catalog, event and claim pages, and may contain numbers a person
   wrote. A Withheld Series is in the index by name, flagged, as it is on the catalog page.
4. **The glossary is searched from the site, not from the Release.** It is the site's own
   vocabulary (`site/src/lib/glossary.ts`) and changes with the site, not with the data. Topic
   hits arrive with Topics (M23).
5. **Search is lexical and small.** A word of the question must begin a word of an entry;
   every word must be found; a match in a name outranks one in a key, a keyword or a
   description; equals keep the index's order. Hits are grouped in one fixed order (Series,
   Events, Claims, Glossary). The page and the sheet call one function; the sheet's JSON
   (`/search/hits`) is the page's helper and is no part of the read API (M24). A Series hit is
   marked when the rights gate, asked for this Surface, would hold its values back.
6. **A row is what the gate allows.** Each headline Series is asked through Query for display
   on the Surface in hand, and the row is built from that answer and from nothing read beside
   it. A Series the gate refuses is its name and the reason: no value, no Period, no window, no
   drawing, no accessible label that dates a value. Tests seed the fixture's values and look
   for them in the HTML, the SVG and the JSON of a production build.
7. **The change over one, five and ten years is the engine's** (`changeOver`,
   `docs/method/highlights.md`; `semantics_version` 0.8.0). What a page prints of it follows
   the Takeaway's rules: no figure beside a partial Period, an estimate or a projection, or
   across a break; the Data state is named in the cell. This is stricter than arithmetic
   requires and is a presentation policy: a table cell is read as a fact about the world, and
   an estimate set against an observation is not one. Preliminary and revised values are
   compared and marked. A stale Series keeps its figures and is marked Stale.
8. **Two figure types, both server-drawn.** The *sparkline* is the explained figure's drawing
   with everything but the Series removed: ink, the ten years to the latest value, the
   figure's own rule for cadence (line, points or steps), gaps never bridged, and an accessible
   name of the Series and the Periods it spans. The *change strip* is a Series' latest value
   and its three cells, each a door; a row of Highlights is a strip, and a Topic page will open
   with one (M23). Neither animates.
9. **Every cell is a door** to `/explore?s={key}&from=…&to=…`, from the first month of the
   earlier Period to the last month of the latest, with `freq=monthly` when the comparison was
   made at months, and also when the cell has no figure.
10. **The Overview's date line says what it is**: "Release of {day} · each row names its own
    period". The plan's sketch reads "Data to 11 Nov 2026"; the day a Release was made is not
    the day its data runs to, and each row already names its Period.
11. **v1's links still open.** v1 was one page, so its links are the front door with the view
    after a `#`. The Overview carries the same small shim the Explorer has and sends such a
    link to the Explorer. It is the only script the Overview's content needs.
12. **The first visit is decided by the gate, from the request.** PLAN section 8 allows one
    flourish: on a first visit the Overview's rows fade up with a 40 ms stagger. The gate
    looks for a cookie (`atlas-seen=1`, the base path, a year, HttpOnly, Secure over HTTPS) on
    a reader's own GET of `/`, tells the page through a request header a client cannot set,
    and sets the cookie. The page is rendered per request and is not stored by a shared cache.
    The cookie records one bit and identifies nobody. The fade is CSS (`@starting-style`); the
    rows are in the HTML and usable throughout; reduced motion keeps the fade and drops the
    movement.
13. **The search sheet never animates** (PLAN section 8: search opening). Without script it is
    a link to `/search`.
14. **No Overview tab.** PLAN section 3 lists none before the statement views (v2.3); the site
    name in the top bar is the way home. Highlights and Search have a breadcrumb and no tab.

## Deferred

- **Twins of `/` and `/highlights`** (`.csv`, `.json`, `.md`). PLAN section 3's rule is that a
  page's address is its API. M22's criteria do not ask for these, they need the redistribute
  gate applied row by row, and M25 lists Markdown twins for every page; CSV and JSON of
  Highlights should be decided with M24's read API so the two agree. Until then each row's
  figures are reachable through the Series' own twins.
- **Topic hits and topic links on the Overview**: M23.

## Consequences

- A Release written before 0.5.0 (an old pinned one) opens with six empty Segments and a
  search index made by the same projection when it is opened.
- On a production build, while no row of the rights register is signed, the Overview and
  Highlights name each headline Series with the reason and show no figure.
