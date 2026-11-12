import type { ReactNode } from "react";
import { BasisMark } from "@/components/BasisMark";
import { Figure } from "@/components/Figure";
import { Panel } from "@/components/Panel";
import { StateMark } from "@/components/StateMark";
import { glossaryHref } from "@/lib/glossary";
import { stateOfStatus } from "@/lib/figure/states";
import { STATE_INFO } from "@/lib/figure";
import type { Fact, Revisions, SeriesPageView } from "@/lib/series-page";

const link = "press hover-ink text-accent underline underline-offset-2";
const tap = `${link} inline-flex min-h-6 min-w-6 items-center`;
// The catalog page's control grammar (DESIGN.md): 36px high, the `control` border, 4px corners.
const control = "hover-control h-9 rounded border border-control bg-raised px-2 text-sm text-ink";

/**
 * "What did this say before a date?" A GET form: the address is the state, and it works with no
 * script. The rest of the question (a Transform, a window) rides along in hidden fields.
 */
function AsOfForm({ view, basePath }: { view: SeriesPageView; basePath: string }) {
  const here = `${basePath}/data/${view.key}`;
  const { request } = view;
  const rest = request.carried.map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join("&");
  const day = request.asOf && /^\d{4}-\d{2}-\d{2}$/.test(request.asOf) ? request.asOf : undefined;
  return (
    <form method="get" action={here} data-as-of-form className="mt-4 flex flex-wrap items-end gap-2">
      {request.carried.map((c) => (
        <input key={c.name} type="hidden" name={c.name} value={c.value} />
      ))}
      <label htmlFor="as-of" className="flex flex-col gap-1 text-xs text-ink-3">
        What it said before a date
        <input id="as-of" type="date" name="as_of" defaultValue={day} min="1900-01-01" required className={`${control} num`} />
      </label>
      <button type="submit" className="press h-9 rounded border border-accent bg-accent px-3 text-sm font-semibold text-void">
        Show
      </button>
      {request.asOf && (
        <a href={rest ? `${here}?${rest}` : here} className={`${link} inline-flex h-9 items-center px-1 text-sm`}>
          Show it as it is now
        </a>
      )}
    </form>
  );
}

