import { describe, expect, it } from "vitest";
import { breadcrumb, tabsFor } from "./nav";

describe("navigation: only tabs whose pages exist are shown (PLAN section 3)", () => {
  it("shows Explore, Events (from M19) and Data, in the plan's order", () => {
    expect(tabsFor("/explore").map((t) => t.label)).toEqual(["Explore", "Events", "Data"]);
    expect(tabsFor("/data").find((t) => t.current)?.label).toBe("Data");
    expect(tabsFor("/data/fx_price_index").find((t) => t.current)?.label).toBe("Data");
  });

  it("marks the tab the reader is under, including deeper pages", () => {
    expect(tabsFor("/explore").find((t) => t.current)?.label).toBe("Explore");
    expect(tabsFor("/explore/anything").find((t) => t.current)?.label).toBe("Explore");
    expect(tabsFor("/no-such-page").some((t) => t.current)).toBe(false);
    expect(tabsFor("/explorers").some((t) => t.current)).toBe(false);
  });

  it("names where the reader is for the breadcrumb, or nothing on an unknown page", () => {
    expect(breadcrumb("/explore")).toBe("Explore");
    expect(breadcrumb("/data")).toBe("Data");
    expect(breadcrumb("/nowhere")).toBeNull();
  });
});
