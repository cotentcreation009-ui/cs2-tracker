import { API_BASE, internalHeaders } from "@/lib/api";

// Public front door for connecting an account's match history.
//
// The backend endpoint sits behind the internal token like everything else;
// this route injects the token server-side — same pattern as the player-panel
// proxy. Ownership needs no login: a (steamid, auth code) pair only validates
// at Valve when the codes genuinely belong to that account, so the Valve check
// the backend performs IS the ownership proof. What this route adds is abuse
// control, because repeated bad auth codes reputedly get our server 503-parked
// by Valve — a stranger must not be able to spend that reputation.
export const dynamic = "force-dynamic";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 6; // a human correcting typos, not a script

// Per-instance in-memory limiter. Fine at this site's scale (one frontend
// container); revisit if that ever changes.
const attempts = new Map<string, { count: number; reset: number }>();

function limited(ip: string): boolean {
  const now = Date.now();
  const slot = attempts.get(ip);
  if (!slot || now > slot.reset) {
    attempts.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  slot.count += 1;
  return slot.count > MAX_PER_WINDOW;
}

export async function POST(req: Request): Promise<Response> {
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (limited(ip)) {
    return Response.json(
      { error: "too many attempts — wait an hour and try again" },
      { status: 429 },
    );
  }

  let body: { steamId?: string; authCode?: string; shareCode?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const steamId = (body.steamId ?? "").trim();
  if (!/^7656119\d{10}$/.test(steamId)) {
    return Response.json({ error: "invalid SteamID64" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${API_BASE}/api/players/${steamId}/chain`,
      {
        method: "POST",
        headers: { ...internalHeaders(), "content-type": "application/json" },
        // Forward only the two fields, never the raw body: this is a
        // credential-carrying request and must stay minimal.
        body: JSON.stringify({
          authCode: body.authCode ?? "",
          shareCode: body.shareCode ?? "",
        }),
        cache: "no-store",
      },
    );
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return Response.json(
      { error: `cannot reach backend (${(err as Error).message})` },
      { status: 502 },
    );
  }
}
