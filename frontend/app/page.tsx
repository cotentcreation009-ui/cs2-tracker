import { SearchBar } from "@/components/SearchBar";
import { Leaderboard } from "@/components/Leaderboard";
import { FeaturedPlayers } from "@/components/FeaturedPlayers";
import { RecentlyViewed } from "@/components/RecentlyViewed";
import Link from "next/link";
import { getLeaderboard } from "@/lib/api";
import { JsonLd } from "@/components/JsonLd";
import {
  graph,
  organizationSchema,
  websiteSchema,
  faqSchema,
} from "@/lib/schema";

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

// Cache the homepage (ISR); featured-player data and the leaderboard degrade
// gracefully when the backend is unavailable.
export const revalidate = 60;

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
    d: "StatRun fetches the account from Leetify, FACEIT and the Steam Web API.",
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
    a: "Paste their SteamID, Steam vanity URL or full profile link into the search box above. StatRun instantly pulls that account's Leetify, FACEIT and Steam data into one page — no login required.",
  },
  {
    q: "What do Leetify ratings mean?",
    a: "Leetify grades a player's aim, utility and positioning against a performance baseline — higher is better. Numbers consistently above the benchmark for a player's skill level point to a strong, well-rounded game, while the sub-ratings show where someone is carrying or struggling.",
  },
  {
    q: "How do FACEIT levels and ELO work?",
    a: "FACEIT levels run from 1 to 10 and are driven by ELO: level 1 is the entry tier and level 10 begins at 2001 ELO. StatRun shows both the level badge and the exact ELO, so you can see how close a player is to the next tier.",
  },
  {
    q: "Can I tell if a player is smurfing or cheating?",
    a: "StatRun's CheatMeter, together with Steam trust signals like account age, VAC/ban status and cross-platform rank gaps, helps flag suspicious accounts. Treat it as a prompt to look closer — a starting point, not proof.",
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
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-faint">
            <a
              className="font-medium text-brand hover:underline"
              href="/profiles/76561198077030352"
            >
              Try a live profile →
            </a>
            <span aria-hidden>·</span>
            <span>Powered by Leetify · FACEIT · Steam</span>
          </div>
        </div>
      </section>

      <RecentlyViewed />

      <FeaturedPlayers />

      <section className="mt-8 grid gap-4 md:grid-cols-3">
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
            FACEIT for level and ELO. StatRun pulls all three together, so sizing
            up a teammate or scouting an opponent takes one search instead of five
            browser tabs.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
            No account and no download — the lookup works off public data, so you
            get a full breakdown the moment you hit enter. Vet a random teammate
            before the match starts, scout an opponent, or track your own climb
            across Premier, FACEIT and Leetify over time.{" "}
            <Link href="/about" className="text-brand hover:underline">
              Learn more about StatRun →
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
        </div>
      </section>
    </div>
  );
}
