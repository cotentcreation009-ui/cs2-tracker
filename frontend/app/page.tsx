import type { Metadata } from "next";
import Link from "next/link";
import { SearchBar } from "@/components/SearchBar";
import { RecentlyViewed } from "@/components/RecentlyViewed";
import { FaceitTopPlayers } from "@/components/FaceitTopPlayers";
import { Leaderboard } from "@/components/Leaderboard";
import { SectionHeading } from "@/components/SectionHeading";
import { JsonLd } from "@/components/JsonLd";
import { getTopAnalysed } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { GUIDES } from "@/lib/guides";
import type { TopAnalysedResponse } from "@/lib/types";
import {
  graph,
  organizationSchema,
  websiteSchema,
  faqSchema,
} from "@/lib/schema";

// Four evergreen guides surfaced on the homepage; the full library is one
// click away. Resolved from the registry so a renamed slug fails the build
// instead of 404ing quietly.
const FEATURED_GUIDE_SLUGS = [
  "premier-cs-rating-explained",
  "faceit-levels-and-elo",
  "what-is-a-good-adr-cs2",
  "spotting-smurfs-and-cheaters",
];
const FEATURED_GUIDES = FEATURED_GUIDE_SLUGS.map((slug) => {
  const g = GUIDES.find((x) => x.slug === slug);
  if (!g) throw new Error(`featured guide missing from registry: ${slug}`);
  return g;
});

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

// Cache the homepage (ISR). Everything it fetches is Redis-served at the
// backend (the FACEIT snapshot an hour, the board ten minutes) and degrades
// to an honest one-liner, never a blank, when the backend is unavailable.
export const revalidate = 60;

// Self-referencing canonical so query-param/trailing-slash/host variants of the
// site's most important URL don't fragment its ranking. metadataBase (layout)
// resolves the relative "/".
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// A known-rich, public account the hero can point a first-time visitor at.
// A LINK, never a fetch: the page itself asks nothing about this profile.
const DEMO_PROFILE_ID = "76561198077030352";

// The analysed-players board's floor and window. Five demos and ninety days:
// 384 of the 402 career rows in production are a single lobby, and a one-
// match row with a 9.00 K/D over six rounds is noise, not a top player. If
// the board runs thin as demos age, these are the two numbers to move.
const BOARD_MIN_DEMOS = 5;
const BOARD_WINDOW_DAYS = 90;

type FeatureIcon = "layers" | "chart" | "shield";

const FEATURES: { title: string; body: string; accent: string; icon: FeatureIcon }[] = [
  {
    title: "Every rank in one place",
    body: "Premier rating, FACEIT level & ELO, Wingman rank and Leetify rating for any account — pulled live from a single SteamID.",
    accent: "bg-brand/10 text-brand",
    icon: "layers",
  },
  {
    title: "Deep Leetify analytics",
    body: "Aim, positioning and utility ratings, opening duels, clutches, trading and recent-match form — the numbers past the scoreboard.",
    accent: "bg-brand2/10 text-brand2",
    icon: "chart",
  },
  {
    title: "Steam identity & trust",
    body: "Account age, CS2 friend code, friends and ban checks — vet a teammate or scope an opponent in seconds.",
    accent: "bg-mid/10 text-mid",
    icon: "shield",
  },
];

