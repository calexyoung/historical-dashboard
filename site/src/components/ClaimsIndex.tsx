import { Panel } from "@/components/Panel";
import { CLAIM_FACETS, type ClaimFacet, type ClaimsIndexView } from "@/lib/claims";

const FACET_LABEL: Record<ClaimFacet, { label: string; all: string }> = {
  person: { label: "Person", all: "Everyone" },
  party: { label: "Party", all: "Any party" },
  topic: { label: "Topic", all: "Any topic" },
};
const control = "press hover-control h-9 min-w-0 rounded border border-control bg-raised px-2 text-sm text-ink";
const link = "press hover-ink text-accent underline underline-offset-2";

/**
 * The Claims index as markup (PLAN section 3, M21): a pure function of its view, so a test can
 * read every word of it. No script. Nothing here says what any Claim's figures show.
 */
export function ClaimsIndex({ view, basePath }: { view: ClaimsIndexView; basePath: string }) {
  const here = `${basePath}/claims`;
  const count = view.active ? `${view.shown} of ${view.total} claims` : `${view.total} ${view.total === 1 ? "claim" : "claims"}`;

  return (
    <div className="flex flex-col gap-6">
      <Panel id="claims" title="Claims" level={1}>
        <p className="max-w-[68ch] text-ink-2">
          Public statements set beside the figures: what was said, by whom, when and where it can be checked, and what the data showed then and
          shows now. What the figures say about a statement is left to the reader.{" "}
          <a href={`${basePath}/docs/method/claims`} className={link}>
            How a claim record is built
          </a>
          .
        </p>
        {view.total > 0 && (
          <form method="get" action={here} role="search" aria-label="Claims" className="mt-4 flex flex-wrap items-end gap-2">
            {CLAIM_FACETS.map((name) => (
              <span key={name} className="contents">
                <label className="sr-only" htmlFor={`claims-${name}`}>
                  {FACET_LABEL[name].label}
                </label>
                <select id={`claims-${name}`} name={name} defaultValue={view.filters[name] ?? ""} className={`${control} w-[calc(50%-0.25rem)] sm:w-auto`}>
                  <option value="">{FACET_LABEL[name].all}</option>
                  {view.options[name].map((option) => (
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
            {view.active && (
              <a href={here} className={`${link} inline-flex h-9 items-center px-1 text-sm`}>
                Clear
              </a>
            )}
          </form>
        )}
        {view.note && <p className="mt-3 text-sm text-ink-2">{view.note}</p>}
        {view.total > 0 && (
          <p data-by-party className="mt-3 max-w-[84ch] text-sm leading-6 text-ink-2">
            <span className="font-medium text-ink">Recorded, by party:</span>{" "}
            {view.byParty.map((row, i) => (
              <span key={row.party}>
                {i > 0 && " · "}
                <a href={`${here}?${row.query}`} className={`${link} inline-block min-h-6`}>
                  {row.party}
                </a>{" "}
                <span className="num text-ink">{row.count}</span>
              </span>
            ))}
          </p>
        )}
        {view.drafts > 0 && (
          <p className="mt-2 max-w-[68ch] text-sm text-ink-2">
            <span className="font-medium text-ink">{view.drafts === 1 ? "1 draft" : `${view.drafts} drafts`}.</span> A draft is a record that has not been
            published. Drafts are in local releases only.
          </p>
        )}
      </Panel>

      {view.total === 0 ? (
        <Panel id="list" title="All claims">
          <p className="max-w-[68ch] text-ink-2">
            This release holds no claims. One is recorded with <code className="font-mono text-ink">python -m atlas add claim</code>; the steps are in{" "}
            <a href={`${basePath}/docs/method/claims`} className={link}>
              how a claim record is built
            </a>
            .
          </p>
        </Panel>
      ) : (
        <Panel id="list" title={view.active ? "Claims shown" : "All claims"} meta={<span className="num">{count}</span>} bodyClassName="p-0">
          <ul>
            {view.rows.map((row) => (
              <li key={row.id} data-claim={row.id} className="border-b border-line px-4 py-3 text-sm last:border-b-0">
                <p className="text-ink-2">
                  <span className="num">{row.when}</span> · <span className="font-medium text-ink">{row.name}</span>, {row.role} · {row.party}
                  {row.draft && <span className="ml-2 rounded border border-control px-1.5 py-0.5 text-xs text-ink-2">Draft</span>}
                </p>
                <p className="mt-1 max-w-[76ch]">
                  <a href={`${basePath}${row.href}`} className={`${link} inline-block min-h-6 leading-6`}>
                    {row.quote}
                  </a>
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {row.readings === 1 ? "1 reading" : `${row.readings} readings`}
                  {row.topics.length > 0 && ` · ${row.topics.join(", ")}`}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {view.total > 0 && (
        <Panel id="corrections" title="Correction log" meta="Every change to a claim record after it was first kept, newest first.">
          {view.corrections.length > 0 ? (
            <ul className="flex max-w-[84ch] flex-col text-sm">
              {view.corrections.map((c, i) => (
                <li key={i} data-correction className="flex flex-col gap-x-3 border-b border-line py-1.5 last:border-b-0 sm:flex-row">
                  <span className="num w-28 shrink-0 text-ink-2">{c.when}</span>
                  <span className="min-w-0 text-ink">
                    <a href={`${basePath}${c.href}`} className={`${link} inline-block min-h-6 leading-6`}>
                      {c.who}
                    </a>
                    : {c.reason}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">No correction has been made.</p>
          )}
        </Panel>
      )}
    </div>
  );
}
