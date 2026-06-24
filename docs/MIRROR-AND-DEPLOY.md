# The steamcommunity-TLD mirror, and how to deploy it

This is the "swap `steamcommunity.com` for `steamcommunity.<your-tld>` and land on
your stats page" trick (what csstats/AllStar/Leetify-style sites do). It needs
only two things, and the app already provides the first:

1. **Mirror Steam's URL paths.** The app serves `/id/<vanity>` and
   `/profiles/<steamID64>` — identical to Steam's own paths — so the same profile
   URL renders our page. ✅ Built (`frontend/app/id/[vanity]`,
   `frontend/app/profiles/[steamid]`).
2. **Own a `steamcommunity.<tld>` domain pointed at the app.** This is a DNS +
   hosting step (below). The second-level label must be exactly `steamcommunity`;
   you choose an available TLD as your "ending".

## Try it locally (feel the swap)

The app is host-agnostic, so any host works. Because editing a URL's TLD drops
the port, you serve the app on port 80 with a small proxy.

1. **Map a host to localhost** — one-time, in an **Administrator** shell:
   ```powershell
   Add-Content "$env:WINDIR\System32\drivers\etc\hosts" "`n127.0.0.1 steamcommunity.test"
   ```
   (Use `.test` — reserved for testing, so it won't shadow a real site. Don't map
   a real domain you actually use.)
2. **Run the proxy** (`:80` → Next on `:3000`); Admin if your OS reserves 80:
   ```bash
   node scripts/mirror-proxy.js
   ```
3. Open **http://steamcommunity.test/id/PodSoil** — your stats page.

Now take any Steam profile URL, change `.com` to `.test`, and it lands on your
app. (Verified: `Host: steamcommunity.test` → `/id/PodSoil` → 200.)

## Do it for real (your own TLD)

1. **Register `steamcommunity.<tld>`** with a registrar — pick a TLD where the
   `steamcommunity` label is available (that's your "unique ending"). Note: using
   the Steam name is a trademark gray area; the existing `.rip`/etc. sites operate
   in it — be aware.
2. **Deploy the stack** (see below) on a server with a public IP.
3. **Point DNS**: an `A` record for `steamcommunity.<tld>` → your server IP.
4. **Serve over 80/443** with a real reverse proxy that terminates TLS — e.g.
   Caddy (auto Let's Encrypt):
   ```
   steamcommunity.<tld> {
     reverse_proxy localhost:3000   # Next.js frontend
   }
   ```
   The frontend talks to the backend server-side via `API_INTERNAL_URL`.
5. Done — `steamcommunity.<tld>/id/<vanity>` and `/profiles/<id>` now serve your
   stats pages, and the `.com`→`.<tld>` swap works for anyone.

## Deploying the stack

`docker compose up --build` brings up Postgres + Redis + backend + worker +
frontend (needs a healthy Docker engine). For a hostless/VM deploy, run the four
binaries + Next directly (see the README "Running without Docker"), front them
with Caddy/nginx for TLS, and set `STEAM_API_KEY` + `DATABASE_URL` + `REDIS_URL`
on the backend process. To light up the FACEIT panel, also set `FACEIT_API_KEY`
(a free **server-side** key from https://developers.faceit.com); without it the
FACEIT panel and the cross-source table are simply hidden. Optional:
`LEETIFY_API_KEY`, `FACEIT_BASE_URL`, `EXTERNAL_CACHE_TTL`.

Data sources that populate the pages:
- **Leetify API** (built) — instant MM/Premier + Faceit stats per SteamID, live.
- **Your own parsed demos** (built) — the owned corpus; add the GC crawler
  (roadmap) to auto-ingest from share codes at scale.
