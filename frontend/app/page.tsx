import { SearchBar } from "@/components/SearchBar";
import { Leaderboard } from "@/components/Leaderboard";
import { getLeaderboard } from "@/lib/api";

// The leaderboard is live data; render per-request (and degrade gracefully when
// the backend is unavailable).
export const dynamic = "force-dynamic";

const FEATURES = [
  {
    title: "Every rank in one place",
    body: "Premier rating, FACEIT level & ELO, Wingman rank and Leetify rating for any account — pulled live from a single SteamID.",
  },
  {
    title: "Deep Leetify analytics",
    body: "Aim, positioning and utility ratings, opening duels, clutches, trading and recent-match form — the numbers past the scoreboard.",
  },
  {
    title: "Steam identity & trust",
    body: "Account age, CS2 friend code, friends and ban checks — vet a teammate or scope an opponent in seconds.",
  },
];

export default async function HomePage() {
  const leaders = await getLeaderboard(10).catch(() => []);

  return (
    <div>
      <section className="card-2 relative overflow-hidden px-6 py-14 text-center sm:px-10">
        <div className="mx-auto max-w-2xl">
          <div className="pill mx-auto mb-4 bg-brand/10 text-brand">
            Counter-Strike 2 · Steam App 730
          </div>
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            The CS2 stat tracker that goes{" "}
            <span className="bg-gradient-to-r from-brand to-brand2 bg-clip-text text-transparent">
              past the scoreboard
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-muted">
            Look up any CS2 player by SteamID64, vanity name or profile URL — and
            see their Leetify rating, FACEIT level, ranks and Steam identity in
            one place.
          </p>
          <div className="mx-auto mt-7 max-w-md">
            <SearchBar autoFocus />
          </div>
          <p className="mt-3 text-xs text-faint">
            See an example:{" "}
            <a
              className="text-brand hover:underline"
              href="/profiles/76561198077030352"
            >
              a live player profile
            </a>
          </p>
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card px-5 py-5">
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
