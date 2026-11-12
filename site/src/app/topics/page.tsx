import type { Metadata } from "next";
import { Panel } from "@/components/Panel";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";
import { topicsIndexView } from "@/lib/topics";

export const metadata: Metadata = { title: "Topics" };

const link = "press hover-ink text-accent underline underline-offset-2";

/**
 * The Topics of the Release being served (PLAN section 3, M23). A reading page: complete in the
 * HTML, no script of its own, nothing that moves. Each Topic is its name, the definition it
 * quotes with where the words stand, and its main Series. The page writes no text about a
 * Topic: there is none to write.
 */
export default async function TopicsPage() {
  const { release } = await releaseForRequest();
  const view = topicsIndexView(release, SURFACE);
  const count = view.topics.length;

  return (
    <div className="flex flex-col gap-6">
      <Panel id="topics" title="Topics" level={1} meta={<span className="num">{count === 1 ? "1 topic" : `${count} topics`}</span>}>
        <p className="max-w-[68ch] text-ink-2">
          A topic sets its main series beside the series, events and claims an editor chose for it, with a definition quoted from the agency
          that measures it. A topic page states figures and names sources. It gives no explanation of why anything moved.
        </p>
        {count === 0 && <p className="mt-3 text-ink-2">This release holds no topics.</p>}
      </Panel>

      {count > 0 && (
        <Panel id="list" title="All topics" bodyClassName="p-0">
          <ul>
            {view.topics.map((topic) => (
              <li key={topic.slug} data-topic={topic.slug} className="border-b border-line px-4 py-3 last:border-b-0">
                <h2 className="text-base font-semibold text-ink">
                  <a href={`${BASE_PATH}${topic.href}`} className={`${link} inline-flex min-h-6 items-center`}>
                    {topic.title}
                  </a>
                  {topic.draft && <span className="ml-2 rounded border border-control px-1.5 py-0.5 text-xs font-normal text-ink-2">Draft</span>}
                </h2>
                <p className="mt-0.5 text-xs text-ink-3">{topic.segment}</p>
                <blockquote className="mt-2 max-w-[68ch] border-l-2 border-line-strong pl-3 text-sm text-ink">
                  <p>{topic.quote}</p>
                  <footer className="mt-1 text-xs text-ink-3">{topic.source}</footer>
                </blockquote>
                <p className="mt-2 text-sm text-ink-2">
                  Main series:{" "}
                  {topic.main.href ? (
                    <a href={`${BASE_PATH}${topic.main.href}`} className={`${link} inline-flex min-h-6 items-center`}>
                      {topic.main.name}
                    </a>
                  ) : (
                    <span className="font-mono text-ink">{topic.main.name}</span>
                  )}
                  {topic.main.note && <span> · {topic.main.note}</span>}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
