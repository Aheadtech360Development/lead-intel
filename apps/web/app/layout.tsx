import type { Metadata } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { readTheme, THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

/**
 * Three faces, each with a job — and all three self-hosted.
 *
 * `next/font` downloads these at build time and serves them from the product's own domain, so a
 * cold load makes no third-party request, cannot be slowed by somebody else's CDN, and never shows
 * the fallback first. That matters here specifically: the operator's report was "platform ki speed
 * kafi slow hai", and a webfont fetched from a font host is one of the easiest ways to put two
 * round trips in front of the first paint.
 *
 * Inter for the interface. Inter Tight for headings and figures — a little narrower, so a 28px
 * number states itself rather than shouting. JetBrains Mono wherever digits have to line up in a
 * column: money, counts, ids, priorities.
 */
const sans = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans" });
const display = Inter_Tight({ subsets: ["latin"], display: "swap", variable: "--font-display" });
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Lead Intel — AheadTech360",
  description: "Local business lead intelligence.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /**
   * The theme is stamped here, on <html>, and nowhere else.
   *
   * Stamping it in the root layout means it is part of the very first byte of HTML: there is no
   * moment where a dark-mode operator sees a white page, which is what any script-based toggle
   * costs. "system" deliberately stamps **nothing** — that is the state where
   * `prefers-color-scheme` is allowed to decide, and an attribute would silence it.
   */
  const theme = readTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} ${mono.variable}`}
      {...(theme === "system" ? {} : { "data-theme": theme })}
    >
      <body>{children}</body>
    </html>
  );
}
