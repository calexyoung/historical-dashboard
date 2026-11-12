import type { Metadata } from "next";
import { Panel } from "@/components/Panel";
import { StateMark } from "@/components/StateMark";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";
import { MAX_QUERY, PAGE_HITS, parseSearch, search } from "@/lib/search";

export const metadata: Metadata = { title: "Search", robots: { index: false } };

const link = "press hover-ink text-accent underline underline-offset-2";
const control = "press hover-control h-9 min-w-0 rounded border border-control bg-raised px-2 text-sm text-ink placeholder:text-ink-3";

/**
 * Search without JavaScript (PLAN M22): a GET form, so the address is the question and a copied
 * link asks it again. The hits are those of the search sheet, from the same function: the
 * Series, Events and Claims of the Release being served and the glossary's terms, grouped by
 * kind. A hit is a name and a door; it holds no value.
 */
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const { release } = await releaseForRequest();
  const answer = search(release, SURFACE, parseSearch(await searchParams), { limit: PAGE_HITS });
  const here = `${BASE_PATH}/search`;

  return (
    <div className="flex flex-col gap-6">
      <Panel id="search" title="Search" level={1} meta={answer.asked ? <span className="num">{answer.total === 1 ? "1 result" : `${answer.total} results`}</span> : undefined}>
        <form method="get" action={here} role="search" aria-label="Macro Atlas" className="flex flex-wrap items-end gap-2">
          <label className="sr-only" htmlFor="search-q">
            Search series, events and the glossary
          </label>
          <input
            id="search-q"
            type="search"
            name="q"
            defaultValue={answer.q}
            maxLength={MAX_QUERY}
            placeholder="Search series, events and the glossary"
            autoComplete="off"
            className={`${control} w-full sm:w-96`}
          />
          <button type="submit" className="press h-9 rounded border border-accent bg-accent px-3 text-sm font-semibold text-void">
            Search
          </button>
        </form>
        {!answer.asked && (
          <p className="mt-3 max-w-[68ch] text-sm text-ink-2">
            Searches the names and descriptions of the series, events and claims in the release being served, and the glossary. A word matches
            from its start, and every word asked for must be found.
          </p>
        )}
        {answer.asked && answer.total === 0 && (
          <p className="mt-3 text-sm text-ink-2" data-no-results>
            Nothing matches &ldquo;{answer.q}&rdquo;.
          </p>
        )}
      </Panel>

      {answer.groups.map((group) => (
        <Panel
          key={group.kind}
          id={`results-${group.kind}`}
          title={group.label}
          meta={<span className="num">{group.hits.length < group.total ? `${group.hits.length} of ${group.total}` : group.total}</span>}
          bodyClassName="p-0"
        >
          <ul data-group={group.kind}>
            {group.hits.map((hit) => (
              <li key={hit.id} data-hit={hit.id} className="border-b border-line px-4 py-2 text-sm last:border-b-0">
                <a href={`${BASE_PATH}${hit.href}`} className={`${link} inline-flex min-h-6 min-w-6 items-center font-medium`}>
                  {hit.title}
                </a>
                {hit.held && (
                  <span className="ml-2 text-xs">
                    <StateMark mark="withheld" word={hit.held === "withheld" ? "Withheld" : "Not shown here"} basePath={BASE_PATH} />
                  </span>
                )}
                {hit.detail && <p className="mt-0.5 max-w-[76ch] text-ink-2">{hit.detail}</p>}
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
