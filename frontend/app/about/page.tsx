// About page. Editorial/trust content that establishes what StatRun is, where
// its data comes from, and who stands behind it — the E-E-A-T anchor for SEO and
// a prerequisite for ad-network review. Static (no data fetching) so it renders
// as fully-crawlable HTML. Copy is intentionally honest: independent project,
// public data only. Edit the entity/contact details in lib/site.ts.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/site";
import { JsonLd } from "@/components/JsonLd";
import {
  graph,
  organizationSchema,
  websiteSchema,
  faqSchema,
} from "@/lib/schema";

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  title: `About ${SITE_NAME} — independent CS2 stats & demo analytics`,
  description: `What ${SITE_NAME} is, where its Counter-Strike 2 data comes from, and how it handles player privacy. An independent tool for Leetify, FACEIT and Steam stats plus demo analysis.`,
  alternates: { canonical: "/about" },
  openGraph: {
    title: `About ${SITE_NAME}`,
    description: `An independent Counter-Strike 2 stats & demo-analysis tool — Leetify, FACEIT and Steam data for any player, in one place.`,
    url: "/about",
    type: "website",
  },
};

// Feature cards — each links into a real tool so crawl equity flows inward.
const TOOLS: { title: string; body: string; href: string; accent: string }[] = [
  {
    title: "Player lookup",
    body: "Paste any SteamID, vanity name or profile URL and get Premier rating, FACEIT level & ELO, Wingman rank, Leetify stats and Steam identity together.",
    href: "/",
    accent: "bg-brand/10 text-brand",
  },
  {
    title: "Demo analyzer",
    body: "Upload a demo or drop a Premier share code, then replay rounds, trace routes, break down utility and weapons, and read an AI-assisted cheat review.",
    href: "/demos",
    accent: "bg-brand2/10 text-brand2",
  },
  {
    title: "CheatMeter",
    body: "A suspicion score built from public stats and behavioural signals — a starting point for a closer look, not an accusation. Also shown by the browser extension.",
    href: "/profiles/76561198077030352",
    accent: "bg-mid/10 text-mid",
  },
  {
    title: "Compare players",
    body: "Put two accounts side by side to see who really has the edge across ranks, aim, utility and recent form.",
    href: "/compare",
    accent: "bg-brand/10 text-brand",
  },
];

// Single source of truth for both the visible FAQ and the FAQPage schema, so the
// structured data always matches what users actually see (a Google requirement).
const FAQ: { q: string; a: string }[] = [
  {
    q: `Is ${SITE_NAME} affiliated with Valve, Steam, Leetify or FACEIT?`,
    a: `No. ${SITE_NAME} is an independent project. It is not affiliated with, endorsed by, or sponsored by Valve, Steam, Leetify or FACEIT. "Counter-Strike" and "Steam" are trademarks of Valve Corporation.`,
  },
  {
    q: "Where does the data come from?",
    a: `${SITE_NAME} does not generate stats. It aggregates publicly available data from the Steam Web API (persona, avatar, account age, CS2 friend code, VAC/ban status), Leetify (aim, utility and positioning ratings, clutches, recent form) and FACEIT (level, ELO and match history). Responses are cached briefly and refreshed on demand.`,
  },
  {
    q: `Do I need to sign in or give my Steam password?`,
    a: `No. Looking up a player never requires an account, and ${SITE_NAME} never asks for your Steam login or password. You only ever paste a public SteamID, vanity name or profile URL.`,
  },
  {
    q: `Is ${SITE_NAME} free?`,
    a: `Yes — ${SITE_NAME} is free to use.`,
  },
  {
    q: "What is the CheatMeter?",
    a: `The CheatMeter is a heuristic suspicion score derived from a player's public statistics and behavioural signals. It is a prompt to look closer, not proof or an accusation of cheating.`,
  },
  {
    q: "Can I analyze my own demos?",
    a: `Yes. Upload a CS2 demo (or provide a Premier match share code) and ${SITE_NAME} parses it server-side to give you a round replay, route tracing, utility and weapon breakdowns, callout zones and an AI-assisted cheat review.`,
  },
  {
    q: "How do I remove my profile?",
    a: `Email ${CONTACT_EMAIL} with your SteamID or profile link. We will suppress your profile on ${SITE_NAME} and clear its cached data. (The underlying data still exists at Steam, Leetify and FACEIT; you can also adjust your privacy settings there.)`,
  },
  {
    q: "Is there a browser extension?",
    a: `Yes. The ${SITE_NAME} browser extension surfaces CheatMeter scores and cross-platform ranks directly inside FACEIT match rooms and Steam profiles, so you can vet a lobby without leaving the page.`,
  },
];

function H({ children }: { children: ReactNode }) {
  return <h2 className="mt-10 text-xl font-bold tracking-tight">{children}</h2>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-muted">{children}</p>;
}

