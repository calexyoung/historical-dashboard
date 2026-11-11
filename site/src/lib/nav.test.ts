import { describe, expect, it } from "vitest";
import { breadcrumb, tabsFor } from "./nav";

describe("navigation: only tabs whose pages exist are shown (PLAN section 3)", () => {
  it("shows Explore alone in M1", () => {
    expect(tabsFor("/explore").map((t) => t.label)).toEqual(["Explore"]);
  });

  it("marks the tab the reader is under, including deeper pages", () => {
    expect(tabsFor("/explore").find((t) => t.current)?.label).toBe("Explore");
    expect(tabsFor("/explore/anything").find((t) => t.current)?.label).toBe("Explore");
    expect(tabsFor("/no-such-page").some((t) => t.current)).toBe(false);
    expect(tabsFor("/explorers").some((t) => t.current)).toBe(false);
  });

  it("names where the reader is for the breadcrumb, or nothing on an unknown page", () => {
    expect(breadcrumb("/explore")).toBe("Explore");
    expect(breadcrumb("/nowhere")).toBeNull();
  });
});
