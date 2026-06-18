import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { SearchBar } from "@/components/SearchBar";

export const metadata: Metadata = {
  title: "CS2 Tracker — advanced Counter-Strike 2 stats",
  description:
    "Per-match and career CS2 analytics: rating, ADR, KAST, clutches, opening duels and more.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand to-brand2 text-sm font-black text-bg">
                CS
              </span>
              <span className="text-lg font-bold tracking-tight">
                Tracker<span className="text-brand">.gg</span>
              </span>
            </Link>
            <div className="ml-auto flex items-center gap-3">
              <div className="w-full max-w-md">
                <SearchBar />
              </div>
              <Link
                href="/compare"
                className="link-muted shrink-0 text-sm font-medium"
              >
                Compare
              </Link>
              <Link
                href="/ingest"
                className="link-muted shrink-0 text-sm font-medium"
              >
                Ingest
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-24 pt-6">{children}</main>

        <footer className="border-t border-line">
          <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-faint">
            CS2 Tracker · open-source analytics for Counter-Strike 2 · not
            affiliated with Valve.
          </div>
        </footer>
      </body>
    </html>
  );
}
