import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Panel } from "@/components/Panel";
import { apiDocsView } from "@/lib/api/docs";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { glossaryHref } from "@/lib/glossary";
import { releaseForRequest } from "@/lib/release/server";

export const metadata: Metadata = { title: "Read API" };

const link = "press hover-ink inline-block min-h-6 leading-6 text-accent underline underline-offset-2";
const prose = "flex max-w-[72ch] flex-col gap-3 text-sm text-ink";
const code = "font-mono text-[0.8125rem]";

function Rows({ head, rows, mono = true }: { head: [string, string]; rows: [ReactNode, ReactNode][]; mono?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table max-w-[96ch]">
        <thead>
          <tr>
            <th scope="col">{head[0]}</th>
            <th scope="col">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, text], i) => (
            <tr key={i}>
              <th scope="row" className={`whitespace-nowrap align-top ${mono ? code : ""}`}>
                {name}
              </th>
              <td className="text-ink-2">{text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The read API, for a person or a program that wants the data without the pages (PLAN M24).
 * A reading page: no script and no motion. Everything it states about routes, lists and limits
 * is read from the tables the API itself answers from (`lib/api/docs.ts`); the contract for the
 * repository is `docs/method/api.md`. Its Markdown twin arrives with the other pages' (M25).
 */
export default async function ApiDocsPage() {
  const { release, address } = await releaseForRequest();
  const view = apiDocsView(release, SURFACE, address);
  return (
    <div className="flex flex-col gap-6">
      <Panel id="api" title="Read API" level={1}>
        <div className={prose}>
          <p>
            Everything Macro Atlas shows can be read by a program. The API is read-only, needs no key, and answers in JSON from the release this
            site is serving. It lives at <code className={`${code} [overflow-wrap:anywhere]`}>{view.root}</code>.
          </p>
          <p>
            A page&rsquo;s address is also the address of its data: add <code className={code}>.csv</code>, <code className={code}>.json</code> or{" "}
            <code className={code}>.md</code> to a series page and the same values come back as a file. The API gives the same answers, and adds the
            catalog, the history of each value, the events and the claims.
          </p>
        </div>
      </Panel>

      <Panel id="routes" title="Routes">
        <div className="overflow-x-auto">
          <table className="data-table" data-api-routes>
            <thead>
              <tr>
                <th scope="col">Route</th>
                <th scope="col">What it gives</th>
                <th scope="col">Parameters</th>
              </tr>
            </thead>
            <tbody>
              {view.routes.map((route) => (
                <tr key={route.path}>
                  <th scope="row" className={`align-top ${code}`}>
                    <a href={route.example} className={link} data-api-route={route.path}>
                      {route.path}
                    </a>
                  </th>
                  <td className="min-w-[24ch] text-ink-2">{route.about}</td>
                  <td className={`align-top text-ink-2 ${route.parameters === "None" ? "" : code}`}>{route.parameters}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={`${prose} mt-3`}>
          <p>
            Each route is a link to a real answer{view.example ? <> for {view.example.name}</> : null}. A series key is the last part of a series
            page&rsquo;s address; every key is in the catalog.
            {view.example && !view.example.given ? " On this build no series may be handed out yet, so the series routes answer 403 with the reason." : null}
          </p>
          <p>
            <code className={code}>GET</code> only. A key that was renamed answers 308 to its permanent address.
          </p>
        </div>
      </Panel>

      <Panel id="parameters" title="Parameters">
        <div className={prose}>
          <p>
            A series takes the same parameters as its page and its files, and they mean the same. The order of work is fixed: find what was known
            as of the date, bring it to the frequency asked for, then apply the transform. The window is applied last.
          </p>
        </div>
        <div className="mt-3 flex flex-col gap-4">
          <Rows head={["On series/{key}", "Means"]} rows={view.seriesParameters} />
          <Rows head={["Elsewhere", "Means"]} rows={view.otherParameters} />
        </div>
        <div className={`${prose} mt-3`}>
          <p>
            A parameter a route does not take is refused, and so is one given twice. An answer to a question nobody asked is never given in its
            place.
          </p>
        </div>
      </Panel>

      <Panel id="fields" title="What every answer carries">
        <div className={prose}>
          <p>Every JSON body, a refusal included, carries the first four of these. An answer about the past carries the last three as well.</p>
        </div>
        <div className="mt-3">
          <Rows head={["Field", "What it says"]} rows={view.fields} />
        </div>
        <div className={`${prose} mt-3`}>
          <p>
            The words{" "}
            <a href={glossaryHref(BASE_PATH, "basis")} className={link}>
              basis
            </a>
            , origin, channel and release are in the{" "}
            <a href={glossaryHref(BASE_PATH)} className={link}>
              glossary
            </a>
            .
          </p>
        </div>
      </Panel>

      <Panel id="errors" title="Refusals">
        <div className={prose}>
          <p>
            A refusal is JSON with an <code className={code}>error</code>: its status, a code, a sentence, and where it helps, what may be asked
            instead.
          </p>
          <p>
            One case is not JSON. When there is no release this site may serve, every address answers 503 with a line of text, the API included:
            there is then no release to name.
          </p>
        </div>
        <div className="mt-3">
          <Rows head={["Status", "When"]} rows={view.errors} />
        </div>
      </Panel>

      <Panel id="limits" title="Limits and caching">
        <Rows head={["Limit", "How much"]} rows={view.limits} mono={false} />
        <div className={`${prose} mt-3`}>
          <p>
            Answers on the public site may be kept by a cache for five minutes and carry an <code className={code}>ETag</code>; send it back in{" "}
            <code className={code}>If-None-Match</code> and an unchanged answer costs nothing to fetch. A refusal and the status route are never
            kept. For the whole dataset at once, use the bulk files when they are published, not the API.
          </p>
        </div>
      </Panel>

      <Panel id="examples" title="Examples">
        <pre data-api-examples tabIndex={0} className="overflow-x-auto rounded border border-line bg-raised p-2 font-mono text-xs leading-relaxed text-ink">
          <code>{view.curl.join("\n")}</code>
        </pre>
      </Panel>
    </div>
  );
}
