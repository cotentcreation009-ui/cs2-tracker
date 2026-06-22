import type { Metadata } from "next";
import {
  ApiError,
  getFaceit,
  getLeetify,
  getMapStats,
  getPlayerMatches,
  getProfile,
  getSteamExtras,
  getWeaponStats,
} from "@/lib/api";
import { ProfileView } from "@/components/ProfileView";
import { FetchError } from "@/components/FetchError";

// Profiles depend on live backend data, so render per-request.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ steamid: string }>;
}): Promise<Metadata> {
  const { steamid } = await params;
  try {
    const { player, career } = await getProfile(steamid);
    const name = player.personaName || steamid;
    return {
      title: `${name} — CS2 Tracker`,
      description:
        career.matches > 0
          ? `${name}: ${career.rating} rating, ${career.kd} K/D over ${career.matches} matches.`
          : `${name} on CS2 Tracker.`,
    };
  } catch {
    return { title: "Player — CS2 Tracker" };
  }
}

/**
 * /profiles/<steamID64> mirrors Steam's own profile URL path. Point a
 * steamcommunity.<tld> redirect here and the same links resolve to our tracker.
 */
export default async function ProfileBySteamID({
  params,
}: {
  params: Promise<{ steamid: string }>;
}) {
  const { steamid } = await params;
  try {
    const [profile, matches, weapons, maps, leetify, faceit, steamExtras] =
      await Promise.all([
        getProfile(steamid),
        getPlayerMatches(steamid),
        getWeaponStats(steamid).catch(() => []),
        getMapStats(steamid).catch(() => []),
        getLeetify(steamid),
        getFaceit(steamid),
        getSteamExtras(steamid),
      ]);
    return (
      <ProfileView
        profile={profile}
        matches={matches}
        weapons={weapons}
        maps={maps}
        leetify={leetify}
        faceit={faceit}
        steamExtras={steamExtras}
      />
    );
  } catch (e) {
    if (e instanceof ApiError) {
      return <FetchError status={e.status} message={e.message} />;
    }
    throw e;
  }
}
