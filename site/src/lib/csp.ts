/**
 * The Content Security Policy, enforced, with a fresh nonce per request (ADR 0013).
 *
 * The proxy builds it and sends it on the response; it also forwards it on the request, which is
 * where Next reads the nonce it puts on its own bootstrap and chunk scripts. Nothing loads from
 * another origin: there is no CDN, no analytics and no remote font (ADR 0001).
 */
export function buildCsp(nonce: string, options: { dev: boolean }): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets a nonced script load the chunks it needs. React's development build
    // needs eval for its debugging tools; the production build does not.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ""}`,
    // Stylesheets from this origin, style elements only with the nonce. Style attributes are
    // allowed: a server-rendered figure positions things with them, and they cannot run script.
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
