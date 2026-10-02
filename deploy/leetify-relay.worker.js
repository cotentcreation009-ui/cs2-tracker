// Cloudflare Worker: the keyed Leetify forwarder, for running the relay on
// Cloudflare's network instead of a VPS. Why a relay exists at all:
// backend/internal/leetify/appprofile.go ("THE WALL") for the app routes, and
// backend/internal/leetify/publicrelay.go for the public API, whose host
// refuses the main box's own address outright (429 "Calm down son" on every
// request since 2026-10-01).
//
// Deploy (dashboard, ~5 minutes): Workers & Pages → Create → "Hello World"
// → Edit code → paste this → Deploy → Settings → Variables and Secrets → add
// secret RELAY_KEY (openssl rand -hex 32) → Deploy again. Note the
// https://<name>.<account>.workers.dev URL. Then on the VM's .env:
//   LEETIFY_APP_RELAY_URL=https://<name>.<account>.workers.dev
//   LEETIFY_APP_RELAY_KEY=<the same secret>
// (the public routes use the same two unless LEETIFY_PUBLIC_RELAY_URL/_KEY
// say otherwise) and restart the backend. Full runbook: docs/LEETIFY-RELAY.md.
// Updating an existing Worker: Edit code → replace everything → Deploy; the
// secret stays.
//
// It forwards exactly the routes the backend calls, only with the key, and
// hands the answer back status, Retry-After and body intact — a 429 here is a
// 429 there, and the backend's pause reads it as it would a direct one. Two
// upstreams, chosen by path:
//   /api/profile/{id}/…   → api.cs-prod.leetify.com (the app's own routes:
//   /api/games/{gameId}     pool list, one pool's summary, display name, last
//                           30 games; and one game's full scoreboard, which
//                           the expanded match row and one-click analysis
//                           read — the wall has refused the main box that
//                           route since mid-September 2026). No key is
//                           forwarded: the routes answer a plain GET and the
//                           public key means nothing here.
//   /v3/… and /v2/…       → api-public.cs-prod.leetify.com (the documented
//                           API: a profile, its match list, a match by id or by
//                           share code). The backend's _leetify_key header is
//                           forwarded as sent, because the key is what sets the
//                           rate tier and it is the address that is burned; the
//                           only query forwarded is a 17-digit steam64_id.
// Every forwarded answer carries X-Relay-Upstream so the backend can tell
// Leetify's answers from this Worker's own (401 key, 404 route, 502) and from
// Cloudflare's — an older paste of this file never sends it, which is how the
// backend knows to ask Leetify directly instead.
//
// The one thing added beyond forwarding (2026-09-28): the app host's wall
// refuses some of this network's egress addresses, not all — the same route
// answered 20 of 20 minutes after a refusal — so a 511 is asked again, twice,
// before it is passed back as a 511. No challenge is solved and no header is
// faked. A 429 from the public host is NOT retried: it is a rate limit, and
// a limit answered by more requests never lifts.

const APP_UPSTREAM = "https://api.cs-prod.leetify.com";
const PUBLIC_UPSTREAM = "https://api-public.cs-prod.leetify.com";

// /api/games/{gameId} takes Leetify's own game id, a UUID on current games
// and a shorter hex-and-dash form on old ones; the backend sends either.
const APP_ROUTE =
  /^\/api\/(profile\/[0-9]{17}\/(meta|match-history|recent-games\/(available-data-sources|[a-z0-9_]{1,32}))|games\/[A-Za-z0-9-]{1,64})$/;
// /v3/profile and /v3/profile/matches take ?steam64_id=; /v2/matches/{id}
// (Leetify's own match id, a UUID) and /v2/matches/matchmaking/{share code}
// (CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx) take none.
const PUBLIC_ROUTE =
  /^\/(v3\/profile(\/matches)?|v2\/matches\/(matchmaking\/CSGO(-[A-Za-z0-9]{5}){5}|[A-Za-z0-9-]{1,64}))$/;
const STEAM64 = /^[0-9]{17}$/;

// route says which upstream a request path belongs to, or null for one this
// Worker will not forward. Exported for the test beside this file; the
// Worker runtime ignores named exports.
export function route(pathname) {
  if (APP_ROUTE.test(pathname)) return { upstream: APP_UPSTREAM, kind: "app" };
  if (PUBLIC_ROUTE.test(pathname)) return { upstream: PUBLIC_UPSTREAM, kind: "public" };
  return null;
}

// upstreamURL builds the request to Leetify: the path as asked, and for the
// public routes the one query the backend sends. Returns null when a profile
// route lacks it — a request Leetify would answer 400 to anyway, stopped here.
export function upstreamURL(target, pathname, searchParams) {
  if (target.kind !== "public") return target.upstream + pathname;
  const id = searchParams.get("steam64_id");
  if (pathname.startsWith("/v3/profile")) {
    if (!id || !STEAM64.test(id)) return null;
    return `${target.upstream}${pathname}?steam64_id=${id}`;
  }
  return target.upstream + pathname;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return new Response("ok");
    if (request.method !== "GET") return new Response("GET only", { status: 405 });
    if (!env.RELAY_KEY || !safeEqual(request.headers.get("x-relay-key") || "", env.RELAY_KEY)) {
      return new Response("relay key", { status: 401 });
    }
    const target = route(url.pathname);
    if (!target) return new Response("not a relayed route", { status: 404 });
    const dest = upstreamURL(target, url.pathname, url.searchParams);
    if (!dest) return new Response("steam64_id required", { status: 400 });

    const headers = { accept: "application/json" };
    if (target.kind === "public") {
      const key = request.headers.get("_leetify_key");
      if (key) headers["_leetify_key"] = key;
    }

    let upstream;
    try {
      for (let attempt = 0; ; attempt++) {
        upstream = await fetch(dest, { headers });
        if (target.kind !== "app" || upstream.status !== 511 || attempt >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    } catch {
      return new Response("upstream unreachable", { status: 502 });
    }
    const out = {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "x-relay-upstream": target.kind,
    };
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) out["retry-after"] = retryAfter;
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};

// Constant-time compare, so the key cannot be guessed byte by byte from
// response timing.
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}
