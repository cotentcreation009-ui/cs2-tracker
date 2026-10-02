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
The relay is a keyed forwarder for exactly the routes the backend calls. It
solves no challenge, fakes no header, and hands Leetify's answer back status
and all: if the relay's network is ever walled too, the backend sees the 511
and pauses the fallback exactly as it does today. Leetify's refusals for a
player (403 on a hidden pool) pass through untouched.

Since 2026-10-01 the **public API goes through it too** — `api-public` refuses
the box's address outright (see "Public API 429" below), and the key that sets
the rate tier is address-independent. The Worker picks the upstream by path:

| Path | Upstream | What it is | Key forwarded |
|---|---|---|---|
| `/api/profile/{id}/recent-games/available-data-sources` | `api.cs-prod.leetify.com` | the player's pool list | no |
| `/api/profile/{id}/recent-games/{pool}` | `api.cs-prod.leetify.com` | one pool's 30-game summary | no |
| `/api/profile/{id}/meta` | `api.cs-prod.leetify.com` | display name | no |
| `/api/profile/{id}/match-history` | `api.cs-prod.leetify.com` | the last 30 games (a non-member's list; a member's kills/deaths) | no |
| `/api/games/{gameId}` | `api.cs-prod.leetify.com` | one game's full scoreboard (the expanded match row, one-click analysis) | no |
| `/v3/profile?steam64_id=` | `api-public.cs-prod.leetify.com` | a member's profile (`GetProfile`) | `_leetify_key` as sent |
| `/v3/profile/matches?steam64_id=` | `api-public.cs-prod.leetify.com` | their match list (`MatchReference`, one-click analysis) | `_leetify_key` as sent |
| `/v2/matches/{id}` | `api-public.cs-prod.leetify.com` | a match report by Leetify id (`MatchByID`) | `_leetify_key` as sent |
| `/v2/matches/matchmaking/{share code}` | `api-public.cs-prod.leetify.com` | a match report by share code (the bridge) | `_leetify_key` as sent |

Anything else is a `404` at the Worker, before it becomes a request to
Leetify. For the public routes the only query forwarded is a 17-digit
`steam64_id` (a `/v3/profile*` request without one is a `400`). Every
forwarded answer carries `X-Relay-Upstream: app|public` plus the upstream's
`Content-Type` and `Retry-After`, so the backend can tell Leetify's answers
from the Worker's own (`401` key, `404` route, `502`) and from Cloudflare's.
A `429` from the public host is passed back untouched, never retried.

(`backend/cmd/leetifyrelay`, the Go forwarder for option A below, still
forwards the five app routes only. Pointed at it, the backend's public calls
get its `404` and fall back to the direct host — exactly what an un-updated
Worker produces.)

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
`https://<name>.<account>.workers.dev`. Verify exactly as in A.5, and for the
public routes:
```
curl -s -H "X-Relay-Key: <key>" "https://<name>.<account>.workers.dev/v3/profile?steam64_id=76561198200413817"
```
must print the profile JSON (add `-H "_leetify_key: <key>"` to test the keyed
tier). A `429 {"error":"Calm down son"}` here means the Worker's egress is
limited too and the relay buys nothing for the public routes.

To update a Worker that already exists (a new paste of this file): Edit code →
replace everything → Deploy. The secret stays. The route test beside the file
runs with `node --test deploy/leetify-relay.worker.test.mjs`.

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
must show `"relay":true` and `"public_relay":true`. Then open
`csrun.win/profiles/76561197965792900`: the Leetify panel appears with the
"recent games only" pill. The Steam-page card of the browser extension reads
the same backend, so it fills in too. Cached misses expire within 5 minutes.

The public routes need nothing more: `LEETIFY_PUBLIC_RELAY_URL` and
`LEETIFY_PUBLIC_RELAY_KEY` each default to the app relay's value, so one
Worker with one key serves both. Set them only for a separate relay.

## Switches

- `LEETIFY_APP_RELAY_URL=` (empty): ask Leetify directly again (walled from Contabo → misses).
- `LEETIFY_APP_FALLBACK=0`: no app routes at all, relay or not.
- A relay that is down, or refuses the key, is a plain miss on the profile page
  — never an error — and is logged on the backend as `leetify app fallback failed`.
- `LEETIFY_PUBLIC_RELAY=0`: the public routes (v3/v2) go to `api-public` directly
  again, the app relay untouched. `LEETIFY_PUBLIC_RELAY_URL` / `_KEY`: a separate
  relay for the public routes; empty = the app relay's.
