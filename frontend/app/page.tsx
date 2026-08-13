import type { Metadata } from "next";
import { SearchBar } from "@/components/SearchBar";
import { Leaderboard } from "@/components/Leaderboard";
import { FeaturedPlayers } from "@/components/FeaturedPlayers";
import { RecentlyViewed } from "@/components/RecentlyViewed";
import Link from "next/link";
import { getLeaderboard } from "@/lib/api";
import { JsonLd } from "@/components/JsonLd";
import { GUIDES } from "@/lib/guides";
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

// Cache the homepage (ISR); featured-player data and the leaderboard degrade
// gracefully when the backend is unavailable.
export const revalidate = 60;

// Self-referencing canonical so query-param/trailing-slash/host variants of the
// site's most important URL don't fragment its ranking. metadataBase (layout)
// resolves the relative "/".
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const FEATURES = [
  {
    title: "Every rank in one place",
    body: "Premier rating, FACEIT level & ELO, Wingman rank and Leetify rating for any account — pulled live from a single SteamID.",
    accent: "bg-brand/10 text-brand",
  },
  {
    title: "Deep Leetify analytics",
    body: "Aim, positioning and utility ratings, opening duels, clutches, trading and recent-match form — the numbers past the scoreboard.",
    accent: "bg-brand2/10 text-brand2",
  },
  {
    title: "Steam identity & trust",
    body: "Account age, CS2 friend code, friends and ban checks — vet a teammate or scope an opponent in seconds.",
    accent: "bg-mid/10 text-mid",
  },
];

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

export default async function HomePage() {
  const leaders = await getLeaderboard(10).catch(() => []);

  const homeSchema = graph([
    organizationSchema(siteUrl),
    websiteSchema(siteUrl),
    faqSchema(siteUrl, "/", HOME_FAQ),
  ]);

  return (
    <div>
      <JsonLd data={homeSchema} />
      <section
        className="relative overflow-hidden rounded-2xl border border-brand/25 bg-panel2/40 px-6 py-16 text-center backdrop-blur-sm sm:px-10 sm:py-24"
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
              href="/profiles/76561198077030352"
            >
              Try a live profile →
            </Link>
            <span aria-hidden>·</span>
            <span>Public data from Leetify · FACEIT · Steam</span>
          </div>
        </div>
      </section>

      <RecentlyViewed />

      <FeaturedPlayers />

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
          What you get
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card lift px-5 py-5">
              <div
                className={`mb-3 grid h-9 w-9 place-items-center rounded-lg ${f.accent}`}
              >
                <span className="h-2 w-2 rounded-full bg-current" />
              </div>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {leaders.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
            Top tracked players
          </h2>
          <Leaderboard players={leaders} />
        </section>
      )}

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
