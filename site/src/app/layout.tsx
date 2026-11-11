import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { ReleaseStrip } from "@/components/ReleaseStrip";
import { SiteFooter } from "@/components/SiteFooter";
import { TabBar } from "@/components/TabBar";
import { TopBar } from "@/components/TopBar";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { freshness } from "@/lib/freshness";
import { releaseForRequest } from "@/lib/release/server";
import { THEME_COOKIE, themeFromCookie } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Macro Atlas", template: "%s · Macro Atlas" },
  description: "Data and facts about the past and current state of the United States in a global context.",
  // Only the production surface is for search engines.
  robots: SURFACE === "production" ? undefined : { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1318" },
  ],
};

// System font stacks only: nothing is downloaded at build time or from another origin.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { release, refreshFailed, path, now } = await releaseForRequest();
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);
  const pathname = path.split("?")[0]!;
  const fresh = freshness(release.manifest.created, refreshFailed, now);
  return (
    <html lang="en" className="h-full antialiased" data-theme={theme ?? undefined} suppressHydrationWarning>
      <body className="flex min-h-full flex-col" data-release={release.id}>
        <a href="#main" className="skip-link rounded border border-control bg-void px-3 py-2 text-sm font-semibold text-accent">
          Skip to content
        </a>
        <TopBar basePath={BASE_PATH} pathname={pathname} returnTo={BASE_PATH + path} theme={theme} freshness={fresh} />
        <TabBar basePath={BASE_PATH} pathname={pathname} />
        <ReleaseStrip release={release} />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 outline-none lg:px-6">
          {children}
        </main>
        <SiteFooter surface={SURFACE} release={release} />
      </body>
    </html>
  );
}
