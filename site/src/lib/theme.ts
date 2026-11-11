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

/** Where to send the reader after the form post: a path inside this app, or its front door. */
export function safeReturnPath(value: unknown, basePath: string): string {
  const home = `${basePath}/`;
  if (typeof value !== "string" || value.length > 2000) return home;
  if (value !== basePath && !value.startsWith(home)) return home;
  // Printable ASCII only, and nothing a browser could read as another origin or a parent path.
  if (!/^[\x21-\x7e]*$/.test(value) || value.includes("\\") || value.includes("//") || /(^|\/)\.\.(\/|$|\?|#)/.test(value)) {
    return home;
  }
  return value;
}
