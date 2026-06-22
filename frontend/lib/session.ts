// Signed, server-side session for "Sign in through Steam". The cookie carries a
// small JSON identity payload (SteamID64 + cached persona for the header chip)
// authenticated with an HMAC-SHA256 signature, so it is tamper-evident without a
// server-side session store.
//
// Server-only: this module imports next/headers and node:crypto, so importing it
// from a Client Component is a build error — which is what keeps SESSION_SECRET
// out of the browser bundle.

import { cookies } from "next/headers";
import crypto from "node:crypto";

const COOKIE = "cs2_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

// HMAC key. Set SESSION_SECRET in production; the dev fallback keeps local login
// working out of the box but must never be relied on for anything real.
const SECRET =
  process.env.SESSION_SECRET || "cs2-tracker-dev-session-secret-change-me";

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = MAX_AGE_SEC;

// Short-lived cookie holding the OpenID anti-CSRF state nonce between /login and
// /callback.
export const OAUTH_STATE_COOKIE = "cs2_oauth_state";

// Mark auth cookies Secure in production. Deriving this from the (Host-derived)
// request origin would let a misconfigured/HTTP-forwarded proxy silently
// downgrade the cookie, so key it off the build environment instead.
export const COOKIE_SECURE = process.env.NODE_ENV === "production";

export interface SessionUser {
  steamId64: string;
  personaName: string;
  avatarUrl: string;
}

interface Payload extends SessionUser {
  iat: number; // issued-at, unix seconds
}

function sign(data: string): string {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

function timingEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Encode + sign a session token for the given user. */
export function encodeSession(user: SessionUser): string {
  const payload: Payload = { ...user, iat: Math.floor(Date.now() / 1000) };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Verify a token and return its user, or null if missing/tampered/expired. */
export function decodeSession(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!timingEqual(sig, sign(body))) return null;
  try {
    const p = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as Payload;
    if (!p.steamId64) return null;
    if (typeof p.iat === "number" && Date.now() / 1000 - p.iat > MAX_AGE_SEC) {
      return null;
    }
    return {
      steamId64: p.steamId64,
      personaName: p.personaName ?? "",
      avatarUrl: p.avatarUrl ?? "",
    };
  } catch {
    return null;
  }
}

/** Read + verify the current session from the request cookies. Returns null
 *  when signed out (Server Components / Route Handlers only). */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  return decodeSession(jar.get(COOKIE)?.value);
}
