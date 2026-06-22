import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { siteOrigin } from "@/lib/steam-openid";

// POST /api/auth/logout — clear the session cookie and return home. POST plus a
// same-origin check (Sec-Fetch-Site, falling back to Origin) so a cross-site
// auto-submitting form can't force-sign-out a visiting user.
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  const origin = siteOrigin(req);
  const home = NextResponse.redirect(`${origin}/`, { status: 303 });

  const sfs = req.headers.get("sec-fetch-site");
  if (sfs) {
    if (sfs !== "same-origin" && sfs !== "same-site") return home; // ignore cross-site
  } else {
    const reqOrigin = req.headers.get("origin");
    if (reqOrigin && reqOrigin !== origin) return home; // ignore cross-origin
  }

  home.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return home;
}
