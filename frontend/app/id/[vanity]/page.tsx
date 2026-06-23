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
  resolveSteamId,
} from "@/lib/api";
import { ProfileView } from "@/components/ProfileView";
import { FetchError } from "@/components/FetchError";
import { profileMetadata } from "@/lib/meta";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ vanity: string }>;
}): Promise<Metadata> {
  const { vanity } = await params;
  try {
    const id = await resolveSteamId(vanity);
    return profileMetadata(await getProfile(id));
  } catch {
    return { title: "Player — CS2 Tracker" };
  }
}

/**
 * /id/<vanity> mirrors Steam's custom-URL path. We resolve the vanity name to a
 * SteamID64 via the backend (which calls Steam's ResolveVanityURL) and then
 * render the same profile view as /profiles/<id>.
 */
export default async function ProfileByVanity({
  params,
}: {
  params: Promise<{ vanity: string }>;
}) {
  const { vanity } = await params;
  try {
    const steamId = await resolveSteamId(vanity);
    const [profile, matches, weapons, maps, leetify, faceit, steamExtras] =
      await Promise.all([
        getProfile(steamId),
        getPlayerMatches(steamId),
        getWeaponStats(steamId).catch(() => []),
        getMapStats(steamId).catch(() => []),
        getLeetify(steamId),
        getFaceit(steamId),
        getSteamExtras(steamId),
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
