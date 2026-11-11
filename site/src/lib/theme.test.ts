import { describe, expect, it } from "vitest";
import { parseThemeChoice, safeReturnPath, themeCookie, themeFromCookie } from "./theme";

describe("theme: the OS setting unless the reader chose otherwise", () => {
  it("reads the override from the cookie, and anything else means follow the OS", () => {
    expect(themeFromCookie("dark")).toBe("dark");
    expect(themeFromCookie("light")).toBe("light");
    for (const value of [undefined, "", "auto", "DARK", "dark;x", "<script>"]) expect(themeFromCookie(value)).toBeNull();
  });

  it("accepts only the three choices from the form", () => {
    expect(parseThemeChoice("auto")).toBe("auto");
    expect(parseThemeChoice("light")).toBe("light");
    expect(parseThemeChoice("dark")).toBe("dark");
    expect(parseThemeChoice("sepia")).toBeNull();
    expect(parseThemeChoice(null)).toBeNull();
  });

  it("keeps an override for a year, scoped to this app's base path", () => {
    expect(themeCookie("dark", "/macro-atlas")).toBe("atlas-theme=dark; Path=/macro-atlas; Max-Age=31536000; SameSite=Lax");
    expect(themeCookie("light", "/macro-atlas-staging")).toContain("Path=/macro-atlas-staging;");
  });

  it("forgets the override when the reader goes back to Auto", () => {
    expect(themeCookie("auto", "/macro-atlas")).toBe("atlas-theme=; Path=/macro-atlas; Max-Age=0; SameSite=Lax");
  });

  it("sends the reader back only to a page of this app", () => {
    const base = "/macro-atlas";
    expect(safeReturnPath("/macro-atlas/explore?s=a,b", base)).toBe("/macro-atlas/explore?s=a,b");
    expect(safeReturnPath("/macro-atlas", base)).toBe("/macro-atlas");
    expect(safeReturnPath("/macro-atlas/data/unrate?from=2020-01&s=a%2Cb#table", base)).toBe("/macro-atlas/data/unrate?from=2020-01&s=a%2Cb#table");
    for (const bad of [
      null,
      "",
      "https://evil.example/macro-atlas/",
      "//evil.example/macro-atlas",
      "/macro-atlas-staging/explore",
      "/macro-atlas/../admin",
      "/macro-atlas/%2e%2e/missions",
      "/macro-atlas/%2E%2E%2Fmissions",
      "/macro-atlas/a/..%2f..%2fmissions",
      "/macro-atlas/./../missions",
      "/macro-atlas/\t/x",
      "/macro-atlas/\\evil",
      "/macro-atlas/x\r\nSet-Cookie: a=b",
      "/other",
    ]) {
      expect(safeReturnPath(bad, base)).toBe("/macro-atlas/");
    }
  });
});
