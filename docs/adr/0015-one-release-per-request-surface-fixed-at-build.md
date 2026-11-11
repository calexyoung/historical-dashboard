---
status: accepted (M1, 2026-11-11)
---

# The proxy fixes one Release per request; the Surface is fixed when the image is built

M1 had to make four promises true in the web app: everything on a page comes from one Release; a
rewritten `CURRENT` is served with no restart; a build knows its Surface and cannot be talked out
of it; and a build for a public Surface answers 503 everywhere, health check included, when the
Release it is pointed at may not be served there (PLAN 6.1, ADR 0006). This records how.

## Decisions

1. **The Surface and base path are build inputs with no defaults.** `next.config.ts` calls
   `resolveSurface()` and throws when `ATLAS_SURFACE` or `BASE_PATH` is missing, unknown or
   mismatched: production is `/macro-atlas`, staging is `/macro-atlas-staging`, and local may be
   either (so both paths can be tried on one machine). Both values are then inlined into the
   build. Setting `ATLAS_SURFACE=local` on a running production container changes nothing; a test
   does exactly that.

2. **The proxy reads `CURRENT`, once per request, and nothing else does.** `site/src/proxy.ts`
   runs on every path. It asks the ReleaseReader for the promoted Release and either answers 503
   itself or forwards the request with the release id in a header (overwriting anything a client
   sent). Pages and route handlers call `releaseForRequest()`, which opens exactly that id. So a
   response is one Release even while `CURRENT` is being rewritten.

3. **Navigation between pages is a full document load.** Links are plain `<a>` elements, not
   `next/link`. Client-side navigation would let a layout from one Release sit around content
   from the next, and would prefetch pages from a Release that may be gone by the click. One
   document is one request is one Release. The Explorer (M4) changes its own state in place
   without leaving its page.

4. **The reader refuses, on a public Surface, any Release that is not public-profile, names an
   unsigned rights register or holds a legacy Series**, checking the manifest's profile before
   validation and the rest after. The contract's own profile rules (`unsigned_register`,
   `legacy_in_public`, `draft_in_public`) count as refusals too. A refused Release is never
   replaced by an earlier good one: the answer is 503 until `CURRENT` names a Release that may be
   served.

5. **Staging is held to production's rule for now.** The plan lets staging show a local-profile
   Release only behind a password that covers every route (D9, still open). The app cannot see
   whether Caddy asks for a password, so until a deploy step can prove it (M27), a staging build
   refuses what a production build refuses. This is the stricter reading and is Alex's to relax.

6. **A failed refresh is not a refusal.** If `CURRENT` names a Release that is missing or breaks
   the contract in some other way, and this process has already served a good one, it keeps
   serving that one; the top bar says "Refresh failed" and `/api/health` reports `degraded` with
   the reason. With no earlier good Release the answer is 503.

7. **A local-surface build answers only to this machine's names** (`localhost`, `*.localhost`,
   `127.0.0.1`, `[::1]`); any other `Host` gets 421. A local build may hold v1's data (PLAN 6.1),
   and binding to loopback does not stop someone pointing a reverse proxy at it. This is an added
   defence, not the boundary: `atlas doctor` (M26) is still the deploy check.

8. **Every Surface but production sends `X-Robots-Tag: noindex`.**

## Considered options

- **Each page reads `CURRENT` itself.** Two reads in one request can see two Releases; and a 503
  for "every route" would have to be remembered in every route.
- **A `next.config` redirect from `/` to `/explore`.** It runs before the proxy, so a refused
  Release would still answer 307 there. The redirect is an ordinary route instead.
- **Read the Surface from the environment at start-up.** One wrong variable on the server would
  turn a production container into a local one.
- **Treat a rule-breaking Release as "invalid" and fall back** to the last good one. The site
  would keep answering 200 while pointed at something it must refuse, and nobody would notice.

## Consequences

- No page is prerendered, and nothing from a Release is in the build output or the image; tests
  search both for seeded values.
- Next documents that redirects and headers from `next.config` run before the proxy. This app
  defines none, and sets `skipTrailingSlashRedirect` so the proxy sees every path as asked. A
  request outside the base path never reaches the app's routes and gets Next's own 404.
- The proxy and the pages may not share memory, so they share nothing but request headers. A page
  re-opens the Release by id from its own cache or from disk. If a last-good Release has been
  pruned from disk while a refresh is failing, the page fails with a 500, not with other data.
- Withdrawal (ADR 0006) and the failed-refresh state interact: if the Release that replaces a
  withdrawn one is broken, the old one would still be served by a running process. The publisher
  validates before promotion, and `atlas withdraw` (M9) must end by checking `/api/health`.
