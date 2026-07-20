import type { Metadata } from "next";
import { getFaceit, getLeetify, getProfile, resolveSteamId } from "@/lib/api";
import { ComparisonView, type ComparePlayer } from "@/components/ComparisonView";
import { CompareForm } from "@/components/CompareForm";
import { ShareButton } from "@/components/ShareButton";
import type { PlayerHit } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX = 6;

type SP = { ids?: string | string[]; a?: string | string[]; b?: string | string[] };

// Accept ?ids=a,b,c (the N-player form) and the legacy ?a=&b= links, deduped.
function parseIds(sp: SP): string[] {
  const out: string[] = [];
  const push = (v?: string | string[]) => {
    if (!v) return;
    for (const chunk of Array.isArray(v) ? v : [v]) {
      for (const part of chunk.split(",")) {
        const t = part.trim();
        if (t) out.push(t);
      }
    }
  };
  push(sp.ids);
  push(sp.a);
  push(sp.b);
  return [...new Set(out)].slice(0, MAX);
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SP>;
}): Promise<Metadata> {
  const ids = parseIds(await searchParams);
  // Every variant canonicalises to the clean /compare URL: the ?ids= permutations
  // are user-built combinations with no search value, and letting Google index
  // them would bloat the index with near-duplicates.
  const alternates = { canonical: "/compare" };
  if (ids.length >= 2) {
    const title = `Compare ${ids.length} players — StatRun`;
    const description =
      "Side-by-side CS2 comparison: Leetify rating, ranks, win rate, aim, utility and more.";
    return { title, description, alternates, openGraph: { title, description }, twitter: { card: "summary" } };
  }
  const title = "Compare CS2 players side by side — StatRun";
  const description =
    "Compare up to 6 Counter-Strike 2 players at once: Leetify rating, FACEIT level & ELO, Premier rank, win rate, aim, opening duels and utility — all side by side.";
  return {
    title,
    description,
    alternates,
    openGraph: { title, description, url: "/compare", type: "website" },
  };
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const ids = parseIds(await searchParams);

  // Resolve + fetch each player independently so one bad id doesn't break the page.
  const resolved: ComparePlayer[] = ids.length
    ? (
        await Promise.all(
          ids.map(async (raw) => {
            try {
              const id = await resolveSteamId(raw);
              const [profile, leetifyRaw, faceit] = await Promise.all([
                getProfile(id),
                getLeetify(id).catch(() => null),
                getFaceit(id),
              ]);
              // Show the player's CURRENT FACEIT ELO: prefer the live FACEIT
              // profile (same source the player page uses) over Leetify's cached
              // ranks.faceit_elo, which can lag.
              const leetify =
                leetifyRaw && faceit?.elo
                  ? {
                      ...leetifyRaw,
                      ranks: { ...leetifyRaw.ranks, faceit_elo: faceit.elo },
                    }
                  : leetifyRaw;
              return profile ? { profile, leetify, faceit } : null;
            } catch {
              return null;
            }
          }),
        )
      ).filter((p): p is ComparePlayer => !!p)
    : [];

  // Dedupe by resolved SteamID — the same player could be added via vanity + id.
  const seen = new Set<string>();
  const players = resolved.filter((p) => {
    const id = p.profile.player.steamId64;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const selected: PlayerHit[] = players.map((p) => ({
    steamId64: p.profile.player.steamId64,
    personaName: p.profile.player.personaName,
    avatarUrl: p.profile.player.avatarUrl,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Compare players</h1>
          <p className="mt-1 text-sm text-muted">
            {players.length >= 2
              ? `${players.length} players side by side — the best in each row is highlighted.`
              : "Add two or more players (SteamID64 or vanity) to compare them side by side."}
          </p>
        </div>
        {players.length >= 2 && <ShareButton label="Share comparison" />}
      </div>

      {players.length >= 2 && <ComparisonView players={players} />}

      <CompareForm selected={selected} max={MAX} />
    </div>
  );
}
