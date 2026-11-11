/**
 * The theme follows the OS setting unless the reader overrides it (ADR 0009; the one deliberate
 * difference from /missions). The override lives in a cookie so the server can render
 * `<html data-theme>` itself: no inline script, no flash of the wrong theme, and the control
 * works with JavaScript off. Pure; shared by the server and the client island.
 */
export const THEME_COOKIE = "atlas-theme";
export type Theme = "light" | "dark";
export type ThemeChoice = Theme | "auto";
export const THEME_CHOICES: readonly { value: ThemeChoice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** The reader's override, or null to follow the OS. */
export function themeFromCookie(value: string | undefined): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function parseThemeChoice(value: unknown): ThemeChoice | null {
  return value === "auto" || value === "light" || value === "dark" ? value : null;
}

/** The Set-Cookie value (also what the client island writes to document.cookie). */
export function themeCookie(choice: ThemeChoice, basePath: string): string {
  return choice === "auto"
    ? `${THEME_COOKIE}=; Path=${basePath}; Max-Age=0; SameSite=Lax`
    : `${THEME_COOKIE}=${choice}; Path=${basePath}; Max-Age=31536000; SameSite=Lax`;
}

/**
 * Where to send the reader after the form post: a path inside this app, or its front door.
 * The path is resolved the way a browser will resolve it before the boundary is checked, so
 * `..` segments, however they are written, cannot leave the app.
 */
export function safeReturnPath(value: unknown, basePath: string): string {
  const home = `${basePath}/`;
  if (typeof value !== "string" || value.length > 2000) return home;
  // A path, in printable ASCII, with nothing a browser could read as another origin.
  if (!/^\/[\x21-\x7e]*$/.test(value) || value.includes("\\") || value.includes("//")) return home;
  // An encoded dot, slash or backslash has no business in a path of this app (a query may have them).
  if (/%(2e|2f|5c)/i.test(value.split(/[?#]/)[0]!)) return home;
  let url: URL;
  try {
    url = new URL(value, "http://atlas.invalid");
  } catch {
    return home;
  }
  if (url.origin !== "http://atlas.invalid") return home;
  if (url.pathname !== basePath && !url.pathname.startsWith(home)) return home;
  return url.pathname + url.search + url.hash;
}
