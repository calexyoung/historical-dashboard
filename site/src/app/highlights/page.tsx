import type { Metadata } from "next";
import { ChangeCell, spanLabel } from "@/components/ChangeStrip";
import { Panel } from "@/components/Panel";
import { StateMark } from "@/components/StateMark";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { highlightsView, type HeadlineRow } from "@/lib/highlights";
import { releaseForRequest } from "@/lib/release/server";

export const metadata: Metadata = { title: "Highlights" };

const link = "press hover-ink text-accent underline underline-offset-2";

function Latest({ row }: { row: Extract<HeadlineRow, { state: "shown" }> }) {
  if (!row.latest) return <span className="text-ink-3">No value</span>;
  return (
    <>
      <span className="num font-medium text-ink">{row.latest.value}</span>
      <span className="num ml-2 text-xs text-ink-3 sm:ml-0 sm:block">{row.latest.when}</span>
      {row.marks.map((m) => (
        <span key={m.mark} className="ml-2 text-xs sm:ml-0 sm:block">
          <StateMark mark={m.mark} word={m.word} basePath={BASE_PATH} />
        </span>
      ))}
    </>
  );
}

/**
 * Highlights (PLAN section 3, M22): the headline Series of the Release being served, by
 * Segment, each with its latest value and its change over one, five and ten years. A reading
 * page: complete in the HTML, no script of its own, nothing that moves. Every cell is a door
 * to the Explorer at the window it compares across; every name is a door to the Series' page.
 * Values come through Query, so a Series that may not be shown is a row with its name and the
 * reason and no cell.
 */
export default async function HighlightsPage() {
  const { release } = await releaseForRequest();
  const view = highlightsView(release, SURFACE);
  const filled = view.segments.filter((s) => s.rows.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <Panel id="highlights" title="Highlights" level={1} meta={<span className="num">{view.total === 1 ? "1 headline series" : `${view.total} headline series`}</span>}>
        <p className="max-w-[68ch] text-ink-2">
          Each headline series with its latest value and how that differs from the same period one, five and ten years earlier. A series
          measured in percent changes by percentage points; any other by a percent of the earlier value. Each cell opens the Explorer at
          the window it compares across.
        </p>
        {view.total === 0 && <p className="mt-3 text-ink-2">This release names no headline series.</p>}
      </Panel>

      {filled.map((segment) => (
        <Panel key={segment.segment} id={segment.segment.replace(/_/g, "-")} title={segment.label} bodyClassName="overflow-x-auto">
          {/*
              A table from 640px. Below that each Series is a block: its name and latest value,
              then its three cells side by side, each under its own label, so a phone never
              scrolls sideways. The roles are written out because a table laid out as blocks
              would otherwise stop being a table to a screen reader.
          */}
          <table role="table" className="block w-full border-collapse text-left text-sm sm:table" data-segment={segment.segment}>
            <thead role="rowgroup" className="hidden sm:table-header-group">
              <tr role="row" className="border-b border-line text-xs text-ink-3">
                <th role="columnheader" scope="col" className="px-4 py-2 font-medium">
                  Series
                </th>
                <th role="columnheader" scope="col" className="px-2 py-2 text-right font-medium">
                  Latest
                </th>
                {view.spans.map((years) => (
                  <th key={years} role="columnheader" scope="col" className="w-[17%] px-2 py-2 font-medium last:pr-4">
                    {spanLabel(years)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody role="rowgroup" className="block sm:table-row-group">
              {segment.rows.map((row) => (
                <tr key={row.key} role="row" data-series-key={row.key} data-state={row.state} className="grid grid-cols-3 border-b border-line align-top last:border-b-0 sm:table-row">
                  <th role="rowheader" scope="row" className="col-span-3 px-4 pb-1 pt-2 font-normal sm:table-cell sm:py-2">
                    <a href={`${BASE_PATH}${row.href}`} className={`${link} inline-flex min-h-6 min-w-6 items-center font-medium`}>
                      {row.name}
                    </a>
                    {row.state === "shown" && (
                      <>
                        <span className="block text-xs text-ink-3">{row.unit}</span>
                        {row.compared && <span className="mt-1 block text-xs text-ink-2">{row.compared}</span>}
                      </>
                    )}
                  </th>
                  {row.state === "shown" ? (
                    <>
                      <td role="cell" className="col-span-3 px-4 py-1 sm:table-cell sm:whitespace-nowrap sm:px-2 sm:py-2 sm:text-right">
                        <span className="mr-2 text-xs text-ink-3 sm:hidden">Latest</span>
                        <Latest row={row} />
                      </td>
                      {row.cells ? (
                        row.cells.map((cell) => (
                          <td key={cell.years} role="cell" className="min-w-0 px-2 pb-2 pt-1 first-of-type:pl-4 last:pr-4 sm:table-cell sm:py-1 sm:first-of-type:pl-2 [&_[data-state]]:whitespace-normal">
                            <span className="block text-xs text-ink-3 sm:hidden">{spanLabel(cell.years)}</span>
                            <ChangeCell cell={cell} basePath={BASE_PATH} name={row.name} />
                          </td>
                        ))
                      ) : (
                        <td role="cell" colSpan={view.spans.length} className="col-span-3 px-4 pb-2 pt-1 text-ink-2 sm:table-cell sm:px-2 sm:py-2 sm:pr-4">
                          {row.reason}{" "}
                          <a href={`${BASE_PATH}${row.explorer}`} className={`${link} inline-flex min-h-6 items-center whitespace-nowrap`}>
                            Open in the Explorer
                          </a>
                        </td>
                      )}
                    </>
                  ) : (
                    <td role="cell" colSpan={view.spans.length + 1} className="col-span-3 px-4 pb-2 pt-1 text-ink-2 sm:table-cell sm:px-2 sm:py-2 sm:pr-4">
                      {row.state === "no_answer" ? (
                        row.reason
                      ) : (
                        <>
                          <StateMark mark="withheld" word={row.state === "withheld" ? "Withheld" : "Not shown here"} basePath={BASE_PATH} /> {row.reason}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}
    </div>
  );
}
