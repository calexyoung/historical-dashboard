import { createElement, type ReactElement } from "react";
import { svgString, type SvgNode } from "@/lib/figure";

/** SVG's attribute names as React wants them: `stroke-width` is `strokeWidth`; `data-*` and `aria-*` stay. */
const reactName = (name: string): string => (/^(data|aria)-/.test(name) ? name : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

/**
 * A drawing made by the figure module, on the page. It adds nothing and changes nothing.
 *
 * The root is an element (so it can carry a class); what is inside it is written as markup by
 * the figure module's own `svgString`, which escapes every text and attribute. A drawing is
 * thousands of nodes, and as elements each one is sent twice, once as HTML and once, at several
 * times the size, in React's payload (ADR 0017, 0018). As markup the payload holds it once, as
 * text. Nothing in a drawing is interactive, so nothing is lost.
 */
export function Svg({ node, className }: { node: SvgNode; className?: string }): ReactElement {
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.attrs)) props[reactName(name)] = value;
  if (className) props.className = className;
  props.dangerouslySetInnerHTML = { __html: node.children.map(svgString).join("") };
  return createElement(node.tag, props);
}
