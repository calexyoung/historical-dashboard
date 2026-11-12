import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/Markdown";
import { Panel } from "@/components/Panel";
import { BASE_PATH } from "@/lib/config";
import { inlineText, parseInline } from "@/lib/markdown";
import { methodBlocks, methodDoc } from "@/lib/method-docs";

const titleOf = (title: string): string => inlineText(parseInline(title, () => null));

export async function generateMetadata({ params }: PageProps<"/docs/method/[name]">): Promise<Metadata> {
  const doc = methodDoc((await params).name);
  return { title: doc ? `${titleOf(doc.title)} · Method` : "Method" };
}

const link = "press hover-ink inline-flex min-h-6 min-w-6 items-center text-accent underline underline-offset-2";

/**
 * One method page (PLAN section 3, M25): a Markdown document, drawn. `/docs/method/claims` is
 * the page written for a reader of a claim (M21); the others are the repository's own
 * `docs/method/*.md`. The page's `.md` twin is the document's text, so the two cannot differ.
 * No data: nothing here is read from a Release.
 */
export default async function MethodPage({ params }: PageProps<"/docs/method/[name]">) {
  const doc = methodDoc((await params).name);
  if (!doc) notFound();
  return (
    <Panel
      id="method"
      title={titleOf(doc.title)}
      level={1}
      meta={
        <>
          <a href={`${BASE_PATH}/docs/method`} className={link}>
            Method
          </a>
          {doc.kind === "contract" && (
            <>
              {" "}
              · The repository&rsquo;s <code className="font-mono">{doc.file}</code>
            </>
          )}
        </>
      }
    >
      <Markdown blocks={methodBlocks(doc, BASE_PATH)} skipTitle />
    </Panel>
  );
}
