import type { Metadata } from "next";
import { Panel } from "@/components/Panel";
import { BASE_PATH } from "@/lib/config";
import { GRANT_MEANINGS, rightsPageView, type RightsPageRow } from "@/lib/rights-page";

export const metadata: Metadata = { title: "Rights" };

const link = "press hover-ink text-accent underline underline-offset-2";

function Rows({ rows, label }: { rows: RightsPageRow[]; label: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Licence class</th>
            <th scope="col">Terms</th>
            <th scope="col">Proposed</th>
            <th scope="col">Decision</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-row={row.id} data-signed={row.signed ? "yes" : "no"}>
              <th scope="row" className="min-w-[16ch] max-w-[34ch] font-normal">
                <span className="font-medium text-ink">{row.name}</span>
                {row.attribution && <span className="block text-xs text-ink-3">{row.attribution}</span>}
              </th>
              <td className="whitespace-nowrap text-ink-2">{row.licence}</td>
              <td className="max-w-[34ch] text-xs text-ink-2">
                {row.terms.length === 0 && "None to read"}
                {row.terms.map((terms, i) => (
                  <span key={i} className="block break-words">
                    {terms.url ? (
                      <a href={terms.url} className={`${link} inline-block min-h-6 leading-6`} rel="noreferrer">
                        {terms.text}
                      </a>
                    ) : (
                      terms.text
                    )}{" "}
                    <span className="text-ink-3">({terms.read})</span>
                  </span>
                ))}
              </td>
              <td className="text-ink-2">{row.proposed}</td>
              <td className="max-w-[34ch]">
                <span className={row.signed ? "font-medium text-ink" : "text-ink-2"}>{row.decided}</span>
                {row.signed && <span className="num block text-xs text-ink-3">Signed {row.signed}</span>}
                <span className="block text-xs text-ink-3">{row.effect}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * `/docs/rights` (PLAN section 3, M25): the rights register as a page. A reading page with no
 * data in it. It states the register the gate reads; it grants nothing itself, and whether a
 * row is signed is said in words in every row, never by colour.
 */
export default function RightsPage() {
  const view = rightsPageView();
  return (
    <div className="flex flex-col gap-6">
      <Panel id="rights" title="Rights" level={1} meta={<span className="num">Register {view.version} · {view.signed} of {view.total} rows signed</span>}>
        <div className="flex max-w-[72ch] flex-col gap-3 text-ink-2">
          <p>
            Every series comes from an origin, and every origin has a row here: the terms that were read, the licence class, the attribution, what was
            proposed and what has been decided. On a public build a value is shown or handed out only where a signed row allows it. A row that is
            not decided allows nothing.
          </p>
          <p>
            A value that came through an intermediary channel needs that channel&rsquo;s row as well as its origin&rsquo;s, and the channel cleared by
            name. A series computed from others needs every one of them allowed. A series held back for rights is{" "}
            <a href={`${BASE_PATH}/docs/glossary/withheld`} className={`${link} inline-block min-h-6 leading-6`}>
              withheld
            </a>
            : named in the catalog with the reason, and no value of it anywhere.
          </p>
        </div>
      </Panel>

      <Panel id="permissions" title="What a decision allows">
        <dl className="grid max-w-[84ch] gap-x-6 gap-y-2 text-sm sm:grid-cols-[14rem_1fr]">
          {GRANT_MEANINGS.map(([name, text]) => (
            <div key={name} className="contents">
              <dt className="font-medium text-ink">{name}</dt>
              <dd className="text-ink-2">{text}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel id="origins" title="Origins" meta={<span className="num">{view.origins.length} rows</span>} bodyClassName="p-0 sm:p-4">
        <Rows rows={view.origins} label="Origins" />
      </Panel>
      <Panel id="channels" title="Intermediary channels" meta={<span className="num">{view.channels.length} rows · {view.cleared.length === 0 ? "none cleared" : `cleared: ${view.cleared.join(", ")}`}</span>} bodyClassName="p-0 sm:p-4">
        <Rows rows={view.channels} label="Intermediary channels" />
      </Panel>
    </div>
  );
}
