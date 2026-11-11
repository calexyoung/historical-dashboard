"use client";

import { useState, type FormEvent } from "react";
import { THEME_CHOICES, parseThemeChoice, themeCookie, type Theme, type ThemeChoice } from "@/lib/theme";

/**
 * Auto follows the OS setting; Light and Dark override it and are remembered (ADR 0009).
 *
 * It is a real form: with JavaScript off, each button posts to /api/theme, which sets the cookie
 * and returns the reader to the same page. With JavaScript on, the same press is applied in
 * place. The change is instant on purpose: a theme is not a thing that should fade.
 */
export function ThemeControl({
  basePath,
  returnTo,
  initial,
}: {
  basePath: string;
  returnTo: string;
  initial: Theme | null;
}) {
  const [choice, setChoice] = useState<ThemeChoice>(initial ?? "auto");

  const apply = (event: FormEvent<HTMLFormElement>) => {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const next = parseThemeChoice(submitter?.value);
    if (!next) return; // let the form post; the server answers
    event.preventDefault();
    document.cookie = themeCookie(next, basePath);
    if (next === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    setChoice(next);
  };

  return (
    <form method="post" action={`${basePath}/api/theme`} onSubmit={apply} className="ml-auto sm:ml-0">
      <input type="hidden" name="return" value={returnTo} />
      <div role="group" aria-label="Theme" className="inline-flex overflow-hidden rounded border border-control">
        {THEME_CHOICES.map((option) => {
          const on = option.value === choice;
          return (
            <button
              key={option.value}
              type="submit"
              name="theme"
              value={option.value}
              aria-pressed={on}
              className={`press h-8 border-l border-control px-2.5 text-xs first:border-l-0 ${
                on ? "bg-accent/20 font-semibold text-ink" : "bg-raised text-ink-2 hover-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </form>
  );
}
