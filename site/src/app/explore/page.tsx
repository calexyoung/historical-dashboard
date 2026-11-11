import type { Metadata } from "next";
import Link from "next/link";
import { CopyLink } from "@/components/explorer/CopyLink";
import { ExplorerChart } from "@/components/explorer/ExplorerChart";
import { ExplorerControls, ExplorerLayers } from "@/components/explorer/ExplorerControls";
import { ExplorerSession } from "@/components/explorer/ExplorerSession";
import { SeriesPicker } from "@/components/explorer/SeriesPicker";
import { Figure } from "@/components/Figure";
import { Panel } from "@/components/Panel";
import { Svg } from "@/components/Svg";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { parseExplorerParams } from "@/lib/explorer/state";
import { explorerView, MODE_LABELS, type Selected } from "@/lib/explorer/view";
import { swatch } from "@/lib/figure";
import { MAX_SERIES } from "@/lib/query";
import { releaseForRequest } from "@/lib/release/server";

export const metadata: Metadata = { title: "Explore" };

const link = "press hover-ink text-accent underline underline-offset-2";
const chip = "press hover-control inline-flex h-8 items-center rounded border border-control bg-raised px-2.5 text-sm text-ink";
const button = "press inline-flex h-9 items-center justify-center rounded border border-control bg-raised px-3 text-sm font-medium text-ink";

const NOT_DRAWN: Record<Exclude<Selected["state"], "drawn">, string> = { not_drawn: "Not drawn", withheld: "Withheld", not_permitted: "Not shown here" };

/**
 * The Explorer (PLAN section 3; M4): the Series a reader picked, a window and a mode, drawn
 * together with Annotation layers and a readout.
 *
 * The address is the state and the server draws every view (ADR 0018). Every control is a GET
 * form or a link, so the page works with JavaScript off and a copied address reproduces the
 * view. Four small client components make it quick: a change applies at once and the reader
 * stays where they were, a pointer or the arrow keys move the readout and pin it, the picker
 * opens as a sheet, and v1's hash links are sent to their address here.
 *
 * Links between views are next/link with prefetching off: there are a hundred on the page, and
 * each one is a whole drawing for the server.
 */
