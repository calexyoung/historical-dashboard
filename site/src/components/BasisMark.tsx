import type { VintageBasis } from "@macro-atlas/core";
import { glossaryHref } from "@/lib/glossary";
import { BASIS_INFO } from "@/lib/series-words";

/**
 * The Basis of an as-of answer, always as a mark and a word together (never colour alone). The
 * marks are in the text's own ink and each has its own outline, so the five are told apart by
 * shape: two rings (the Origin's record), a ring with a centre (seen by Macro Atlas), a square
 * (v1's one state), a broken ring (a day went unseen), an empty broken square (no answer).
 */
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5 } as const;
const SHAPES: Record<VintageBasis, React.ReactNode> = {
  provider: (
    <>
      <circle cx="8" cy="8" r="5.5" {...stroke} />
      <circle cx="8" cy="8" r="2.5" {...stroke} />
    </>
  ),
  atlas_observed: (
    <>
      <circle cx="8" cy="8" r="5.5" {...stroke} />
      <circle cx="8" cy="8" r="1.75" fill="currentColor" />
    </>
  ),
  legacy: <rect x="3" y="3" width="10" height="10" {...stroke} />,
  uncertain: <circle cx="8" cy="8" r="5.5" {...stroke} strokeDasharray="3 2.5" />,
  unavailable: <rect x="3" y="3" width="10" height="10" {...stroke} strokeDasharray="2.5 2.5" />,
};

/** The mark alone, beside a word that is already there. */
export function BasisIcon({ basis }: { basis: VintageBasis }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" data-basis-mark={basis} className="shrink-0">
      {SHAPES[basis]}
    </svg>
  );
}

export function BasisMark({ basis, basePath, link = true }: { basis: VintageBasis; basePath: string; link?: boolean }) {
  const { word, slug } = BASIS_INFO[basis];
  return (
    <span data-basis={basis} className="inline-flex min-h-6 min-w-6 items-center gap-1 whitespace-nowrap align-middle font-medium text-ink">
      <BasisIcon basis={basis} />
      {link ? (
        <a href={glossaryHref(basePath, slug)} className="press hover-ink inline-flex min-h-6 min-w-6 items-center text-accent underline underline-offset-2">
          {word}
        </a>
      ) : (
        word
      )}
    </span>
  );
}
