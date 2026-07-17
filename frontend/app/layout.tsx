import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import Link from "next/link";
import Script from "next/script";

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
import { ConsentModeSync } from "@/components/ConsentModeSync";
import { ADSENSE_CLIENT } from "@/lib/site";

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

// Google AdSense loads in production only (keeps dev + the seeded-browser tests
// clean). Ad cookies stay off until "Accept all" via Consent Mode — see below.
const adsenseClient = process.env.NODE_ENV === "production" ? ADSENSE_CLIENT : "";

// Consent Mode v2 defaults: deny every ad/analytics signal until the visitor
// opts in (ConsentModeSync flips them). Must run before the AdSense loader.
const consentDefaultJs =
  "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}" +
  "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied'," +
  "ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});";

// Cloudflare Web Analytics beacon token. Set CF_BEACON_TOKEN in .env (from the
// Cloudflare dashboard → Web Analytics). Read at runtime like SITE_URL, so a
// container recreate picks it up — no rebuild needed. Cookieless, so it needs no
// consent gate. Left unset in dev → no beacon renders.
const cfBeaconToken = process.env.CF_BEACON_TOKEN;

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
      <head>
        {adsenseClient ? (
          <>
            {/* Consent Mode defaults (denied) — runs before the AdSense loader */}
            <script dangerouslySetInnerHTML={{ __html: consentDefaultJs }} />
            {/* AdSense loader — required in <head> for verification + serving */}
            <script
              async
              src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient}`}
              crossOrigin="anonymous"
            />
          </>
        ) : null}
      </head>
      <body className="min-h-screen overflow-x-clip">
        <ConsentModeSync />
        <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur">
          <div className="mx-auto flex max-w-[1800px] items-center gap-3 px-4 py-2.5 sm:gap-6 lg:px-8">
            <Link
              href="/"
              className="shrink-0 transition-opacity hover:opacity-90"
            >
              <Logo />
            </Link>
            {/* search centered between the logo and the nav */}
            <div className="mx-auto w-full max-w-xl">
              <SearchBar />
            </div>
            <nav className="flex shrink-0 items-center gap-4 sm:gap-5">
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
              <Link
                href="/guides"
                className="link-muted shrink-0 text-sm font-medium"
              >
                Guides
              </Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-24 pt-6">{children}</main>

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1800px] flex-col gap-2 px-4 py-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between lg:px-8">
            <span>
              StatRun · independent CS2 analytics · not affiliated with Valve,
              Steam, Leetify or FACEIT.
            </span>
            <span className="flex items-center gap-3">
              <Link href="/about" className="hover:text-muted">
                About
              </Link>
              <Link href="/guides" className="hover:text-muted">
                Guides
              </Link>
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

        {cfBeaconToken ? (
          <Script
            src="https://static.cloudflareinsights.com/beacon.min.js"
            strategy="afterInteractive"
            data-cf-beacon={JSON.stringify({ token: cfBeaconToken })}
          />
        ) : null}
      </body>
    </html>
  );
}
