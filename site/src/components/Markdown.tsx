import type { ReactNode } from "react";
import type { Block, Inline } from "@/lib/markdown";

// A link in running text is still a target: at least 24px tall (WCAG 2.2, target size).
const link = "press hover-ink inline-block min-h-6 leading-6 text-accent underline underline-offset-2";

function Line({ nodes }: { nodes: Inline[] }): ReactNode {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "code":
        return (
          <code key={i} className="break-words font-mono text-ink">
            {node.text}
          </code>
        );
      case "strong":
        return (
          <strong key={i} className="font-semibold text-ink">
            <Line nodes={node.children} />
          </strong>
        );
      case "em":
        return (
          <em key={i}>
            <Line nodes={node.children} />
          </em>
        );
      case "link":
        return (
          <a key={i} href={node.href} className={link} {...(node.external ? { rel: "noreferrer" } : {})}>
            <Line nodes={node.children} />
          </a>
        );
    }
  });
}

/**
 * A Markdown document as the site draws it (`lib/markdown.ts`): the method pages. Reading
 * text, so a measure of about 72 characters; a table or a block of code that is wider scrolls
 * inside itself and the page never does. Nothing moves. The document's own first heading is the
 * page's `h1`, and is left to the caller (`skipTitle`).
 */
export function Markdown({ blocks, skipTitle = false }: { blocks: Block[]; skipTitle?: boolean }) {
  const list = skipTitle && blocks[0]?.kind === "heading" && blocks[0].level === 1 ? blocks.slice(1) : blocks;
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm leading-relaxed text-ink-2" data-markdown>
      {list.map((block, i) => {
        switch (block.kind) {
          case "heading": {
            const Tag = block.level <= 2 ? "h2" : block.level === 3 ? "h3" : "h4";
            const tone = block.level <= 2 ? "mt-4 border-t border-line pt-3 text-[13px] font-bold uppercase tracking-[0.06em] text-ink" : "mt-2 text-sm font-semibold text-ink";
            return (
              <Tag key={i} id={block.id} className={`${tone} max-w-[72ch] scroll-mt-4`}>
                <Line nodes={block.children} />
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={i} className="max-w-[72ch]">
                <Line nodes={block.children} />
              </p>
            );
          case "code":
            return (
              <pre key={i} tabIndex={0} aria-label="Code" role="region" className="max-w-full overflow-x-auto border-l-2 border-line py-1 pl-3 text-[13px] leading-relaxed text-ink">
                <code className="font-mono">{block.text}</code>
              </pre>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={i} start={block.ordered && block.start !== 1 ? block.start : undefined} className={`flex max-w-[72ch] flex-col gap-1.5 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}>
                {block.items.map((item, j) => (
                  <li key={j} className="min-w-0 pl-1">
                    {item.length === 1 && item[0]!.kind === "paragraph" ? <Line nodes={item[0]!.children} /> : <Markdown blocks={item} />}
                  </li>
                ))}
              </Tag>
            );
          }
          case "table":
            return (
              <div key={i} role="group" aria-label="Table" tabIndex={0} className="max-w-full overflow-x-auto">
                <table className="data-table max-w-[96ch]">
                  <thead>
                    <tr>
                      {block.head.map((cell, j) => (
                        <th key={j} scope="col">
                          <Line nodes={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) =>
                          k === 0 ? (
                            <th key={k} scope="row" className="font-normal text-ink">
                              <Line nodes={cell} />
                            </th>
                          ) : (
                            <td key={k}>
                              <Line nodes={cell} />
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "quote":
            return (
              <blockquote key={i} className="max-w-[72ch] border-l-2 border-ink pl-3 text-ink">
                <Markdown blocks={block.children} />
              </blockquote>
            );
          case "rule":
            return <hr key={i} className="max-w-[72ch] border-line" />;
        }
      })}
    </div>
  );
}
