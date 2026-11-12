import type { Metadata } from "next";
import { Panel } from "@/components/Panel";
import { BASE_PATH } from "@/lib/config";
import { eventsIndexView, parseEventFilters } from "@/lib/events";
import { releaseForRequest } from "@/lib/release/server";

export const metadata: Metadata = { title: "Events" };

const link = "press hover-ink text-accent underline underline-offset-2";

/**
 * The Events of the Release being served (PLAN section 3, M19). A reading page: complete in the
 * HTML, no script of its own. The category is a link, so the address says what is listed and a
 * copied link reproduces it. Each title is a door to the Event's own page.
 */
export default async function EventsPage({ searchParams }: PageProps<"/events">) {
  const { release } = await releaseForRequest();
  const view = eventsIndexView(release, parseEventFilters(await searchParams));
  const here = `${BASE_PATH}/events`;
  const count = view.shown === view.total ? `${view.total} ${view.total === 1 ? "event" : "events"}` : `${view.shown} of ${view.total} events`;

  return (
    <div className="flex flex-col gap-6">
      <Panel id="events" title="Events" level={1}>
        <p className="max-w-[68ch] text-ink-2">
          Dated occurrences recorded with their sources: laws, decisions, elections, disasters. Each is shown as context beside the
          series. An event is never said to have caused a movement.
        </p>
        {view.categories.length > 1 && (
          <nav aria-label="Categories" className="mt-4">
            <ul className="flex flex-wrap gap-2">
              {view.categories.map((c) => (
                <li key={c.value}>
                  <a
                    href={c.query ? `${here}?${c.query}` : here}
                    aria-current={c.current ? "true" : undefined}
                    className={`press inline-flex h-9 items-center gap-1.5 rounded border px-3 text-sm ${
                      c.current ? "border-accent bg-accent font-semibold text-void" : "hover-control border-control bg-raised text-ink"
                    }`}
                  >
                    {c.label} <span className={`num text-xs ${c.current ? "" : "text-ink-3"}`}>{c.count}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {view.note && <p className="mt-3 text-sm text-ink-2">{view.note}</p>}
        {view.drafts > 0 && (
          <p className="mt-3 max-w-[68ch] text-sm text-ink-2">
            <span className="font-medium text-ink">{view.drafts === 1 ? "1 draft" : `${view.drafts} drafts`}.</span> A draft is an event whose
            wording has not been decided. Drafts are in local releases only.
          </p>
        )}
      </Panel>

      {view.total === 0 ? (
        <Panel id="list" title="All events">
          <p className="text-ink-2">This release holds no events.</p>
        </Panel>
      ) : (
        <Panel id="list" title={view.categories.find((c) => c.current && c.value !== "")?.label ?? "All events"} meta={<span className="num">{count}</span>} bodyClassName="p-0">
          {view.groups.map((group) => (
            <section key={group.year} aria-labelledby={`year-${group.year}`}>
              <h3 id={`year-${group.year}`} className="num border-b border-line bg-raised px-4 py-1.5 text-xs font-semibold text-ink-2">
                {group.year}
              </h3>
              <ul>
                {group.rows.map((row) => (
                  <li key={row.id} data-event={row.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 border-b border-line px-4 py-2 text-sm sm:grid-cols-[7.5rem_9rem_minmax(0,1fr)]">
                    <span className="num text-ink-2">{row.when}</span>
                    <span className="col-start-2 row-start-2 text-xs text-ink-3 sm:col-start-auto sm:row-start-auto sm:text-sm sm:text-ink-2">{row.category}</span>
                    <span className="min-w-0">
                      <a href={`${BASE_PATH}${row.href}`} className={`${link} inline-flex min-h-6 items-center`}>
                        {row.title}
                      </a>
                      {row.draft && <span className="ml-2 rounded border border-control px-1.5 py-0.5 text-xs text-ink-2">Draft</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Panel>
      )}
    </div>
  );
}
