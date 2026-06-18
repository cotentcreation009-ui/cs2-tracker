import {
  ApiError,
  getPlayerMatches,
  getProfile,
  getWeaponStats,
  resolveSteamId,
} from "@/lib/api";
import { ProfileView } from "@/components/ProfileView";
import { FetchError } from "@/components/FetchError";

export const dynamic = "force-dynamic";

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
    const [profile, matches, weapons] = await Promise.all([
      getProfile(steamId),
      getPlayerMatches(steamId),
      getWeaponStats(steamId).catch(() => []),
    ]);
    return (
      <ProfileView profile={profile} matches={matches} weapons={weapons} />
    );
  } catch (e) {
    if (e instanceof ApiError) {
      return <FetchError status={e.status} message={e.message} />;
    }
    throw e;
  }
}
