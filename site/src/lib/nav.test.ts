import { describe, expect, it } from "vitest";
import { breadcrumb, tabsFor } from "./nav";

describe("navigation: only tabs whose pages exist are shown (PLAN section 3)", () => {
  it("shows Explore, Events (from M19) and Data, in the plan's order", () => {
    expect(tabsFor("/explore").map((t) => t.label)).toEqual(["Explore", "Events", "Data"]);
    expect(tabsFor("/data").find((t) => t.current)?.label).toBe("Data");
    expect(tabsFor("/data/fx_price_index").find((t) => t.current)?.label).toBe("Data");
  });

  it("shows Claims, first, only when the Release being served holds a Claim (M21)", () => {
    expect(tabsFor("/explore", { claims: true }).map((t) => t.label)).toEqual(["Claims", "Explore", "Events", "Data"]);
    expect(tabsFor("/claims/2025-12-11-x", { claims: true }).find((t) => t.current)?.label).toBe("Claims");
    expect(tabsFor("/claims", { claims: false }).map((t) => t.label)).toEqual(["Explore", "Events", "Data"]);
    expect(breadcrumb("/claims")).toBe("Claims");
  });

  it("shows Topics, before Claims, only when the Release being served holds a Topic (M23)", () => {
    expect(tabsFor("/explore", { claims: true, topics: true }).map((t) => t.label)).toEqual(["Topics", "Claims", "Explore", "Events", "Data"]);
    expect(tabsFor("/topics/inflation", { topics: true }).find((t) => t.current)?.label).toBe("Topics");
    expect(tabsFor("/topics", { topics: false }).map((t) => t.label)).toEqual(["Explore", "Events", "Data"]);
    expect(breadcrumb("/topics/jobs")).toBe("Topics");
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

  it("names Highlights and Search, which have no tab, and nothing on the Overview itself (M22)", () => {
    expect(breadcrumb("/highlights")).toBe("Highlights");
    expect(breadcrumb("/search")).toBe("Search");
    expect(breadcrumb("/")).toBeNull();
    expect(tabsFor("/highlights").some((t) => t.current)).toBe(false);
    expect(tabsFor("/").map((t) => t.label)).toEqual(["Explore", "Events", "Data"]);
  });
});
