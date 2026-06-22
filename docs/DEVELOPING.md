# Developing in VS Code

Everything you need to open `F:\cs2-tracker` in VS Code and keep building.

## 1. Open it

`File → Open Folder… → F:\cs2-tracker`. VS Code will offer to install the
**recommended extensions** (`.vscode/extensions.json`): Go, Tailwind CSS, Docker,
EditorConfig — accept them. Tasks and debug configs are in `.vscode/`.

## 2. Prerequisites

| Tool | Needed for | Status on this machine |
|---|---|---|
| **Go 1.26+** | backend | Bootstrapped (see note ↓) — install for VS Code Go tooling |
| **Node 20+** | frontend | ✅ installed (v24) |
| **Postgres 16** | data store | ✅ a portable instance is already running (see §3) |
| Redis | queue/cache (optional) | not running — the API degrades without it |
| Docker | one-command stack (optional) | down (WSL2 broken) |

**Toolchains I bootstrapped for you** (outside the repo, not committed):
- **Go** → `C:\Users\David\go-portable\go` (binary at `…\go\bin\go.exe`)
- **Postgres 16.6** → `C:\Users\David\pg16`, data dir `C:\Users\David\pg16data`

For VS Code's Go extension to work, either:
- **Install Go** from <https://go.dev/dl/> (recommended, puts `go` on PATH), or
- **Reuse the portable Go**: add `C:\Users\David\go-portable\go\bin` to your PATH
  (System → Environment Variables), then restart VS Code.

## 3. Postgres (the data store)

A portable Postgres is **already running** on **port 5433** (db `cs2tracker`,
user `postgres`, trust auth) and is seeded. `.env` already points at it. If you
reboot, restart it from a terminal:

```powershell
& "C:\Users\David\pg16\pgsql\bin\pg_ctl.exe" -D "C:\Users\David\pg16data" -o "-p 5433" -l "C:\Users\David\pg16data\server.log" start
```

Stop it with the same command + `stop`. (Or install Postgres normally / use
`docker compose up postgres` once Docker is healthy, and update `DATABASE_URL`.)

## 4. Secrets / env

`.env` (repo root, **git-ignored — keep it**) holds your keys and the DB URL:
`STEAM_API_KEY`, `CS2SPACE_API_KEY`, `LEETIFY_*`, and
`DATABASE_URL=…@localhost:5433/cs2tracker`. The backend loads it automatically
when run from `backend/` (every VS Code task sets that working dir).

## 5. Run it (VS Code: Terminal → Run Task…, or `Ctrl+Shift+B`)

| Task | What it does |
|---|---|
| `run: seed` | Load demo data (already done once; safe to re-run) |
| `run: api` | API on http://localhost:8080 |
| `frontend: dev` | UI on http://localhost:3000 |
| `run: worker` | Parse worker (needs Redis for the queue; optional) |
| `backend: build` / `backend: test` / `backend: vet` | Go checks |
| `frontend: build` | Production Next build |

Then open **http://localhost:3000**. Debugging: the **Run and Debug** panel has
*Debug API*, *Debug worker*, *Debug parsedemo* (Go; the Go extension installs
`dlv` on first use).

## 6. What's currently running (from the bootstrap session)

Postgres (`:5433`), the API (`:8080`), the Next dev server (`:3000`), and the
mirror proxy (`:80`) are running as background processes. To take over cleanly,
stop the stale API/frontend (find by port and kill), then start them from the
VS Code tasks so the output lands in your integrated terminal:

```powershell
Get-NetTCPConnection -LocalPort 8080,3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

(Leave Postgres `:5433` running, or restart per §3.)

## 7. Project layout

```
backend/   Go: cmd/{api,worker,parsedemo,seed,steamcheck}, internal/*, migrations
frontend/  Next.js (App Router) + Tailwind v4: app/, components/, lib/
docs/      this guide, MIRROR-AND-DEPLOY.md
scripts/   mirror-proxy.js (TLD-swap demo)
```

## 8. Fresh clone elsewhere (not this machine)

```bash
# install Go 1.26+, Node 20+, Postgres 16 (or Docker)
cp .env.example .env            # then fill STEAM_API_KEY etc.
createdb cs2tracker             # or: docker compose up -d postgres
cd backend && go run ./cmd/seed # migrate + seed
go run ./cmd/api                # :8080   (separate terminal: go run ./cmd/worker)
cd ../frontend && npm install && npm run dev   # :3000
```

Not in git (recreated locally): `.env`, `node_modules/`, `backend/bin/`,
`.next/`, and the portable Go/Postgres.

## 9. Verify the build (what CI runs)

```bash
cd backend && go build ./... && go vet ./... && go test ./...
cd ../frontend && npm install && npm run typecheck && npm run build
```
