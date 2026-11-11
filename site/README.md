# site

The Macro Atlas web app (ADR 0001): Next.js 16 App Router, React 19, Tailwind 4, copied from the
/missions skeleton. It reads Releases through the ReleaseReader and never writes one.

## Run it

Every build is given its Surface and base path explicitly; there are no defaults (PLAN 6.1).

| What | Command | Address |
|---|---|---|
| On v1's data (converts it first; local only) | `make v2` | http://localhost:3000/macro-atlas/data, then any series name, e.g. http://localhost:3000/macro-atlas/data/unrate |
| Development, fixture release | `make v2-dev` | http://localhost:3000/macro-atlas/explore |
| Both base paths in Docker, loopback only | `make v2-up` | http://localhost:3101/macro-atlas/explore and http://localhost:3102/macro-atlas-staging/explore |
| A production build by hand | `ATLAS_SURFACE=local BASE_PATH=/macro-atlas npm run build -w @macro-atlas/site`, then `ATLAS_RELEASE_ROOT=$PWD/fixtures/public npm start -w @macro-atlas/site` | http://localhost:3000/macro-atlas/explore |

All but the first serve the committed fixture release (synthetic data) unless `ATLAS_RELEASE_ROOT`
(or `ATLAS_RELEASES` for compose) points somewhere else.

| Setting | When | Meaning |
|---|---|---|
| `ATLAS_SURFACE` | build | `local`, `staging` or `production`. Fixed into the build |
| `BASE_PATH` | build | `/macro-atlas` or `/macro-atlas-staging`; must match the Surface |
| `ATLAS_RELEASE_ROOT` | start | The directory that holds `CURRENT` and `releases/` |

## How a request is answered

```
request -> src/proxy.ts -> src/lib/gate.ts
             local build and the Host is not this machine?   421
             read CURRENT once; open, validate, guard        503 on every path if it may not be served
             forward with x-atlas-release, the CSP and nonce
           -> layout, page or route handler: releaseForRequest() opens exactly that Release
```

| Module | Holds |
|---|---|
| `src/lib/surface.ts` | The Surface and base path rule; called by `next.config.ts`, so a bad build fails |
| `src/lib/release/reader.ts` | ReleaseReader v0: open, validate, cache by id, the Surface guard, the failed-refresh state |
| `src/lib/gate.ts`, `src/proxy.ts` | One read of `CURRENT` per request; 503 everywhere when refused; security headers |
| `src/lib/csp.ts` | The enforced nonce policy (ADR 0013) |
| `src/lib/release/server.ts` | `releaseForRequest()`: the Release this request was fixed to |
| `src/lib/theme.ts`, `src/components/ThemeControl.tsx` | OS theme with a cookie override; a form that works without JavaScript |
| `src/lib/query/` | Query v0: one validated request shape; asks `permits()` about the whole lineage, then the engine answers |
| `src/lib/catalog.ts`, `src/app/data/page.tsx` | The catalog page: search and filters as a GET form, values through Query, no script of its own |
| `src/lib/figure/` | The explained figure as data: `renderFigure(spec, series)` gives the takeaway or the reason for silence, three drawings, marks, lines of words and the table (`docs/method/explained-figure.md`, ADR 0017). Pure |
| `src/components/Figure.tsx`, `Svg.tsx`, `StateMark.tsx` | Lay the figure out; show one of its three drawings by container query; no script |
| `src/lib/series-page.ts`, `src/components/SeriesPage.tsx`, `src/app/data/[key]/page.tsx` | The series page: values only through Query; a withheld or refused series keeps its page without values |
| `src/lib/glossary.ts`, `src/app/docs/glossary/` | The site's own words, each defined once; a page per term |
| `src/components/ReleaseStrip.tsx` | The strip on every page of a local-profile Release |
| `src/lib/nav.ts` | The tabs. A tab is listed only when its pages exist |
| `src/app/globals.css` | Tokens copied from /missions plus Macro Atlas's own (`/DESIGN.md`) |

Decisions: ADR 0013 (CSP), 0014 (JavaScript budget), 0015 (one Release per request, Surface fixed
at build), 0017 (figures drawn on the server at three widths). Links between pages are plain `<a>` elements on purpose (ADR 0015).

## Tests

| Suite | Command | Proves |
|---|---|---|
| Unit (Vitest) | `npm test` at the repo root | the figure (cadence, every data state's mark and word, every takeaway template and silence rule, label extents at each width, the palette under colour-vision deficiency); series pages for all 126 v1 series rendered to static markup; the glossary; surface rule, reader, gate, CSP, theme, freshness, navigation, token contrast in both themes; Query; the catalog view; the comparison of all 126 v1 series with v1's `stats.js` (needs the Python environment: it runs the legacy converter into a temp dir) |
| Built server (Vitest) | `npm run test:built -w @macro-atlas/site` | M1's acceptance criteria over HTTP on three production builds |
| Browser (Playwright) | `npm run test:e2e -w @macro-atlas/site` | theme follows the OS and the override persists; CSP does not break hydration; JavaScript off; axe; 320px; keyboard order; the catalog page's search and filters; series pages (the right drawing at each width, no clipped label from 320px up, every data state on a page, JavaScript off, axe in both themes) |
| Images (Docker) | `make v2-image-check` | no seeded value in any image layer; compose serves both paths on loopback only |

`make v2-site-check` runs the second and third.
