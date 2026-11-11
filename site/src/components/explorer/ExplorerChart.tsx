"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Svg } from "@/components/Svg";
import { nearestStop, readoutAt, stepStop, stopWords, type ReadoutModel } from "@/lib/explorer/readout";
import { swatch } from "@/lib/figure/plot";
import { tidyQuery, useExplorerNav, useHydrated } from "./nav";

type Line = { left: number; top: number; height: number };

const DAY_MS = 86_400_000;
const iso = (ms: number): string => new Date(Math.round(ms / DAY_MS) * DAY_MS).toISOString().slice(0, 10);

/** The drawing of a plot that is showing (one of three is, by a container query). */
function shownDrawing(plot: Element): SVGSVGElement | null {
  for (const svg of plot.querySelectorAll<SVGSVGElement>(":scope > svg[role=img]")) if (svg.getClientRects().length > 0) return svg;
  return null;
}

/** A drawing's own account of its time axis (figure/plot.ts writes it on the svg). */
function axisOf(svg: SVGSVGElement) {
  const box = svg.getBoundingClientRect();
  const scale = box.width / svg.viewBox.baseVal.width;
  const n = (name: string) => Number(svg.dataset[name]);
  const area = svg.querySelector<SVGRectElement>("[data-plot-area]");
  return { box, scale, t0: n("t0"), t1: n("t1"), x0: n("x0"), x1: n("x1"), top: Number(area?.getAttribute("y") ?? 0), height: Number(area?.getAttribute("height") ?? 0) };
}

/**
 * The chart's pointer and keyboard layer, and the readout above it (PLAN section 8).
 *
 * The drawings are made on the server and arrive as children; this adds nothing to them. It
 * places two upright lines over them, the pin and the pointer's preview, and writes the readout
 * for whichever date is in hand. Nothing here is hover-only: the pointer previews, and a click,
 * a tap or the arrow keys pin, which writes `at=` into the address. Nothing animates: lines and
 * figures change at once, and the readout has the same rows whatever the date.
 */