export default async function ExplorePage({ searchParams }: PageProps<"/explore">) {
  const { release } = await releaseForRequest();
  const state = parseExplorerParams(await searchParams);
  const view = explorerView(release, SURFACE, state);
  const here = `${BASE_PATH}/explore`;
  const to = (query: string) => (query === "" ? "/explore" : `/explore?${query}`);

  const { resolved } = view;
  const carried: [string, string][] = resolved.carried.map(([name, value]) => [name, value]);
  const pinAndEvent: [string, string][] = [...(resolved.at ? [["at", resolved.at] as [string, string]] : []), ...(resolved.event ? [["event", resolved.event] as [string, string]] : [])];
  const table: [string, string][] = state.table ? [["table", "1"]] : [];
  const controlsHidden: [string, string][] = [["s", resolved.series!.join(",")], ...pinAndEvent, ...carried, ...table];
  const pickerHidden: [string, string][] = [
    ["mode", view.mode],
    ...(view.window.from ? [["from", view.window.from] as [string, string]] : []),
    ...(view.window.to ? [["to", view.window.to] as [string, string]] : []),
    ["layers", resolved.layers!.length > 0 ? resolved.layers!.join(",") : "none"],
    ...pinAndEvent,
    ...carried,
    ...table,
  ];
  const kept = view.selection.filter((s) => s.state !== "drawn");
  const drawn = view.selection.filter((s) => s.state === "drawn").length;

  return (
    <div className="flex flex-col gap-6">
      <ExplorerSession basePath={BASE_PATH} releaseId={release.id} />

      <Panel id="explore" title="Explore" level={1}>
        <p className="max-w-[68ch] text-ink-2">Pick series, a window and a way to show them. The address of this page describes the view.</p>
        {view.presets.length > 0 && (
          <nav aria-label="Presets" className="mt-3">
            <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
              {view.presets.map((preset) => (
                <li key={preset.name} className="shrink-0">
                  <Link href={to(preset.query)} prefetch={false} scroll={false} data-preset className={chip}>
                    {preset.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </Panel>

      <Panel id="view" title="View" bodyClassName="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SeriesPicker
            action={here}
            groups={view.picker}
            selected={resolved.series!}
            max={MAX_SERIES}
            hidden={pickerHidden}
            initialOpen={state.pick}
            openHref={`${BASE_PATH}${to(view.queryWith({ pick: true }))}`}
            closeHref={`${BASE_PATH}${to(view.query)}`}
          />
          {view.selection.length > 0 && <CopyLink href={`${BASE_PATH}${to(view.resolvedQuery)}`} className={button} />}
        </div>

        {view.selection.length > 0 && (
          <ul data-selection aria-label="Selected series" className="flex flex-wrap gap-2">
            {view.selection.map((s) => (
              <li key={s.key} data-selected={s.key} data-state={s.state} className={`inline-flex h-8 max-w-full items-center rounded border bg-raised text-sm ${s.state === "drawn" ? "border-control" : "border-dashed border-control"}`}>
                <a href={`${BASE_PATH}/data/${s.key}`} className="hover-ink inline-flex h-full min-w-0 items-center gap-1.5 pl-2 pr-1 text-ink">
                  {s.style && <Svg node={swatch(s.style)} className="shrink-0" />}
                  <span className="truncate">{s.name}</span>
                </a>
                <Link href={to(s.removeQuery)} prefetch={false} scroll={false} aria-label={`Remove ${s.name}`} className="press hover-ink inline-flex h-full w-8 shrink-0 items-center justify-center border-l border-line text-ink-2">
                  <span aria-hidden="true">×</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <ExplorerControls action={here} modes={view.modes} selected={view.selection.length} from={view.window.from} to={view.window.to} hidden={controlsHidden} />

        {(view.notes.length > 0 || view.carriedNote) && (
          <ul data-notes className="flex max-w-[80ch] flex-col gap-1 text-sm text-ink-2">
            {view.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
            {view.carriedNote && <li>{view.carriedNote}</li>}
          </ul>
        )}
      </Panel>

      <Panel
        id="chart"
        title="Chart"
        meta={
          view.figure && (
            <>
              <span className="num">{view.window.words}</span> · {MODE_LABELS[view.mode]} · <span className="num">{drawn}</span> series
            </>
          )
        }
        bodyClassName="flex flex-col gap-4 p-4"
      >
        {view.figure ? (
          <Figure
            figure={view.figure}
            basePath={BASE_PATH}
            namePlots={view.figure.plots.length > 1}
            tableOnDemand={{
              shown: state.table,
              toggle: (
                <Link href={to(view.queryWith({ table: !state.table }))} prefetch={false} scroll={false} data-table-toggle className={`${link} inline-flex min-h-8 items-center`}>
                  {state.table ? "Take the table off the page" : "Show the table"}
                </Link>
              ),
            }}
            wrapPlots={(plots) => (
              <ExplorerChart model={view.readout} pinned={view.pinned} shownAt={view.shownAt} unpinHref={`${BASE_PATH}${to(view.queryWith({ at: null }))}`}>
                {plots}
              </ExplorerChart>
            )}
          />
        ) : (
          <p data-empty className="max-w-[68ch] text-ink-2">
            {view.selection.length === 0 ? "No series is selected. Choose series above to begin." : "None of the selected series can be drawn in this view. The reasons are below."}
          </p>
        )}
        {kept.length > 0 && (
          <ul data-not-drawn className="flex max-w-[80ch] flex-col gap-1 border-t border-line pt-3 text-sm text-ink-2">
            {kept.map((s) => (
              <li key={s.key}>
                <span className="font-medium text-ink">
                  {NOT_DRAWN[s.state as keyof typeof NOT_DRAWN]} · {s.name}
                </span>
                : {s.reason}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {(view.layers.toggles.length > 0 || view.layers.bands.length > 1) && (
        <Panel id="layers" title="Layers" meta="Context drawn behind the series. An event or a term of government is never said to have caused a movement." bodyClassName="flex flex-col gap-4 p-4">
          <ExplorerLayers toggles={view.layers.toggles} bands={view.layers.bands} />
          {(view.recessions.length > 0 || view.bands.length > 0) && (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {view.recessions.length > 0 && (
                <div data-recessions>
                  <dt className="flex items-center gap-2 text-xs font-semibold text-ink-2">
                    <span aria-hidden="true" className="inline-block h-3 w-5 bg-ink/10" />
                    Recessions in the window
                  </dt>
                  {view.recessions.map((r) => (
                    <dd key={r.when} className="num text-ink-2">
                      {r.when}
                    </dd>
                  ))}
                </div>
              )}
              {view.bands.length > 0 && (
                <div data-bands>
                  <dt className="flex items-center gap-2 text-xs font-semibold text-ink-2">
                    <span aria-hidden="true" className="inline-block h-3 w-5 border-l border-line-strong bg-band/60" />
                    {view.layers.bands.find((b) => b.on)?.label} in the window
                  </dt>
                  {view.bands.map((b) => (
                    <dd key={`${b.label} ${b.when}`} className="text-ink-2">
                      <span className="text-ink">{b.label}</span> · <span className="num">{b.when}</span>
                    </dd>
                  ))}
                </div>
              )}
            </dl>
          )}
        </Panel>
      )}

      {view.layers.toggles.some((t) => t.token.startsWith("ev")) && (
        <Panel id="events" title="Events in the window" meta={<span className="num">{view.events.length === 1 ? "1 event" : `${view.events.length} events`}</span>} bodyClassName="p-0">
          {view.events.length === 0 ? (
            <p className="p-4 text-ink-2">No events in this window for the categories switched on.</p>
          ) : (
            <div role="group" aria-label="Events in the window" tabIndex={0} className="max-h-[28rem] overflow-y-auto">
              <ul data-events>
                {view.events.map((e) => (
                  <li key={e.id} data-event-row={e.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 border-b border-line px-4 py-1.5 text-sm last:border-b-0 sm:grid-cols-[6.5rem_9rem_minmax(0,1fr)]">
                    <span className="num text-ink-2">{e.when}</span>
                    <span className="col-start-2 row-start-2 text-xs text-ink-3 sm:col-start-auto sm:row-start-auto sm:text-sm sm:text-ink-2">{e.category}</span>
                    <span className="min-w-0">
                      <Link href={to(e.query)} prefetch={false} scroll={false} aria-current={e.chosen ? "true" : undefined} className={`${link} inline-flex min-h-6 items-center ${e.chosen ? "font-semibold" : ""}`}>
                        {e.label}
                      </Link>
                      {e.chosen && <span className="text-ink-2"> · marked on the chart</span>}
                      {e.url && (
                        <>
                          {" "}
                          <a href={e.url} rel="noopener noreferrer" className="press hover-ink inline-flex min-h-6 items-center whitespace-nowrap text-xs text-ink-3 underline underline-offset-2">
                            source<span className="sr-only"> for {e.label}</span> ↗
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
