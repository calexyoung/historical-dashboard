import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BasisMark } from "@/components/BasisMark";
import { Panel } from "@/components/Panel";
import { BASE_PATH } from "@/lib/config";
import { glossaryHref } from "@/lib/glossary";

export const metadata: Metadata = { title: "How a claim record is built" };

const link = "press hover-ink inline-block min-h-6 leading-6 text-accent underline underline-offset-2";
const prose = "flex max-w-[72ch] flex-col gap-3 text-sm text-ink";

function Rows({ head, rows }: { head: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table max-w-[84ch]">
        <thead>
          <tr>
            <th scope="col">{head[0]}</th>
            <th scope="col">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, text], i) => (
            <tr key={i}>
              <th scope="row" className="whitespace-nowrap">
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
 * How a claim record is built (PLAN M21). A reading page with no data in it: the method, in the
 * site's own words, for a reader of a claim page. The contract for a person who records a Claim
 * is the repository's `docs/method/claims.md`; this page says the same things without the
 * commands. Its Markdown twin arrives with the other method pages (M25).
 */
export default function ClaimsMethodPage() {
  return (
    <div className="flex flex-col gap-6">
      <Panel id="method" title="How a claim record is built" level={1}>
        <div className={prose}>
          <p>
            A claim is a public statement by an official, a candidate or a named commentator that can be set beside data. Macro Atlas keeps the
            statement as a record and computes the figures needed to examine it. It gives no finding, rating or label: no file, page or download
            has a place for one. What the figures say about the statement is the reader&rsquo;s to decide.
          </p>
          <p>
            <a href={`${BASE_PATH}/claims`} className={link}>
              All claims
            </a>
          </p>
        </div>
      </Panel>

      <Panel id="record" title="The record">
        <div className={prose}>
          <p>Each claim is one file. It holds the statement and where it can be checked, and it says how the statement is measured.</p>
        </div>
        <div className="mt-3">
          <Rows
            head={["Part", "What it holds"]}
            rows={[
              ["Quote", "The words, verbatim."],
              ["Claimant", "Who said it, with the role and the party held on that day."],
              ["Day and venue", "The New York calendar day, the time when it is known, and where it was said."],
              ["Sources", "Two or more records of the statement at different addresses. Each has an archived copy, a locator (a time in a recording, a paragraph or a page) and says what kind of record it is: a recording, a transcript, the claimant's own publication or a report."],
              ["Readings", "Each way the words are measured. See below."],
              ["Readings not measured", "Other ways the words could be read that this record does not measure, a line each."],
              ["Selection note", "Why this statement was recorded."],
              ["Checked on", "The day the record was made and its figures computed."],
              ["Correction log", "Every change after the record was first kept, with its date and reason. It is always present, and empty when there is none."],
            ]}
          />
        </div>
      </Panel>

      <Panel id="readings" title="Readings and measures">
        <div className={prose}>
          <p>
            A reading turns the words into something that can be computed: one series, at one frequency, re-expressed one way (as it is, or for
            example as the percent change from a year earlier), with one measure. A statement may have several readings. A measure is one of five
            fixed computations. Each returns numbers, never true or false.
          </p>
        </div>
        <div className="mt-3">
          <Rows
            head={["Measure", "What it returns"]}
            rows={[
              ["Value at a period", "The value of the series in that period."],
              ["Change over a window", "The values in the first and the last period that start inside the window, the change between them, and the percent change."],
              ["Extreme in a window", "The highest or the lowest value in the window, the period it fell in, and how many periods had a value."],
              ["Rank in a window", "Where one period stands among the periods of the window, counted from the highest or from the lowest, and out of how many."],
              ["Difference", "The values in two named periods and the second less the first."],
            ]}
          />
        </div>
        <div className={`${prose} mt-3`}>
          <p>
            The periods are fixed by the calendar before any value is looked at. If one of them has no value, the figure is empty and says why; no
            other period stands in. Nothing is rounded in the computation. A page rounds for reading and its files carry the numbers as computed.
          </p>
        </div>
      </Panel>

      <Panel id="rows" title="Then, now when checked, latest">
        <div className={prose}>
          <p>Every reading is computed against three states of the data. They are shown side by side and never mixed.</p>
        </div>
        <div className="mt-3">
          <Rows
            head={["State", "What it is"]}
            rows={[
              ["Then", "What was public before the statement: before its time when the time is known, otherwise before 00:00 in New York on its day. A figure first published later that day does not count."],
              ["Now when checked", "The same periods on the day the claim was recorded, in the release it was computed against."],
              ["Latest", "The same periods in the release being served. It is computed afresh for each release and is not part of the lock."],
            ]}
          />
        </div>
        <div className={`${prose} mt-3`}>
          <p>
            The then figures carry a{" "}
            <a href={glossaryHref(BASE_PATH, "basis")} className={link}>
              basis
            </a>
            : the kind of evidence that the values were public by then. It is shown as a mark and a word, for example{" "}
            <BasisMark basis="atlas_observed" basePath={BASE_PATH} /> or <BasisMark basis="unavailable" basePath={BASE_PATH} />. When nothing says what was
            known then, the answer is unavailable and the cell is empty. A later figure is never put in its place.
          </p>
          <p>
            A figure that was preliminary, revised or an estimate when it was read carries that{" "}
            <a href={glossaryHref(BASE_PATH)} className={link}>
              data state
            </a>{" "}
            beside it.
          </p>
        </div>
      </Panel>

      <Panel id="windows" title="Window sensitivity">
        <div className={prose}>
          <p>
            A change, an extreme or a rank depends on the window it is taken over. The record declares the reading&rsquo;s own window and may declare
            alternatives. The same measure is computed over each, in all three states, and the results are shown together so a reader can see how
            much the choice of window matters. Every declared window is shown.
          </p>
        </div>
      </Panel>

      <Panel id="lock" title="The lock">
        <div className={prose}>
          <p>
            When a claim is recorded, its then and now-when-checked figures and their window sensitivity are frozen in a lock, with the release they
            were computed on, the version of the engine&rsquo;s rules, every origin and channel the numbers came through, and a hash of the record
            itself. A lock is never edited. If the record or the method changes, the claim is recorded afresh: a new version is added with the reason,
            and the earlier versions stay.
          </p>
          <p>
            A page shows the figures of the newest lock only. If that lock&rsquo;s numbers may not be shown, because a permission was withdrawn or the
            release does not carry them, the page says so and shows no numbers; an earlier lock does not stand in.
          </p>
          <p>
            Each release also recomputes the then row and compares it and the latest row with the lock. Differences are listed for the editor with
            no cause named. They change nothing on their own: only a person records a claim afresh.
          </p>
        </div>
      </Panel>

      <Panel id="files" title="Files">
        <div className={prose}>
          <p>
            A claim page&rsquo;s address is also the address of its data. Add <code className="font-mono">.json</code> or <code className="font-mono">.md</code>{" "}
            for the record and its figures, <code className="font-mono">/evidence.csv</code> for every figure a line each, and{" "}
            <code className="font-mono">/lock.json</code> for the lock exactly as it was written, so the hash the page lists can be checked. A file of
            figures is offered only where the rights of every series behind it allow redistribution.
          </p>
        </div>
      </Panel>

      <Panel id="notes" title="What is not here">
        <div className={prose}>
          <p>
            Macro Atlas does not say whether a statement is accurate. A user may keep notes of their own on a claim. Those are that user&rsquo;s, are
            marked with their name where they are shown, and are not part of any release, file or download.
          </p>
        </div>
      </Panel>
    </div>
  );
}
