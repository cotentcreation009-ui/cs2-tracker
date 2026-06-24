import type { Metadata } from "next";
import {
  ApiError,
  getFaceit,
  getLeetify,
  getMapStats,
  getPlayerMatches,
  getProfile,
  getSteamExtras,
  getSteamStats,
  getWeaponStats,
} from "@/lib/api";
import { ProfileView } from "@/components/ProfileView";
import { FetchError } from "@/components/FetchError";
import { profileMetadata } from "@/lib/meta";

// Cache the rendered profile for a short window (ISR) so repeat/shared views are
// served from cache; the underlying data is itself cached server-side.
export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ steamid: string }>;
}): Promise<Metadata> {
  const { steamid } = await params;
  try {
    return profileMetadata(await getProfile(steamid));
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
    const [profile, matches, weapons, maps, leetify, faceit, steamExtras, steamStats] =
      await Promise.all([
        getProfile(steamid),
        getPlayerMatches(steamid),
        getWeaponStats(steamid).catch(() => []),
        getMapStats(steamid).catch(() => []),
        getLeetify(steamid),
        getFaceit(steamid),
        getSteamExtras(steamid),
        getSteamStats(steamid),
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
        steamStats={steamStats}
      />
    );
  } catch (e) {
    if (e instanceof ApiError) {
      return <FetchError status={e.status} message={e.message} />;
    }
    throw e;
  }
}
