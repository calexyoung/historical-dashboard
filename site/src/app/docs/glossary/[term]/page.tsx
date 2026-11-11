import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Panel } from "@/components/Panel";
import { Svg } from "@/components/Svg";
import { BASE_PATH } from "@/lib/config";
import { markIcon } from "@/lib/figure";
import { glossaryEntry, glossaryHref } from "@/lib/glossary";

export async function generateMetadata({ params }: PageProps<"/docs/glossary/[term]">): Promise<Metadata> {
  const entry = glossaryEntry((await params).term);
  return { title: entry ? `${entry.term} · Glossary` : "Glossary" };
}

const link = "press hover-ink text-accent underline underline-offset-2";

/** One glossary entry at its own address, so a page can point a reader straight at a word. */
export default async function GlossaryTermPage({ params }: PageProps<"/docs/glossary/[term]">) {
  const entry = glossaryEntry((await params).term);
  if (!entry) notFound();
  const see = (entry.see ?? []).map((slug) => glossaryEntry(slug)!);
  return (
    <Panel
      id="term"
      title={entry.term}
      level={1}
      meta={
        <>
          <a href={glossaryHref(BASE_PATH)} className={`${link} inline-flex min-h-6 min-w-6 items-center`}>
            Glossary
          </a>{" "}
          · {entry.group}
        </>
      }
    >
      <div className="flex max-w-[68ch] items-start gap-3">
        {entry.mark && (
          <span data-state={entry.mark} className="mt-0.5 shrink-0 text-ink">
            <Svg node={markIcon(entry.mark)} />
          </span>
        )}
        <p className="text-ink">{entry.definition}</p>
      </div>
      {see.length > 0 && (
        <p className="mt-4 text-sm text-ink-2">
          See also:{" "}
          {see.map((other, i) => (
            <span key={other.slug}>
              {i > 0 && ", "}
              <a href={glossaryHref(BASE_PATH, other.slug)} className={`${link} inline-flex min-h-6 min-w-6 items-center`}>
                {other.term}
              </a>
            </span>
          ))}
        </p>
      )}
    </Panel>
  );
}
