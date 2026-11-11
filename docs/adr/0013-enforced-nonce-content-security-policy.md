---
status: accepted (M1 spike, 2026-11-11)
---

# An enforced Content Security Policy with a per-request nonce

/missions sends its policy as Report-Only with `script-src 'self' 'unsafe-inline'`, because its
pages are a static shell and a `'self'`-only policy breaks Next's inline bootstrap. The plan
(4.6) asked M1 to find out whether Macro Atlas can do better: enforce a nonce or hash policy if it
works with release-keyed caching and with pages that render without JavaScript; otherwise ship
/missions' Report-Only policy.

It works, so Macro Atlas enforces this policy on every response, from the proxy
(`site/src/lib/csp.ts`):

```
default-src 'self';
script-src 'self' 'nonce-{fresh per request}' 'strict-dynamic';
style-src 'self' 'nonce-{same}';  style-src-attr 'unsafe-inline';
img-src 'self' data:;  font-src 'self';  connect-src 'self';
frame-ancestors 'none';  base-uri 'self';  form-action 'self';  object-src 'none'
```

In `next dev` only, `'unsafe-eval'` is added (React's development build needs it) and inline
style elements are allowed (Next's error overlay injects them without a nonce).

## What the spike found

- **Next 16 applies the nonce by itself.** The proxy sets the policy on the *request* as well as
  the response; Next reads the nonce from it and puts it on its bootstrap script, every chunk and
  the stylesheet link. No page code handles a nonce.
- **It costs nothing here that we had not already paid.** A nonce needs every page to render per
  request. Macro Atlas's pages already do: they read a Release at request time, and that is also
  what keeps Release values out of the build output (PLAN 6.1). "Release-keyed caching" in this
  app is the ReleaseReader's in-memory cache by release id, which a nonce does not touch.
- **Pages without JavaScript are unaffected.** The policy restricts what may run, not what is
  rendered.
- **The theme needs no inline script**, which is what forces `'unsafe-inline'` on /missions: the
  override is a cookie the server reads (ADR 0009, `DESIGN.md`).
- **No inline `<style>` elements are emitted** by the production build. Style *attributes* are
  allowed (`style-src-attr 'unsafe-inline'`): server-rendered figures will position marks with
  them, and they cannot run script.
- **`'strict-dynamic'` trusts what trusted scripts create.** A script element built by the app's
  own code runs; that is by design and is how Next loads chunks. What the policy stops is markup
  that reaches the page as HTML: inline event handlers, `javascript:` links, parser-inserted
  script. The browser test injects those and checks they do not run.

## Considered options

- **Report-Only, as on /missions.** Safe to ship, but it blocks nothing.
- **Hashes for the inline bootstrap.** Next's inline scripts carry the page's data, so their
  hashes change with every Release and every page; they cannot be known at build time.
- **`'self'` with no nonce.** Blocks Next's own inline bootstrap; the page never hydrates.

## Consequences

- An HTML response carries a nonce, so it is never shared-cached and never revalidated as a 304
  (the cached body would hold a stale nonce). If a later milestone wants cached HTML for reading
  pages, it must change this decision first; the fallback is the /missions Report-Only policy,
  and the change is an amendment here, not a quiet edit to `csp.ts`.
- Nothing may load from another origin: no CDN, analytics or remote font. Adding one means
  editing the policy, which a test will notice.
- Inline event handlers and inline scripts do not work in this app. Client code is a module.

## Tests

`site/src/lib/csp.test.ts` (the policy), `site/tests/built/build.test.ts` (the built server sends
it enforced, every script tag carries the response's nonce, the nonce is fresh, no inline style
element) and `site/e2e/shell.spec.ts` (a real browser hydrates the page at both base paths with
no violation, and injected markup cannot run script).
