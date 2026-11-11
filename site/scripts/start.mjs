// Start the standalone server the way the container does (deploy/Dockerfile): the server Next
// traced into .next/standalone, plus the static assets it does not copy itself.
import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("..", import.meta.url));
const dist = process.env.ATLAS_DIST_DIR || ".next";
const standalone = `${site}${dist}/standalone/site`;
if (!existsSync(`${standalone}/server.js`)) {
  console.error("No build found. Run `npm run build -w @macro-atlas/site` with ATLAS_SURFACE and BASE_PATH set.");
  process.exit(1);
}
cpSync(`${site}${dist}/static`, `${standalone}/${dist}/static`, { recursive: true });
const child = spawn(process.execPath, ["server.js"], {
  cwd: standalone,
  stdio: "inherit",
  env: { HOSTNAME: "127.0.0.1", PORT: "3000", ...process.env },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
