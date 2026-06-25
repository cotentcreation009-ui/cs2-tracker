import { SearchBar } from "@/components/SearchBar";
import { Leaderboard } from "@/components/Leaderboard";
import { FeaturedPlayers } from "@/components/FeaturedPlayers";
import { RecentlyViewed } from "@/components/RecentlyViewed";
import { getLeaderboard } from "@/lib/api";

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

export default async function HomePage() {
  const leaders = await getLeaderboard(10).catch(() => []);

  return (
    <div>
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
    </div>
  );
}
