/**
 * schema.org `Dataset` for a series page (PLAN section 7, M25): what a search engine or a
 * program reads to know what the page is about. It is made from the metadata twin's record
 * (`seriesRecord`), a fixed selection of the Catalog entry, so it holds no value, and says how
 * far the Series runs only where the Series may be shown. A file is listed as a distribution
 * only where it would be given: a Series that may not be handed out, or is too long for one
 * answer (its default twin would answer 422), lists its metadata alone.
 */
import type { RightsGate, Surface } from "@macro-atlas/core";
import type { OpenedRelease } from "./release/reader";
import { fitsOneAnswer } from "./query";
import { seriesRecord } from "./twin";

const FREQUENCY: Record<string, string> = { daily: "P1D", business_daily: "P1D", weekly: "P1W", monthly: "P1M", quarterly: "P3M", annual: "P1Y" };

export function datasetJsonLd(release: OpenedRelease, surface: Surface, key: string, options: { address: string; gate?: Pick<RightsGate, "permits"> }): Record<string, unknown> | null {
  const entry = release.catalog.series.find((e) => e.key === key);
  if (!entry) return null;
  const record = seriesRecord(release, surface, entry, { gate: options.gate, history: false });
  const page = `${options.address}/data/${entry.key}`;
  const file = record.state === "shown" ? (release.series[entry.key] ?? release.derived[entry.key]) : undefined;
  const distribution = [
    ...(record.downloads.permitted && fitsOneAnswer(release, entry.key)
      ? [
          { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${page}.csv` },
          { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${page}.json` },
          { "@type": "DataDownload", encodingFormat: "text/markdown", contentUrl: `${page}.md` },
        ]
      : []),
    { "@type": "DataDownload", name: "Metadata", encodingFormat: "application/json", contentUrl: `${page}.metadata.json` },
  ];
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: entry.name,
    ...(entry.description ? { description: entry.description } : { description: `${entry.name}, ${entry.unit}.` }),
    identifier: entry.key,
    url: page,
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: record.source.origin.producer },
    ...(record.rights.terms_url ? { license: record.rights.terms_url } : {}),
    ...(record.rights.attribution ? { creditText: record.rights.attribution } : {}),
    variableMeasured: { "@type": "PropertyValue", name: entry.name, unitText: entry.unit },
    ...(FREQUENCY[entry.freq] ? { repeatFrequency: FREQUENCY[entry.freq] } : {}),
    ...(file && file.observations.length > 0 ? { temporalCoverage: `${file.period_start}/${file.period_end}` } : {}),
    ...(entry.country ? { spatialCoverage: entry.country } : {}),
    dateModified: release.manifest.created,
    version: release.id,
    includedInDataCatalog: { "@type": "DataCatalog", name: "Macro Atlas", url: `${options.address}/data` },
    distribution,
  };
}

/** The document as the text of a `<script type="application/ld+json">`: nothing in it can close the element. */
export const jsonLdText = (doc: unknown): string => JSON.stringify(doc).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