// Inline, stroke="currentColor" like the search glyph, so each tile's icon
// takes the tile's accent colour.
function FeatureGlyph({ icon }: { icon: FeatureIcon }) {
  const common = {
    className: "h-5 w-5",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (icon) {
    case "layers":
      return (
        <svg {...common}>
          <path d="m12 3 9 5-9 5-9-5 9-5Z" />
          <path d="m3 12.5 9 5 9-5" />
          <path d="m3 17 9 5 9-5" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <path d="M3 20h18" />
          <path d="m4 15 5-5 4 4 7-8" />
          <path d="M16 6h4v4" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3 4.5 6v5.2c0 4.7 3.2 8.3 7.5 9.8 4.3-1.5 7.5-5.1 7.5-9.8V6L12 3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
  }
}

// Three-step explainer for the "how to look up CS2 stats" section.
const STEPS: { n: string; t: string; d: string }[] = [
  {
    n: "1",
    t: "Paste an ID",
    d: "A SteamID, a Steam vanity name, or a full profile URL — whatever you have.",
  },
  {
    n: "2",
    t: "We pull it live",
    d: "CSRun fetches the account from Leetify, FACEIT and the Steam Web API.",
  },
  {
    n: "3",
    t: "Read the full picture",
    d: "Ranks, aim & utility ratings, trust signals and recent form in one view.",
  },
];

// Homepage FAQ — deliberately distinct from /about's FAQ (targets lookup-intent
// and "what does X mean" queries) so the two pages don't duplicate content. Also
// emitted as FAQPage structured data below.
const HOME_FAQ: { q: string; a: string }[] = [
  {
    q: "How do I find someone's CS2 stats?",
    a: "Paste their SteamID, Steam vanity URL or full profile link into the search box above. CSRun instantly pulls that account's Leetify, FACEIT and Steam data into one page — no login required.",
  },
  {
    q: "What do Leetify ratings mean?",
    a: "Leetify grades a player's aim, utility and positioning against a performance baseline — higher is better. Numbers consistently above the benchmark for a player's skill level point to a strong, well-rounded game, while the sub-ratings show where someone is carrying or struggling.",
  },
  {
    q: "How do FACEIT levels and ELO work?",
    a: "FACEIT levels run from 1 to 10 and are driven by ELO: level 1 is the entry tier and level 10 begins at 2001 ELO. CSRun shows both the level badge and the exact ELO, so you can see how close a player is to the next tier.",
  },
  {
    q: "Can I tell if a player is smurfing or cheating?",
    a: "CSRun's CheatMeter, together with Steam trust signals like account age, VAC/ban status and cross-platform rank gaps, helps flag suspicious accounts. Treat it as a prompt to look closer — a starting point, not proof.",
  },
];

// The board's subline is the server's statement of what the rows are — the
// floor, the window and the count come from the response, never from copy.
function boardSubline(board: TopAnalysedResponse | null): string {
  const base = "HLTV 1.0 rating across demos analysed on CSRun";
  if (!board) return base;
  const parts = [base, `${board.minMatches}+ demos`];
  if (board.windowDays > 0) parts.push(`last ${board.windowDays} days`);
  parts.push(`${board.qualified} ${board.qualified === 1 ? "player qualifies" : "players qualify"}`);
  if (board.asOf) {
    const ago = timeAgo(board.asOf);
    if (ago) parts.push(`updated ${ago}`);
  }
  return parts.join(" · ");
}

export default async function HomePage() {
  const board = await getTopAnalysed({
    limit: 10,
    min: BOARD_MIN_DEMOS,
    days: BOARD_WINDOW_DAYS,
  }).catch(() => null);

  const homeSchema = graph([
    organizationSchema(siteUrl),
    websiteSchema(siteUrl),
    faqSchema(siteUrl, "/", HOME_FAQ),
  ]);

  const boardWindow =
    board && board.windowDays > 0 ? ` in the last ${board.windowDays} days` : "";

  return (
    <div>
      <JsonLd data={homeSchema} />
      {/* No overflow-hidden here: the search box's dropdown lives inside this
          card and was being clipped at its bottom edge (two "Recent" rows and
          a slice of a third). The rounded corners still clip the card's own
          background and the glow is a box-shadow, so nothing else needed it.
          z-10 keeps the overflowing dropdown above the hover-lifted cards
          below (their transform makes a stacking context) and under the
          header's z-20. */}
      <section
        className="relative z-10 rounded-2xl border border-brand/25 bg-panel2/40 px-6 py-16 text-center backdrop-blur-sm sm:px-10 sm:py-24"
        style={{ boxShadow: "0 0 60px -14px rgba(56,214,255,0.30)" }}
      >
        <div className="relative mx-auto max-w-2xl">
          <div className="pill mx-auto mb-5 border border-brand/20 bg-brand/10 text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand2" />
            Counter-Strike 2 · live stats
          </div>
          <h1 className="text-balance text-4xl font-extrabold tracking-tight sm:text-6xl">
            The CS2 tracker that goes{" "}
            <span className="gradient-text">past the scoreboard</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-muted sm:text-lg">
            Look up any player by SteamID, vanity name, or profile URL — Leetify
            rating, FACEIT level, ranks and Steam identity, all in one place.
          </p>
          <div className="mx-auto mt-8 max-w-md">
            <SearchBar autoFocus />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted">
            <Link
              className="font-medium text-brand hover:underline"
              href={`/profiles/${DEMO_PROFILE_ID}`}
            >
              See an example profile →
            </Link>
            <span aria-hidden>·</span>
            <span>Public data from Leetify · FACEIT · Steam</span>
          </div>
        </div>
      </section>

      <RecentlyViewed />

      <FaceitTopPlayers />

      <section className="mt-10" aria-labelledby="what-you-get-heading">
        <SectionHeading id="what-you-get-heading" eyebrow="What you get" />
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card px-5 py-5">
              <div
                className={`mb-3 grid h-9 w-9 place-items-center rounded-lg ${f.accent}`}
              >
                <FeatureGlyph icon={f.icon} />
              </div>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Never silently absent: a thin board says it is thin, a failed fetch
          says it failed, and the demo analyzer is the way onto it either way. */}
      <section className="mt-10" aria-labelledby="analysed-heading">
        <SectionHeading
          id="analysed-heading"
          eyebrow="Top analysed players"
          subline={boardSubline(board)}
          action={
            <Link
              href="/demos"
              className="text-sm font-semibold text-brand hover:underline"
            >
              Analyse a demo →
            </Link>
          }
        />
        {board === null ? (
          <div className="card-2 px-5 py-6 text-center text-sm text-muted">
            The board couldn&apos;t load — try again in a minute.
          </div>
        ) : board.qualified >= 3 && board.players.length > 0 ? (
          <Leaderboard
            players={board.players}
            minMatches={board.minMatches}
            windowDays={board.windowDays}
          />
        ) : (
          <div className="card-2 px-5 py-6 text-center text-sm text-muted">
            Not enough players with {board.minMatches}+ analysed demos
            {boardWindow} yet ({board.qualified} so far).{" "}
            <Link
              href="/demos"
              className="font-semibold text-brand hover:underline"
            >
              Analyse a demo →
            </Link>
          </div>
        )}
      </section>

      {/* Editorial content — makes the homepage substantial and keyword-relevant
          for search, without pushing the search tool below the fold. */}
      <section className="mt-14 border-t border-line pt-10">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight">
            Check any Counter-Strike 2 player in seconds
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-muted sm:text-base">
            Every CS2 player leaves a trail across three services — Steam for
            identity and bans, Leetify for the deep aim and utility numbers, and
            FACEIT for level and ELO. CSRun pulls all three together, so sizing
            up a teammate or scouting an opponent takes one search instead of five
            browser tabs.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
            No account and no download — the lookup works off public data, so you
            get a full breakdown the moment you hit enter. Vet a random teammate
            before the match starts, scout an opponent, or track your own climb
            across Premier, FACEIT and Leetify over time. Studying your own play?
            The{" "}
            <Link
              href="/demos"
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              demo analyzer
            </Link>{" "}
            replays any match round by round.{" "}
            <Link
              href="/about"
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              Learn more about CSRun →
            </Link>
          </p>

          <h2 className="mt-10 text-2xl font-bold tracking-tight">
            How to look up CS2 stats
          </h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="card px-5 py-5">
                <div className="mb-3 grid h-8 w-8 place-items-center rounded-lg bg-brand/10 font-bold text-brand">
                  {s.n}
                </div>
                <h3 className="font-semibold">{s.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.d}</p>
              </li>
            ))}
          </ol>

          <h2 className="mt-10 text-2xl font-bold tracking-tight">
            CS2 stats — quick answers
          </h2>
          <div className="mt-4 space-y-3">
            {HOME_FAQ.map((f) => (
              <details key={f.q} className="card group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <svg
                    className="h-4 w-4 shrink-0 text-faint transition-transform group-open:rotate-180"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                From the guides
              </h2>
              <p className="mt-1.5 text-sm text-muted">
                Plain-English explainers for the numbers on every profile.
              </p>
            </div>
            <Link
              href="/guides"
              className="text-sm font-semibold text-brand hover:underline"
            >
              All {GUIDES.length} guides →
            </Link>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {FEATURED_GUIDES.map((g) => (
              <Link
                key={g.slug}
                href={`/guides/${g.slug}`}
                className="card lift block px-5 py-5"
              >
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand">
                  {g.tag}
                  <span aria-hidden className="text-faint">
                    ·
                  </span>
                  <span className="font-normal text-faint">{g.read}</span>
                </div>
                <h3 className="mt-2 font-bold tracking-tight">
                  {g.shortTitle ?? g.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  {g.description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
