import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Panel } from "@/components/Panel";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { eventPageView, type EventSource } from "@/lib/events";
import { releaseForRequest } from "@/lib/release/server";

// A link in running text is at least 24px tall, so it can be pressed on a phone (PLAN section 8).
const link = "press hover-ink inline-block min-h-6 leading-6 text-accent underline underline-offset-2";

async function answer(props: PageProps<"/events/[id]">) {
  const [{ id }, { release }] = await Promise.all([props.params, releaseForRequest()]);
  return eventPageView(release, SURFACE, id);
}

export async function generateMetadata(props: PageProps<"/events/[id]">): Promise<Metadata> {
  return { title: (await answer(props))?.title ?? "Event" };
}

/** One citation: the address, then its archived copy or the reason there is none. */
function Source({ source }: { source: EventSource }) {
  return (
    <>
      <a href={source.url} rel="noopener noreferrer" className={`${link} max-w-full [overflow-wrap:anywhere]`}>
        {source.name ?? source.url}
      </a>
      {source.archive ? (
        <>
          {" · "}
          <a href={source.archive} rel="noopener noreferrer" className={`${link} whitespace-nowrap`}>
            archived copy<span className="sr-only"> of {source.name ?? source.url}</span>
          </a>
        </>
      ) : (
        <span className="text-ink-2"> · No archived copy: {source.noArchive}</span>
      )}
    </>
  );
}

/**
 * One Event of the Release this request was fixed to (PLAN section 3, M19). A reading page:
 * complete in the HTML, no script. It states what happened and when, in the Event's own cited
 * words, and where that can be checked. It says nothing of what the Event did to any Series:
 * the Series beside it are doors, not effects.
 */
export default async function EventRoute(props: PageProps<"/events/[id]">) {
  const view = await answer(props);
  if (!view) notFound();
  const term = "w-28 shrink-0 text-ink-3";

  return (
    <div className="flex flex-col gap-6">
      <Panel id="event" title="Event" level={2} bodyClassName="p-4">
        <h1 className="max-w-[40ch] text-xl font-semibold leading-snug text-ink">{view.title}</h1>
        <dl className="mt-3 flex flex-col gap-1 text-sm">
          <div className="flex gap-3 leading-6">
            <dt className={term}>When</dt>
            <dd className="num text-ink">{view.when}</dd>
          </div>
          <div className="flex gap-3 leading-6">
            <dt className={term}>Category</dt>
            <dd>
              <a href={`${BASE_PATH}/events?${view.categoryQuery}`} className={link}>
                {view.category}
              </a>
            </dd>
          </div>
          {view.magnitude && (
            <div className="flex gap-3 leading-6">
              <dt className={term}>Size</dt>
              <dd className="min-w-0">
                <span className="num text-ink">{view.magnitude.words}</span>
                <span className="text-ink-2">, as published by </span>
                <Source source={view.magnitude.source} />
              </dd>
            </div>
          )}
          {view.topics.length > 0 && (
            <div className="flex gap-3 leading-6">
              <dt className={term}>Topics</dt>
              <dd className="text-ink">{view.topics.join(", ")}</dd>
            </div>
          )}
          {view.draft && (
            <div className="flex gap-3 leading-6">
              <dt className={term}>Status</dt>
              <dd className="max-w-[60ch] text-ink">
                <span className="font-medium">Draft.</span> Its wording has not been decided. A draft is in local releases only.
              </dd>
            </div>
          )}
        </dl>
        <div className="mt-4 flex max-w-[68ch] flex-col gap-3 text-ink">
          {view.description.length > 0 ? (
            view.description.map((paragraph, i) => <p key={i}>{paragraph}</p>)
          ) : (
            <p className="text-ink-2">No description has been written for this event. Its sources say what happened.</p>
          )}
        </div>
        {view.explorer && (
          <p className="mt-4 text-sm">
            <a href={`${BASE_PATH}/explore?${view.explorer}`} className={link}>
              Open in Explorer →
            </a>
          </p>
        )}
      </Panel>

      <Panel id="sources" title="Sources" meta="Where this can be checked.">
        <ul className="flex max-w-[80ch] flex-col gap-2 text-sm">
          {view.sources.map((source) => (
            <li key={source.url} className="min-w-0">
              <Source source={source} />
            </li>
          ))}
        </ul>
      </Panel>

      {view.related.length > 0 && (
        <Panel id="series" title="Series to set beside it" meta="Chosen by an editor. An event is never said to have caused a movement.">
          <ul className="flex flex-col gap-2 text-sm">
            {view.related.map((series) => (
              <li key={series.key} data-related={series.key}>
                {series.href ? (
                  <a href={`${BASE_PATH}${series.href}`} className={link}>
                    {series.name}
                  </a>
                ) : (
                  <span className="font-mono text-ink">{series.name}</span>
                )}
                {series.state && <span className="text-ink-2"> · {series.state}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <p className="px-4 text-sm">
        <a href={`${BASE_PATH}/events`} className={link}>
          ← All events
        </a>
      </p>
    </div>
  );
}
