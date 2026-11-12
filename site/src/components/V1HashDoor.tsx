"use client";

import { useEffect } from "react";
import { v1HashToQuery } from "@/lib/explorer/state";

/**
 * v1 was one page, so its links are the site's front door with the view after a `#`, which a
 * server never sees. The front door is now the Overview: a reader who arrives on one of v1's
 * links is taken to the same view in the Explorer (state.ts knows how v1 read its links).
 * `replace`, so Back does not return to the hash and bounce. Nothing else on the Overview
 * needs a script.
 */
export function V1HashDoor({ basePath }: { basePath: string }) {
  useEffect(() => {
    const query = v1HashToQuery(window.location.hash);
    if (query !== null) window.location.replace(`${basePath}/explore${query ? `?${query}` : ""}`);
  }, [basePath]);
  return null;
}
