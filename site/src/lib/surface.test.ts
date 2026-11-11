import { describe, expect, it } from "vitest";
import { resolveSurface } from "./surface";

describe("resolveSurface: every build is given its Surface explicitly (PLAN 6.1, point 1)", () => {
  it("accepts production only at /macro-atlas", () => {
    expect(resolveSurface({ ATLAS_SURFACE: "production", BASE_PATH: "/macro-atlas" })).toEqual({
      surface: "production",
      basePath: "/macro-atlas",
    });
  });

  it("accepts staging only at /macro-atlas-staging", () => {
    expect(resolveSurface({ ATLAS_SURFACE: "staging", BASE_PATH: "/macro-atlas-staging" })).toEqual({
      surface: "staging",
      basePath: "/macro-atlas-staging",
    });
  });

  it("accepts local at either base path", () => {
    expect(resolveSurface({ ATLAS_SURFACE: "local", BASE_PATH: "/macro-atlas" }).surface).toBe("local");
    expect(resolveSurface({ ATLAS_SURFACE: "local", BASE_PATH: "/macro-atlas-staging" }).basePath).toBe(
      "/macro-atlas-staging",
    );
  });

  it.each([
    [{ BASE_PATH: "/macro-atlas" }, /ATLAS_SURFACE is not set/],
    [{ ATLAS_SURFACE: "", BASE_PATH: "/macro-atlas" }, /ATLAS_SURFACE is not set/],
    [{ ATLAS_SURFACE: "prod", BASE_PATH: "/macro-atlas" }, /unknown surface "prod"/],
    [{ ATLAS_SURFACE: "local" }, /BASE_PATH is not set/],
    [{ ATLAS_SURFACE: "local", BASE_PATH: "/" }, /BASE_PATH must be/],
    [{ ATLAS_SURFACE: "local", BASE_PATH: "/macro-atlas/" }, /BASE_PATH must be/],
    [{ ATLAS_SURFACE: "production", BASE_PATH: "/macro-atlas-staging" }, /production surface is served at \/macro-atlas/],
    [{ ATLAS_SURFACE: "staging", BASE_PATH: "/macro-atlas" }, /staging surface is served at \/macro-atlas-staging/],
  ])("refuses %j", (env, message) => {
    expect(() => resolveSurface(env)).toThrow(message);
  });
});
