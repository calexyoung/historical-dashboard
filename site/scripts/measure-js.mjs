// The JavaScript a page makes a browser load: every script file the HTML references,
// gzip-compressed, counted once each (ADR 0014). The inline scripts are reported apart: they are
// the page's own data in React's wire format, and grow with the page, not with the code.
//
//   node scripts/measure-js.mjs http://127.0.0.1:3000/macro-atlas/explore
//
// "Framework" is everything except the chunks that hold this app's own client code, which are
// recognised by a string only that code contains (the theme cookie's name).
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

/** Recorded by ADR 0014 from the M1 build. Reading pages must stay within `budgetBytes`. */
export const JS_BUDGET = { floorBytes: 131_395, budgetBytes: 131_395 + 15 * 1024 };

const OWN_CODE_MARKER = "atlas-theme";

export async function measureJs(pageUrl) {
  const html = await (await fetch(pageUrl)).text();
  const origin = new URL(pageUrl).origin;
  const external = [...new Set([...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"[^>]*>/g)].filter((m) => !/\snoModule\b/i.test(m[0])).map((m) => m[1]))];
  const inline = [...html.matchAll(/<script\b(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let gzipBytes = 0;
  let frameworkGzipBytes = 0;
  const files = [];
  for (const src of external) {
    const body = Buffer.from(await (await fetch(new URL(src, origin))).arrayBuffer());
    const size = gzipSync(body).length;
    const own = body.includes(OWN_CODE_MARKER);
    files.push({ src, gzipBytes: size, own });
    gzipBytes += size;
    if (!own) frameworkGzipBytes += size;
  }
  const inlineBytes = gzipSync(Buffer.from(inline.join("\n"))).length;
  return { scripts: external.length, files, inlineGzipBytes: inlineBytes, gzipBytes, frameworkGzipBytes };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const measured = await measureJs(process.argv[2]);
  console.log(JSON.stringify({ ...measured, budget: JS_BUDGET }, null, 2));
}
