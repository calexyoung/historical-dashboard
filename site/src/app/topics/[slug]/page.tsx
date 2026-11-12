import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChangeStrip } from "@/components/ChangeStrip";
import { Figure } from "@/components/Figure";
import { Panel } from "@/components/Panel";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";
import { TOPIC_YEARS, topicPageView, type RangeView, type SeriesRef } from "@/lib/topics";

// A link in running text is at least 24px tall, so it can be pressed on a phone (PLAN section 8).
const link = "press hover-ink inline-block min-h-6 leading-6 text-accent underline underline-offset-2";

async function answer(props: PageProps<"/topics/[slug]">) {
  const [{ slug }, { release }] = await Promise.all([props.params, releaseForRequest()]);
  return topicPageView(release, SURFACE, slug);
}

export async function generateMetadata(props: PageProps<"/topics/[slug]">): Promise<Metadata> {
  return { title: (await answer(props))?.title ?? "Topic" };
}

/** A Series by name: a door to its page when the Release holds it, and the reason when it has no values to show. */
function Series({ series }: { series: SeriesRef }) {
  return (
    <>
      {series.href ? (
        <a href={`${BASE_PATH}${series.href}`} className={link}>
          {series.name}
        </a>
      ) : (
        <span className="font-mono text-ink">{series.name}</span>
      )}
      {series.note && <span className="text-ink-2"> · {series.note}</span>}
    </>
  );
}

