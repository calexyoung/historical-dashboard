import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

const directives = (policy: string): Record<string, string[]> =>
  Object.fromEntries(policy.split("; ").map((d) => [d.split(" ")[0]!, d.split(" ").slice(1)]));

describe("buildCsp: the enforced Content Security Policy (ADR 0013)", () => {
  const csp = directives(buildCsp("Tm9uY2U", { dev: false }));

  it("allows scripts only by this request's nonce, never inline or by eval", () => {
    expect(csp["script-src"]).toEqual(["'self'", "'nonce-Tm9uY2U'", "'strict-dynamic'"]);
  });

  it("allows only this origin for everything else, and nothing from a CDN", () => {
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual(["'self'"]);
    expect(csp["font-src"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(Object.values(csp).flat().filter((v) => /^https?:|\*/.test(v))).toEqual([]);
  });

  it("allows no inline style elements; style attributes are allowed for SVG geometry", () => {
    expect(csp["style-src"]).toEqual(["'self'", "'nonce-Tm9uY2U'"]);
    expect(csp["style-src-attr"]).toEqual(["'unsafe-inline'"]);
  });

  it("adds eval in development only, which React's dev tooling needs", () => {
    expect(directives(buildCsp("n", { dev: true }))["script-src"]).toContain("'unsafe-eval'");
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
  });
});
