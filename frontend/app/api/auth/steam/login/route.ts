import { NextResponse } from "next/server";
import { buildAuthURL, siteOrigin } from "@/lib/steam-openid";

// GET /api/auth/steam/login — kick off "Sign in through Steam" by redirecting
// the browser to Steam's OpenID endpoint. Steam returns to /callback below.
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return NextResponse.redirect(buildAuthURL(siteOrigin(req)));
}
