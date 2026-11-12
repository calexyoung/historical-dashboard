/**
 * A small Markdown reader for the site's own documents (PLAN section 3 and M25): the method
 * pages, whose text is the repository's. `parseMarkdown(text)` gives blocks a page can draw;
 * the `.md` twin of the page is the text itself, so the two cannot say different things.
 *
 * It reads what those documents use and nothing more: headings, paragraphs, fenced code, lists
 * (nested, with paragraphs and code inside an item), tables, quotations and rules; in a line,
 * code, strong, emphasis and links. Anything else stays text. It makes no HTML: a page draws
 * the blocks as elements, so nothing in a document can bring markup or a script with it, and a
 * link is kept only when `resolve` gives it an address.
 *
 * Also here: `mdText`, which writes a Release's own words (a name, a description, a note) into
 * a Markdown file so that they stay words.
 */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em"; children: Inline[] }
  | { kind: "link"; href: string; external: boolean; children: Inline[] };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; id: string; children: Inline[]; text: string }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "code"; lang: string | null; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: Block[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "quote"; children: Block[] }
  | { kind: "rule" };

/** Where a link in a document leads on the site: an address, or null to leave its words as text. */
export type Resolve = (href: string) => { href: string; external: boolean } | null;

const FENCE = /^(`{3,})\s*([a-z0-9-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,4}[.)])\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const COMMENT = /^\s*<!--.*-->\s*$/;

/** The cells of a table line; `\|` is a bar inside a cell, and a bar inside code is the code's. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let code = false;
  const text = line.trim().replace(/^\|/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\\" && text[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (c === "`") {
      code = !code;
      cell += c;
    } else if (c === "|" && !code) {
      out.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  if (cell.trim() !== "") out.push(cell.trim());
  return out;
}

export function parseInline(text: string, resolve: Resolve): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = (): void => {
    if (plain) out.push({ kind: "text", text: plain });
    plain = "";
  };
  for (let i = 0; i < text.length; ) {
    const c = text[i]!;
    if (c === "\\" && i + 1 < text.length && /[\\`*_[\]#|~<>()!-]/.test(text[i + 1]!)) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const ticks = /^`+/.exec(text.slice(i))![0];
      const end = text.indexOf(ticks, i + ticks.length);
      if (end !== -1) {
        flush();
        out.push({ kind: "code", text: text.slice(i + ticks.length, end).replace(/^ (.*) $/, "$1") });
        i = end + ticks.length;
        continue;
      }
    }
    if (c === "[") {
      const close = text.indexOf("](", i);
      const end = close === -1 ? -1 : text.indexOf(")", close);
      if (close !== -1 && end !== -1 && !text.slice(i + 1, close).includes("[")) {
        const label = text.slice(i + 1, close);
        const to = resolve(text.slice(close + 2, end).trim());
        flush();
        const children = parseInline(label, () => null);
        if (to) out.push({ kind: "link", ...to, children });
        else out.push(...children);
        i = end + 1;
        continue;
      }
    }
    if (c === "<") {
      const auto = /^<(https:\/\/[^\s<>]+)>/.exec(text.slice(i));
      if (auto) {
        flush();
        out.push({ kind: "link", href: auto[1]!, external: true, children: [{ kind: "text", text: auto[1]! }] });
        i += auto[0].length;
        continue;
      }
    }
    if (c === "*") {
      const mark = text.startsWith("**", i) ? "**" : "*";
      const end = text.indexOf(mark, i + mark.length);
      // Emphasis opens against a word and closes against one: `2 * 3` and a lone star stay text.
      if (end > i + mark.length && !/\s/.test(text[i + mark.length]!) && !/\s/.test(text[end - 1]!)) {
        flush();
        out.push({ kind: mark === "**" ? "strong" : "em", children: parseInline(text.slice(i + mark.length, end), resolve) });
        i = end + mark.length;
        continue;
      }
    }
    plain += c;
    i++;
  }
  flush();
  return out;
}

export const inlineText = (nodes: readonly Inline[]): string => nodes.map((n) => (n.kind === "text" || n.kind === "code" ? n.text : inlineText(n.children))).join("");

const slugOf = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "section";

