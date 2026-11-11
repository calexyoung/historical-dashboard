"use client";

import { useRouter } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
import { explorerQuery, parseExplorerParams } from "@/lib/explorer/state";

/** A marker only this app's Explorer code contains; scripts/measure-js.mjs tells own code from the framework's by it. */
export const EXPLORER_MARK = "atlas-explorer";

/** Any query string as the Explorer writes it: one order, commas, nothing it cannot read. */
export function tidyQuery(params: URLSearchParams): string {
  return explorerQuery(parseExplorerParams(params));
}

/**
 * Go to another view of the Explorer without leaving the page: the server draws the new view and
 * the reader stays where they were scrolled. A change of view (Series, mode, window, layers) is
 * a step in the history, so Back undoes it; moving the pin replaces the current step.
 */
export function useExplorerNav(): (query: string, how?: "push" | "replace") => void {
  const router = useRouter();
  return useCallback(
    (query, how = "push") => {
      const href = query === "" ? "/explore" : `/explore?${query}`;
      if (how === "replace") router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router],
  );
}

/** The fields of a form (and of controls outside it that name it with `form=`), as an address. */
export function formQuery(form: HTMLFormElement): string {
  const params = new URLSearchParams();
  for (const [name, value] of new FormData(form)) if (typeof value === "string") params.append(name, value);
  return tidyQuery(params);
}

const never = () => () => {};
/** False on the server and while the server's markup is being taken over; true from then on. */
export function useHydrated(): boolean {
  return useSyncExternalStore(never, () => true, () => false);
}
