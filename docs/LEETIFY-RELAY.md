# The Leetify relay

Why it exists, what it is not, and how to run it.

## Why

Leetify's public API (`api-public.cs-prod.leetify.com`) serves registered Leetify
users only. For everyone else the backend asks the routes leetify.com itself
uses (`api.cs-prod.leetify.com/api/profile/{id}/…`, see
`backend/internal/leetify/appprofile.go`). Those routes answer any anonymous
visitor — **except from networks Leetify's bot wall refuses**, and the main
box's network is one of them: from Contabo (AS40021) every request gets
`511 {"error":"bot_check_required"}`.

This is not a "datacenters are blocked" rule. Measured 2026-09-24 with
check-host.net: 40 of 40 probe nodes on hosting networks worldwide got `200`
from the same route — Hetzner, Scaleway, Kamatera, even Contabo's Asian
network — and so does a home connection. The wall refuses a handful of
networks with bad abuse reputations, and AS40021 is one. (Skinport's Cloudflare
does the same to it, which is why inventory prices moved to the Steam market —
`backend/internal/steaminv/steaminv.go`.)

So the fallback can be asked **through a relay on a network Leetify answers**.
The relay is a keyed forwarder for exactly four routes — a player's pool list,
one pool's recent-games summary, their display name, and their last 30 games
(`match-history`). It solves no
challenge, fakes no header, and hands Leetify's answer back status and all: if
the relay's network is ever walled too, the backend sees the 511 and pauses
the fallback exactly as it does today. Leetify's refusals for a player
(403 on a hidden pool) pass through untouched.

## Two ways to run it

### A. A small box on a clean network (recommended: certain, ~€4/month)

Hetzner (AS24940) answered `200` for both Leetify's app routes **and**
Skinport's price feeds in the same measurement, so a CX22 in Falkenstein,
Helsinki or Ashburn does the job — and can later carry Skinport prices too.

1. Create the server (Ubuntu 24.04), install Docker (`curl -fsSL https://get.docker.com | sh`).
2. DNS: an **A record** `relay.csrun.win → <box IP>`, **DNS only** (grey
   cloud) — Caddy obtains the certificate itself and the ACME challenge must
   reach the box directly.
3. Firewall: `ufw allow 80` (ACME), `ufw allow from 89.117.150.114 to any port 443`
   (only the main box needs to talk to it), `ufw enable`.
4. Put the repo on the box the same way `~/csrun-app` is on the main box (a
   read-only deploy key via `GIT_SSH_COMMAND`), then:
   ```
   cd cs2-tracker
   printf 'RELAY_DOMAIN=relay.csrun.win\nLEETIFY_RELAY_KEY=%s\n' "$(openssl rand -hex 32)" > .env
   docker compose -f docker-compose.relay.yml up -d --build
   ```
5. Verify from anywhere:
   ```
   curl -s https://relay.csrun.win/healthz                                   # ok
   curl -s -H "X-Relay-Key: <key>" https://relay.csrun.win/api/profile/76561197965792900/meta
   ```
   The second must print JSON with `"name"`. A `511` here means this network
   is walled too — pick another region or provider.

### B. A Cloudflare Worker (free, five minutes, very likely to work)

`deploy/leetify-relay.worker.js` is the same forwarder. Cloudflare's own
network answered `200` on the check-host measurement; a Worker's egress was not
measured separately, so test it before relying on it.

Workers & Pages → Create → Hello World → Edit code → paste the file → Deploy →
Settings → Variables and Secrets → secret `RELAY_KEY` → Deploy. The URL is
`https://<name>.<account>.workers.dev`. Verify exactly as in A.5.

## Point the main box at it

On the main VM, add to `~/cs2-tracker/.env`:
```
LEETIFY_APP_RELAY_URL=https://relay.csrun.win        # or the workers.dev URL
LEETIFY_APP_RELAY_KEY=<the same key>
```
then (first time, because the compose passthrough and the client are new):
```
cd ~/cs2-tracker && git pull && docker compose -f docker-compose.prod.yml -f docker-compose.posters.yml up -d --build backend
```
Later changes to those two variables only need `up -d backend` (recreate, no rebuild).

Check:
```
docker compose -f docker-compose.prod.yml -f docker-compose.posters.yml logs --since 2m backend | grep "leetify app fallback"
```
must show `"relay":true`. Then open `csrun.win/profiles/76561197965792900`: the
Leetify panel appears with the "recent games only" pill. The Steam-page card
of the browser extension reads the same backend, so it fills in too. Cached
misses expire within 5 minutes.

## Switches

- `LEETIFY_APP_RELAY_URL=` (empty): ask Leetify directly again (walled from Contabo → misses).
- `LEETIFY_APP_FALLBACK=0`: no app routes at all, relay or not.
- A relay that is down, or refuses the key, is a plain miss on the profile page
  — never an error — and is logged on the backend as `leetify app fallback failed`.

## When the wall hits the relay (2026-09-28)

Leetify's wall refuses some of Cloudflare's egress addresses, not all: the backend logged
28 refusals in a day while the same routes answered 20 of 20 from the relay minutes later.
Under the original rule — one 511 pauses the fallback for thirty minutes — that was fourteen
hours a day of "no Leetify profile" for every non-member, cached five minutes each. Now:

