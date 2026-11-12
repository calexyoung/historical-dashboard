import { Panel } from "@/components/Panel";
import type { DownloadRow, DownloadsView } from "@/lib/downloads";

const link = "press hover-ink text-accent underline underline-offset-2";
const door = `${link} inline-flex min-h-6 items-center`;

function Files({ rows, basePath, label }: { rows: DownloadRow[]; basePath: string; label: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">File</th>
            <th scope="col">Format</th>
            <th scope="col" className="text-right">
              Rows
            </th>
            <th scope="col" className="text-right">
              Series
            </th>
            <th scope="col" className="text-right">
              Size
            </th>
            <th scope="col">SHA-256</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((file) => (
            <tr key={file.name} data-file={file.name}>
              <th scope="row" className="whitespace-nowrap font-normal">
                {file.refused ? (
                  <span className="text-ink-2">{file.name}</span>
                ) : (
                  <a href={`${basePath}${file.href}`} className={`${door} font-mono text-[13px]`} download>
                    {file.name}
                  </a>
                )}
                {file.refused && <span className="block max-w-[44ch] whitespace-normal text-xs text-ink-3">{file.refused}.</span>}
              </th>
              <td className="whitespace-nowrap text-ink-2">{file.format}</td>
              <td className="num text-right">{file.rows.toLocaleString("en-US")}</td>
              <td className="num text-right">{file.series.toLocaleString("en-US")}</td>
              <td className="num whitespace-nowrap text-right">{file.size}</td>
              <td className="num font-mono text-xs text-ink-3">
                <span className="block max-w-[18ch] truncate sm:max-w-none" title={file.sha256}>
                  {file.sha256}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Named({ rows, basePath }: { rows: { key: string; name: string; reason: string }[]; basePath: string }) {
  return (
    <ul className="flex max-w-[84ch] flex-col gap-1.5 text-sm">
      {rows.map((row) => (
        <li key={row.key}>
          <a href={`${basePath}/data/${row.key}`} className={door}>
            {row.name}
          </a>
          <span className="text-ink-2">: {row.reason.replace(/[.]$/, "")}.</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * `/downloads` (PLAN sections 3 and 7, M25): the bulk files of one Release. A reading page with
 * no value of any Series on it: names, counts, sizes and hashes. A file the gate would refuse
 * today is listed without a link and with the reason, and what is in no file is named.
 */
export function DownloadsPage({ view, basePath, address, current }: { view: DownloadsView; basePath: string; /** The site's address, for the snippets. */ address: string; /** Whether this is the Release being served as current. */ current: boolean }) {
  const at = (file: string): string => `${address}/downloads/${current ? "latest" : view.release}/${file}`;
  return (
    <div className="flex flex-col gap-6">
      <Panel id="downloads" title="Bulk files" level={1} meta={<span className="num">Release {view.release}</span>}>
        {view.none ? (
          <div className="flex max-w-[68ch] flex-col gap-3 text-ink-2">
            <p data-no-bulk>{view.none}</p>
            <p>
              Each series&rsquo; own values are at its page&rsquo;s address with <code className="font-mono">.csv</code>, <code className="font-mono">.json</code> or{" "}
              <code className="font-mono">.md</code> added, where they may be handed out.{" "}
              <a href={`${basePath}/data`} className={door}>
                Open the catalog
              </a>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="max-w-[72ch] text-ink-2">
              Every series of this release that may be redistributed, at its native frequency and not rounded:{" "}
              <span className="num text-ink">{view.counts.observations.toLocaleString("en-US")}</span> observations of{" "}
              <span className="num text-ink">{view.counts.series.toLocaleString("en-US")}</span> series as one long table in three formats, and{" "}
              <span className="num text-ink">{view.counts.versions.toLocaleString("en-US")}</span> versions held of{" "}
              <span className="num text-ink">{view.counts.withHistory.toLocaleString("en-US")}</span> of them. The three formats hold the same rows.
            </p>
            <Files rows={view.whole} basePath={basePath} label="The whole tables" />
            <p className="max-w-[72ch] text-sm text-ink-2">
              <a href={`${basePath}${view.datapackage}`} className={`${door} font-mono text-[13px]`}>
                datapackage.json
              </a>{" "}
              names every file with its size, its SHA-256, its columns and its licence (Frictionless Data Package v2). A release&rsquo;s files never
              change. The newest release&rsquo;s are always at <code className="font-mono">{`${basePath}/downloads/latest/{file}`}</code>.
            </p>
          </div>
        )}
      </Panel>

      {view.byLicence.map((group) => (
        <Panel key={group.licence} id={`licence-${group.licence.replace(/_/g, "-")}`} title={`By licence: ${group.label}`}>
          <div className="flex flex-col gap-3">
            <ul className="max-w-[72ch] text-sm text-ink-2">
              {group.attributions.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {group.terms.map((url) => (
                <li key={url}>
                  Terms:{" "}
                  <a href={url} className={door} rel="noreferrer">
                    {url.replace(/^https:\/\//, "")}
                  </a>
                </li>
              ))}
            </ul>
            <Files rows={group.rows} basePath={basePath} label={`Files for ${group.label}`} />
          </div>
        </Panel>
      ))}

      {view.whole.some((file) => file.refused === null) && (
        <Panel id="load" title="Load them">
          <pre tabIndex={0} aria-label="How to load the files" role="region" className="overflow-x-auto text-[13px] leading-relaxed text-ink">
            <code className="font-mono">{`# pandas
import pandas as pd
observations = pd.read_parquet("${at("observations.parquet")}")

# polars
import polars as pl
observations = pl.read_parquet("${at("observations.parquet")}")

# DuckDB
SELECT key, period, value FROM read_parquet('${at("observations.parquet")}');
SELECT * FROM read_csv('${at("observations.csv.gz")}');`}</code>
          </pre>
        </Panel>
      )}

      {view.leftOut.length > 0 && (
        <Panel id="left-out" title="Published, and in no bulk file">
          <p className="mb-3 max-w-[68ch] text-sm text-ink-2">These series are shown on their pages. Their values may not be handed out as files, so no bulk file holds them.</p>
          <Named rows={view.leftOut} basePath={basePath} />
        </Panel>
      )}
      {view.withheld.length > 0 && (
        <Panel id="withheld" title="Withheld">
          <p className="mb-3 max-w-[68ch] text-sm text-ink-2">Named in the catalog with the reason. No value of them is in this release or in any file.</p>
          <Named rows={view.withheld} basePath={basePath} />
        </Panel>
      )}
    </div>
  );
}
