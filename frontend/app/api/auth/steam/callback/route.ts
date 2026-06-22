import { NextResponse } from "next/server";
import { getProfile } from "@/lib/api";
import {
  encodeSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/session";
import {
  siteOrigin,
  steamIdFromClaimedId,
  verifyAssertion,
} from "@/lib/steam-openid";

// GET /api/auth/steam/callback — Steam redirects here after the user approves.
// We verify the assertion with Steam, then set a signed session cookie and send
// the user to their own profile.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = siteOrigin(req);
  const params = new URL(req.url).searchParams;

  const ok = await verifyAssertion(params);
  const steamId = ok
    ? steamIdFromClaimedId(params.get("openid.claimed_id"))
    : null;
  if (!steamId) {
    // 303 so the failed-login redirect is followed as a GET.
    return NextResponse.redirect(`${origin}/?login=failed`, { status: 303 });
  }

  // Cache persona + avatar in the cookie so the header chip needs no per-render
  // backend call. Cosmetic only — login still succeeds if this lookup fails.
  let personaName = "";
  let avatarUrl = "";
  try {
    const { player } = await getProfile(steamId);
    personaName = player.personaName ?? "";
    avatarUrl = player.avatarUrl ?? "";
  } catch {
    /* identity is cosmetic; ignore */
  }

  const token = encodeSession({ steamId64: steamId, personaName, avatarUrl });
  const res = NextResponse.redirect(`${origin}/profiles/${steamId}`, {
    status: 303,
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
