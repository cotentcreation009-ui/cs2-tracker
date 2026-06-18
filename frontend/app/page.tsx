import { SearchBar } from "@/components/SearchBar";
import { Leaderboard } from "@/components/Leaderboard";
import { getLeaderboard } from "@/lib/api";

// The leaderboard is live data; render per-request (and degrade gracefully when
// the backend is unavailable).
export const dynamic = "force-dynamic";

const FEATURES = [
  {
    title: "True per-round analytics",
    body: "Every demo is parsed once into KAST, ADR, opening duels, trades and clutches — not just the end-of-match scoreboard.",
  },
  {
    title: "HLTV-style rating",
    body: "A transparent, reproducible rating computed from your kill, survival and multi-kill output across every parsed match.",
  },
  {
    title: "Career that updates on write",
    body: "Rolling aggregates are recomputed the moment a demo finishes parsing, so your profile is always current and fast to load.",
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
            Look up any player by SteamID64, vanity name or profile URL. Parse
            your demos for round-level insight you can actually act on.
          </p>
          <div className="mx-auto mt-7 max-w-md">
            <SearchBar autoFocus />
          </div>
          <p className="mt-3 text-xs text-faint">
            Try a seeded demo profile:{" "}
            <a
              className="text-brand hover:underline"
              href="/profiles/76561198000000001"
            >
              /profiles/76561198000000001
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