function Range({ range }: { range: RangeView }) {
  return (
    <Panel id="range" title={`Against the ${range.label} range`} meta={<span className="num">{`${range.indicator} · ${range.shown} of ${range.of} members shown here`}</span>}>
      {range.figure ? (
        <>
          {range.sentence && (
            <p data-range-sentence className="mb-3 max-w-[68ch] text-base font-medium leading-snug text-ink">
              {range.sentence}
            </p>
          )}
          <Figure figure={range.figure} basePath={BASE_PATH} explorerHref={range.explorer ? `${BASE_PATH}${range.explorer}` : undefined} />
          <ul data-range-caption className="mt-3 flex max-w-[68ch] list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
            {range.caption.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <details data-range-counts className="mt-2">
            <summary className="hover-ink w-fit cursor-pointer py-1.5 text-sm font-medium text-accent">How many members were counted in each period</summary>
            <div role="group" aria-label="Members counted in each period" tabIndex={0} className="mb-2 mt-1 overflow-x-auto">
              <table className="figure-table">
                <caption>
                  {range.label}: members counted, and the lowest, median and highest value. A range is stated for at least {range.least}.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Period</th>
                    <th scope="col">Counted</th>
                    <th scope="col">Lowest</th>
                    <th scope="col">Median</th>
                    <th scope="col">Highest</th>
                  </tr>
                </thead>
                <tbody>
                  {range.rows.map((row) => (
                    <tr key={row.period}>
                      <th scope="row">{row.label}</th>
                      <td>
                        {row.n} of {range.of}
                      </td>
                      {row.median === null ? (
                        <td colSpan={3}>
                          <i>No range</i>
                        </td>
                      ) : (
                        <>
                          <td>{row.minimum}</td>
                          <td>{row.median}</td>
                          <td>{row.maximum}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p data-range-reason className="max-w-[68ch] text-ink-2">
          {range.reason}
        </p>
      )}
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.06em] text-ink-2">Members</h3>
      <ul data-range-members className="mt-1 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {range.members.map((member) => (
          <li key={member.key} data-member={member.key} data-state={member.state} className="min-w-0">
            <span className="num mr-2 text-xs text-ink-3">{member.country}</span>
            <Series series={member} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * One Topic of the Release this request was fixed to (PLAN section 3, M23; ADR 0037). A
 * reading page: complete in the HTML, no script, and nothing that moves (charts and data get
 * no animation). In the plan's order: the definition, quoted from the agency with where the
 * words stand, and the main Series' change strip; its explained figure; what else moved, each
 * Companion in a plot of its own on one time axis; the Series against the range of a group,
 * where the Topic names one; then the Claims, Events and member Series.
 *
 * Every sentence here is a label, a template that states a figure, or the quoted definition.
 * The page gives no account of why anything moved, and a Companion or an Event beside a Series
 * is never said to have moved it. Every figure is a door to the Explorer or to a Series' page.
 */
export default async function TopicRoute(props: PageProps<"/topics/[slug]">) {
  const view = await answer(props);
  if (!view) notFound();
  const { main, definition } = view;

  return (
    <div className="flex flex-col gap-6">
      <Panel id="topic" title="Topic" level={2} meta={<a href={`${BASE_PATH}${view.segment.href}`} className="press hover-ink inline-flex min-h-6 items-center underline underline-offset-2">{view.segment.label}</a>}>
        <h1 className="text-xl font-semibold leading-snug text-ink">
          {view.title}
          {view.draft && <span className="ml-2 rounded border border-control px-1.5 py-0.5 align-middle text-xs font-normal text-ink-2">Draft</span>}
        </h1>
        {view.draft && <p className="mt-1 max-w-[60ch] text-sm text-ink-2">A draft is in local releases only.</p>}
        <figure className="m-0 mt-3">
          <blockquote data-definition cite={definition.source.url} className="max-w-[60ch] border-l-2 border-ink pl-3 text-base font-medium leading-snug text-ink sm:text-lg">
            <p>{definition.quote}</p>
          </blockquote>
          <figcaption data-definition-source className="mt-2 max-w-[80ch] text-sm text-ink-2">
            <a href={definition.source.url} rel="noopener noreferrer" className={`${link} max-w-full [overflow-wrap:anywhere]`}>
              {definition.source.name}
            </a>
            {definition.source.archive ? (
              <>
                {" · "}
                <a href={definition.source.archive} rel="noopener noreferrer" className={`${link} whitespace-nowrap`}>
                  archived copy<span className="sr-only"> of {definition.source.name}</span>
                </a>
              </>
            ) : (
              <span> · No archived copy: {definition.source.noArchive}</span>
            )}
          </figcaption>
        </figure>

        <div data-main={main.key} className="mt-5 border-t border-line pt-3">
          <p className="text-sm text-ink-2">
            <Series series={main.state === "shown" ? { key: main.key, name: main.name, href: main.href, state: "shown", note: null } : { key: main.key, name: main.name, href: main.href, state: "not_in_release", note: main.state === "not_in_release" ? main.note : main.reason }} />
          </p>
          {main.state === "shown" && (
            <div className="mt-1">
              <ChangeStrip name={main.name} latest={main.latest?.words ?? null} marks={main.marks} cells={main.cells} reason={main.reason} basePath={BASE_PATH} />
              {main.compared && <p className="mt-1 text-xs text-ink-3">{main.compared}</p>}
            </div>
          )}
        </div>
      </Panel>

      {view.figure && (
        <Panel id="figure" title={main.name} meta={<span className="num">{`${TOPIC_YEARS} years: ${view.window}`}</span>}>
          <Figure figure={view.figure} basePath={BASE_PATH} explorerHref={view.explorer ? `${BASE_PATH}${view.explorer}` : undefined} />
        </Panel>
      )}

      {view.companions.items.length > 0 && (
        <Panel id="companions" title="What else moved" meta="Series an editor chose to set beside the main series. None is said to have caused a movement.">
          <ul data-companions className="flex flex-col gap-2 text-sm">
            {view.companions.items.map((companion) => (
              <li key={companion.key} data-companion={companion.key} data-state={companion.state} className="min-w-0">
                <Series series={companion} />
                <span className="block text-xs text-ink-3">{companion.relation}</span>
              </li>
            ))}
          </ul>
          {view.companions.figure && (
            <div data-small-multiples className="mt-4 border-t border-line pt-3">
              <p className="mb-2 max-w-[68ch] text-sm text-ink-2">
                Each series in a plot of its own, over the same {TOPIC_YEARS} years ({view.window}). The scales at the left differ; the time axis is one.
              </p>
              <Figure figure={view.companions.figure} basePath={BASE_PATH} namePlots explorerHref={view.companions.explorer ? `${BASE_PATH}${view.companions.explorer}` : undefined} />
            </div>
          )}
        </Panel>
      )}

      {view.range && <Range range={view.range} />}

      <Panel id="claims" title="Claims on this topic" meta="A claim is set beside the data. It carries no finding.">
        {view.claims.length === 0 ? (
          <p className="text-sm text-ink-2">This release holds no claim on this topic.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {view.claims.map((claim) => (
              <li key={claim.id} data-claim={claim.id} className="min-w-0">
                <a href={`${BASE_PATH}${claim.href}`} className={link}>
                  {claim.title}
                </a>
                {claim.draft && <span className="ml-2 rounded border border-control px-1.5 py-0.5 text-xs text-ink-2">Draft</span>}
                <blockquote className="mt-0.5 max-w-[68ch] border-l-2 border-line-strong pl-3 text-ink">{claim.quote}</blockquote>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel id="events" title="Events on this topic" meta="Chosen by an editor. An event is never said to have caused a movement.">
        {view.events.length === 0 ? (
          <p className="text-sm text-ink-2">No event is listed for this topic in this release.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {view.events.map((event) => (
              <li key={event.id} data-event={event.id} className="grid grid-cols-1 gap-x-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <span className="num text-ink-2">{event.when}</span>
                <span className="min-w-0">
                  <a href={`${BASE_PATH}${event.href}`} className={link}>
                    {event.title}
                  </a>
                  {event.draft && <span className="ml-2 rounded border border-control px-1.5 py-0.5 text-xs text-ink-2">Draft</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel id="series" title="Series" meta={<span className="num">{view.series.length === 1 ? "1 member series" : `${view.series.length} member series`}</span>}>
        <ul data-members className="flex flex-col gap-1 text-sm">
          {view.series.map((series) => (
            <li key={series.key} data-series-ref={series.key} data-state={series.state} className="min-w-0">
              <Series series={series} />
            </li>
          ))}
        </ul>
      </Panel>

      <p className="px-4 text-sm">
        <a href={`${BASE_PATH}/topics`} className={link}>
          ← All topics
        </a>
      </p>
    </div>
  );
}
