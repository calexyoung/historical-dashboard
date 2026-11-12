/**
 * Which of a Release's Annotations may be drawn on a Surface (M19; ADR 0033).
 *
 * An Event, a Claim and a Data note are Macro Atlas's own content, or belong to a Series the
 * gate is asked about anyway. A term of government, a recession or a policy period was typed
 * in from somebody's record: it says where from (`provenance`), and the rights gate is asked
 * about that Origin here, on every request, exactly as it is asked about a Series. So a layer
 * whose permission is taken away stops being drawn at once, whatever Release is being served.
 * One that does not say where it came from is not drawn on a public Surface at all. The local
 * Surface asks for no signature (PLAN 6.1).
 */
import { permits, type RightsGate, type Surface } from "@macro-atlas/core";
import type { Annotation } from "@macro-atlas/core/release";
import type { OpenedRelease } from "./release/reader";

const OWN_KINDS: ReadonlySet<string> = new Set(["event", "claim", "data_note"]);

export type ShownAnnotations = {
  annotations: Annotation[];
  /** Why some were left out, each reason once, with how many it left out. */
  withheld: { reason: string; count: number }[];
};

export function annotationsFor(release: Pick<OpenedRelease, "annotations">, surface: Surface, gate?: Pick<RightsGate, "permits">): ShownAnnotations {
  const ask = gate ? gate.permits.bind(gate) : permits;
  const decided = new Map<string, string | null>();
  const withheld = new Map<string, number>();
  const annotations = release.annotations.annotations.filter((a) => {
    let reason: string | null = null;
    if (a.provenance) {
      const p = a.provenance;
      const key = JSON.stringify([p.producer, p.dataset, p.via, p.representation]);
      if (!decided.has(key)) {
        const decision = ask([{ origin: p.producer, dataset: p.dataset, channel: p.via, representation: p.representation, permission: "display" }], surface);
        decided.set(key, decision.allowed ? null : decision.reason);
      }
      reason = decided.get(key)!;
    } else if (!OWN_KINDS.has(a.kind) && surface !== "local") {
      reason = "it does not say where it came from, so it is not permitted on a public surface";
    }
    if (reason === null) return true;
    withheld.set(reason, (withheld.get(reason) ?? 0) + 1);
    return false;
  });
  return { annotations, withheld: [...withheld].map(([reason, count]) => ({ reason, count })) };
}
