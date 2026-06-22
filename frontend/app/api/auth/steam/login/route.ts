import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { buildAuthURL, siteOrigin } from "@/lib/steam-openid";
import { COOKIE_SECURE, OAUTH_STATE_COOKIE } from "@/lib/session";

// GET /api/auth/steam/login — kick off "Sign in through Steam". We mint an
// anti-CSRF state nonce, stash it in a short-lived cookie, and redirect the
// browser to Steam's OpenID endpoint with the nonce on return_to. The callback
// confirms the nonce so a response can't be replayed into someone else's browser.
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const origin = siteOrigin(req);
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(buildAuthURL(origin, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: 600, // 10 minutes to complete the Steam round-trip
  });
  return res;
}
