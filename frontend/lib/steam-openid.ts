// Steam "Sign in through Steam" uses OpenID 2.0 — a keyless redirect flow (no
// Steam Web API key required): we bounce the browser to Steam, Steam redirects
// back with a signed assertion, and we confirm that assertion by replaying it
// straight back to Steam. The only identity Steam returns is the SteamID64.
//
// Spec: https://openid.net/specs/openid-authentication-2_0.html
// Steam:  https://steamcommunity.com/dev  (login endpoint below)

const OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";

/**
 * The scheme://host this request was served on. SITE_URL overrides it when the
 * app sits behind a proxy that rewrites the Host header (or for the
 * steamcommunity.<tld> mirror), so the OpenID realm/return_to match what the
 * browser actually used.
 */
export function siteOrigin(req: Request): string {
  const override = process.env.SITE_URL?.replace(/\/$/, "");
  if (override) return override;
  return new URL(req.url).origin;
}

/** Build the URL to send the browser to so it can authenticate with Steam. */
export function buildAuthURL(origin: string): string {
  const params = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": `${origin}/api/auth/steam/callback`,
    "openid.realm": origin,
    // identifier_select lets Steam pick the user's own id (standard for Steam).
    "openid.identity": IDENTIFIER_SELECT,
    "openid.claimed_id": IDENTIFIER_SELECT,
  });
  return `${OPENID_ENDPOINT}?${params.toString()}`;
}

const CLAIMED_ID_RE =
  /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

/** Pull the SteamID64 out of a (verified) claimed_id. */
export function steamIdFromClaimedId(claimedId: string | null): string | null {
  if (!claimedId) return null;
  const m = claimedId.match(CLAIMED_ID_RE);
  return m ? m[1] : null;
}

/**
 * Confirm an assertion is genuine by replaying the exact parameters Steam sent
 * back to it with mode=check_authentication. Returns true only on a positive
 * `is_valid:true`. Any network/parse problem is treated as "not valid".
 */
export async function verifyAssertion(
  params: URLSearchParams,
): Promise<boolean> {
  // Only a positive id_res assertion can be validated.
  if (params.get("openid.mode") !== "id_res") return false;

  const body = new URLSearchParams(params);
  body.set("openid.mode", "check_authentication");

  let res: Response;
  try {
    res = await fetch(OPENID_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
    });
  } catch {
    return false;
  }
  if (!res.ok) return false;
  const text = await res.text();
  return /is_valid\s*:\s*true/i.test(text);
}
