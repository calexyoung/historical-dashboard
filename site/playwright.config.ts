import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks on a production build serving the synthetic fixture release (PLAN section 8 and
 * 9): both base paths, a phone and a desktop width. The servers are started by the fixtures in
 * e2e/site.ts, on free loopback ports; nothing here touches the network.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { trace: "off", screenshot: "off", video: "off" }, // no artefacts (PLAN 6.1)
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 740 } } },
  ],
});
