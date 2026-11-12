import { StateMark } from "@/components/StateMark";
import type { StripCell, StripMark } from "@/lib/figure";

const SPAN_LABEL: Record<number, string> = { 1: "1 year", 5: "5 years", 10: "10 years" };
export const spanLabel = (years: number): string => SPAN_LABEL[years] ?? `${years} years`;

type DoorCell = StripCell & { href: string };

/**
 * One cell of a change strip: the change over a span, as a door to the Explorer at that window
 * (PLAN section 3: every figure is a door). The whole cell is the link. A figure is a signed
 * number in ink: no green, no red, no arrow, because a colour would judge the data (DESIGN.md).
 * Where there is no figure the cell says what stands in its place, as a mark and a word or as
 * plain words, and is a door all the same. Nothing here moves.
 */
export function ChangeCell({ cell, basePath, name }: { cell: DoorCell; basePath: string; /** The Series, for a reader who hears the link out of its row. */ name: string }) {
  const label = `${name}, ${spanLabel(cell.years)}: ${cell.figure ? cell.figure.words : (cell.reason ?? "no figure")}. Open in the Explorer.`;
  return (
    <a href={`${basePath}${cell.href}`} aria-label={label} data-years={cell.years} className="press hover-ink group flex min-h-11 flex-col justify-center py-1 text-ink-2">
      {cell.figure ? (
        <span className="num font-semibold text-accent underline decoration-transparent underline-offset-2 group-hover:decoration-current">{cell.figure.text}</span>
      ) : cell.state ? (
        <StateMark mark={cell.state.mark} word={cell.state.word} basePath={basePath} link={false} />
      ) : (
        <span className="text-accent">No data</span>
      )}
      <span className="num text-xs text-ink-3">
        {cell.figure ? `from ${cell.earlier} in ${cell.periodWords}` : cell.state ? cell.reason : cell.periodWords ? `for ${cell.periodWords}` : cell.reason}
      </span>
    </a>
  );
}

/**
 * The change strip on its own (a Topic page opens with one, M23): the latest value in words,
 * then one labelled cell per span. Highlights lays the same cells out as the columns of a table.
 */
export function ChangeStrip({ name, latest, marks, cells, reason, basePath }: { name: string; latest: string | null; marks: StripMark[]; cells: DoorCell[] | null; reason: string | null; basePath: string }) {
  return (
    <div data-change-strip className="text-sm">
      {latest && (
        <p className="num text-base font-medium text-ink">
          {latest}
          {marks.map((m) => (
            <span key={m.mark} className="ml-2 text-sm">
              <StateMark mark={m.mark} word={m.word} basePath={basePath} />
            </span>
          ))}
        </p>
      )}
      {cells ? (
        <dl className="mt-2 grid max-w-md grid-cols-3 gap-x-4 border-t border-line">
          {cells.map((cell) => (
            <div key={cell.years}>
              <dt className="pt-1.5 text-xs text-ink-3">{spanLabel(cell.years)}</dt>
              <dd>
                <ChangeCell cell={cell} basePath={basePath} name={name} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        reason && <p className="mt-1 max-w-[68ch] text-ink-2">{reason}</p>
      )}
    </div>
  );
}
