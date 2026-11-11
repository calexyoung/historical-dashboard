import type { Metadata } from "next";
import { Panel } from "@/components/Panel";
import { Svg } from "@/components/Svg";
import { BASE_PATH } from "@/lib/config";
import { markIcon } from "@/lib/figure";
import { GLOSSARY, GLOSSARY_GROUPS, glossaryHref } from "@/lib/glossary";

export const metadata: Metadata = { title: "Glossary" };

const link = "press hover-ink text-accent underline underline-offset-2";
const groupId = (group: string) => group.toLowerCase().replace(/[^a-z]+/g, "-");

/** Every word the pages use, defined once. The Data states come first, each with its mark. */
export default function GlossaryPage() {
  return (
    <div className="flex flex-col gap-6">
      <Panel id="glossary" title="Glossary" level={1}>
        <p className="max-w-[68ch] text-ink-2">
          The words Macro Atlas uses on its pages, each defined once. A data state is always shown as a mark and a word together, never by colour
          alone.
        </p>
      </Panel>
      {GLOSSARY_GROUPS.map((group) => (
        <Panel key={group} id={groupId(group)} title={group}>
          <dl className="max-w-[76ch] text-sm">
            {GLOSSARY.filter((entry) => entry.group === group).map((entry) => (
              <div key={entry.slug} id={entry.slug} data-term={entry.slug} className="border-b border-line py-2 last:border-b-0">
                <dt className="flex items-center gap-1.5 font-medium text-ink">
                  {entry.mark && <Svg node={markIcon(entry.mark)} className="shrink-0" />}
                  <a href={glossaryHref(BASE_PATH, entry.slug)} className={`${link} inline-flex min-h-6 min-w-6 items-center`}>
                    {entry.term}
                  </a>
                </dt>
                <dd className="mt-0.5 text-ink-2">{entry.definition}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      ))}
    </div>
  );
}
