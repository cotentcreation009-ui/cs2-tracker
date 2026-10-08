import type { Metadata } from "next";
import Link from "next/link";
import { ApiError, getLeetifyState, getProfile } from "@/lib/api";
import { LeetifyRecentMatches } from "@/components/LeetifyRecentMatches";
import { FetchError } from "@/components/FetchError";
import { BackButton } from "@/components/BackButton";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ steamid: string }>;
}): Promise<Metadata> {
  const { steamid } = await params;
  try {
    const { player } = await getProfile(steamid);
    const name = player.personaName || steamid;
    return {
      title: `${name} — recent matches — CSRun`,
      // noindex like the profile itself (lib/meta.ts): a per-player match list
      // is the same class of near-identical numeric page.
      robots: { index: false, follow: true },
      alternates: { canonical: `/profiles/${player.steamId64}/matches` },
    };
  } catch {
    return { title: "Recent matches — CSRun", robots: { index: false, follow: true } };
  }
}

export default async function PlayerMatchesPage({
  params,
}: {
  params: Promise<{ steamid: string }>;
}) {
  const { steamid } = await params;
  try {
    const [profile, leetifyState] = await Promise.all([
      getProfile(steamid),
      getLeetifyState(steamid),
    ]);
    const name = profile.player.personaName || profile.player.steamId64;
    const matches = leetifyState.profile?.recent_matches ?? [];
    return (
      <div className="space-y-4">
        <BackButton />
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            <Link
              href={`/profiles/${profile.player.steamId64}`}
              className="hover:underline"
            >
              {name}
            </Link>{" "}
            <span className="text-muted">· recent matches</span>
          </h1>
        </div>
        {matches.length > 0 ? (
          <LeetifyRecentMatches matches={matches} steamId={steamid} />
        ) : (
          <div className="card px-5 py-6 text-sm text-muted">
            {/* An empty list during a pause is not "no matches": the backend
                answered 503 because Leetify is rate-limiting the site. */}
            {leetifyState.paused
              ? "Leetify is not answering this site right now, so this player's recent Leetify matches are hidden. They come back on their own."
              : "No recent Leetify matches for this player."}
          </div>
        )}
      </div>
    );
  } catch (e) {
    if (e instanceof ApiError) {
      return <FetchError status={e.status} message={e.message} />;
    }
    throw e;
  }
}
