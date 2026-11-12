/**
 * The pages of `/docs/method` (PLAN section 3 and M25): a page written for a reader of the
 * site, and the repository's own method documents, which are the contracts the code is tested
 * from. Each is Markdown; the page is drawn from it and its `.md` twin is the text itself.
 * No value of any Series is in them.
 */
import { inlineText, parseInline, parseMarkdown, type Block, type Inline, type Resolve } from "./markdown";
import { METHOD_DOCS } from "./method-docs.generated";

export type MethodDoc = (typeof METHOD_DOCS)[number];
export type MethodEntry = { slug: string; title: string; kind: MethodDoc["kind"]; /** Its first paragraph, as text. */ summary: string; /** Without the base path. */ href: string };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const strip = (title: string): string => inlineText(parseInline(title, () => null));
const BY_FILE = new Map(METHOD_DOCS.filter((doc) => doc.kind === "contract").map((doc) => [doc.file.split("/").pop()!, doc.slug]));

export function methodDoc(slug: string): MethodDoc | null {
  return typeof slug === "string" && slug.length <= 60 && SLUG.test(slug) ? (METHOD_DOCS.find((doc) => doc.slug === slug) ?? null) : null;
}

/**
 * Where a link in a method document leads. A link to another method document goes to its page;
 * the site's own address is kept; an https address is kept and marked as leaving the site. A
 * link to any other file of the repository has no address here, so its words stay as text.
 */
export const methodLinks =
  (basePath: string): Resolve =>
  (href) => {
    if (/^https:\/\/[^\s]+$/.test(href)) return { href, external: true };
    if (/^\/(?!\/)[a-z0-9/_.#?=&-]*$/i.test(href) && !href.endsWith(".md")) return { href: `${basePath}${href}`, external: false };
    const [file, anchor] = href.split("#");
    const slug = BY_FILE.get((file ?? "").split("/").pop() ?? "");
    if (slug && /^(?:\.\/|docs\/method\/|\/docs\/method\/)?[a-z-]+\.md$/.test(file ?? "")) return { href: `${basePath}/docs/method/${slug}${anchor ? `#${anchor.replace(/[^a-z0-9-]/gi, "")}` : ""}`, external: false };
    return null;
  };

/**
 * The documents name one another as code (`transforms.md`). On the site that name is the door
 * to the page: a code span that is exactly another method document's file becomes a link to it.
 */
function withDoors(nodes: Inline[], resolve: Resolve, self: string): Inline[] {
  return nodes.map((node) => {
    if (node.kind === "code" && /^(docs\/method\/)?[a-z-]+\.md$/.test(node.text)) {
      const to = resolve(node.text);
      return to && !to.href.endsWith(`/docs/method/${self}`) ? { kind: "link", ...to, children: [node] } : node;
    }
    return node.kind === "strong" || node.kind === "em" ? { ...node, children: withDoors(node.children, resolve, self) } : node;
  });
}
function doors(blocks: Block[], resolve: Resolve, self: string): Block[] {
  return blocks.map((block) => {
    switch (block.kind) {
      case "paragraph":
        return { ...block, children: withDoors(block.children, resolve, self) };
      case "list":
        return { ...block, items: block.items.map((item) => doors(item, resolve, self)) };
      case "table":
        return { ...block, rows: block.rows.map((row) => row.map((cell) => withDoors(cell, resolve, self))) };
      case "quote":
        return { ...block, children: doors(block.children, resolve, self) };
      default:
        return block;
    }
  });
}

export function methodBlocks(doc: MethodDoc, basePath: string): Block[] {
  const resolve = methodLinks(basePath);
  return doors(parseMarkdown(doc.text, resolve), resolve, doc.slug);
}

export function methodIndex(): MethodEntry[] {
  return METHOD_DOCS.map((doc) => {
    const first = parseMarkdown(doc.text).find((block) => block.kind === "paragraph");
    return { slug: doc.slug, title: strip(doc.title), kind: doc.kind, summary: first && first.kind === "paragraph" ? inlineText(first.children) : "", href: `/docs/method/${doc.slug}` };
  }).sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === "reader" ? -1 : 1));
}
