/**
 * Production builds of the site for the built-server suite and Playwright: three variants of one
 * commit, side by side under .builds/. Each is started the way the container starts it
 * (scripts/start.mjs), on a free loopback port, against a release root the test owns.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

export const SITE = fileURLToPath(new URL("../..", import.meta.url));

export const VARIANTS = {
  "local-atlas": { ATLAS_SURFACE: "local", BASE_PATH: "/macro-atlas" },
  "local-staging": { ATLAS_SURFACE: "local", BASE_PATH: "/macro-atlas-staging" },
  production: { ATLAS_SURFACE: "production", BASE_PATH: "/macro-atlas" },
} as const;
export type VariantName = keyof typeof VARIANTS;

export const distDir = (name: VariantName): string => `.builds/${name}`;

/** The environment for a child process: ours, minus anything that would configure the app. */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["ATLAS_SURFACE", "BASE_PATH", "ATLAS_RELEASE_ROOT", "ATLAS_NOTES_DIR", "ATLAS_DIST_DIR", "NODE_ENV", "PORT", "HOSTNAME"]) delete env[key];
  return { ...env, NEXT_TELEMETRY_DISABLED: "1", ...extra };
}

/** Run `next build` with exactly this configuration. No release root is given to any build. */
export function nextBuild(config: Record<string, string>): { status: number; output: string } {
  const result = spawnSync("npx", ["next", "build"], { cwd: SITE, env: cleanEnv(config), encoding: "utf8" });
  return { status: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

export function buildVariant(name: VariantName): void {
  const result = nextBuild({ ...VARIANTS[name], ATLAS_DIST_DIR: distDir(name) });
  if (result.status !== 0) throw new Error(`building ${name} failed:\n${result.output}`);
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

export type Running = { origin: string; base: string; url: (path: string) => string; stop: () => Promise<void> };

/** Start a built variant. `env` is what a container would be started with. */
export async function startVariant(
  name: VariantName,
  options: { root?: string; env?: Record<string, string> } = {},
): Promise<Running> {
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, ["scripts/start.mjs"], {
    cwd: SITE,
    env: cleanEnv({
      ATLAS_DIST_DIR: distDir(name),
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      ...(options.root ? { ATLAS_RELEASE_ROOT: options.root } : {}),
      ...options.env,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (chunk) => (log += chunk));
  child.stderr?.on("data", (chunk) => (log += chunk));
  const origin = `http://127.0.0.1:${port}`;
  const base = VARIANTS[name].BASE_PATH;
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`${name} exited before it was ready:\n${log}`);
    try {
      await fetch(`${origin}${base}/api/health`, { redirect: "manual" });
      break;
    } catch {
      if (Date.now() > deadline) throw new Error(`${name} did not start:\n${log}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return {
    origin,
    base,
    url: (path) => `${origin}${base}${path}`,
    stop: () =>
      new Promise((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
}
