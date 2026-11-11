import { Svg } from "@/components/Svg";
import { markIcon, type MarkName } from "@/lib/figure";
import { glossaryHref, stateSlug } from "@/lib/glossary";

/**
 * A Data state, always as a mark and a word together (never colour alone). The mark is drawn in
 * the text's own ink; the word carries the meaning and links to its glossary entry.
 */
export function StateMark({ mark, word, basePath, link = true }: { mark: MarkName; word: string; basePath: string; link?: boolean }) {
  // "Not shown here" borrows the Withheld mark and has its own entry.
  const slug = mark === "withheld" && word !== "Withheld" ? "not-shown-here" : stateSlug(mark);
  return (
    <span data-state={mark} className="inline-flex min-h-6 items-center gap-1 whitespace-nowrap align-middle font-medium text-ink">
      <Svg node={markIcon(mark)} className="shrink-0" />
      {link ? (
        <a href={glossaryHref(basePath, slug)} className="press hover-ink inline-flex min-h-6 items-center text-accent underline underline-offset-2">
          {word}
        </a>
      ) : (
        word
      )}
    </span>
  );
}
