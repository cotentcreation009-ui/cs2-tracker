import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { siteOrigin } from "@/lib/steam-openid";

// POST /api/auth/logout — clear the session cookie and return home. POST (not a
// GET link) so a stray prefetch or third-party link can't sign the user out.
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  const res = NextResponse.redirect(`${siteOrigin(req)}/`, { status: 303 });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