export function ExplorerChart({
  model,
  pinned,
  shownAt,
  unpinHref,
  children,
}: {
  model: ReadoutModel;
  /** The pinned date in the address, if any. */
  pinned: string | null;
  /** Where the readout stands with no pin: the latest date in the window. */
  shownAt: string | null;
  /** The address without the pin, for the "Unpin" link. */
  unpinHref: string;
  children: ReactNode;
}) {
  const go = useExplorerNav();
  const frame = useRef<HTMLDivElement>(null);
  const live = useHydrated();
  const [seen, setSeen] = useState(pinned);
  const [at, setAt] = useState(pinned);
  const [hover, setHover] = useState<string | null>(null);
  const [lines, setLines] = useState<{ pin: Line[]; hover: Line[] }>({ pin: [], hover: [] });
  const [said, setSaid] = useState("");
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (seen !== pinned) {
    // The server drew another view (Back, a link): its pin is the pin.
    setSeen(pinned);
    setAt(pinned);
  }

  const date = hover ?? at ?? shownAt;
  const readout = date === null ? null : readoutAt(model, date);

  const place = useCallback(() => {
    const root = frame.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const linesFor = (day: string | null): Line[] => {
      if (day === null) return [];
      const t = Date.parse(`${day}T00:00:00Z`);
      const out: Line[] = [];
      for (const plot of root.querySelectorAll("[data-plot]")) {
        const svg = shownDrawing(plot);
        if (!svg) continue;
        const a = axisOf(svg);
        if (t < a.t0 || t > a.t1) continue;
        const x = a.x0 + ((t - a.t0) / (a.t1 - a.t0)) * (a.x1 - a.x0);
        out.push({ left: a.box.left - origin.left + x * a.scale, top: a.box.top - origin.top + a.top * a.scale, height: a.height * a.scale });
      }
      return out;
    };
    setLines({ pin: linesFor(at), hover: linesFor(hover !== at ? hover : null) });
  }, [at, hover]);

  // After every draw, and whenever the drawings change size, put the lines where the dates are.
  useLayoutEffect(place, [place, children]);
  useEffect(() => {
    const root = frame.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => observer.disconnect();
  }, [place]);

  /** Write the pin into the address. Held back a moment while keys repeat, so only the last one asks the server. */
  const commit = useCallback(
    (next: string | null, wait: number) => {
      if (pending.current) clearTimeout(pending.current);
      const write = () => {
        const params = new URLSearchParams(window.location.search);
        if (next === null) params.delete("at");
        else params.set("at", next);
        go(tidyQuery(params), "replace");
      };
      if (wait > 0) pending.current = setTimeout(write, wait);
      else write();
    },
    [go],
  );
  useEffect(() => () => void (pending.current && clearTimeout(pending.current)), []);

  const pin = (next: string | null, wait = 0) => {
    setAt(next);
    setSeen(next); // ours until the server answers with it
    commit(next, wait);
  };

  const stopUnder = (event: PointerEvent | MouseEvent): string | null => {
    const plot = (event.target as Element).closest("[data-plot]");
    const svg = plot && shownDrawing(plot);
    if (!svg) return null;
    const a = axisOf(svg);
    const x = (event.clientX - a.box.left) / a.scale;
    if (event.clientY < a.box.top || event.clientY > a.box.bottom) return null;
    const t = a.t0 + ((x - a.x0) / (a.x1 - a.x0)) * (a.t1 - a.t0);
    return nearestStop(model, iso(Math.min(a.t1, Math.max(a.t0, t))));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return; // a finger has no hover; it taps
    setHover(stopUnder(event));
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const stop = stopUnder(event);
    if (stop === null) return;
    pin(stop === at ? null : stop); // the same place again lets go
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.altKey || event.metaKey || event.ctrlKey) return;
    const from = at ?? shownAt;
    const next =
      event.key === "ArrowLeft" ? stepStop(model, from, event.shiftKey ? -12 : -1)
      : event.key === "ArrowRight" ? stepStop(model, from, event.shiftKey ? 12 : 1)
      : event.key === "Home" ? (model.stops[0] ?? null)
      : event.key === "End" ? (model.stops.at(-1) ?? null)
      : undefined; // prettier-ignore
    if (event.key === "Escape" && at !== null) {
      event.preventDefault();
      pin(null);
      setSaid("Pin removed.");
      return;
    }
    if (next === undefined || next === null) return;
    event.preventDefault();
    setHover(null);
    pin(next, 200);
    const now = readoutAt(model, next);
    setSaid(`${now.words}. ${now.rows.map((r) => `${r.name}: ${r.value ?? r.note}`).join("; ")}.`);
  };

  const status = hover !== null && hover !== at ? "under the pointer" : at !== null ? "pinned" : "latest in the window";

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div data-readout className="min-w-0">
        <p className="flex h-6 items-center gap-2 whitespace-nowrap text-xs text-ink-2">
          <span className="font-bold uppercase tracking-[0.06em] text-ink">Readout</span>
          {readout ? (
            <>
              <span data-readout-date className="num font-medium text-ink">
                {readout.words}
              </span>
              <span data-readout-status>{status}</span>
              {at !== null && (
                <a
                  href={unpinHref}
                  onClick={(event) => {
                    event.preventDefault();
                    pin(null);
                  }}
                  className="press hover-ink inline-flex h-6 items-center text-accent underline underline-offset-2"
                >
                  Unpin
                </a>
              )}
            </>
          ) : (
            <span>no dates in this view</span>
          )}
        </p>
        <ul className="mt-1 grid gap-x-6 border-t border-line sm:grid-cols-2 xl:grid-cols-4">
          {model.series.map((s, i) => {
            const row = readout?.rows[i];
            return (
              <li key={s.key} data-readout-row={s.key} className="min-w-0 border-b border-line py-1">
                <p className="flex h-5 items-center gap-1.5 text-sm">
                  {s.style ? <Svg node={swatch(s.style)} className="shrink-0" /> : <span aria-hidden="true" className="inline-block w-8 shrink-0 border-t border-dashed border-control" />}
                  <span className="min-w-0 flex-1 truncate text-ink-2">{s.name}</span>
                  <span className="num shrink-0 font-semibold text-ink">{row?.value ?? "–"}</span>
                </p>
                <p className="num h-[18px] truncate pl-[38px] text-xs text-ink-3">{row ? (row.note ?? [s.unit, row.period, row.drawn].filter(Boolean).join(" · ")) : s.unit}</p>
              </li>
            );
          })}
        </ul>
      </div>

      <div
        ref={frame}
        data-explorer-chart
        data-live={live || undefined}
        role="group"
        tabIndex={0}
        aria-label="Chart. With the chart in focus, the left and right arrow keys move the readout one period, with Shift twelve; Home and End go to the ends; Escape removes the pin."
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
        onKeyDown={onKeyDown}
        className="explorer-chart relative flex min-w-0 flex-col gap-4"
      >
        {children}
        {lines.pin.map((line, i) => (
          <span key={`pin-${i}`} data-pin-line aria-hidden="true" className="pointer-events-none absolute w-0 border-l-[1.5px] border-accent" style={{ left: line.left, top: line.top, height: line.height }} />
        ))}
        {lines.hover.map((line, i) => (
          <span key={`hover-${i}`} data-hover-line aria-hidden="true" className="pointer-events-none absolute w-0 border-l border-dashed border-ink-2" style={{ left: line.left, top: line.top, height: line.height }} />
        ))}
      </div>
      <p role="status" className="sr-only">
        {said}
      </p>
      <p className="text-xs text-ink-3">
        {date === null ? "" : `${stopWords(date)}: `}click or tap the chart to pin a date; press the same place, or Unpin, to let it go.
      </p>
    </div>
  );
}
