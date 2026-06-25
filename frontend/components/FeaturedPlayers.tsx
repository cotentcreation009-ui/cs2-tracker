import Link from "next/link";
import { getLeetify, getProfile } from "@/lib/api";
import type { LeetifyProfile, PlayerProfile } from "@/lib/types";

// A handful of real, verified-live accounts so the landing page is populated
// from day one with genuine data (no fabricated rows) — they resolve to live
// Leetify/FACEIT/Steam stats like any other profile, and viewing them also
// seeds them into search.
const FEATURED_IDS = [
  "76561198034202275",
  "76561197987713664",
  "76561197991272318",
  "76561198077030352",
  "76561198190664314",
];

type Loaded = {
  id: string;
  profile: PlayerProfile;
  leetify: LeetifyProfile | null;
};

function flag(cc?: string): string | null {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return null;
  const base = 0x1f1e6;
  return String.fromCodePoint(
    ...[...cc.toUpperCase()].map((c) => base + c.charCodeAt(0) - 65),
  );
}

function headlineStat(
  leetify: LeetifyProfile | null,
): { label: string; value: string } | null {
  const r = leetify?.ranks;
  if (!r) return null;
  if (r.premier) return { label: "Premier", value: r.premier.toLocaleString() };
  if (r.faceit) return { label: "FACEIT", value: `Lvl ${r.faceit}` };
  if (r.leetify) return { label: "Leetify", value: r.leetify.toFixed(2) };
  return null;
}

async function load(id: string): Promise<Loaded | null> {
  try {
    const [profile, leetify] = await Promise.all([
      getProfile(id),
      getLeetify(id),
    ]);
    return { id, profile, leetify };
  } catch {
    return null; // skip an unavailable account rather than failing the page
  }
}

export async function FeaturedPlayers() {
  const players = (await Promise.all(FEATURED_IDS.map(load))).filter(
    (p): p is Loaded => p !== null,
  );
  if (players.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
        Featured players
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {players.map(({ id, profile, leetify }) => {
          const name = leetify?.name || profile.player.personaName || id;
          const stat = headlineStat(leetify);
          const f = flag(profile.player.countryCode);
          const winPct =
            leetify && leetify.winrate != null
              ? Math.round(leetify.winrate * 100)
              : null;
          return (
            <Link
              key={id}
              href={`/profiles/${id}`}
              className="card lift flex items-center gap-3 px-4 py-3"
            >
              {profile.player.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.player.avatarUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-panel text-sm font-bold text-faint">
                  {name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">
                  {name}{" "}
                  {f && (
                    <span className="ml-0.5" aria-hidden="true">
                      {f}
                    </span>
                  )}
                </div>
                {winPct !== null && (
                  <div className="text-xs text-muted">{winPct}% win rate</div>
                )}
              </div>
              {stat && (
                <div className="shrink-0 text-right">
                  <div className="stat-label">{stat.label}</div>
                  <div className="text-sm font-semibold tabular-nums">
                    {stat.value}
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
