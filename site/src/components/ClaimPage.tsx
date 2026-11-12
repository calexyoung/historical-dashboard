import type { ReactNode } from "react";
import { BasisMark } from "@/components/BasisMark";
import { Panel } from "@/components/Panel";
import { StateMark } from "@/components/StateMark";
import { Svg } from "@/components/Svg";
import type { Cell, ClaimPageView, ColumnInfo, FigureRow, ReadingView } from "@/lib/claims";

// A link in running text is at least 24px tall, so it can be pressed on a phone (PLAN section 8).
const link = "press hover-ink inline-block min-h-6 leading-6 text-accent underline underline-offset-2";
const term = "w-28 shrink-0 text-ink-3";

/** One figure in one state: the number with its Period and Data state, or why there is none. */
function Figure({ cell, state, basePath }: { cell: Cell; state: "then" | "now" | "latest"; basePath: string }) {
  if (cell.kind === "none") {
    return (
      <td className="n" data-cell={state}>
        <i>No figure</i>
      </td>
    );
  }
  if (cell.kind === "empty") {
    return (
      <td className="n" data-cell={state}>
        <i className="whitespace-normal">{cell.why}</i>
      </td>
    );
  }
  return (
    <td className="n" data-cell={state}>
      <data value={cell.exact} className="font-semibold text-ink">
        {cell.text}
      </data>
      {(cell.period || cell.state) && (
        <>
          {cell.period && <small>{cell.period}</small>}
          {cell.state && (
            <small>
              <StateMark mark={cell.state.mark} word={cell.state.word} basePath={basePath} link={false} />
            </small>
          )}
        </>
      )}
    </td>
  );
}

function Head({ first, then }: { first: ReactNode; then: ColumnInfo }) {
  return (
    <thead>
      <tr>
        {first}
        <th scope="col" className="n">
          Then
          {!then.answered && <span className="sr-only"> (no answer)</span>}
        </th>
        <th scope="col" className="n">
          Now when checked
        </th>
        <th scope="col" className="n">
          Latest
        </th>
      </tr>
    </thead>
  );
}

const Cells = ({ row, basePath }: { row: FigureRow; basePath: string }) => (
  <>
    <Figure cell={row.then} state="then" basePath={basePath} />
    <Figure cell={row.now} state="now" basePath={basePath} />
    <Figure cell={row.latest} state="latest" basePath={basePath} />
  </>
);

/** Where one state's figures come from, in sentences; then's carries its Basis as a mark and a word. */
function Origin({ name, label, info, basePath }: { name: "then" | "now" | "latest"; label: string; info: ColumnInfo; basePath: string }) {
  return (
    <div data-origin={name} className="flex flex-col gap-x-3 border-b border-line py-1.5 last:border-b-0 sm:flex-row">
      <dt className="w-40 shrink-0 font-medium text-ink">{label}</dt>
      <dd className="min-w-0 text-ink-2">
        {info.basis && (
          <>
            <BasisMark basis={info.basis} basePath={basePath} />{" "}
          </>
        )}
        {info.lines.join(" ")}
      </dd>
    </div>
  );
}

