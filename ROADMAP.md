# Roadmap — beating Leetify

Milestone 1 (this repo) is the spine: a correct parse-once pipeline, a real data
model, and a profile page that already shows round-level stats most hobby
trackers never compute. Everything below builds toward parity with — and then an
edge over — Leetify and csgostats.gg. Each phase is shippable on its own.

## ✅ Milestone 1 — Foundation (done)

- Monorepo + Docker Compose (Postgres, Redis, backend, worker, frontend).
- Demo parser → per-match/round/player stats (KAST, ADR, HS%, rating, clutches,
  opening duels, trades), parse-once with aggregate-on-write.
- Steam Web API client; match share-code decoder.
- Postgres schema + embedded migrations; Redis queue + cache.
- Steam-mirroring `/id` and `/profiles` routes; polished profile + match pages.

## ✅ Shipped since (milestones 2–13)

Built and verified after the foundation (each commit build/test-checked and
adversarially reviewed):

- **Weapon analytics + match killfeed** (surfacing the stored kill events).
- **Per-map performance breakdown** and **opening-duel / clutch-conversion**
  profile metrics.
- **Homepage leaderboard** (top tracked players by rating).
- **Persisted parse-job status** (`jobs` table + pollable `GET /api/jobs/{id}`,
  worker status transitions) and an **in-browser ingest UI** with live polling.
- **Steam key verified live** + client **retry/backoff** with rate-limit handling.
- **Round economy / buy-type classification** (eco/force/full/pistol per round;
  thresholds heuristic, pending real-demo tuning).
- **Frontend robustness**: error boundary, 404, loading skeletons, dynamic
  per-page metadata.
- **Per-IP API rate limiting**; **testable API layer** (Store interface + handler
  tests); **GitHub Actions CI** (build/vet/gofmt/test, tsc, next build, images).

---

## Phase 2 — Automatic match ingestion (the "it's magic" moment)

The single biggest UX win Leetify has is: connect once, your matches just appear.

1. **Game Coordinator client.** We already decode share codes; the missing piece
   is authenticating to the CS2 GC (via a Steam bot account / `go-steam` + the
   CS2 protobufs) to turn `matchId/reservationId/tvPort` into a GOTV demo URL.
   The worker's `demosource` package already accepts a URL and decompresses
   `.dem.bz2`, so this slots straight in.
2. **Share-code history sync.** Store a user's
   `authentication_code` + last known share code and poll
   `GetNextMatchSharingCode` so new matchmaking games auto-enqueue.
3. **Steam OpenID login.** Let users sign in with Steam so ingestion and "this is
   me" highlighting are tied to an account.
4. **Reliable delivery.** ✅ The `jobs` table + pollable status are shipped;
   still to do: promote the plain-list queue to visibility timeouts, max-retries
   and a dead-letter list.

## Phase 3 — Depth that pros actually want

- **Positional data & heatmaps.** Capture kill/death/utility positions (X/Y/Z)
  during the parse, store per-map, and render kill/death/entry heatmaps and
  common smoke/flash lineups.
- **Aim & mechanics analysis.** Time-to-damage, crosshair placement, spray
  control, counter-strafing %, preaim — derived from tick-level player/view data.
- **Impact rating.** ✅ Eco/force/full-buy detection is shipped; still to do: an
  impact rating weighting opening picks and clutches above filler frags, per-side
  splits, and real-demo tuning of the buy thresholds.
- **Utility grading.** Flash assists, enemies blinded duration, HE/molly damage,
  smoke coverage quality.

## Phase 4 — Identity, ranks & social

- **Premier/Faceit rank tracking** over time, with a rating-vs-rank graph.
- **Faceit integration** (their public API) to merge matchmaking + Faceit history
  into one profile.
- **Leaderboards & friends**, role detection (entry/AWP/support/IGL/lurker),
  map-pool strengths/weaknesses, teammate/duo synergy.
- **Match comparison & "what lost you the game"** narratives.

## Phase 5 — Scale & product

- **Parser fleet.** The worker is already stateless — autoscale a pool of
  workers off queue depth (KEDA/HPA), shard hot Postgres reads with read
  replicas, and move the killfeed/positional tables to partitioned/columnar
  storage as volume grows.
- **Incremental aggregates.** Replace full career recompute with delta updates
  (and materialized rollups) once a player has thousands of matches.
- **Premium tier.** Unlimited history retention, deeper aim analytics, demo
  clip generation, API access — the sustainable wedge against free trackers.
- **Public API & embeds** for streamers and team sites.

## Cross-cutting engineering backlog

- ✅ CI: GitHub Actions running `go test`, `go vet`, `gofmt`, `tsc`, `next build`
  and building both images — shipped.
- ✅ API handler tests via a fake `Store` — shipped. Still to do: integration
  tests against a throwaway Postgres (Testcontainers) for the `db` layer, and a
  small committed demo fixture for a parser golden test.
- Observability: structured request logs (in place), plus metrics
  (parse duration, queue depth, cache hit rate) and tracing.
- Rating model: validate Rating 1.0 against known matches, then add an
  impact-weighted Rating 2.0-style model with documented coefficients.
- Robustness: handle reconnects/substitutes/coaches, surrendered matches, and
  non-MM formats (wingman, faceit knife rounds) in round detection.
