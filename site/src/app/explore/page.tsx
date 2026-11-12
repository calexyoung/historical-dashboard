import type { Metadata } from "next";
import Link from "next/link";
import { BasisMark } from "@/components/BasisMark";
import { CopyLink } from "@/components/explorer/CopyLink";
import { ExplorerChart } from "@/components/explorer/ExplorerChart";
import { ExplorerControls, ExplorerLayers } from "@/components/explorer/ExplorerControls";
import { ExplorerSession } from "@/components/explorer/ExplorerSession";
import { ExportAction } from "@/components/explorer/ExportActions";
import { RelationshipControls } from "@/components/explorer/RelationshipControls";
import { SeriesPicker } from "@/components/explorer/SeriesPicker";
import { Figure } from "@/components/Figure";
import { Panel } from "@/components/Panel";
import { Svg } from "@/components/Svg";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { MAX_LAG, parseExplorerParams } from "@/lib/explorer/state";
import { exportAllowed } from "@/lib/export";
import { explorerView, MODE_LABELS, type Selected } from "@/lib/explorer/view";
import { swatch } from "@/lib/figure";
import { MAX_SERIES } from "@/lib/query";
import { BASIS_INFO } from "@/lib/series-words";
import { SEMANTICS_VERSION } from "@macro-atlas/core";
import { dayWords } from "@/lib/figure/words";
import { savedAddress, savedQueries } from "@/lib/explorer/saved";
import { getReader, releaseForRequest } from "@/lib/release/server";

export const metadata: Metadata = { title: "Explore" };

const link = "press hover-ink text-accent underline underline-offset-2";
const chip = "press hover-control inline-flex h-8 items-center rounded border border-control bg-raised px-2.5 text-sm text-ink";
const summary = "hover-ink w-fit cursor-pointer py-1.5 text-sm font-medium text-accent";
const button = "press inline-flex h-9 items-center justify-center rounded border border-control bg-raised px-3 text-sm font-medium text-ink";

const NOT_DRAWN: Record<Exclude<Selected["state"], "drawn">, string> = { not_drawn: "Not drawn", withheld: "Withheld", not_permitted: "Not shown here" };

/**
 * The Explorer (PLAN section 3; M4 and M5): the Series a reader picked, a window and a mode, drawn
 * together with Annotation layers and a readout; then a snapshot table, how the Series moved
 * together, and the view as a file.
 *
 * The address is the state and the server draws every view (ADR 0018). Every control is a GET
 * form or a link, so the page works with JavaScript off and a copied address reproduces the
 * view. A few small client components make it quick: a change applies at once and the reader
 * stays where they were, a pointer or the arrow keys move the readout and pin it, the picker
 * opens as a sheet, and v1's hash links are sent to their address here.
 *
 * Links between views are next/link with prefetching off: there are a hundred on the page, and
 * each one is a whole drawing for the server.
 */
