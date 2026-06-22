# CS2 Tracker

An open-source Counter-Strike 2 stats tracker — the foundation for something
that goes past the end-of-match scoreboard the way Leetify and csgostats.gg do.
This is **milestone 1**: a clean, runnable monorepo with a real demo-parsing
pipeline, a typed Steam Web API client, a Postgres-backed data model, and a
polished Next.js profile page.

> Status: the Go backend builds, vets and tests green; the Next.js frontend
> type-checks and production-builds. See [Verification](#verification) for what
> runs today and what is intentionally stubbed for later milestones.

---

## What it does

- **Parses real demos.** A CS2 GOTV `.dem` is parsed once with
  [`demoinfocs-golang`](https://github.com/markus-wa/demoinfocs-golang) into
  per-match, per-round and per-player stats: kills/deaths/assists, **ADR**,
  **KAST**, **HS%**, opening duels, trade kills, clutches, multi-kill rounds, and
  an HLTV-style **rating**. Parse once, store the results, throw the demo away.
- **Aggregates on write.** When a demo finishes parsing, the player's rolling
  career aggregate is recomputed in the same transaction, so profile reads are a
  single indexed lookup (and cached in Redis).
- **Async pipeline.** Ingest enqueues a job on Redis; stateless worker(s) parse
  off the request path and can be scaled horizontally.
- **Steam identity.** A typed client for `ResolveVanityURL`,
  `GetPlayerSummaries` and `GetUserStatsForGame` (App 730).
- **Mirrors Steam's URLs.** `/id/<vanity>` and `/profiles/<steamID64>` resolve
  and render our profile page — point a `steamcommunity.<tld>` redirect at the
  app and the same profile links Just Work.
- **Decodes match share codes.** `CSGO-xxxxx-…` → matchId / reservationId / TV
  port (fully implemented and unit-tested against reference vectors).

## Architecture

```
                ┌────────────┐      enqueue job      ┌──────────────┐
   browser ───► │  frontend  │ ───► API (Go/chi) ───►│  Redis queue │
   (Next.js)    │  Next.js   │ ◄─── JSON ◄───┐       └──────┬───────┘
                └────────────┘               │              │ BRPOP
                                             │              ▼
                                      ┌──────┴──────┐  ┌──────────┐
                                      │  Postgres   │◄─┤  worker  │ parse .dem
                                      │ (source of  │  │ (Go)     │ → stats
                                      │   truth)    │  └────┬─────┘ → write
                                      └──────┬──────┘       │ invalidate
                                             │              ▼
                                             └────────► Redis cache
```

- **Backend** — Go. One module, four binaries: `api`, `worker`, `parsedemo`,
  `seed`. Packages are small and single-purpose (`steam`, `sharecode`, `parser`,
  `stats`, `db`, `queue`, `cache`, `demosource`, `api`).
- **Frontend** — Next.js (App Router) + TypeScript + Tailwind v4. Server
  Components fetch from the backend; the browser never talks to it directly.
- **Datastores** — Postgres is the source of truth (schema via embedded
  migrations applied on boot); Redis is the job queue + hot cache.

## Repository layout

```
cs2-tracker/
├─ backend/
│  ├─ cmd/{api,worker,parsedemo,seed}/   # entrypoints
│  ├─ internal/
│  │  ├─ steam/        # Steam Web API client (+ tests)
│  │  ├─ sharecode/    # match share-code decode/encode (+ tests)
│  │  ├─ parser/       # demoinfocs integration + RoundTracker (+ tests)
│  │  ├─ stats/        # rating/ADR/KAST math (pure, + tests)
│  │  ├─ db/           # pgx pool, migrations, queries (aggregate-on-write)
│  │  ├─ queue/        # Redis job queue
│  │  ├─ cache/        # Redis JSON cache
│  │  ├─ demosource/   # resolve a job → local .dem (file or HTTP/bz2)
│  │  ├─ api/          # chi router + handlers
│  │  ├─ models/       # shared domain types
│  │  └─ config/       # env-driven config
│  └─ Dockerfile
├─ frontend/
│  ├─ app/             # /, /profiles/[steamid], /id/[vanity], /matches/[id]
│  ├─ components/      # ProfileView, Scoreboard, RatingRing, …
│  ├─ lib/             # api client, types, formatters
│  └─ Dockerfile
├─ docker-compose.yml
├─ .env.example
└─ ROADMAP.md
```

---

> **Continuing in VS Code?** See **[docs/DEVELOPING.md](docs/DEVELOPING.md)** —
> prerequisites, the bundled `.vscode` tasks/debug configs, how to start the
> portable Postgres, and how to run everything. Deploy + the steamcommunity-TLD
> mirror trick: **[docs/MIRROR-AND-DEPLOY.md](docs/MIRROR-AND-DEPLOY.md)**.

## Quick start (Docker)

> Needs a healthy Docker engine. **On this machine the WSL2/Hyper-V backend is
> currently broken (HCS error `0xc03a001a`), so `docker compose up` may not start
> until that is fixed** — see [Running without Docker](#running-without-docker).

```bash
cp .env.example .env          # optionally add STEAM_API_KEY
docker compose up --build     # postgres + redis + backend + worker + frontend

# in another terminal, load demo data so the UI has something to show:
docker compose run --rm backend seed
```

Then open:

- Frontend: <http://localhost:3000>
- Seeded profile: <http://localhost:3000/profiles/76561198000000001>
- API health: <http://localhost:8080/api/health>

## Running without Docker

You need **Go 1.26+**, **Node 20+**, and local **Postgres** + **Redis**
(install them, or run just those two via Docker if the engine works:
`docker compose up postgres redis`).

```bash
# 1) Backend API (runs migrations on boot)
cd backend
export DATABASE_URL='postgres://cs2:cs2@localhost:5432/cs2tracker?sslmode=disable'
export REDIS_URL='redis://localhost:6379/0'
export STEAM_API_KEY=''        # optional
go run ./cmd/api

# 2) Worker (separate terminal, same env)
go run ./cmd/worker

# 3) Seed demo data (optional, separate terminal, same DATABASE_URL)
go run ./cmd/seed

# 4) Frontend (separate terminal)
cd ../frontend
echo 'API_INTERNAL_URL=http://localhost:8080' > .env.local
npm install
npm run dev
```

> Shortcut: a `Makefile` wraps the common commands — run `make help` to list
> them (`make build`, `make test`, `make run-api`, `make seed`,
> `make parsedemo DEMO=…`, `make steamcheck`, `make up`, …).

## Try the parser on a real demo

No database required:

```bash
cd backend
go run ./cmd/parsedemo /path/to/match.dem          # pretty scoreboard
go run ./cmd/parsedemo -json /path/to/match.dem    # full JSON
go run ./cmd/parsedemo -db  /path/to/match.dem     # also write to Postgres
```

Or via the running stack (worker mounts `./testdata` at `/demos`):

```bash
curl -X POST localhost:8080/api/ingest/demo \
  -H 'content-type: application/json' \
  -d '{"demoPath":"/demos/match.dem","source":"local"}'
```

A `.dem` can also be ingested by URL (GOTV `.dem.bz2` is decompressed
automatically): `{"demoUrl":"https://.../match.dem.bz2"}`.

---

## Verify your Steam API key

Once you have a key (`STEAM_API_KEY`), confirm it works against the live API
without needing the database, Redis or Docker:

```bash
cd backend
STEAM_API_KEY=xxxxxxxx go run ./cmd/steamcheck                 # default public account
STEAM_API_KEY=xxxxxxxx go run ./cmd/steamcheck gabelogannewell # a vanity name
STEAM_API_KEY=xxxxxxxx go run ./cmd/steamcheck 7656119...      # a SteamID64
```

It exercises `ResolveVanityURL`, `GetPlayerSummaries` and
`GetUserStatsForGame` (App 730) and prints what it gets back.

## API reference

| Method | Path | Description |
|---|---|---|
| GET  | `/api/health` | Liveness + whether a Steam key is configured + queue depth |
| GET  | `/api/resolve?q=<vanity\|id>` | Resolve a vanity name or SteamID64 → SteamID64 |
| GET  | `/api/leaderboard?limit=` | Top tracked players by rating |
| GET  | `/api/players/{steamid}` | Profile: identity + rolling career aggregate (cached) |
| POST | `/api/players/{steamid}/refresh` | Re-fetch identity from Steam (needs key) |
| GET  | `/api/players/{steamid}/matches?limit=&offset=` | Recent matches with the player's line |
| GET  | `/api/players/{steamid}/weapons?limit=` | Per-weapon kills + headshot % from the killfeed |
| GET  | `/api/players/{steamid}/maps` | Per-map career breakdown (W-L, win %, rating, ADR) |
| GET  | `/api/players/{steamid}/leetify` | Live Leetify profile (ratings, ranks, stats) — fetched real-time, attributed |
| GET  | `/api/players/{steamid}/faceit` | Live FACEIT profile (CS2 skill level, ELO, lifetime stats) — fetched real-time, attributed (needs `FACEIT_API_KEY`) |
| GET  | `/api/players/{steamid}/steam-stats` | Raw App 730 lifetime stats (needs key) |
| GET  | `/api/matches/{id}` | Full match detail: scoreboard + rounds |
| GET  | `/api/matches/{id}/kills` | Ordered killfeed for a match |
| POST | `/api/ingest/demo` | Enqueue a parse job (`demoPath` \| `demoUrl` \| `shareCode`); returns a pollable `jobId` |
| GET  | `/api/jobs/{id}` | Parse-job status (`queued`/`running`/`done`/`failed`, with `matchId` on success) |
| GET  | `/api/queue` | Pending job count |
| GET  | `/metrics` | Prometheus HTTP request counters (root path, not rate-limited) |

## The steamcommunity-TLD redirect trick

Steam profile URLs look like `steamcommunity.com/id/<vanity>` and
`steamcommunity.com/profiles/<steamID64>`. The frontend mirrors **both paths**
(`app/id/[vanity]` and `app/profiles/[steamid]`). If you make a
`steamcommunity.<some-tld>` host resolve to this app (DNS or a local `hosts`
entry) the same profile URLs render our tracker instead of Steam — the redirect
trick csgostats/Leetify-style tools use. SteamID64s render directly; vanity names
are resolved through the backend's `ResolveVanityURL` call.

## Configuration

All config is environment-driven (see [`.env.example`](.env.example)). Notable
vars: `STEAM_API_KEY`, `FACEIT_API_KEY` (free, from
<https://developers.faceit.com> — enables the live FACEIT panel),
`DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`,
`DELETE_RAW_DEMO`, `JOB_TIMEOUT`, `WORKER_CONCURRENCY` (jobs parsed in
parallel per worker), `CACHE_TTL`, `RATE_LIMIT_RPS` / `RATE_LIMIT_BURST`
(per-IP API rate limit; RPS 0 disables), and `API_INTERNAL_URL` (frontend).

## How the advanced stats are computed

- **KAST** — a round counts for a player if they got a **K**ill, an **A**ssist,
  **S**urvived, or were **T**raded (their killer died within 5s). Logic lives in
  `parser.RoundTracker` and is unit-tested with synthetic rounds.
- **ADR** — total health damage dealt ÷ rounds played.
- **Opening duels** — first kill of the round credits the killer (opening kill)
  and victim (opening death).
- **Clutches** — when a player is left 1-vs-X on their team; counted won if their
  team takes the round.
- **Rating** — HLTV Rating 1.0 from kills, survival and the multi-kill-round
  distribution. See `internal/stats`.

## Verification

Run from a clone:

```bash
cd backend && go build ./... && go vet ./... && go test ./...
cd ../frontend && npm install && npm run typecheck && npm run build
```

Current status on the dev machine (Go 1.26.4, Node 24):

- ✅ `go build ./...`, `go vet ./...` clean
- ✅ `go test ./...` — sharecode, steam (httptest), parser (RoundTracker), stats
- ✅ frontend `tsc --noEmit` and `next build` clean
- ⛔ `docker compose up` not exercised here — the machine's WSL2/Docker backend is
  down (HCS `0xc03a001a`). The compose file and Dockerfiles are written and
  reviewed; bring up a healthy Docker engine to run the full stack.
- 🔑 Steam endpoints are real but need a `STEAM_API_KEY` to hit live; they are
  covered by tests against a mock server in the meantime.

See [ROADMAP.md](ROADMAP.md) for the path beyond this milestone.
