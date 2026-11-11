import type { Metadata } from "next";
import { Panel } from "@/components/Panel";
import { formatDay } from "@/lib/freshness";
import { releaseForRequest } from "@/lib/release/server";

export const metadata: Metadata = { title: "Explore" };

const FREQUENCY: Record<string, string> = {
  annual: "Annual",
  quarterly: "Quarterly",
  monthly: "Monthly",
  weekly: "Weekly",
  daily: "Daily",
  business_daily: "Business daily",
  irregular: "Irregular",
};

/**
 * The Explorer's address, ahead of the Explorer (M4). Until then it lists what the Release holds:
 * names, frequencies and period spans from the Catalog. It shows no Observation values, so there
 * is nothing here for the rights gate to decide yet (M2 brings Query, which asks `permits()`).
 */
export default async function ExplorePage() {
  const { release } = await releaseForRequest();
  const { manifest, catalog } = release;
  const withheld = new Map(manifest.withheld.map((row) => [row.key, row.reason]));
  const files = { ...release.series, ...release.derived };
  const shown = catalog.series.length - withheld.size;

  return (
    <div className="flex flex-col gap-6">
      <Panel id="explore" title="Explore" level={1}>
        <p className="max-w-[68ch] text-ink-2">
          The Explorer is not built yet. This page lists the series in the release being served.
        </p>
      </Panel>

      <Panel id="release" title="Release" bodyClassName="px-4 py-3">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm" data-release-id={release.id}>
          <dt className="text-ink-3">Release</dt>
          <dd className="num break-all font-mono text-[13px]">{release.id}</dd>
          <dt className="text-ink-3">Created</dt>
          <dd className="num">
            <time dateTime={manifest.created}>{formatDay(manifest.created)}</time>
          </dd>
          <dt className="text-ink-3">Profile</dt>
          <dd>{manifest.profile === "public" ? "Public" : "Local"}</dd>
          <dt className="text-ink-3">Series</dt>
          <dd className="num">
            {shown} with data, {withheld.size} withheld
          </dd>
        </dl>
      </Panel>

      <Panel
        id="series"
        title="Series in this release"
        meta={`${catalog.series.length} in the catalog`}
        bodyClassName="overflow-x-auto"
      >
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-3">
              <th scope="col" className="px-4 py-2 font-medium">
                Series
              </th>
              <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
                Frequency
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Periods
              </th>
            </tr>
          </thead>
          <tbody>
            {catalog.series.map((entry) => {
              const file = files[entry.key];
              const reason = withheld.get(entry.key);
              const first = file?.observations[0]?.period;
              const last = file?.observations.at(-1)?.period;
              return (
                <tr key={entry.key} className="border-b border-line align-top last:border-b-0">
                  <th scope="row" className="px-4 py-2 font-normal">
                    <span className="font-medium text-ink">{entry.name}</span>
                    <span className="num block break-all font-mono text-xs text-ink-3">{entry.key}</span>
                    <span className="block text-xs text-ink-3 sm:hidden">{FREQUENCY[entry.freq] ?? entry.freq}</span>
                  </th>
                  <td className="hidden px-4 py-2 text-ink-2 sm:table-cell">{FREQUENCY[entry.freq] ?? entry.freq}</td>
                  <td className="num px-4 py-2 text-ink-2">
                    {reason !== undefined ? (
                      // Withheld is visible: named, with the reason, and no values (PLAN section 3).
                      <span>
                        <span className="font-medium text-ink">Withheld</span>: {reason}
                      </span>
                    ) : first && last ? (
                      <span className="whitespace-nowrap">
                        {first} to {last}
                      </span>
                    ) : (
                      "No periods"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