export default async function ExplorePage({ searchParams }: PageProps<"/explore">) {
  const { release, pinnedFrom, address } = await releaseForRequest();
  const state = parseExplorerParams(await searchParams);
  const view = explorerView(release, SURFACE, state);
  const here = `${BASE_PATH}/explore`;
  const to = (query: string) => (query === "" ? "/explore" : `/explore?${query}`);

  const { resolved } = view;
  // What the address says of Explorer II's features, for a form that has no field for it.
  const pairs = (names: string[]): [string, string][] => [...new URLSearchParams(view.resolvedQuery)].filter(([name]) => names.includes(name));
  const relations = pairs(["basis", "lag", "sx", "sy", "roll"]);
  const carried = pairs(["cmp", "basis", "lag", "sx", "sy", "roll", "ext"]);
  const pinAndEvent: [string, string][] = [...(resolved.at ? [["at", resolved.at] as [string, string]] : []), ...(resolved.event ? [["event", resolved.event] as [string, string]] : [])];
  const table: [string, string][] = state.table ? [["table", "1"]] : [];
  // What every form must carry and has no field for: the Release a view is pinned to, and (outside the view form) the as-of date and the common frequency.
  const held: [string, string][] = resolved.pin ? [["pin", resolved.pin]] : [];
  const asked: [string, string][] = [...(resolved.freq ? [["freq", resolved.freq] as [string, string]] : []), ...(resolved.asOf ? [["as_of", resolved.asOf] as [string, string]] : [])];
  const controlsHidden: [string, string][] = [["s", resolved.series!.join(",")], ...pinAndEvent, ...relations, ...table, ...held];
  const layersValue: [string, string] = ["layers", resolved.layers!.length > 0 ? resolved.layers!.join(",") : "none"];
  const windowFields: [string, string][] = [...(view.window.from ? [["from", view.window.from] as [string, string]] : []), ...(view.window.to ? [["to", view.window.to] as [string, string]] : [])];
  const relationshipHidden: [string, string][] = [["s", resolved.series!.join(",")], ["mode", view.mode], ...windowFields, ...asked, layersValue, ...pinAndEvent, ...pairs(["cmp", "ext"]), ...table, ...held];
  const exporting = exportAllowed(release, SURFACE, resolved.series!, { history: resolved.asOf !== null });
  const file = (format: string) => `${here}/export?format=${format}${view.resolvedQuery ? `&${view.resolvedQuery.replace(/&(table|pick)=1/g, "")}` : ""}`;
  const rel = view.relationships;
  const uncompared = view.selection.filter((s) => s.state === "drawn" && s.compared && !s.compared.drawn);
  const pickerHidden: [string, string][] = [
    ["mode", view.mode],
    ...windowFields,
    ...asked,
    layersValue,
    ...pinAndEvent,
    ...carried,
    ...table,
    ...held,
  ];
  // Saved queries carry a person's own note: they are shown on the local Surface only (ADR 0032).
  const saved = SURFACE === "local" ? savedQueries((await getReader().savedText?.()) ?? "") : [];
  const saveable = SURFACE === "local" && release.manifest.profile === "local" ? savedAddress(view.resolvedQuery.replace(/&(table|pick)=1/g, "")) : null;
  const drawnSeries = view.selection.filter((s) => s.state === "drawn");
  const kept = view.selection.filter((s) => s.state !== "drawn");
  const drawn = view.selection.filter((s) => s.state === "drawn").length;

  return (
    <div className="flex flex-col gap-6">
      <ExplorerSession basePath={BASE_PATH} releaseId={release.id} />

      {resolved.pin && (
        // A note, there on every load of a pinned link: it never moves or animates.
        <p role="note" data-pinned={release.id} className="max-w-[80ch] border-l-2 border-line-strong pl-3 text-sm text-ink-2">
          <span className="font-medium text-ink">
            Pinned to release <span className="num">{release.id}</span>
          </span>
          , made <span className="num">{dayWords(release.manifest.created.slice(0, 10))}</span>. The figures are that release&rsquo;s; they are drawn by today&rsquo;s engine (semantics <span className="num">{SEMANTICS_VERSION}</span>).{" "}
          {pinnedFrom !== null && pinnedFrom !== release.id ? "A newer release is current. " : "It is the current release. "}
          <a href={`${BASE_PATH}${to(view.queryWith({ pin: null }))}`} data-unpin className={`${link} inline-flex min-h-6 items-center`}>
            Open this view on the current release
          </a>
        </p>
      )}

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

      {saved.length > 0 && (
        <Panel id="saved" title="Saved views" meta="Each is pinned to the release it was saved on, and kept with it." bodyClassName="p-0">
          <ul data-saved className="max-h-72 overflow-y-auto">
            {saved.map((q) => (
              <li key={q.id} data-saved-query={q.id} className="grid gap-x-3 border-b border-line px-4 py-1.5 text-sm last:border-b-0 sm:grid-cols-[7rem_minmax(0,1fr)]">
                <span className="num text-ink-2">{dayWords(q.savedAt.slice(0, 10), "short")}</span>
                <span className="min-w-0">
                  <a href={`${BASE_PATH}/explore?${q.query}`} className={`${link} inline-flex min-h-6 items-center`}>
                    {q.note}
                  </a>
                  <span className="num block truncate text-xs text-ink-3">release {q.releaseId}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

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
          {view.figure && exporting.allowed && (
            <ul data-exports aria-label="Export" className="flex flex-wrap items-center gap-2">
              <li>
                <a href={file("csv")} data-export="csv" className={button}>
                  Download CSV
                </a>
              </li>
              <li>
                <ExportAction href={file("csv")} kind="copy" label="Copy CSV" done="Copied" className={button} />
              </li>
              <li>
                <ExportAction href={file("svg")} kind="png" label="Save chart as PNG" done="Saved" className={button} />
              </li>
            </ul>
          )}
        </div>
        {view.figure && exporting.allowed && SURFACE === "local" && (
          <p data-export-note className="-mt-2 text-xs text-ink-3">
            Files made here are stamped “not for publication”.{" "}
            <a href={file("all")} data-export="all" className={`${link} inline-flex min-h-6 items-center`}>
              Every series in this release as one CSV
            </a>
          </p>
        )}
        {saveable !== null && view.figure && (
          <details data-save className="-mt-2 text-xs text-ink-3">
            <summary className={summary.replace("text-sm", "text-xs")}>Save this view</summary>
            <p className="mt-1 max-w-[80ch]">
              A saved view is this address pinned to {resolved.pin ? "its release" : "the current release"}, with a note; the release is kept for as long as the view is. Run this where the release root is, with your own note:
            </p>
            <pre tabIndex={0} className="num mt-1 max-w-full overflow-x-auto rounded border border-line bg-raised p-2 text-ink">{`python -m atlas save '${address}/explore?${saveable}' --profile local --note "what this view is for"`}</pre>
          </details>
        )}
        {view.figure && exporting.allowed && exporting.leftOut.length > 0 && (
          <p data-export-left-out className="-mt-2 max-w-[80ch] text-xs text-ink-3">
            A file made here leaves out {exporting.leftOut.map((s) => `${s.name} (${s.reason})`).join("; ")}.
          </p>
        )}
        {view.selection.length > 0 && !exporting.allowed && (
          <p data-export-note className="-mt-2 text-xs text-ink-3">
            Export is not available here: {exporting.reason}.
          </p>
        )}

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
        {view.selection.length > 1 && (
          <p className="-mt-2 text-sm">
            <Link href={to(view.queryWith({ series: [], sx: null, sy: null }))} prefetch={false} scroll={false} data-clear-all className={`${link} inline-flex min-h-6 items-center`}>
              Clear all
            </Link>
          </p>
        )}

        <ExplorerControls action={here} modes={view.modes} selected={view.selection.length} from={view.window.from} to={view.window.to} compare={state.cmp} extremes={view.extremes} asOf={resolved.asOf} freq={resolved.freq} hidden={controlsHidden} />

        {view.asOf && (
          <div data-as-of={view.asOf.basis} className="max-w-[80ch] border-l-2 border-line-strong pl-3 text-sm text-ink-2">
            <p>
              <span className="font-medium text-ink">
                As known before <span className="num">{view.asOf.words}</span>
              </span>
              {drawnSeries.length > 0 && (
                <>
                  {" "}
                  · <BasisMark basis={view.asOf.basis} basePath={BASE_PATH} />
                </>
              )}{" "}
              ·{" "}
              <Link href={to(view.asOf.offQuery)} prefetch={false} scroll={false} data-as-of-off className={`${link} inline-flex min-h-6 items-center`}>
                Show today&rsquo;s values
              </Link>
            </p>
            {drawnSeries.length > 0 && <p className="mt-0.5">{BASIS_INFO[view.asOf.basis].meaning}</p>}
            {view.selection.length > 1 && (
              <ul data-as-of-series className="mt-1 flex flex-col gap-0.5">
                {view.selection
                  .filter((s) => s.basis !== null)
                  .map((s) => (
                    <li key={s.key} className="flex flex-wrap items-center gap-x-2">
                      <span className="text-ink">{s.name}</span>
                      <BasisMark basis={s.basis!} basePath={BASE_PATH} link={false} />
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        {view.compare && (
          <p data-compare className="max-w-[80ch] text-sm text-ink-2">
            Comparing <span className="num text-ink">{view.window.words}</span> with <span className="num text-ink">{view.compare.words}</span>, drawn pale and wide from the left edge of the same axis.{" "}
            <Link href={to(view.compare.offQuery)} prefetch={false} scroll={false} data-compare-off className={`${link} inline-flex min-h-6 items-center`}>
              Stop comparing
            </Link>
          </p>
        )}

        {view.notes.length > 0 && (
          <ul data-notes className="flex max-w-[80ch] flex-col gap-1 text-sm text-ink-2">
            {view.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        id="chart"
        title="Chart"
        meta={
          view.figure && (
            <>
              <span className="num">{view.window.words}</span> · {MODE_LABELS[view.mode]} · <span className="num">{drawn}</span> series{view.asOf && <> · as known before <span className="num">{view.asOf.words}</span></>}
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
            {view.selection.length === 0 ? (view.absent.length > 0 ? "None of the series this address names is in this release. They are named below." : "No series is selected. Choose series above to begin.") : "None of the selected series can be drawn in this view. The reasons are below."}
          </p>
        )}
        {(kept.length > 0 || uncompared.length > 0 || view.absent.length > 0) && (
          <ul data-not-drawn className="flex max-w-[80ch] flex-col gap-1 border-t border-line pt-3 text-sm text-ink-2">
            {kept.map((s) => (
              <li key={s.key}>
                <span className="font-medium text-ink">
                  {NOT_DRAWN[s.state as keyof typeof NOT_DRAWN]} · {s.name}
                </span>
                : {s.reason}
              </li>
            ))}
            {view.absent.map((a) => (
              <li key={a.key} data-absent={a.key}>
                <span className="font-medium text-ink">Not in this release · {a.name}</span>: {a.reason}{" "}
                <Link href={to(a.removeQuery)} prefetch={false} scroll={false} aria-label={`Remove ${a.name} from the address`} className={`${link} inline-flex min-h-6 items-center`}>
                  Remove
                </Link>
              </li>
            ))}
            {uncompared.map((s) => (
              <li key={`${s.key}-compared`}>
                <span className="font-medium text-ink">Not drawn over the second range · {s.name}</span>: {s.compared!.reason}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {view.snapshot.length > 0 && (
        <Panel id="snapshot" title="Snapshot" meta={<>Each series&rsquo; own values over <span className="num">{view.window.words}</span>, whatever the chart shows them as.</>} bodyClassName="p-4">
          <div role="group" aria-label="Snapshot table" tabIndex={0} className="overflow-x-auto">
            <table data-snapshot className="data-table">
              <thead>
                <tr>
                  <th scope="col">Series</th>
                  <th scope="col" className="n">First in window</th>
                  <th scope="col" className="n">Latest in window</th>
                  <th scope="col" className="n">Change</th>
                  <th scope="col" className="n">Low</th>
                  <th scope="col" className="n">High</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {view.snapshot.map((row) => {
                  const cell = (c: { value: string; period: string } | null) =>
                    c ? (
                      <>
                        {c.value} <small>{c.period}</small>
                      </>
                    ) : (
                      "–"
                    );
                  return (
                    <tr key={row.key} data-snapshot-row={row.key}>
                      <th scope="row">
                        {row.name}
                        <small>{row.unit}</small>
                      </th>
                      {row.note ? (
                        <td colSpan={5}>
                          <i>{row.note}</i>
                        </td>
                      ) : (
                        <>
                          <td className="n">{cell(row.first)}</td>
                          <td className="n">{cell(row.last)}</td>
                          <td className="n">{row.change ?? "–"}</td>
                          <td className="n">{cell(row.low)}</td>
                          <td className="n">{cell(row.high)}</td>
                        </>
                      )}
                      <td>
                        <small>
                          {row.source}
                          {row.latest && ` · latest value ${row.latest}`}
                        </small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {view.selection.length > 0 && (
        <Panel
          id="relationships"
          title="Relationships"
          meta={
            <>
              How the series moved together over <span className="num">{view.window.words}</span>. Descriptive only.
            </>
          }
          bodyClassName="flex flex-col gap-5 p-4"
        >
          {rel.empty ? (
            <p data-relationships-empty className="max-w-[68ch] text-ink-2">
              {rel.empty}
            </p>
          ) : (
            <>
              <div>
                <h3 className="text-xs font-semibold text-ink-2">Correlation of every pair, r, {rel.basis === "chg" ? "on changes from the period before" : "on levels"}, with no lag</h3>
                <div role="group" aria-label="Correlation of every pair" tabIndex={0} className="mt-1 overflow-x-auto">
                  <table data-matrix className="data-table w-auto">
                    <thead>
                      <tr>
                        <td />
                        {rel.series.map((s) => (
                          <th key={s.key} scope="col" className="n" title={s.name}>
                            {s.short}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rel.matrix.map((row, a) => (
                        <tr key={rel.series[a]!.key}>
                          <th scope="row" title={rel.series[a]!.name}>
                            {rel.series[a]!.short}
                          </th>
                          {row.map((c, b) => (
                            <td key={rel.series[b]!.key} className="n">
                              {c.self ? (
                                <span aria-label={c.words} className="text-ink-3">
                                  –
                                </span>
                              ) : (
                                <Link
                                  href={to(c.query!)}
                                  prefetch={false}
                                  scroll={false}
                                  title={c.words}
                                  aria-label={c.words}
                                  aria-current={c.chosen ? "true" : undefined}
                                  data-cell={`${rel.series[a]!.key} ${rel.series[b]!.key}`}
                                  className={`press hover-ink num inline-flex h-8 min-w-14 items-center justify-end rounded border px-2 ${c.chosen ? "border-accent bg-band font-semibold text-ink" : "border-transparent text-accent underline underline-offset-2"}`}
                                >
                                  {c.r ?? "no answer"}
                                </Link>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-xs text-ink-3">Choose a cell to look at that pair below. “No answer” has its reason in the cell&rsquo;s name and under the pair.</p>
              </div>

              {rel.pair && (
                <div data-pair className="flex flex-col gap-3 border-t border-line pt-4">
                  <RelationshipControls
                    action={here}
                    series={rel.series}
                    x={rel.pair.x.key}
                    y={rel.pair.y.key}
                    levels={rel.basis === "lvl"}
                    lag={rel.pair.lag}
                    maxLag={MAX_LAG}
                    lagUnit={rel.pair.lags.unit}
                    roll={rel.pair.rolling.span}
                    hidden={relationshipHidden}
                  />
                  <div>
                    <p className="text-sm text-ink-2">
                      X: <span className="font-medium text-ink">{rel.pair.x.name}</span> · Y: <span className="font-medium text-ink">{rel.pair.y.name}</span>
                    </p>
                    {rel.pair.answer ? (
                      <p data-pair-answer className="num mt-1 text-base font-semibold text-ink">
                        r = {rel.pair.answer.r} <span className="ml-3 font-normal text-ink-2">r² = {rel.pair.answer.r2}</span> <span className="ml-3 font-normal text-ink-2">n = {rel.pair.answer.n}</span>
                      </p>
                    ) : (
                      <p data-pair-answer className="mt-1 text-base font-medium text-ink">
                        {rel.pair.noAnswer}
                      </p>
                    )}
                    <ul data-pair-facts className="mt-1 flex max-w-[80ch] flex-col gap-0.5 text-sm text-ink-2">
                      {rel.pair.facts.map((fact) => (
                        <li key={fact}>{fact}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="grid gap-x-6 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
                    <figure data-relationship="scatter" className="m-0 flex min-w-0 flex-col gap-1">
                      <h3 className="text-xs font-semibold text-ink-2">Each pair of periods</h3>
                      {rel.pair.scatter ? (
                        <>
                          <Svg node={rel.pair.scatter.drawing} className="h-auto w-full max-w-[352px] text-ink" />
                          {state.table && (
                            <details data-relationship-table>
                              <summary className={summary}>The pairs as a table</summary>
                              <div role="group" aria-label="Pairs" tabIndex={0} className="max-h-80 overflow-auto">
                                <table className="data-table">
                                  <thead>
                                    <tr>
                                      <th scope="col">Period of X</th>
                                      <th scope="col" className="n">{rel.pair.scatter.xHead}</th>
                                      <th scope="col">Period of Y</th>
                                      <th scope="col" className="n">{rel.pair.scatter.yHead}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rel.pair.scatter.rows.map((row) => (
                                      <tr key={`${row.xPeriod} ${row.yPeriod}`}>
                                        <th scope="row">{row.xPeriod}</th>
                                        <td className="n">{row.x}</td>
                                        <td>{row.yPeriod}</td>
                                        <td className="n">{row.y}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-ink-2">Nothing to draw: {rel.pair.noAnswer}</p>
                      )}
                    </figure>

                    <figure data-relationship="lags" className="m-0 flex min-w-0 flex-col gap-1">
                      <h3 className="text-xs font-semibold text-ink-2">r at each lag, in {rel.pair.lags.unit}</h3>
                      <Svg node={rel.pair.lags.drawing} className="h-auto w-full max-w-[352px] text-ink" />
                      {rel.pair.lags.strongest && <figcaption className="max-w-[60ch] text-xs text-ink-2">{rel.pair.lags.strongest}</figcaption>}
                      <details data-relationship-table>
                        <summary className={summary}>The lags as a table; choose one</summary>
                        <div role="group" aria-label="Lags" tabIndex={0} className="max-h-80 overflow-auto">
                          <table data-lags className="data-table">
                            <thead>
                              <tr>
                                <th scope="col">Lag</th>
                                <th scope="col" className="n">r</th>
                                <th scope="col" className="n">n</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rel.pair.lags.rows.map((row) => (
                                <tr key={row.lag}>
                                  <th scope="row">
                                    <Link href={to(row.query)} prefetch={false} scroll={false} aria-current={row.current ? "true" : undefined} className={`${link} ${row.current ? "font-semibold" : ""}`}>
                                      {row.label}
                                    </Link>
                                  </th>
                                  <td className="n">{row.r ?? <i>no answer</i>}</td>
                                  <td className="n">{row.n}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </figure>

                    <figure data-relationship="rolling" className="m-0 flex min-w-0 flex-col gap-1">
                      <h3 className="text-xs font-semibold text-ink-2">
                        r over a rolling {rel.pair.rolling.span} months, with no lag
                      </h3>
                      {rel.pair.rolling.drawing ? (
                        <>
                          <Svg node={rel.pair.rolling.drawing} className="h-auto w-full max-w-[352px] text-ink" />
                          {state.table && (
                            <details data-relationship-table>
                              <summary className={summary}>The rolling values as a table</summary>
                              <div role="group" aria-label="Rolling correlation" tabIndex={0} className="max-h-80 overflow-auto">
                                <table className="data-table">
                                  <thead>
                                    <tr>
                                      <th scope="col">Window ending</th>
                                      <th scope="col" className="n">r</th>
                                      <th scope="col" className="n">n</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rel.pair.rolling.rows.map((row) => (
                                      <tr key={row.period}>
                                        <th scope="row">{row.period}</th>
                                        <td className="n">{row.r ?? <i>no answer</i>}</td>
                                        <td className="n">{row.n}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          )}
                        </>
                      ) : (
                        <p data-rolling-note className="max-w-[60ch] text-sm text-ink-2">
                          {rel.pair.rolling.note}
                        </p>
                      )}
                    </figure>
                  </div>
                  {!state.table && (rel.pair.scatter || rel.pair.rolling.drawing) && (
                    <p className="text-sm font-medium">
                      <Link href={to(view.queryWith({ table: true }))} prefetch={false} scroll={false} className={`${link} inline-flex min-h-8 items-center`}>
                        Show the tables behind these drawings
                      </Link>
                    </p>
                  )}
                </div>
              )}
            </>
          )}
          {rel.left_out.length > 0 && (
            <ul data-relationships-left-out className="flex max-w-[80ch] flex-col gap-1 text-sm text-ink-2">
              {rel.left_out.map((s) => (
                <li key={s.key}>
                  <span className="font-medium text-ink">Takes no part · {s.name}</span>: {s.reason}
                </li>
              ))}
            </ul>
          )}
          <ul data-guard className="flex max-w-[80ch] list-disc flex-col gap-1 border-t border-line pl-5 pt-3 text-sm text-ink-2">
            {rel.guard.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Panel>
      )}

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