export function parseMarkdown(text: string, resolve: Resolve = () => null): Block[] {
  const ids = new Map<string, number>();
  const unique = (base: string): string => {
    const seen = ids.get(base) ?? 0;
    ids.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  };

  function blocks(lines: string[]): Block[] {
    const out: Block[] = [];
    let i = 0;
    const startsBlock = (line: string, next: string | undefined): boolean =>
      FENCE.test(line.trim()) || HEADING.test(line) || ITEM.test(line) || RULE.test(line) || line.startsWith(">") || (line.trim().startsWith("|") && next !== undefined && TABLE_RULE.test(next));
    while (i < lines.length) {
      const line = lines[i]!;
      if (line.trim() === "" || COMMENT.test(line)) {
        i++;
        continue;
      }
      const fence = FENCE.exec(line.trim());
      if (fence) {
        const indent = line.length - line.trimStart().length;
        const body: string[] = [];
        i++;
        while (i < lines.length && !(lines[i]!.trim().startsWith(fence[1]!) && lines[i]!.trim().replace(/`/g, "") === "")) {
          body.push(lines[i]!.slice(Math.min(indent, lines[i]!.length - lines[i]!.trimStart().length)));
          i++;
        }
        i++;
        out.push({ kind: "code", lang: fence[2] || null, text: body.join("\n") });
        continue;
      }
      const heading = HEADING.exec(line);
      if (heading) {
        const children = parseInline(heading[2]!, resolve);
        const plain = inlineText(children);
        out.push({ kind: "heading", level: Math.min(4, heading[1]!.length) as 1 | 2 | 3 | 4, id: unique(slugOf(plain)), children, text: plain });
        i++;
        continue;
      }
      if (RULE.test(line)) {
        out.push({ kind: "rule" });
        i++;
        continue;
      }
      if (line.trim().startsWith("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!)) {
        const head = cells(line).map((cell) => parseInline(cell, resolve));
        const rows: Inline[][][] = [];
        i += 2;
        while (i < lines.length && lines[i]!.trim().startsWith("|")) {
          const row = cells(lines[i]!).map((cell) => parseInline(cell, resolve));
          while (row.length < head.length) row.push([]);
          rows.push(row.slice(0, head.length));
          i++;
        }
        out.push({ kind: "table", head, rows });
        continue;
      }
      if (line.startsWith(">")) {
        const body: string[] = [];
        while (i < lines.length && lines[i]!.startsWith(">")) {
          body.push(lines[i]!.replace(/^>\s?/, ""));
          i++;
        }
        out.push({ kind: "quote", children: blocks(body) });
        continue;
      }
      const first = ITEM.exec(line);
      if (first) {
        const base = first[1]!.length;
        const ordered = /\d/.test(first[2]!);
        const items: Block[][] = [];
        while (i < lines.length) {
          const item = ITEM.exec(lines[i]!);
          if (!item || item[1]!.length !== base || /\d/.test(item[2]!) !== ordered) break;
          const width = base + item[2]!.length + 1;
          const body = [item[3]!];
          i++;
          while (i < lines.length) {
            const next = lines[i]!;
            const indent = next.length - next.trimStart().length;
            if (next.trim() === "") {
              // A blank line stays in the item only when what follows is still inside it.
              const after = lines.slice(i + 1).find((l) => l.trim() !== "");
              if (after === undefined || after.length - after.trimStart().length <= base) break;
              body.push("");
            } else if (indent > base) body.push(next.slice(Math.min(indent, width)));
            else break;
            i++;
          }
          items.push(blocks(body));
        }
        out.push({ kind: "list", ordered, start: ordered ? Number(/\d+/.exec(first[2]!)![0]) : 1, items });
        continue;
      }
      const body: string[] = [line.trim()];
      i++;
      while (i < lines.length && lines[i]!.trim() !== "" && !startsBlock(lines[i]!, lines[i + 1])) {
        body.push(lines[i]!.trim());
        i++;
      }
      out.push({ kind: "paragraph", children: parseInline(body.join(" "), resolve) });
    }
    return out;
  }

  return blocks(text.replace(/\r\n/g, "\n").split("\n"));
}

/**
 * Text from a Release (a name, a description, a note), written so that Markdown and anything
 * that renders it take it as text: no HTML, no link or image, no emphasis, no heading, list or
 * rule, no table cell of its own.
 * A Catalog is not written by readers, but a file is opened by people who did not write it.
 */
export const mdText = (text: string | number | null | undefined): string =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]#|~])/g, "\\$1")
    // At the start of a line: no list, quotation, rule or underline of a heading.
    .replace(/^([-+>=]|\d+[.)])/, "\\$1");