/** Every version held of the Periods that changed, the Origin's clock and Macro Atlas's in separate columns. */
function RevisionsTable({ revisions, basePath }: { revisions: Extract<Revisions, { held: true }>; basePath: string }) {
  return (
    <div role="group" aria-label="Versions of the periods that changed" tabIndex={0} className="overflow-x-auto">
      <table data-revisions className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-ink-3">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Period
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Value
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Status
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Published by the origin
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              First held by Macro Atlas
            </th>
            <th scope="col" className="py-1.5 font-medium">
              Held until
            </th>
          </tr>
        </thead>
        <tbody>
          {revisions.rows.map((row, i) => {
            const state = stateOfStatus(row.status);
            return (
              <tr key={i} data-current={row.current || undefined} className="border-b border-line align-top last:border-b-0">
                <th scope="row" className="num whitespace-nowrap py-1 pr-3 font-normal text-ink-2">
                  {row.period}
                </th>
                <td className={`num py-1 pr-3 text-right ${row.current ? "font-semibold text-ink" : "text-ink-2"}`}>{row.value ?? <span className="text-ink-3">{row.withdrawn ? "Withdrawn" : "No value"}</span>}</td>
                <td className="whitespace-nowrap py-1 pr-3 text-xs text-ink-2">
                  {state ? <StateMark mark={state} word={STATE_INFO[state].word} basePath={basePath} link={false} /> : row.withdrawn ? "Withdrawn" : row.status === "final" ? "Final" : row.status}
                </td>
                <td className="num whitespace-nowrap py-1 pr-3 text-ink-2">{row.published ?? <span className="text-ink-3">Not dated</span>}</td>
                <td className="num whitespace-nowrap py-1 pr-3 text-ink-2">{row.held ? row.held.from : <span className="text-ink-3">From the origin&rsquo;s record</span>}</td>
                <td className="num whitespace-nowrap py-1 text-ink-2">{row.held ? (row.held.until ?? "Held now") : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Label and value pairs. Side by side where there is room, stacked on a phone. */
function Facts({ facts, basePath }: { facts: Fact[]; basePath: string }) {
  return (
    <dl className="text-sm">
      {facts.map((fact) => (
        <div key={fact.label} className="grid grid-cols-1 gap-x-4 border-b border-line py-1.5 last:border-b-0 sm:grid-cols-[minmax(9rem,13rem)_1fr]">
          <dt className="text-xs text-ink-3 sm:text-sm">
            {fact.term ? (
              <a href={glossaryHref(basePath, fact.term)} className={`${link} inline-flex min-h-6 min-w-6 items-center`}>
                {fact.label}
              </a>
            ) : (
              fact.label
            )}
          </dt>
          <dd className="min-w-0 break-words text-ink">
            {fact.href ? (
              <a href={fact.href} rel="noreferrer noopener" className={`${link} break-all`}>
                {fact.value}
              </a>
            ) : (
              fact.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Group({ title, term, basePath, children }: { title: string; term?: string; basePath: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-2">
        {term ? (
          <a href={glossaryHref(basePath, term)} className={`${link} inline-flex min-h-6 min-w-6 items-center`}>
            {title}
          </a>
        ) : (
          title
        )}
      </h3>
      {children}
    </div>
  );
}

/**
 * One Series (PLAN section 3, `/data/{key}`): name and definition, the latest value with its
 * Period, the explained figure, provenance with Origin and Channel kept apart, and breaks and
 * notes. A reading page: everything is in the HTML and nothing needs script. A Series whose
 * values may not be shown has the same page with the reason in place of the values.
 */
export function SeriesPage({ view, basePath }: { view: SeriesPageView; basePath: string }) {
  const { latest, provenance } = view;
  return (
    <div className="flex flex-col gap-6" data-series-page={view.key} data-values={view.state}>
      <Panel
        id="series"
        title={view.name}
        level={1}
        meta={
          <>
            <a href={`${basePath}/data`} className={`${link} inline-flex min-h-6 min-w-6 items-center`}>
              Data
            </a>{" "}
            · <span className="num break-all font-mono">{view.key}</span>
          </>
        }
      >
        {view.description && <p className="max-w-[68ch] text-ink-2">{view.description}</p>}
        {latest && (
          <div data-latest className={view.description ? "mt-4" : ""}>
            <p className="text-xs text-ink-3">{latest.label}</p>
            <p className="num text-3xl font-semibold leading-tight text-ink">{latest.value}</p>
            <p className="mt-0.5 text-sm text-ink-2">
              {latest.unit} · <span className="num">{latest.period}</span>
              {latest.states.map((state) => (
                <span key={state.mark}>
                  {" "}
                  · <StateMark mark={state.mark} word={state.word} basePath={basePath} />
                </span>
              ))}
            </p>
            {latest.newerGap && <p className="mt-0.5 text-sm text-ink-2">{latest.newerGap}</p>}
          </div>
        )}
        {(view.state === "withheld" || view.state === "not_permitted") && (
          <p data-held-back className={`max-w-[68ch] text-ink-2 ${view.description ? "mt-4" : ""}`}>
            <StateMark mark="withheld" word={view.state === "withheld" ? "Withheld" : "Not shown here"} basePath={basePath} />: {view.reason} This page
            holds no value of the series.
          </p>
        )}
        {view.state === "no_answer" && (
          <p data-no-answer role="status" className={`max-w-[68ch] text-ink-2 ${view.description ? "mt-4" : ""}`}>
            {view.reason} This page holds no value of the series.{" "}
            <a href={`${basePath}/data/${view.key}`} className={tap}>
              Show the series as it is
            </a>
          </p>
        )}
        {view.request.shownAs && view.state === "shown" && (
          <p data-shown-as className="mt-3 max-w-[68ch] text-sm text-ink-2">
            <span className="font-medium text-ink">Shown as</span>: {view.request.shownAs}.{" "}
            <a href={`${basePath}/data/${view.key}${view.request.asOf ? `?as_of=${encodeURIComponent(view.request.asOf)}` : ""}`} className={tap}>
              Show its own values
            </a>
          </p>
        )}
        {view.asOf && (
          <div data-as-of={view.asOf.basis} className="mt-4 max-w-[68ch] border-l-2 border-line-strong pl-3 text-sm text-ink-2">
            <p>
              <span className="font-medium text-ink">
                As known before <span className="num">{view.asOf.words}</span>
              </span>{" "}
              · <BasisMark basis={view.asOf.basis} basePath={basePath} />
            </p>
            <p className="mt-0.5">{view.asOf.meaning}</p>
            {view.state === "unavailable" && (
              <p data-unavailable className="mt-1 text-ink">
                {view.reason} This page holds no value of the series.
              </p>
            )}
            {view.asOf.lines.length > 0 && view.state === "shown" && (
              <ul className="mt-1 flex flex-col gap-0.5">
                {view.asOf.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {(view.state === "shown" || view.state === "unavailable" || (view.state === "no_answer" && view.request.asOf !== null)) && <AsOfForm view={view} basePath={basePath} />}
      </Panel>

      {view.state === "shown" && (
        <Panel id="figure" title={view.asOf ? "Over time, as known then" : "Over time"}>
          <Figure figure={view.figure} basePath={basePath} explorerHref={`${basePath}${view.explorerPath}`} />
        </Panel>
      )}

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <Panel id="definition" title="Definition" meta="As the catalog records it. What is not recorded is said, not assumed.">
          <Facts facts={view.facts} basePath={basePath} />
        </Panel>

        <Panel id="provenance" title="Provenance" meta="Where the values come from and by what route.">
          <div className="flex flex-col gap-4">
            <Group title="Origin" term="origin" basePath={basePath}>
              <Facts facts={provenance.origin} basePath={basePath} />
            </Group>
            <Group title="Channel" term="channel" basePath={basePath}>
              <Facts facts={provenance.channel} basePath={basePath} />
            </Group>
            {provenance.lineage && (
              <Group title="Computed from" basePath={basePath}>
                <p className="text-sm text-ink-2">{provenance.lineage.text}</p>
                <ul className="mt-1 text-sm">
                  {provenance.lineage.inputs.map((input) => (
                    <li key={input.key}>
                      <a href={`${basePath}/data/${input.key}`} className={`${link} inline-flex min-h-6 min-w-6 items-center`}>
                        {input.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </Group>
            )}
            <Group title="Rights" term="rights" basePath={basePath}>
              <Facts facts={provenance.rights} basePath={basePath} />
            </Group>
            <Group title="Release" term="release" basePath={basePath}>
              <Facts facts={provenance.release} basePath={basePath} />
            </Group>
          </div>
        </Panel>
      </div>

      {view.notes.length > 0 && (
        <Panel id="notes" title="Breaks and notes">
          <ul className="flex max-w-[68ch] flex-col gap-1.5 text-sm">
            {view.notes.map((note, i) => (
              <li key={i}>
                {note.kind === "Break" ? <StateMark mark="break" word="Break" basePath={basePath} /> : <span className="font-medium text-ink">{note.kind}</span>}
                <span className="num text-ink-2"> · {note.period}</span>
                <span className="text-ink-2">: {note.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {view.state === "shown" && view.asOf && (
        <Panel id="revisions" title="Revisions">
          <p className="max-w-[68ch] text-sm text-ink-2">
            This view is limited to what was known before {view.asOf.words}. Every version Macro Atlas holds, later ones included, is listed on{" "}
            <a href={`${basePath}/data/${view.key}#revisions`} className={tap}>
              the page as it is now
            </a>
            .
          </p>
        </Panel>
      )}
      {view.revisions && (
        <Panel id="revisions" title="Revisions" meta="Every version held of each period whose value or status changed. The origin's clock and Macro Atlas's are kept apart.">
          {view.revisions.held ? (
            <div className="flex flex-col gap-3">
              <ul className="flex max-w-[68ch] flex-col gap-0.5 text-sm text-ink-2">
                {view.revisions.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              {view.revisions.rows.length > 0 && <RevisionsTable revisions={view.revisions} basePath={basePath} />}
              {view.revisions.more > 0 && (
                <p className="text-sm text-ink-2">
                  The latest {view.revisions.rows.length} versions are listed; <span className="num">{view.revisions.more}</span> earlier ones are not.
                </p>
              )}
            </div>
          ) : (
            <p data-no-history className="max-w-[68ch] text-sm text-ink-2">
              {view.revisions.text}
            </p>
          )}
        </Panel>
      )}

      <Panel id="cite" title="Cite and download" meta="The data behind this page, at this page's address with a suffix.">
        <div className="flex max-w-[68ch] flex-col gap-3 text-sm">
          <div>
            <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-2">Citation</h3>
            <p data-citation className="break-words text-ink-2 select-all">
              {view.downloads.citation}
            </p>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-2">
              <a href={glossaryHref(basePath, "twin")} className={tap}>
                Files
              </a>
            </h3>
            {!view.downloads.permitted && (
              <p data-downloads-refused className="mb-1 text-ink-2">
                <StateMark mark="withheld" word="Not offered here" basePath={basePath} link={false} />: {view.downloads.reason}
                {/[.!?]$/.test(view.downloads.reason ?? "") ? "" : "."} The file below holds no value.
              </p>
            )}
            <ul data-downloads className="flex flex-wrap gap-x-4 gap-y-1">
              {[...view.downloads.twins, view.downloads.metadata].map((twin) => (
                <li key={twin.path}>
                  <a href={`${basePath}${twin.path}`} className={`${link} inline-flex min-h-8 items-center font-medium`}>
                    {twin.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          {view.downloads.reproduce && (
            <div>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-2">Reproduce</h3>
              {view.downloads.reproduce.map((snippet) => (
                <div key={snippet.label} className="mb-2 last:mb-0">
                  <p className="text-xs text-ink-3">{snippet.label}</p>
                  <pre data-reproduce tabIndex={0} className="overflow-x-auto rounded border border-line bg-raised p-2 font-mono text-xs leading-relaxed text-ink">
                    <code>{snippet.code}</code>
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
