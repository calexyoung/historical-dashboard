import { StateMark } from "@/components/StateMark";
import { Svg } from "@/components/Svg";
import { swatch, type Figure as FigureData, type FigureTable, type LayoutName } from "@/lib/figure";

/**
 * Which drawing shows is decided by the width the figure actually has (a container query), with
 * no script: below 448px the narrow one, from 768px the wide one. Each drawing is only ever
 * scaled up from the width it was laid out for, so its 12px text is never smaller than 12px.
 * Where container queries are not supported, the narrow drawing shows.
 */
const SHOWN: Record<LayoutName, string> = {
  narrow: "block @min-[448px]:hidden",
  medium: "hidden @min-[448px]:block @min-[768px]:hidden",
  wide: "hidden @min-[768px]:block",
};
const LAYOUT_ORDER: LayoutName[] = ["narrow", "medium", "wide"];

const link = "press hover-ink text-accent underline underline-offset-2";
// A native disclosure: the browser draws the triangle and handles the keyboard; nothing animates.
const summary = "hover-ink w-fit cursor-pointer py-1.5 text-sm font-medium text-accent";

/**
 * The table twin. A long Series is hundreds of rows, sent twice (HTML and React's payload), so
 * the rows carry no classes: `.figure-table` in globals.css styles them (ADR 0017).
 */
function Table({ table, basePath }: { table: FigureTable; basePath: string }) {
  return (
    <table data-figure-table={table.key} className="figure-table">
      <caption>
        {table.name}, {table.unit}.{table.rounded && ` Values are shown to ${table.decimals} decimal places.`}
      </caption>
      <thead>
        <tr>
          <th scope="col">Period</th>
          <th scope="col">Value</th>
          <th scope="col">State</th>
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => (
          <tr key={row.period}>
            <th scope="row">{row.label}</th>
            <td>{row.value === null ? <i>No value</i> : table.rounded ? <data value={row.exact ?? undefined}>{row.value}</data> : row.value}</td>
            <td>
              {row.states.map((state) => (
                <span key={state.mark}>
                  <StateMark mark={state.mark} word={state.word} basePath={basePath} link={false} />
                  {state.note && `: ${state.note}`}
                </span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The explained figure (PLAN section 3): takeaway or the reason there is none, the drawing, the
 * unit in words, the Data states present, the source line, how to read it, the same values as a
 * table, and a door into the Explorer. Complete in the HTML: the two disclosures are <details>,
 * and nothing here animates.
 */
export function Figure({ figure, basePath, explorerHref }: { figure: FigureData; basePath: string; explorerHref?: string }) {
  const several = figure.tables.length > 1;
  return (
    <figure data-figure className="m-0 flex min-w-0 flex-col gap-3">
      {figure.takeaway ? (
        <p data-takeaway className="max-w-[68ch] text-base font-medium leading-snug text-ink">
          {figure.takeaway}
        </p>
      ) : (
        figure.silence &&
        figure.tables.length > 0 && (
          <p data-silence={figure.silence.rule} className="max-w-[68ch] text-ink-2">
            {figure.silence.text}
          </p>
        )
      )}

      {figure.plots.map((plot) => (
        <div key={plot.unit} data-plot className="@container min-w-0 max-w-[1024px]">
          {LAYOUT_ORDER.map((layout) => (
            <Svg key={layout} node={plot.layouts[layout]} className={`${SHOWN[layout]} h-auto w-full text-ink`} />
          ))}
          {plot.series.length > 1 && (
            <ul data-legend className={`mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2 ${plot.endLabels ? "@min-[768px]:hidden" : ""}`}>
              {plot.series.map((s) => (
                <li key={s.key} className="inline-flex items-center gap-1.5">
                  <Svg node={swatch(s)} className="shrink-0" />
                  {s.name}
                </li>
              ))}
            </ul>
          )}
          <p data-unit-line className="mt-1 text-xs text-ink-2">
            {plot.unitLine}
          </p>
        </div>
      ))}

      {figure.states.length > 0 && (
        <ul data-states className="flex flex-col gap-0.5 text-sm text-ink-2">
          {figure.states.map((note, i) => (
            <li key={i}>
              <StateMark mark={note.mark} word={note.word} basePath={basePath} />
              {several && <span className="text-ink"> · {note.series}</span>}
              <span>: {note.text}</span>
            </li>
          ))}
        </ul>
      )}

      {figure.tables.length > 0 && (
        <>
          <figcaption data-source-line className="text-xs text-ink-3">
            {figure.sourceLine}
          </figcaption>
          <div className="flex flex-col gap-1 border-t border-line pt-2">
            <details data-how-to-read>
              <summary className={summary}>How to read this</summary>
              <ul className="mb-2 mt-1 flex max-w-[68ch] list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
                {figure.howToRead.map((line, i) => (
                  <li key={i}>
                    {line.mark ? (
                      <>
                        <StateMark mark={line.mark} word={line.text.slice(0, line.text.indexOf("."))} basePath={basePath} link={false} />
                        {line.text.slice(line.text.indexOf("."))}
                      </>
                    ) : (
                      line.text
                    )}
                  </li>
                ))}
              </ul>
            </details>
            <details data-table>
              <summary className={summary}>Show the table</summary>
              {/* Wide values can outgrow a phone: the table scrolls inside this region, never the page.
                  A scrolling region must be reachable from the keyboard, hence the tab stop. */}
              <div role="group" aria-label="Table of values" tabIndex={0} className="mb-2 mt-1 flex flex-col gap-6 overflow-x-auto">
                {figure.tables.map((table) => (
                  <Table key={table.key} table={table} basePath={basePath} />
                ))}
              </div>
            </details>
            {explorerHref && (
              <p>
                <a href={explorerHref} className={`${link} inline-flex min-h-8 items-center text-sm font-medium`}>
                  Open in Explorer →
                </a>
              </p>
            )}
          </div>
        </>
      )}
    </figure>
  );
}
