"use client";

import { useRef, useState, type MouseEvent } from "react";

/** The drawing the server sent, as a PNG at twice its size. Made in the browser, from that file alone. */
async function rasterise(svg: string): Promise<Blob> {
  const size = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!size) throw new Error("not a drawing");
  const image = new Image();
  image.decoding = "async";
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(Number(size[1]) * 2);
  canvas.height = Math.round(Number(size[2]) * 2);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no image"))), "image/png"));
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const filenameOf = (response: Response, fallback: string): string => /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? fallback;

/**
 * One export action that the browser can do better than a plain download: copy the CSV to the
 * clipboard, or save the chart as a PNG. Each is a real link to the file the server makes
 * (lib/export, which asks the rights gate); with JavaScript off, or if the browser refuses, the
 * link is simply followed and the file is downloaded as it is. The label answers a press with
 * a 200 ms crossfade and returns after two seconds, as "Copy link" does.
 */
export function ExportAction({ href, kind, label, done, className }: { href: string; kind: "copy" | "png"; label: string; done: string; className: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const act = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    if (kind === "copy" && !navigator.clipboard) return;
    event.preventDefault();
    if (state === "busy") return;
    setState("busy");
    const finish = () => {
      setState("done");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 2000);
    };
    fetch(href, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const text = await response.text();
        if (kind === "copy") await navigator.clipboard.writeText(text);
        else save(await rasterise(text), filenameOf(response, "macro-atlas.svg").replace(/\.svg$/, ".png"));
        finish();
      })
      .catch(() => {
        // Refused or failed: follow the link, which downloads the file as the server made it.
        setState("idle");
        window.location.assign(href);
      });
  };

  return (
    <a href={href} onClick={act} data-export={kind} aria-busy={state === "busy" || undefined} className={`${className} relative`}>
      <span className="fade-label" data-shown={state !== "done"}>
        {label}
      </span>
      <span className="fade-label absolute inset-0 flex items-center justify-center" data-shown={state === "done"} aria-hidden={state !== "done"}>
        {done}
      </span>
      <span role="status" className="sr-only">
        {state === "done" ? done : ""}
      </span>
    </a>
  );
}
