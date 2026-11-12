#!/usr/bin/env node
// atlas-core: the analytical engine from the command line (PLAN 4.2, "Delivery adapters").
//
//   node packages/core/bin/atlas-core.mjs verify --release STAGED [--spot checks/spot.json]
//
// `verify` is the Node step of the publisher (ADR 0002): it computes the Derived series a
// staged Release asks for and writes them, and its report, inside that directory only.
//
// It runs the engine's TypeScript as it is: Node (22.18 or later) strips the types, and the one
// hook below lets the engine's own imports, which name no file extension, be found. Nothing is
// installed and nothing is built, so the step needs no node_modules.
import { registerHooks } from "node:module";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`atlas-core needs Node 22.18 or later; this is ${process.versions.node}`);
  process.exit(2);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      if (error?.code === "ERR_MODULE_NOT_FOUND" && relative && !/\.[cm]?[jt]s$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { main } = await import("../src/cli/verify.ts");
process.exitCode = main(process.argv.slice(2));
