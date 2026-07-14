import type { Metadata } from "next";
import Link from "next/link";
import { ApiError, getLeetify, getProfile } from "@/lib/api";
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
      title: `${name} — recent matches — StatRun`,
      alternates: { canonical: `/profiles/${player.steamId64}/matches` },
    };
  } catch {
    return { title: "Recent matches — StatRun" };
  }
}

export default async function PlayerMatchesPage({
  params,
}: {
  params: Promise<{ steamid: string }>;
}) {
  const { steamid } = await params;
  try {
    const [profile, leetify] = await Promise.all([
      getProfile(steamid),
      getLeetify(steamid),
    ]);
    const name = profile.player.personaName || profile.player.steamId64;
    const matches = leetify?.recent_matches ?? [];
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
            No recent Leetify matches for this player.
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
