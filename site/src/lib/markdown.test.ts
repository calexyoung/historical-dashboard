/** The site's Markdown reader (M25): what the method pages are drawn from. */
import { describe, expect, it } from "vitest";
import { inlineText, mdText, parseInline, parseMarkdown, type Block } from "./markdown";
import { METHOD_DOCS } from "./method-docs.generated";

const site = (href: string) => (href.startsWith("https://") ? { href, external: true } : href.startsWith("/") ? { href: `/base${href}`, external: false } : null);

describe("parseMarkdown", () => {
  it("reads headings, paragraphs, code, lists and tables as blocks", () => {
    const blocks = parseMarkdown(
      ["# Title", "", "A line", "that goes on.", "", "```", "- not a list", "| not | a table |", "```", "", "| A | B |", "|---|---|", "| `a\\|b` | two \\| bars |", "", "1. one", "   more of one", "", "   ```", "   code in an item", "   ```", "2. two", "   - inner", "", "After."].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "code", "table", "list", "paragraph"]);
    expect(blocks[0]).toMatchObject({ level: 1, id: "title", text: "Title" });
    expect(inlineText((blocks[1] as Extract<Block, { kind: "paragraph" }>).children)).toBe("A line that goes on.");
    expect(blocks[2]).toMatchObject({ text: "- not a list\n| not | a table |" });
    const table = blocks[3] as Extract<Block, { kind: "table" }>;
    expect(table.head.map(inlineText)).toEqual(["A", "B"]);
    expect(table.rows[0]!.map(inlineText)).toEqual(["a|b", "two | bars"]);
    const list = blocks[4] as Extract<Block, { kind: "list" }>;
    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(2);
    expect(list.items[0]!.map((b) => b.kind)).toEqual(["paragraph", "code"]);
    expect(list.items[0]![1]).toMatchObject({ text: "code in an item" });
    expect(list.items[1]!.map((b) => b.kind)).toEqual(["paragraph", "list"]);
  });

  it("gives headings ids that differ", () => {
    const ids = parseMarkdown("## Rules\n\n## Rules\n\n## What: a `thing`").flatMap((b) => (b.kind === "heading" ? [b.id] : []));
    expect(ids).toEqual(["rules", "rules-2", "what-a-thing"]);
  });

  it("keeps a link only where the site gives it an address, and never one that is not https or the site's own", () => {
    const nodes = parseInline("See [the page](/docs/api), [terms](https://example.org/t), [a file](../x.md), [x](javascript:alert) and <https://example.org/a>.", site);
    const links = nodes.flatMap((n) => (n.kind === "link" ? [[n.href, n.external]] : []));
    expect(links).toEqual([["/base/docs/api", false], ["https://example.org/t", true], ["https://example.org/a", true]]);
    expect(inlineText(nodes)).toBe("See the page, terms, a file, x and https://example.org/a.");
  });

  it("reads code, strong and emphasis in a line, and leaves stars that are not emphasis", () => {
    const nodes = parseInline("**bold** and *soft* and `a * b` and 2 * 3 and <script>", () => null);
    expect(nodes.map((n) => n.kind)).toEqual(["strong", "text", "em", "text", "code", "text"]);
    expect(inlineText(nodes)).toBe("bold and soft and a * b and 2 * 3 and <script>");
  });

  it("reads every method page of the site without losing a heading or a fence", () => {
    for (const doc of METHOD_DOCS) {
      const blocks = parseMarkdown(doc.text);
      expect(blocks[0], doc.file).toMatchObject({ kind: "heading", level: 1, text: doc.title.replace(/`/g, "") });
      const fences = doc.text.split("\n").filter((line) => /^\s*```/.test(line)).length;
      const count = (list: Block[]): number => list.reduce((n, b) => n + (b.kind === "code" ? 1 : b.kind === "list" ? b.items.reduce((m, item) => m + count(item), 0) : b.kind === "quote" ? count(b.children) : 0), 0);
      expect(count(blocks) * 2, doc.file).toBe(fences);
      const headings = doc.text.split("\n").filter((line, i, all) => /^#{1,6} /.test(line) && all.slice(0, i).filter((l) => /^\s*```/.test(l)).length % 2 === 0).length;
      expect(blocks.filter((b) => b.kind === "heading").length, doc.file).toBe(headings);
    }
  });
});

describe("mdText", () => {
  it("writes a Release's words so that Markdown takes them as words", () => {
    expect(mdText("<b>x</b> [a](b) *c* | d\n# e")).toBe("&lt;b&gt;x&lt;/b&gt; \\[a\\](b) \\*c\\* \\| d \\# e");
    expect(mdText("- item")).toBe("\\- item");
    expect(mdText("1. item")).toBe("\\1. item");
  });
});
