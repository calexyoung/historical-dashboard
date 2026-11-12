import type { Metadata } from "next";
import { Panel } from "@/components/Panel";
import { BASE_PATH } from "@/lib/config";
import { methodIndex } from "@/lib/method-docs";

export const metadata: Metadata = { title: "Method" };

const link = "press hover-ink inline-flex min-h-6 items-center text-accent underline underline-offset-2";

/**
 * `/docs/method` (PLAN section 3, M25): the pages that say how the figures are made. A reading
 * page with no data in it. The first group is written for a reader of the site; the second is
 * the repository's own method documents, as they are, because the code is tested from them.
 */
export default function MethodIndexPage() {
  const entries = methodIndex();
  const groups = [
    { id: "for-readers", title: "For a reader", rows: entries.filter((e) => e.kind === "reader") },
    { id: "contracts", title: "The contracts", rows: entries.filter((e) => e.kind === "contract") },
  ];
  return (
    <div className="flex flex-col gap-6">
      <Panel id="method" title="Method" level={1}>
        <p className="max-w-[68ch] text-ink-2">
          How Macro Atlas makes its figures: where a number comes from, what was known when, how a series is re-expressed, what a release holds and
          what leaves the site as a file. The contracts are the repository&rsquo;s own documents. The code is tested from them, and they carry the
          commands that run it. Each page is also a file: add <code className="font-mono">.md</code> to its address.
        </p>
      </Panel>
      {groups.map((group) => (
        <Panel key={group.id} id={group.id} title={group.title}>
          <ul className="flex flex-col gap-3">
            {group.rows.map((entry) => (
              <li key={entry.slug} className="max-w-[76ch]">
                <a href={`${BASE_PATH}${entry.href}`} className={`${link} font-medium`}>
                  {entry.title}
                </a>
                <p className="text-sm text-ink-2">{entry.summary}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
