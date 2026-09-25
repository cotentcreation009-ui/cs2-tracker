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

## Not yet done

Skinport prices through the same box (`SKINPORT_BASE_URL` does not exist yet;
the relay forwards Leetify routes only). Worth doing once the box exists:
Skinport is the cash market the inventory panel was designed around, and the
Steam-market fallback quotes wallet prices, which run higher.