- the Worker asks Leetify again, twice, before passing a 511 back (paste the current
  `deploy/leetify-relay.worker.js` into the Worker to get this);
- the backend asks the relay once more before believing a wall;
- a wall that survives pauses the fallback for two minutes, doubling for every wall met
  after a pause lapses (up to thirty), and any answered request resets it;
- a lookup refused by the wall is `leetify.ErrUnavailable` — a miss to every caller, but
  cached for 45 seconds instead of five minutes, with the last-known-good copy served when
  there is one.

The log line still says `fallback paused`, now with the pause length and the streak.

## Public API 429 (2026-09-29)

A different wall, on the other host. From 2026-09-29 ~20:30 UTC
`api-public.cs-prod.leetify.com` answered **every** request from the VPS's address with
`429 {"error":"Calm down son"}` (`server: LRL`, no `Retry-After`) — keyed or not, on the
bare root as much as on `/v3/profile` — while the same key from a home connection got
200. A per-address block, not a per-key quota. The client at the time retried a 429
after 200 ms and cached nothing, and the bridge kept spending its 8/min budget: about
870 refused requests an hour for a day, two thirds of them self-inflicted (the homepage's
featured strip, the same 1,078 share codes re-fetched up to 65 times each). Profiles
without a 24 h stale copy answered `500 internal error`; the rest went dark when the
stale copies expired at ~20:30 UTC on 09-30.

What the backend does now (`backend/internal/leetify/publicpause.go`):

- a 429 from the public host is never retried (`transientStatus` no longer lists it);
- it pauses **every** v3/v2 call from the process — `GetProfile`, `MatchReference`
  (one-click analysis) and the bridge's match fetches — for five minutes (the one
  back-off Leetify has ever published), doubling for each 429 met after a pause lapses,
  capped at thirty; a `Retry-After` is honoured when it asks for longer;
- while paused, a profile lookup falls through to the app routes via the relay (another
  network); their answer is served, their "no" is `ErrUnavailable`, never a five-minute
  miss;
- the bridge parks the codes it could not fetch in the retry set instead of dropping
  them, `shouldSync` says no without stamping the tried key, and the chain poller skips
  its round;
- the profile route answers `503` with a reason (`Cache-Control: no-store`,
  `Retry-After: 60`) instead of `500 internal error`; the page says why the panel is
  missing, and a stale copy says how old it is (`fetched_at`).

Log lines to grep:

```
leetify public API rate-limited this address     # one Warn per pause, with until/pause/limits_in_a_row
leetify public API answers this address again     # one Info when it lifts: paused_for + refused_while_paused
chain poller round skipped: leetify paused
matchsync: leetify paused; codes parked for retry
```

The first `answers this address again` timestamp minus the deploy time is the empirical
length of Leetify's block. Kill switch: `LEETIFY_PUBLIC_BREAKER=0` in the VM `.env` and
`up -d backend` (no rebuild) restores the old behaviour verbatim.

### Follow-up: the public routes through the relay (not built)

The key is address-independent, so the direct fix for the block itself is to send the
keyed public calls through the Worker while the pause lasts. Design, for when it is
worth a Worker paste:

- **Worker** (`deploy/leetify-relay.worker.js`, mirrored in `cmd/leetifyrelay`): two
  upstreams (`APP = api.cs-prod.leetify.com`, `PUBLIC = api-public.cs-prod.leetify.com`);
  keep the app allowlist; add a public one for `/v3/profile`, `/v3/profile/matches`,
  `/v2/matches/{id}` and `/v2/matches/matchmaking/{share code}`; for public routes
  forward ONLY a validated `steam64_id` query (today the query string is dropped, which
  would make `/v3/profile` useless) and the `_leetify_key` header (never for app
  routes); no retry on a 429 — pass it back untouched with any `Retry-After`.
- **Backend**: `LEETIFY_PUBLIC_RELAY=1` + `WithPublicRelay`; a `publicReq` helper that
  builds `baseURL+path` while not paused and `appRelayURL+path` with `X-Relay-Key` while
  paused (direct first, relay only during the outage, one direct probe when the pause
  lapses); a 429 through the relay too stays `ErrUnavailable`.
- **Proof before the flag**: paste the Worker, then from the VPS
  `curl -H "X-Relay-Key: …" -H "_leetify_key: …" "https://leetify-relay.…workers.dev/v3/profile?steam64_id=76561198200413817"`.
  A 200 settles that Cloudflare's egress is answered for the keyed public route; a 429
  means the egress is limited too and the relay buys nothing.
- Budget: ~10k relayed requests a day at today's volume, 10% of the Worker free tier.
- Say it out loud: routing around a per-address block is a change of source address, not
  a challenge bypass, but Leetify could read it as evasion. Their Discord
  (https://discord.gg/UNygC8BAVg) is the only documented channel; a note naming
  89.117.150.114 and the developer account may end the block on its own.

## Not yet done

Skinport prices through the same box (`SKINPORT_BASE_URL` does not exist yet;
the relay forwards Leetify routes only). Worth doing once the box exists:
Skinport is the cash market the inventory panel was designed around, and the
Steam-market fallback quotes wallet prices, which run higher.
