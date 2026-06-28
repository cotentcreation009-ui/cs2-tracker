import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import Link from "next/link";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
import { SearchBar } from "@/components/SearchBar";
import { Logo } from "@/components/Logo";
import {
  CookieConsent,
  CookieSettingsButton,
} from "@/components/CookieConsent";

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "StatRun — CS2 Leetify, FACEIT & Steam stats for any player",
  description:
    "StatRun looks up any Counter-Strike 2 player: Leetify rating, FACEIT level & ELO, Premier/Wingman ranks, aim & utility stats, and Steam identity — all from one SteamID.",
  applicationName: "StatRun",
  openGraph: {
    type: "website",
    siteName: "StatRun",
    title: "StatRun — CS2 Leetify, FACEIT & Steam stats for any player",
    description:
      "Look up any CS2 player's Leetify rating, FACEIT level, ranks and Steam identity in one place.",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen overflow-x-clip">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
            <Link
              href="/"
              className="shrink-0 transition-opacity hover:opacity-90"
            >
              <Logo />
            </Link>
            <div className="ml-auto flex items-center gap-3">
              <div className="w-full max-w-md">
                <SearchBar />
              </div>
              <Link
                href="/demos"
                className="link-muted shrink-0 text-sm font-medium"
              >
                Demos
              </Link>
              <Link
                href="/compare"
                className="link-muted shrink-0 text-sm font-medium"
              >
                Compare
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-24 pt-6">{children}</main>

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
            <span>
              StatRun · independent CS2 analytics · not affiliated with Valve,
              Steam, Leetify or FACEIT.
            </span>
            <span className="flex items-center gap-3">
              <Link href="/privacy" className="hover:text-muted">
                Privacy
              </Link>
              <Link href="/terms" className="hover:text-muted">
                Terms
              </Link>
              <CookieSettingsButton />
            </span>
          </div>
        </footer>

        <CookieConsent />
      </body>
    </html>
  );
}
