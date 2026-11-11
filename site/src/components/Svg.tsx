import { createElement, type ReactElement } from "react";
import type { SvgNode } from "@/lib/figure";

/** SVG's attribute names as React wants them: `stroke-width` is `strokeWidth`; `data-*` and `aria-*` stay. */
const reactName = (name: string): string => (/^(data|aria)-/.test(name) ? name : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

/** A drawing made by the figure module, as elements. It adds nothing and changes nothing. */
export function Svg({ node, className }: { node: SvgNode; className?: string }): ReactElement {
  const props: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(node.attrs)) props[reactName(name)] = value;
  if (className) props.className = className;
  const children = node.children.map((child, i) => (typeof child === "string" ? child : <Svg key={i} node={child} />));
  return createElement(node.tag, props, ...children);
}