function Reading({ reading, basePath }: { reading: ReadingView; basePath: string }) {
  const { evidence } = reading;
  return (
    <Panel id={`reading-${reading.id}`} title={`Reading ${reading.n}`} bodyClassName="p-4">
      <p className="max-w-[68ch] text-ink">
        {reading.series.href ? (
          <a href={`${basePath}${reading.series.href}`} className={link}>
            {reading.series.name}
          </a>
        ) : (
          <span className="font-mono">{reading.series.name}</span>
        )}
        {!reading.series.href && <span className="text-ink-2"> (not in this release)</span>}
        {". "}
        {reading.what}
        {reading.unit && <span className="text-ink-2"> Unit: {reading.unit}.</span>}
      </p>
      {evidence && (
        <>
          <div role="group" aria-label={`Figures of reading ${reading.n}`} tabIndex={0} className="mt-3 overflow-x-auto">
            <table className="data-table evidence w-auto" data-evidence={reading.id}>
              <caption className="sr-only">
                Reading {reading.n}: each figure as it was known then, as it stood when the claim was checked, and as it is in this release.
              </caption>
              <Head first={<th scope="col">Figure</th>} then={evidence.then} />
              <tbody>
                {evidence.rows.map((row) => (
                  <tr key={row.name} data-figure={row.name}>
                    <th scope="row">{row.label}</th>
                    <Cells row={row} basePath={basePath} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="mt-3 max-w-[84ch] text-sm">
            <Origin name="then" label="Then" info={evidence.then} basePath={basePath} />
            <Origin name="now" label="Now when checked" info={evidence.now} basePath={basePath} />
            <Origin name="latest" label="Latest" info={evidence.latest} basePath={basePath} />
          </dl>
          {evidence.drawing && (
            <figure className="mt-4 max-w-[320px] text-ink" data-reading-figure={reading.id}>
              <Svg node={evidence.drawing.svg} className="block h-auto w-full" />
              <figcaption className="mt-1 text-xs text-ink-2">{evidence.drawing.caption}</figcaption>
            </figure>
          )}
          {evidence.windows.length > 0 && (
            <div className="mt-5">
              <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-ink-2">Window sensitivity</h3>
              <p className="mt-1 max-w-[68ch] text-sm text-ink-2">The same measure over each window the record declares. Then and now when checked are the lock&rsquo;s; latest is this release&rsquo;s.</p>
              <div role="group" aria-label={`Window sensitivity of reading ${reading.n}`} tabIndex={0} className="mt-2 overflow-x-auto">
                <table className="data-table evidence w-auto" data-sensitivity={reading.id}>
                  <Head first={<th scope="col">Window and figure</th>} then={evidence.then} />
                  {evidence.windows.map((window) => (
                    <tbody key={window.words} data-window={window.words}>
                      <tr>
                        <th scope="rowgroup" colSpan={4} className="bg-raised">
                          <span className="pl-2">{window.words}</span>
                          <small className="pl-2">{window.declared ? "The reading's own window" : "Alternative window"}</small>
                        </th>
                      </tr>
                      {window.rows.map((row) => (
                        <tr key={row.name} data-figure={row.name}>
                          <th scope="row" className="font-normal text-ink-2">
                            {row.label}
                          </th>
                          <Cells row={row} basePath={basePath} />
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
            </div>
          )}
        </>
      )}
      {reading.explorer && (
        <p className="mt-4 flex flex-wrap gap-x-4 text-sm">
          <a href={`${basePath}/explore?${reading.explorer.today}`} className={link}>
            Open the series in Explorer →
          </a>
          <a href={`${basePath}/explore?${reading.explorer.then}`} className={link}>
            As known before the statement →
          </a>
        </p>
      )}
    </Panel>
  );
}

/**
 * One Claim of the Release this request was fixed to (PLAN section 3, M21). A reading page:
 * complete in the HTML, no script. It states who said what, when and where that can be checked,
 * and the figures each Reading returned then, when the Claim was checked, and in this Release.
 * It gives no finding, rating or label, in words, marks or colour: the judgment is the reader's.
 */
export function ClaimPage({ view, basePath }: { view: ClaimPageView; basePath: string }) {
  const { lock } = view;
  return (
    <div className="flex flex-col gap-6">
      <Panel id="claim" title="Claim" level={2} bodyClassName="p-4">
        <blockquote data-quote className="max-w-[60ch] border-l-2 border-ink pl-3 text-lg font-medium leading-snug text-ink">
          {view.quote.map((paragraph, i) => (
            <p key={i} className={i > 0 ? "mt-2" : undefined}>
              {paragraph}
            </p>
          ))}
        </blockquote>
        <h1 className="mt-3 text-sm font-semibold leading-6 text-ink">
          {view.claimant.name}, {view.when}
        </h1>
        <p className="max-w-[68ch] text-sm leading-6 text-ink-2">
          {view.claimant.role} · {view.claimant.party} · {view.venue}
          {view.at && ` · ${view.at}`}
        </p>
        <p data-sources-line className="mt-1 max-w-[68ch] text-sm leading-6 text-ink-2">
          Sources:{" "}
          {view.sources.map((source, i) => (
            <span key={source.url}>
              {i > 0 && " · "}
              <a href={source.url} rel="noopener noreferrer" className={`${link} [overflow-wrap:anywhere]`}>
                {source.name}
              </a>{" "}
              (
              <a href={source.archive} rel="noopener noreferrer" className={`${link} whitespace-nowrap`}>
                archived<span className="sr-only"> copy of {source.name}</span>
              </a>
              )
            </span>
          ))}
        </p>
        {view.draft && (
          <p data-draft className="mt-2 max-w-[68ch] text-sm text-ink">
            <span className="rounded border border-control px-1.5 py-0.5 text-xs text-ink-2">Draft</span> This record has not been published. A draft is in local releases only.
          </p>
        )}
        {view.evidence.reason && (
          <p data-evidence-state={view.evidence.state} className="mt-2 max-w-[68ch] text-sm text-ink">
            {view.evidence.reason}
          </p>
        )}
      </Panel>

      {view.readings.length === 0 ? (
        <Panel id="readings" title="Readings">
          <p className="text-ink-2">The record declares no reading yet, so nothing is measured.</p>
        </Panel>
      ) : (
        view.readings.map((reading) => <Reading key={reading.id} reading={reading} basePath={basePath} />)
      )}

      <Panel id="not-measured" title="Readings not measured" meta="Other ways the words could be read that this record does not measure.">
        {view.notMeasured.length > 0 ? (
          <ul className="flex max-w-[68ch] list-disc flex-col gap-1 pl-5 text-sm text-ink">
            {view.notMeasured.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">The record lists none.</p>
        )}
        <h3 className="mt-4 text-xs font-bold uppercase tracking-[0.06em] text-ink-2">Why this statement was recorded</h3>
        <p className="mt-1 max-w-[68ch] text-sm text-ink">{view.selectionNote}</p>
      </Panel>

      <Panel id="sources" title="Sources" meta="Two or more records of the statement, each with an archived copy.">
        <ul className="flex max-w-[84ch] flex-col text-sm">
          {view.sources.map((source) => (
            <li key={source.url} data-source className="min-w-0 border-b border-line py-1.5 last:border-b-0">
              <a href={source.url} rel="noopener noreferrer" className={`${link} max-w-full [overflow-wrap:anywhere]`}>
                {source.name}
              </a>
              <span className="text-ink-2">
                {" "}
                · {source.kind} · {source.locator} ·{" "}
              </span>
              <a href={source.archive} rel="noopener noreferrer" className={`${link} whitespace-nowrap`}>
                archived copy<span className="sr-only"> of {source.name}</span>
              </a>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel id="corrections" title="Correction log" meta="Every change to this record after it was first kept, with the reason.">
        {view.corrections.length > 0 ? (
          <ul className="flex max-w-[84ch] flex-col text-sm">
            {view.corrections.map((c, i) => (
              <li key={i} data-correction className="flex flex-col gap-x-3 border-b border-line py-1.5 last:border-b-0 sm:flex-row">
                <span className="num w-40 shrink-0 text-ink-2">{c.when}</span>
                <span className="text-ink">{c.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">No correction has been made.</p>
        )}
        {lock && (
          <>
            <h3 className="mt-4 text-xs font-bold uppercase tracking-[0.06em] text-ink-2">Lock</h3>
            <dl data-lock className="mt-1 flex flex-col gap-1 text-sm">
              <div className="flex gap-3 leading-6">
                <dt className={term}>Version</dt>
                <dd className="num text-ink">
                  {lock.version}, locked {lock.lockedAt}
                </dd>
              </div>
              <div className="flex gap-3 leading-6">
                <dt className={term}>Checked on</dt>
                <dd className="num text-ink">{view.checkedOn}</dd>
              </div>
              {lock.release && (
                <div className="flex gap-3 leading-6">
                  <dt className={term}>Computed on</dt>
                  <dd className="min-w-0 text-ink">
                    Release <span className="num [overflow-wrap:anywhere]">{lock.release}</span>, made {lock.releaseCreated} ({lock.profile} profile), engine semantics {lock.semantics}
                  </dd>
                </div>
              )}
              {lock.fileSha256 && (
                <div className="flex gap-3 leading-6">
                  <dt className={term}>File SHA-256</dt>
                  <dd className="min-w-0 font-mono text-xs leading-6 text-ink [overflow-wrap:anywhere]">{lock.fileSha256}</dd>
                </div>
              )}
              <div className="flex gap-3 leading-6">
                <dt className={term}>Record SHA-256</dt>
                <dd className="min-w-0 font-mono text-xs leading-6 text-ink [overflow-wrap:anywhere]">{lock.recordSha256}</dd>
              </div>
            </dl>
            {lock.history.length > 1 && (
              <ul className="mt-2 flex max-w-[84ch] flex-col text-sm">
                {lock.history.map((entry) => (
                  <li key={entry.version} data-lock-version={entry.version} className="border-b border-line py-1.5 text-ink-2 last:border-b-0">
                    <span className="num text-ink">Version {entry.version}</span> · {entry.lockedAt} · {entry.state}
                    {entry.reason && <> · Recorded afresh: {entry.reason}</>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>

      <Panel id="downloads" title="Evidence downloads" meta={`From release ${view.release.id}, made ${view.release.created}.`}>
        {!view.downloads.permitted && (
          <p data-downloads-refused className="mb-1 max-w-[68ch] text-sm text-ink-2">
            {view.downloads.reason}
          </p>
        )}
        {view.downloads.files.length > 0 && (
          <ul data-downloads className="flex max-w-[84ch] flex-col text-sm">
            {view.downloads.files.map((file) => (
              <li key={file.href} className="border-b border-line py-1 last:border-b-0">
                <a href={`${basePath}${file.href}`} className={link}>
                  {file.label}
                </a>
                <span className="text-ink-2"> · {file.note}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {view.notes.length > 0 && (
        <Panel id="notes" title="Notes" meta="Kept by a user of this local build. Not Macro Atlas's, and in no release, file or download.">
          <ul className="flex max-w-[68ch] flex-col gap-3 text-sm">
            {view.notes.map((note, i) => (
              <li key={i} data-note-by={note.user} className="border-l-2 border-control pl-3">
                <p className="text-xs font-semibold text-ink-2">
                  Note by {note.user} · {note.created} · {note.user}&rsquo;s own, not Macro Atlas&rsquo;s
                </p>
                {note.paragraphs.map((paragraph, j) => (
                  <p key={j} className="mt-1 whitespace-pre-line text-ink">
                    {paragraph}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <p className="flex flex-wrap gap-x-4 px-4 text-sm">
        <a href={`${basePath}/claims`} className={link}>
          ← All claims
        </a>
        <a href={`${basePath}/claims?${view.claimant.personQuery}`} className={link}>
          Claims by {view.claimant.name}
        </a>
        <a href={`${basePath}${view.methodHref}`} className={link}>
          How a claim record is built
        </a>
      </p>
    </div>
  );
}