- For the public routes a relay that cannot answer for Leetify (unreachable, a
  5xx from Cloudflare, the key refused, or an older Worker paste without the
  routes → `404`) is skipped **for that call**: the direct host is asked instead,
  and the backend logs `leetify public relay could not answer for Leetify` once
  per half hour with the count of the failures it did not log. An un-updated
  Worker therefore leaves things exactly where they were — no better, no worse.

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
  back-off Leetify has ever published), doubling for each 429 met **after a pause has
  lapsed**, capped at thirty. 429s that arrive while a pause is open were in flight when
  it was tripped (the homepage's featured strip fires five lookups at once): they are one
  limit, not five — no escalation, no extra log line. A `Retry-After` is honoured when it
  asks for longer, up to the same thirty-minute cap;
- while paused, nothing is asked of Leetify — not the app routes either, though through
  the relay they would answer: `/v3` never said "no", so a member would come back as the
  app's thin non-member summary ("recent games only", "not a Leetify member") and evict
  their last full copy from the cache. A lookup is `ErrUnavailable`, which the cache layer
  answers with the 24 h stale copy when there is one (the page shows its age) and
  otherwise with a miss kept for 45 s or until the pause lapses, whichever is sooner —
  never the five-minute miss a real 404 earns;
- the bridge parks the codes it could not fetch in the retry set instead of dropping
  them, `shouldSync` says no without stamping the tried key, and the chain poller skips
  its round;
- the profile route answers `503` with a reason (`Cache-Control: no-store`,
  `Retry-After: 60`) instead of `500 internal error`; the profile page, its `/id/<vanity>`
  twin and the matches page say why the panel is missing, and a stale copy says how old
  it is (`fetched_at`, stamped on every copy the backend caches — the profile route, the
  teammates route and its per-friend rows share the key; a copy without a stamp shows no
  age).

Log lines to grep:

```
leetify public API rate-limited this address     # one Warn per pause, with until/pause/limits_in_a_row
leetify public API answers this address again     # one Info when it lifts: paused_for + refused_while_paused
chain poller round skipped: leetify paused
matchsync: leetify paused; codes parked for retry
```

The first `answers this address again` timestamp minus the deploy time is the empirical
length of Leetify's block. Kill switch: `LEETIFY_PUBLIC_BREAKER=0` in the VM `.env` and
`up -d backend` (no rebuild) restores the pre-pause behaviour — except that a 429 is still
not retried, which is deliberate.

### The pause bought time; the block did not lift (2026-10-01)

From 2026-10-01 07:01 UTC every probe after every pause was refused again: the breaker
sat at its thirty-minute cap and logged **26 pauses in a row**, one probe per half hour,
every one answered `429 {"error":"Calm down son"}` (`server: LRL`) — while the same
request, with the same key, answered `200` from a home connection at the same minute.
One request per thirty minutes is not a rate anyone limits: the box's address is
burned, not the key and not the volume.

### The public routes through the relay (built 2026-10-01)

The key is address-independent, so the keyed public calls now take the road the app
routes already take — the Worker above, with the public routes pasted in.

- **Relay first, direct as the fallback** (`backend/internal/leetify/publicrelay.go`,
  `WithPublicRelay`). Not "direct first, relay while paused": the direct address is
  refused on every probe, so trying it first spends a request to learn what is already
  known and a pause to forget it. Every `GetProfile`, `MatchReference`, `MatchByID` and
  `MatchByShareCode` goes to the relay with `X-Relay-Key` and the `_leetify_key` header
  for the Worker to forward.
- **A 429 through the relay is the same rate limit.** The Worker passes status,
  `Retry-After` and body through untouched; the backend's pause trips on it with the
  same five-minute start, the same doubling after a lapse, the same thirty-minute cap and
  the same `ErrUnavailable` — and while paused nothing is asked of anyone, relay or not.
  A profile that is `404` through the relay still goes to the app fallback as before.
- **A relay that cannot answer for Leetify is skipped for that call.** The Worker stamps
  `X-Relay-Upstream` on everything it forwarded; a non-2xx without the stamp — an old
  paste's `404 not a relayed route`, Cloudflare's 5xx, `401` on the key, a `429` from the
  Worker's own free-tier limit — means the relay spoke for itself, and the direct host is
  asked instead. That path is what the box had before this change, so an un-updated
  Worker never makes anything worse. Logged once per half hour:
  `leetify public relay could not answer for Leetify`, with `reason`, `status` and
  `unlogged_before_this`.
- **Env**: `LEETIFY_PUBLIC_RELAY_URL` / `LEETIFY_PUBLIC_RELAY_KEY`, each defaulting to
  the app relay's, so the live box needs no new variables; `LEETIFY_PUBLIC_RELAY=0` is
  the way back. All three pass through `docker-compose.prod.yml`; the start-up line
  `leetify app fallback` carries `public_relay` and `public_relay_url`.
- **Proof**: after the paste, from anywhere,
  `curl -s -H "X-Relay-Key: <key>" "https://<worker>/v3/profile?steam64_id=76561198200413817"`
  → `200` and the profile JSON. Then on the box, after the deploy, the pause lines stop
  and `leetify public API answers this address again` is NOT expected — the direct
  address is simply no longer asked. A `429` from the curl means Cloudflare's egress is
  limited too and the relay buys nothing for the public routes.
- Budget: ~10k relayed public requests a day at today's volume, 10% of the Worker free
  tier, on top of the app routes.
- Say it out loud: routing around a per-address block is a change of source address, not
  a challenge bypass, but Leetify could read it as evasion. Their Discord
  (https://discord.gg/UNygC8BAVg) is the only documented channel; a note naming
  89.117.150.114 and the developer account may end the block on its own.

## Not yet done

Skinport prices through the same box (`SKINPORT_BASE_URL` does not exist yet;
the relay forwards Leetify routes only). Worth doing once the box exists:
Skinport is the cash market the inventory panel was designed around, and the
Steam-market fallback quotes wallet prices, which run higher.
