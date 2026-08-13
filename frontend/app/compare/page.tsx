import type { Metadata } from "next";
import Link from "next/link";
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
    const title = `Compare ${ids.length} players — CSRun`;
    const description =
      "Side-by-side CS2 comparison: Leetify rating, ranks, win rate, aim, utility and more.";
    return { title, description, alternates, openGraph: { title, description }, twitter: { card: "summary" } };
  }
  const title = "Compare CS2 players side by side — CSRun";
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

      {/* Crawlable primer under the tool — the comparison itself is data-driven
          UI, so this is the page's only prose. */}
      <section className="max-w-3xl border-t border-line pt-8">
        <h2 className="text-xl font-bold tracking-tight">
          How to read a comparison
        </h2>
        <div className="mt-3 space-y-4 text-sm leading-relaxed text-muted">
          <p>
            The rows come from different measuring systems, and they answer
            different questions. Leetify rating measures per-round impact in a
            single match and only means something as an average; FACEIT ELO and
            Premier CS Rating are ladder positions built from whole win/loss
            histories. Two players can rank the same on one scale and far apart
            on another — the guide to{" "}
            <Link
              href="/guides/cs2-rating-systems-compared"
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              CS2&apos;s rating systems
            </Link>{" "}
            explains why the scales never convert.
          </p>
          <p>
            For the performance rows, judge numbers against role, not just each
            other: an entry fragger&apos;s K/D runs structurally lower than a
            cleanup player&apos;s at the same skill, while ADR counts the damage
            K/D throws away. What counts as good for each is covered in{" "}
            <Link
              href="/guides/what-is-a-good-adr-cs2"
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              the ADR guide
            </Link>{" "}
            and{" "}
            <Link
              href="/guides/what-is-a-good-kd-cs2"
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              the K/D guide
            </Link>
            .
          </p>
          <p>
            One more habit worth keeping: check the sample behind a number
            before trusting it. Win rates and ratings over a handful of matches
            are mostly noise, and a big gap between a player&apos;s ladders —
            say a high{" "}
            <Link
              href="/guides/faceit-levels-and-elo"
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            >
              FACEIT level
            </Link>{" "}
            next to a modest Premier rating — is a prompt to look closer, not a
            verdict on its own.
          </p>
        </div>
      </section>
    </div>
  );
}
