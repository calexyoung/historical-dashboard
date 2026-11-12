import { headers } from "next/headers";
import { Panel } from "@/components/Panel";
import { StateMark } from "@/components/StateMark";
import { Svg } from "@/components/Svg";
import { V1HashDoor } from "@/components/V1HashDoor";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { FIRST_VISIT_HEADER } from "@/lib/gate";
import { overviewView, type HeadlineRow } from "@/lib/highlights";
import { topicLinks } from "@/lib/topics";
import { releaseForRequest } from "@/lib/release/server";
import { MAX_QUERY } from "@/lib/search";

const link = "press hover-ink text-accent underline underline-offset-2";
const control = "press hover-control h-9 min-w-0 rounded border border-control bg-raised px-2 text-sm text-ink placeholder:text-ink-3";

function Row({ row }: { row: HeadlineRow }) {
  const name = (
    <a href={`${BASE_PATH}${row.href}`} className={`${link} inline-flex min-h-6 min-w-6 items-center font-medium`}>
      {row.name}
    </a>
  );
  if (row.state !== "shown") {
    return (
      <div className="col-span-2 min-w-0 text-sm sm:col-span-1">
        {name}
        <p className="mt-0.5 text-ink-2">
          {row.state === "no_answer" ? (
            row.reason
          ) : (
            <>
              <StateMark mark="withheld" word={row.state === "withheld" ? "Withheld" : "Not shown here"} basePath={BASE_PATH} /> {row.reason}
            </>
          )}
        </p>
      </div>
    );
  }
  const year = row.cells?.[0];
  return (
    <>
      <div className="col-span-2 min-w-0 text-sm sm:col-span-1">
        {name}
        {row.latest ? (
          <p className="num mt-0.5 text-base font-medium text-ink">
            {row.latest.words}
            {row.marks.map((m) => (
              <span key={m.mark} className="ml-2 text-sm">
                <StateMark mark={m.mark} word={m.word} basePath={BASE_PATH} />
              </span>
            ))}
          </p>
        ) : (
          <p className="mt-0.5 text-ink-2">{row.reason}</p>
        )}
        {year ? (
          <p className="num mt-0.5 text-ink-2">
            {year.state && (
              <>
                <StateMark mark={year.state.mark} word={year.state.word} basePath={BASE_PATH} />{" "}
              </>
            )}
            <a href={`${BASE_PATH}${year.href}`} data-door="year" className={`${link} inline-flex min-h-6 items-center`}>
              {year.figure ? `${year.figure.words.charAt(0).toUpperCase()}${year.figure.words.slice(1)}` : `${year.reason}: no change from a year earlier is given`}
            </a>
          </p>
        ) : (
          row.latest && row.reason && <p className="mt-0.5 max-w-[60ch] text-ink-2">{row.reason}</p>
        )}
        {row.compared && <p className="mt-0.5 text-xs text-ink-3">{row.compared}</p>}
      </div>
      {row.spark && (
        <a href={`${BASE_PATH}${row.explorer}`} data-door="spark" className="press col-start-2 row-start-1 block self-start justify-self-end text-ink sm:col-start-3 sm:self-center">
          <Svg node={row.spark} className="block h-7 w-[120px]" />
        </a>
      )}
    </>
  );
}

/**
 * The Overview (PLAN section 3, M22): the front door. One row per Segment, in a fixed order:
 * the Segment's first headline Series, its latest value in words, how that differs from a year
 * earlier, and the Series drawn small. Then the Topics, by name, and search. No hero, no cards,
 * no tiles.
 *
 * A reading page: everything is in the HTML and nothing needs a script. Each row's name opens
 * the Series' page, its change opens the Explorer at that window, and its drawing opens the
 * Series in the Explorer. On a reader's first visit, and only then, the rows fade up one after
 * another (the one flourish of PLAN section 8); they are in the page and can be used throughout.
 */
export default async function Overview() {
  const { release } = await releaseForRequest();
  const view = overviewView(release, SURFACE);
  const topics = topicLinks(release);
  const first = (await headers()).get(FIRST_VISIT_HEADER) === "1";

  return (
    <div className="flex flex-col gap-6">
      <V1HashDoor basePath={BASE_PATH} />
      <Panel
        id="overview"
        title="Overview"
        level={1}
        meta={
          <span className="num">
            Release of {view.release} · each row names its own period
          </span>
        }
        bodyClassName="p-0"
      >
        <ol className="overview-rows" data-first-visit={first ? "" : undefined}>
          {view.segments.map((segment, i) => (
            <li
              key={segment.segment}
              data-segment={segment.segment}
              style={{ "--i": i } as React.CSSProperties}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)_auto]"
            >
              <h2 className="text-sm font-semibold text-ink">
                <a href={`${BASE_PATH}${segment.href}`} className="press hover-ink inline-flex min-h-6 items-center underline decoration-line-strong underline-offset-2">
                  {segment.label}
                </a>
              </h2>
              {segment.row ? <Row row={segment.row} /> : <p className="col-span-2 text-sm text-ink-2 sm:col-span-1">No headline series in this release.</p>}
              {segment.more > 0 && (
                <p className="col-span-2 text-xs text-ink-2 sm:col-span-2 sm:col-start-2">
                  <a href={`${BASE_PATH}/highlights#${segment.segment.replace(/_/g, "-")}`} className={`${link} inline-flex min-h-6 items-center`}>
                    {segment.more} more in Highlights
                  </a>
                </p>
              )}
            </li>
          ))}
        </ol>
      </Panel>

      {topics.length > 0 && (
        <Panel id="topics" title="Topics" meta="A main series beside what an editor chose to set with it.">
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {topics.map((topic) => (
              <li key={topic.slug}>
                <a href={`${BASE_PATH}${topic.href}`} data-topic={topic.slug} className={`${link} inline-flex min-h-6 items-center`}>
                  {topic.title}
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel id="find" title="Search">
        <form method="get" action={`${BASE_PATH}/search`} role="search" aria-label="Macro Atlas" className="flex flex-wrap items-end gap-2">
          <label className="sr-only" htmlFor="overview-q">
            Search topics, series, events and the glossary
          </label>
          <input id="overview-q" type="search" name="q" maxLength={MAX_QUERY} placeholder="Search topics, series, events and the glossary" autoComplete="off" className={`${control} w-full sm:w-96`} />
          <button type="submit" className="press h-9 rounded border border-accent bg-accent px-3 text-sm font-semibold text-void">
            Search
          </button>
        </form>
        <p className="mt-3 text-sm text-ink-2">
          <a href={`${BASE_PATH}/highlights`} className={`${link} inline-flex min-h-6 items-center`}>
            Highlights
          </a>
          : every headline series with its change over one, five and ten years.
        </p>
      </Panel>
    </div>
  );
}
