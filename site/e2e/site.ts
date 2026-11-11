import { test as base } from "@playwright/test";
import { FIXTURE_ROOT } from "../src/lib/release/testing";
import { startVariant, type Running } from "../tests/built/builds";

/** One running build per base path for the whole worker, serving the fixture release. */
export const test = base.extend<object, { atlas: Running; staging: Running }>({
  atlas: [
    async ({}, use) => {
      const server = await startVariant("local-atlas", { root: FIXTURE_ROOT });
      await use(server);
      await server.stop();
    },
    { scope: "worker" },
  ],
  staging: [
    async ({}, use) => {
      const server = await startVariant("local-staging", { root: FIXTURE_ROOT });
      await use(server);
      await server.stop();
    },
    { scope: "worker" },
  ],
});
export { expect } from "@playwright/test";
