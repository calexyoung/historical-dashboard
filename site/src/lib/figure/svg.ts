/**
 * A drawing as plain data: the one geometry a figure has. `svgString` writes it out as markup;
 * the page maps the same tree to elements (components/Figure.tsx). Attribute names are SVG's own.
 */
export type SvgNode = { tag: string; attrs: Record<string, string | number>; children: (SvgNode | string)[] };

export function h(tag: string, attrs: Record<string, string | number | undefined | null> = {}, ...children: (SvgNode | string | null | false | undefined)[]): SvgNode {
  const kept: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined && value !== null) kept[name] = value;
  return { tag, attrs: kept, children: children.filter((c): c is SvgNode | string => c !== null && c !== false && c !== undefined) };
}

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function svgString(node: SvgNode | string): string {
  if (typeof node === "string") return escape(node);
  const attrs = Object.entries(node.attrs)
    .map(([name, value]) => ` ${name}="${escape(String(value))}"`)
    .join("");
  return `<${node.tag}${attrs}>${node.children.map(svgString).join("")}</${node.tag}>`;
}

/** Every node of a tree, the root first. */
export function* walk(node: SvgNode): Generator<SvgNode> {
  yield node;
  for (const child of node.children) if (typeof child !== "string") yield* walk(child);
}

export const textOf = (node: SvgNode): string => node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");

/** Coordinates to at most two decimals: enough for a screen, and half the bytes. */
export const r2 = (n: number): number => Math.round(n * 100) / 100;