export default function AboutPage() {
  const schema = graph([
    organizationSchema(siteUrl),
    websiteSchema(siteUrl),
    faqSchema(siteUrl, "/about", FAQ),
  ]);

  return (
    <article className="mx-auto max-w-3xl pb-20">
      <JsonLd data={schema} />

      {/* Hero */}
      <div className="pill mb-5 border border-brand/20 bg-brand/10 text-brand">
        <span className="h-1.5 w-1.5 rounded-full bg-brand2" />
        About · independent CS2 analytics
      </div>
      <h1 className="text-balance text-4xl font-extrabold tracking-tight sm:text-5xl">
        About <span className="gradient-text">{SITE_NAME}</span>
      </h1>
      <p className="mt-5 max-w-2xl text-pretty leading-relaxed text-muted sm:text-lg">
        {SITE_NAME} is an independent, community-built Counter-Strike 2 analytics
        project — made by players, run transparently, and powered entirely by
        public data. Here&apos;s what it does, where its numbers come from, and how
        it treats the people it covers.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-lg bg-brand px-4 py-2 font-semibold text-bg transition-opacity hover:opacity-90"
        >
          Look up a player →
        </Link>
        <span className="text-xs text-faint">
          Not affiliated with Valve, Steam, Leetify or FACEIT.
        </span>
      </div>

      {/* What StatRun is */}
      <H>What {SITE_NAME} is</H>
      <P>
        {SITE_NAME} brings a Counter-Strike 2 player&apos;s scattered stats into a
        single page. Instead of juggling Steam, Leetify and FACEIT across tabs,
        you paste one SteamID, vanity URL or profile link and get their Premier
        rating (Valve&apos;s CS Rating), FACEIT level &amp; ELO, Wingman rank,
        Leetify aim, utility and positioning numbers, and Steam identity — account
        age, CS2 friend code and VAC/ban status — together.
      </P>
      <P>
        Beyond lookups, {SITE_NAME} analyzes match demos: replay the round, trace
        every player&apos;s route, break down utility and weapon performance, map
        callout zones, and get an AI-assisted cheat review — the kind of detail
        that usually takes dedicated software.
      </P>
      <P>
        It&apos;s built for players who want to vet a teammate, scope an opponent,
        or study their own game past the final scoreboard.
      </P>

      {/* What you can do */}
      <H>What you can do</H>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <Link key={t.title} href={t.href} className="card lift px-5 py-5">
            <div
              className={`mb-3 grid h-9 w-9 place-items-center rounded-lg ${t.accent}`}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
            </div>
            <h3 className="font-semibold">{t.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{t.body}</p>
          </Link>
        ))}
      </div>

      {/* Data sources */}
      <H>Where the data comes from</H>
      <P>
        {SITE_NAME} does not create player stats — it aggregates publicly
        available data from established providers and public APIs:
      </P>
      <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
        <li>
          <strong className="text-ink">Steam Web API</strong> — persona name,
          avatar, country, account age, CS2 friend code and VAC/ban status.
        </li>
        <li>
          <strong className="text-ink">Leetify</strong> — aim, utility and
          positioning ratings, clutches, opening duels and recent form.
        </li>
        <li>
          <strong className="text-ink">FACEIT</strong> — level, ELO and match
          history.
        </li>
      </ul>
      <P>
        Responses are cached briefly to reduce load on those services and
        refreshed on demand. {SITE_NAME} is an independent tool and is not
        affiliated with, endorsed by, or sponsored by Valve, Steam, Leetify or
        FACEIT. &ldquo;Counter-Strike&rdquo; and &ldquo;Steam&rdquo; are
        trademarks of Valve Corporation.
      </P>

      {/* Who's behind it */}
      <H>Independent &amp; accountable</H>
      <P>
        {SITE_NAME} is an independent, community-built project — not a company
        product, and not tied to any game publisher or stats provider. We keep it
        deliberately simple: no account is needed to look up a player, and{" "}
        {SITE_NAME} never asks for your Steam login or password. If something looks
        wrong — or you&apos;re a player who wants your profile corrected or
        removed — you can reach a real person at{" "}
        <a
          className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
          href={`mailto:${CONTACT_EMAIL}`}
        >
          {CONTACT_EMAIL}
        </a>
        .
      </P>

      {/* Privacy */}
      <H>Your data &amp; privacy</H>
      <P>
        We display only public data, cache it briefly, and honor removal requests.
        Any advertising or analytics cookies load only after you opt in. If
        you&apos;re a player and want off the site, email us your SteamID and
        we&apos;ll suppress your profile and clear its cache. Full details are in
        our{" "}
        <Link href="/privacy" className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand">
          Privacy Policy
        </Link>{" "}
        and{" "}
        <Link href="/terms" className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand">
          Terms of Service
        </Link>
        .
      </P>

      {/* FAQ */}
      <H>Frequently asked questions</H>
      <div className="mt-4 space-y-3">
        {FAQ.map((f) => (
          <details
            key={f.q}
            className="card px-5 py-4 [&_summary]:cursor-pointer"
          >
            <summary className="font-semibold text-ink marker:text-faint">
              {f.q}
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
          </details>
        ))}
      </div>

      {/* Closing CTA */}
      <div className="mt-12 rounded-2xl border border-brand/25 bg-panel2/40 px-6 py-8 text-center">
        <h2 className="text-xl font-bold tracking-tight">Ready to dig in?</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Look up any Counter-Strike 2 player, or analyze your latest match demo.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-lg bg-brand px-4 py-2 font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Look up a player →
          </Link>
          <Link
            href="/demos"
            className="inline-flex items-center gap-1 rounded-lg border border-line px-4 py-2 font-semibold text-ink transition-colors hover:border-brand/40"
          >
            Analyze a demo
          </Link>
        </div>
      </div>
    </article>
  );
}
