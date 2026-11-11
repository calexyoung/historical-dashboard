import type { ReactNode } from "react";
import { Figure } from "@/components/Figure";
import { Panel } from "@/components/Panel";
import { StateMark } from "@/components/StateMark";
import { glossaryHref } from "@/lib/glossary";
import type { Fact, SeriesPageView } from "@/lib/series-page";

const link = "press hover-ink text-accent underline underline-offset-2";

/** Label and value pairs. Side by side where there is room, stacked on a phone. */
function Facts({ facts, basePath }: { facts: Fact[]; basePath: string }) {
  return (
    <dl className="text-sm">
      {facts.map((fact) => (
        <div key={fact.label} className="grid grid-cols-1 gap-x-4 border-b border-line py-1.5 last:border-b-0 sm:grid-cols-[minmax(9rem,13rem)_1fr]">
          <dt className="text-xs text-ink-3 sm:text-sm">
            {fact.term ? (
              <a href={glossaryHref(basePath, fact.term)} className={`${link} inline-flex min-h-6 min-w-6 items-center`}>
                {fact.label}
              </a>
            ) : (
              fact.label
            )}
          </dt>
          <dd className="min-w-0 break-words text-ink">
            {fact.href ? (
              <a href={fact.href} rel="noreferrer noopener" className={`${link} break-all`}>
                {fact.value}
              </a>
            ) : (
              fact.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Group({ title, term, basePath, children }: { title: string; term?: string; basePath: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-2">
        {term ? (
          <a href={glossaryHref(basePath, term)} className={`${link} inline-flex min-h-6 min-w-6 items-center`}>
            {title}
          </a>
        ) : (
          title
        )}
      </h3>
      {children}
    </div>
  );
}

/**
 * One Series (PLAN section 3, `/data/{key}`): name and definition, the latest value with its
 * Period, the explained figure, provenance with Origin and Channel kept apart, and breaks and
 * notes. A reading page: everything is in the HTML and nothing needs script. A Series whose
 * values may not be shown has the same page with the reason in place of the values.
 */
export function SeriesPage({ view, basePath }: { view: SeriesPageView; basePath: string }) {
  const { latest, provenance } = view;
  return (
    <div className="flex flex-col gap-6" data-series-page={view.key} data-values={view.state}>
      <Panel
        id="series"
        title={view.name}
        level={1}
        meta={
          <>
            <a href={`${basePath}/data`} className={`${link} inline-flex min-h-6 min-w-6 items-center`}>
              Data
            </a>{" "}
            · <span className="num break-all font-mono">{view.key}</span>
          </>
        }
      >
        {view.description && <p className="max-w-[68ch] text-ink-2">{view.description}</p>}
        {latest && (
          <div data-latest className={view.description ? "mt-4" : ""}>
            <p className="text-xs text-ink-3">Latest value</p>
            <p className="num text-3xl font-semibold leading-tight text-ink">{latest.value}</p>
            <p className="mt-0.5 text-sm text-ink-2">
              {latest.unit} · <span className="num">{latest.period}</span>
              {latest.states.map((state) => (
                <span key={state.mark}>
                  {" "}
                  · <StateMark mark={state.mark} word={state.word} basePath={basePath} />
                </span>
              ))}
            </p>
            {latest.newerGap && <p className="mt-0.5 text-sm text-ink-2">{latest.newerGap}</p>}
          </div>
        )}
        {view.state !== "shown" && (
          <p data-held-back className={`max-w-[68ch] text-ink-2 ${view.description ? "mt-4" : ""}`}>
            <StateMark mark="withheld" word={view.state === "withheld" ? "Withheld" : "Not shown here"} basePath={basePath} />: {view.reason} This page
            holds no value of the series.
          </p>
        )}
      </Panel>

      {view.state === "shown" && (
        <Panel id="figure" title="Over time">
          <Figure figure={view.figure} basePath={basePath} explorerHref={`${basePath}${view.explorerPath}`} />
        </Panel>
      )}

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <Panel id="definition" title="Definition" meta="As the catalog records it. What is not recorded is said, not assumed.">
          <Facts facts={view.facts} basePath={basePath} />
        </Panel>

        <Panel id="provenance" title="Provenance" meta="Where the values come from and by what route.">
          <div className="flex flex-col gap-4">
            <Group title="Origin" term="origin" basePath={basePath}>
              <Facts facts={provenance.origin} basePath={basePath} />
            </Group>
            <Group title="Channel" term="channel" basePath={basePath}>
              <Facts facts={provenance.channel} basePath={basePath} />
            </Group>
            {provenance.lineage && (
              <Group title="Computed from" basePath={basePath}>
                <p className="text-sm text-ink-2">{provenance.lineage.text}</p>
                <ul className="mt-1 text-sm">
                  {provenance.lineage.inputs.map((input) => (
                    <li key={input.key}>
                      <a href={`${basePath}/data/${input.key}`} className={`${link} inline-flex min-h-6 min-w-6 items-center`}>
                        {input.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </Group>
            )}
            <Group title="Rights" term="rights" basePath={basePath}>
              <Facts facts={provenance.rights} basePath={basePath} />
            </Group>
            <Group title="Release" term="release" basePath={basePath}>
              <Facts facts={provenance.release} basePath={basePath} />
            </Group>
          </div>
        </Panel>
      </div>

      {view.notes.length > 0 && (
        <Panel id="notes" title="Breaks and notes">
          <ul className="flex max-w-[68ch] flex-col gap-1.5 text-sm">
            {view.notes.map((note, i) => (
              <li key={i}>
                {note.kind === "Break" ? <StateMark mark="break" word="Break" basePath={basePath} /> : <span className="font-medium text-ink">{note.kind}</span>}
                <span className="num text-ink-2"> · {note.period}</span>
                <span className="text-ink-2">: {note.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
