import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getProfile } from "@/lib/api";
import {
  COOKIE_SECURE,
  encodeSession,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/session";
import {
  returnToMatches,
  siteOrigin,
  steamIdFromClaimedId,
  verifyAssertion,
} from "@/lib/steam-openid";

// GET /api/auth/steam/callback — Steam redirects here after the user approves.
// We confirm the anti-CSRF state, that the assertion's return_to is ours, and
// that Steam vouches for it; only then do we set a signed session cookie and
// send the user to their own profile.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = siteOrigin(req);
  const params = new URL(req.url).searchParams;

  // 303 so the redirect is followed as a GET; always clear the one-time state.
  const fail = () => {
    const r = NextResponse.redirect(`${origin}/?login=failed`, { status: 303 });
    r.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return r;
  };

  // Anti-CSRF: the state we issued at /login must come back in both the cookie
  // and the (Steam-signed) return_to query, and the return_to must be ours.
  const cookieState = (await cookies()).get(OAUTH_STATE_COOKIE)?.value;
  const queryState = params.get("state");
  if (!cookieState || !queryState || cookieState !== queryState) return fail();
  if (!returnToMatches(params.get("openid.return_to"), origin)) return fail();

  const ok = await verifyAssertion(params);
  const steamId = ok
    ? steamIdFromClaimedId(params.get("openid.claimed_id"))
    : null;
  if (!steamId) return fail();

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
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  res.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
