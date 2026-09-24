// Cloudflare Worker: the same keyed forwarder as backend/cmd/leetifyrelay, for
// running the Leetify relay on Cloudflare's network instead of a VPS. Why a
// relay exists at all: backend/internal/leetify/appprofile.go ("THE WALL").
//
// Deploy (dashboard, ~5 minutes): Workers & Pages → Create → "Hello World"
// → Edit code → paste this → Deploy → Settings → Variables and Secrets → add
// secret RELAY_KEY (openssl rand -hex 32) → Deploy again. Note the
// https://<name>.<account>.workers.dev URL. Then on the VM's .env:
//   LEETIFY_APP_RELAY_URL=https://<name>.<account>.workers.dev
//   LEETIFY_APP_RELAY_KEY=<the same secret>
// and restart the backend. Full runbook: docs/LEETIFY-RELAY.md.
//
// It forwards exactly the three profile routes the fallback needs, only with
// the key, and hands the answer back status and all — a 511 here is a 511
// there. No challenge is solved and no header is faked.

const UPSTREAM = "https://api.cs-prod.leetify.com";
const ALLOWED =
  /^\/api\/profile\/[0-9]{17}\/(meta|recent-games\/(available-data-sources|[a-z0-9_]{1,32}))$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return new Response("ok");
    if (request.method !== "GET") return new Response("GET only", { status: 405 });
    if (!env.RELAY_KEY || !safeEqual(request.headers.get("x-relay-key") || "", env.RELAY_KEY)) {
      return new Response("relay key", { status: 401 });
    }
    if (!ALLOWED.test(url.pathname)) return new Response("not a relayed route", { status: 404 });

    let upstream;
    try {
      upstream = await fetch(UPSTREAM + url.pathname, { headers: { accept: "application/json" } });
    } catch {
      return new Response("upstream unreachable", { status: 502 });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
    });
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
