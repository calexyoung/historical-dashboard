import type { Metadata } from "next";
import { Panel } from "@/components/Panel";
import { catalogView, FACET_NAMES, parseCatalogFilters, type CatalogRow, type FacetName } from "@/lib/catalog";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";

export const metadata: Metadata = { title: "Data" };

const FACET_LABEL: Record<FacetName, { label: string; all: string }> = {
  segment: { label: "Segment", all: "All segments" },
  freq: { label: "Frequency", all: "All frequencies" },
  via: { label: "Obtained via", all: "Any route" },
  rights: { label: "Rights", all: "Any rights status" },
};

// The control grammar of /missions (h-8, 4px corners, raised ground), with Macro Atlas's
// visible control border (DESIGN.md). Colour is the only thing that changes on hover.
const control = "press hover-control h-9 min-w-0 rounded border border-control bg-raised px-2 text-sm text-ink placeholder:text-ink-3";
const link = "press hover-ink text-accent underline underline-offset-2";

/** What a row has instead of values, in words. */
function Unavailable({ row }: { row: CatalogRow }) {
  return (
    <>
      <span className="font-medium text-ink">{row.state === "withheld" ? "Withheld" : "Not shown here"}</span>: {row.reason}
    </>
  );
}

/**
 * The Catalog of the Release being served (PLAN section 3). A reading page: complete in the HTML,
 * no script of its own. Search and filters are a GET form, so the address says what is shown and
 * a copied link reproduces it. Latest values come through Query, which asks the rights gate; a
 * Series that may not be shown is still listed, by name, with the reason.
 *
 * Names do not link anywhere yet: the series page (`/data/{key}`) arrives in M3.
 */
export default async function DataPage({ searchParams }: PageProps<"/data">) {
  const { release } = await releaseForRequest();
  const view = catalogView(release, SURFACE, parseCatalogFilters(await searchParams));
  const { rows, total, filters, facets, active } = view;
  const here = `${BASE_PATH}/data`;
  const allLegacy = rows.length > 0 && rows.every((row) => row.legacy);
  const count = active ? `${rows.length} of ${total} series` : `${total} series`;

  return (
    <div className="flex flex-col gap-6">
      <Panel id="data" title="Data" level={1}>
        <p className="max-w-[68ch] text-ink-2">
          Every series in the release being served: what it measures, how often, where it came from and what is settled about its
          rights.
        </p>
        <form method="get" action={here} role="search" aria-label="Series" className="mt-4 flex flex-wrap items-end gap-2">
          <label className="sr-only" htmlFor="data-q">
            Search
          </label>
          <input
            id="data-q"
            type="search"
            name="q"
            defaultValue={filters.q}
            maxLength={100}
            placeholder="Search by name, key or source"
            autoComplete="off"
            className={`${control} w-full sm:w-72`}
          />
          {FACET_NAMES.map((name) => (
            <span key={name} className="contents">
              <label className="sr-only" htmlFor={`data-${name}`}>
                {FACET_LABEL[name].label}
              </label>
              <select id={`data-${name}`} name={name} defaultValue={filters[name] ?? ""} className={`${control} w-[calc(50%-0.25rem)] sm:w-auto`}>
                <option value="">{FACET_LABEL[name].all}</option>
                {facets[name].map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </span>
          ))}
          <button type="submit" className="press h-9 rounded border border-accent bg-accent px-3 text-sm font-semibold text-void">
            Show
          </button>
          {active && (
            <a href={here} className={`${link} inline-flex h-9 items-center px-1 text-sm`}>
              Clear
            </a>
          )}
        </form>
      </Panel>

      <Panel
        id="series"
        title="Series"
        meta={
          <>
            <span className="num">{count}</span>
            {allLegacy && " · every value here is v1's rounded monthly output"}
          </>
        }
        bodyClassName={rows.length > 0 ? "overflow-x-auto" : "p-4"}
      >
        {rows.length === 0 ? (
          <p className="text-ink-2">
            No series match.{" "}
            <a href={here} className={link}>
              Clear the search and filters
            </a>
            .
          </p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-3">
                <th scope="col" className="px-4 py-2 font-medium">
                  Series
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">
                  Unit
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">
                  Frequency and periods
                </th>
                <th scope="col" className="hidden px-4 py-2 text-right font-medium md:table-cell">
                  Latest
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">
                  Origin and route
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">
                  Rights
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const shown = row.state === "shown";
                const span = row.first && row.last ? `${row.first} to ${row.last}` : "No periods";
                const route = row.originId ? `${row.via} · ${row.originId}` : row.via;
                return (
                  <tr key={row.key} data-series-key={row.key} data-state={row.state} className="border-b border-line align-top last:border-b-0">
                    <th scope="row" className="px-4 py-2 font-normal">
                      <span className="font-medium text-ink">{row.name}</span>
                      <span className="num block break-all font-mono text-xs text-ink-3">{row.key}</span>
                      {row.legacy && !allLegacy && <span className="block text-xs text-ink-2">v1&rsquo;s rounded monthly output</span>}
                      {/* Below md the other columns fold in here, so the table never scrolls sideways
                          and nothing is lost. From md to lg only origin and rights fold. */}
                      <span className="mt-1 block text-xs text-ink-2 md:hidden">
                        {shown ? (
                          <>
                            <span className="num block">
                              {row.latest ? (
                                <>
                                  <span className="font-medium text-ink">{row.latest.text}</span> {row.unit} · {row.latest.period}
                                </>
                              ) : (
                                row.unit
                              )}
                            </span>
                            <span className="num block">
                              {row.frequency} · {span}
                            </span>
                          </>
                        ) : (
                          <span className="block">
                            <Unavailable row={row} />
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-ink-2 lg:hidden">
                        {row.origin} · {route} · {row.rights}
                      </span>
                    </th>
                    {shown ? (
                      <>
                        <td className="hidden px-4 py-2 text-ink-2 md:table-cell">{row.unit}</td>
                        <td className="hidden px-4 py-2 text-ink-2 md:table-cell">
                          {row.frequency}
                          <span className="num block text-xs text-ink-3">{span}</span>
                        </td>
                        <td className="num hidden whitespace-nowrap px-4 py-2 text-right md:table-cell">
                          {row.latest ? (
                            <>
                              <span className="font-medium text-ink">{row.latest.text}</span>
                              <span className="block text-xs text-ink-3">{row.latest.period}</span>
                            </>
                          ) : (
                            <span className="text-ink-3">No value</span>
                          )}
                        </td>
                      </>
                    ) : (
                      <td colSpan={3} className="hidden px-4 py-2 text-ink-2 md:table-cell">
                        <Unavailable row={row} />
                      </td>
                    )}
                    <td className="hidden px-4 py-2 text-ink-2 lg:table-cell">
                      {row.origin}
                      <span className="block break-all text-xs text-ink-3">{route}</span>
                    </td>
                    <td className="hidden px-4 py-2 text-ink-2 lg:table-cell">{row.rights}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
