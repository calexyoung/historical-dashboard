import type { ReactNode } from "react";

/**
 * The panel grammar from /missions: no card box. A 2px ink rule opens the panel and its label
 * sits at the left margin in small capitals. No corners, no shadow.
 */
export function Panel({
  id,
  title,
  meta,
  level = 2,
  children,
  bodyClassName,
}: {
  id: string;
  title: string;
  /** A short line under the label: provenance or a count. */
  meta?: ReactNode;
  /**
   * The label's heading level. A page has exactly one level-1 heading. 0 is a label that is
   * not a heading (it still names the section): for the one panel whose page heading is inside
   * it, so that no section heading comes before the page's own.
   */
  level?: 0 | 1 | 2;
  children: ReactNode;
  bodyClassName?: string;
}) {
  const Heading = level === 0 ? "p" : level === 1 ? "h1" : "h2";
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="min-w-0 border-t-2 border-ink bg-panel">
      <header className="border-b border-line px-4 pb-2 pt-2.5">
        <Heading id={`${id}-title`} className="text-[13px] font-bold uppercase leading-tight tracking-[0.06em] text-ink">
          {title}
        </Heading>
        {meta && <div className="mt-0.5 text-xs text-ink-3">{meta}</div>}
      </header>
      <div className={bodyClassName ?? "p-4"}>{children}</div>
    </section>
  );
}
