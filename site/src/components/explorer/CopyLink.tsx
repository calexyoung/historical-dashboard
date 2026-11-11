"use client";

import { useRef, useState, type MouseEvent } from "react";

/**
 * The link to this view with nothing left to a default. It is a real link: followed, it opens
 * the same view at an address that says everything outright, which is what a reader without
 * JavaScript copies from the address bar. With JavaScript, pressing it copies that address; the
 * label changes to "Copied" with a 200 ms crossfade (PLAN section 8) and back after two seconds.
 * If the clipboard is refused, the link is simply followed.
 */
export function CopyLink({ href, className }: { href: string; className: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0 || !navigator.clipboard) return;
    event.preventDefault();
    const url = new URL(href, window.location.origin).toString();
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      },
      () => window.location.assign(url),
    );
  };

  return (
    <a href={href} onClick={copy} data-copy-link className={`${className} relative`}>
      <span className="fade-label" data-shown={!copied}>
        Copy link
      </span>
      <span className="fade-label absolute inset-0 flex items-center justify-center" data-shown={copied} aria-hidden={!copied}>
        Copied
      </span>
      <span role="status" className="sr-only">
        {copied ? "Link copied" : ""}
      </span>
    </a>
  );
}
