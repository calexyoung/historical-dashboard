/**
 * The site's one ReleaseReader, and the Release fixed for the request in hand.
 *
 * The proxy reads CURRENT once per request and puts the release id in a request header
 * (src/lib/gate.ts). Everything that renders calls `releaseForRequest()`, which opens exactly
 * that Release; nothing but the proxy reads CURRENT. So one response is one Release.
 */
import { headers } from "next/headers";
import { cache } from "react";
import { siteAddress } from "../address";
import { BASE_PATH, SURFACE } from "../config";
import { HOST_HEADER, PATH_HEADER, REFRESH_FAILED_HEADER, RELEASE_HEADER } from "../gate";
import { createReleaseReader, type Failure, type OpenedRelease, type ReleaseReader } from "./reader";

const KEY = Symbol.for("macro-atlas.release-reader");
type Holder = { [KEY]?: ReleaseReader };

export function getReader(): ReleaseReader {
  const holder = globalThis as Holder;
  if (!holder[KEY]) {
    const root = process.env.ATLAS_RELEASE_ROOT;
    holder[KEY] = root
      ? createReleaseReader({ root, surface: SURFACE })
      : (() => {
          const none: Failure = { ok: false, kind: "unavailable", id: null, reason: "ATLAS_RELEASE_ROOT is not set" };
          return { current: async () => none, open: async () => none };
        })();
  }
  return holder[KEY];
}

export type RequestRelease = {
  release: OpenedRelease;
  refreshFailed: Omit<Failure, "ok"> | null;
  /** The path asked for, without the base path, with its query string. */
  path: string;
  /** The time this request is being answered: one clock for everything on the page. */
  now: number;
  /** The site's own address as the reader wrote it, with the base path and no trailing slash. */
  address: string;
};

/** The Release this request was fixed to. Reading headers also makes the route render per request. */
export const releaseForRequest = cache(async (): Promise<RequestRelease> => {
  const incoming = await headers();
  const id = incoming.get(RELEASE_HEADER);
  // Fail closed: no page renders from a Release the proxy did not vet for this request.
  if (!id) throw new Error("no release was fixed for this request (the proxy did not run)");
  const opened = await getReader().open(id);
  if (!opened.ok) throw new Error(`release ${id} could not be opened: ${opened.kind}`);
  let refreshFailed: RequestRelease["refreshFailed"] = null;
  const failed = incoming.get(REFRESH_FAILED_HEADER);
  if (failed) {
    try {
      refreshFailed = JSON.parse(failed) as RequestRelease["refreshFailed"];
    } catch {
      refreshFailed = { kind: "invalid", id: null, reason: "unreadable" };
    }
  }
  const address = siteAddress(incoming.get(HOST_HEADER) ?? incoming.get("host"), incoming.get("x-forwarded-proto"), BASE_PATH);
  return { release: opened.release, refreshFailed, path: incoming.get(PATH_HEADER) ?? "/", now: Date.now(), address };
});
