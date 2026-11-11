/**
 * The engine runs in the browser (ADR 0003): a browser bundle of `@macro-atlas/core` reads no
 * file and opens no socket, because nothing in it imports a Node built-in. The `./release` entry
 * is the control: it hashes with `node:crypto`, and the same check must catch that.
 */
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { describe, expect, it } from "vitest";

const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

/** Every module a browser bundle of `entry` leaves to be found at run time. */
async function leftOutside(entry: string): Promise<{ external: string[]; code: string }> {
  const external: string[] = [];
  const bundle = await rolldown({
    input: fileURLToPath(new URL(entry, import.meta.url)),
    platform: "browser",
    logLevel: "silent",
    external: (id) => {
      if (BUILTINS.has(id)) external.push(id);
      return BUILTINS.has(id);
    },
  });
  const { output } = await bundle.generate({ format: "esm" });
  await bundle.close();
  return { external: [...new Set(external)].sort(), code: output.map((chunk) => ("code" in chunk ? chunk.code : "")).join("\n") };
}

describe("a browser bundle of core", () => {
  it("imports no fs and no other Node built-in", async () => {
    const { external, code } = await leftOutside("./index.ts");
    expect(external).toEqual([]);
    expect(code).not.toMatch(/from\s*["'](node:)?fs["']|require\(["'](node:)?fs["']\)/);
    expect(code).toContain("America/New_York"); // resolve() is in the bundle
  }, 30_000);

  it("the check bites: the Node-only release entry does import a built-in", async () => {
    expect((await leftOutside("./release/index.ts")).external).toContain("node:crypto");
  }, 30_000);
});
