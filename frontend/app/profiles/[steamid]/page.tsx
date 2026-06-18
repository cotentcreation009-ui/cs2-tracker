import { ApiError, getPlayerMatches, getProfile } from "@/lib/api";
import { ProfileView } from "@/components/ProfileView";
import { FetchError } from "@/components/FetchError";

// Profiles depend on live backend data, so render per-request.
export const dynamic = "force-dynamic";

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
    const [profile, matches] = await Promise.all([
      getProfile(steamid),
      getPlayerMatches(steamid),
    ]);
    return <ProfileView profile={profile} matches={matches} />;
  } catch (e) {
    if (e instanceof ApiError) {
      return <FetchError status={e.status} message={e.message} />;
    }
    throw e;
  }
}
