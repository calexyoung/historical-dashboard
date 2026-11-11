"use client";

import { useEffect } from "react";
import { v1HashToQuery } from "@/lib/explorer/state";
import { EXPLORER_MARK } from "./nav";

/**
 * Two things only a browser can do for the Explorer.
 *
 * v1's links kept their state after a `#`, which a server never sees. If this page was opened
 * with one, the same view is opened at its address here (state.ts knows how v1 read its links).
 * `replace`, so Back does not return to the hash and bounce.
 *
 * And one Release per page (ADR 0015): a new view drawn without leaving the page comes from the
 * Release current when it was asked for, while the frame around it (the footer, the freshness
 * mark) is from the Release the page was loaded with. If they differ, load the page afresh.
 */
export function ExplorerSession({ basePath, releaseId }: { basePath: string; releaseId: string }) {
  useEffect(() => {
    const query = v1HashToQuery(window.location.hash);
    if (query !== null) window.location.replace(`${basePath}/explore${query ? `?${query}` : ""}`);
  }, [basePath]);

  useEffect(() => {
    const frame = document.body.dataset.release;
    if (frame && frame !== releaseId) window.location.reload();
  }, [releaseId]);

  return <span hidden data-explorer-session={EXPLORER_MARK} />;
}
