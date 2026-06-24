# Deploy: Vercel + Supabase + Fly.io (managed, no VPS)

The split:

```
            steamcommunity.run (DNS on Cloudflare, DNS-only)
                          |
                      Vercel  ── Next.js frontend (SSR/ISR + CDN + TLS)
                          |  (server-to-server, API_INTERNAL_URL)
                       Fly.io ── Go backend API (always-on, holds API keys + cache)
                          |  (DATABASE_URL)
                     Supabase ── Postgres
                          ⌐ (optional) Upstash ── Redis cache
```

The browser only ever talks to Vercel. Vercel's servers call the Fly backend
(server-side). The backend is the only thing holding `STEAM_API_KEY` /
`FACEIT_API_KEY` and the only thing touching Postgres — so it must be a real
always-on process, which is what Fly provides.

> Browser never calls the backend directly (the one client call, search
> autocomplete, is proxied through a Next route). So the Fly app can stay on its
> `*.fly.dev` hostname and CORS is not strictly required.

---

## 0. Prep
- Merge the feature branch into `main` and deploy `main` (Vercel/Fly track a
  branch). Steam **login is on a separate branch** and is NOT included — the live
  site is the search / profiles / compare / live-stats tracker without a "Sign
  in" button.
- Have your Steam Web API key and FACEIT server-side key handy.

## 1. Supabase (Postgres)
1. Create a project at supabase.com; pick a region near your Fly region.
2. Settings → Database → **Connection string** → choose **Session pooler**
   (NOT the Transaction pooler on port 6543 — the Go client uses prepared
   statements, which transaction-mode pooling breaks).
3. Copy that URL and append `?sslmode=require`. This is your `DATABASE_URL`:
   ```
   postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
   ```
   Migrations run automatically the first time the backend boots against it — no
   manual migrate step.

## 2. Fly.io (Go backend)
From the `backend/` directory:
```bash
fly launch --no-deploy      # detects backend/Dockerfile, internal_port 8080; decline its Postgres/Redis offers
fly secrets set \
  DATABASE_URL="postgresql://...pooler.supabase.com:5432/postgres?sslmode=require" \
  STEAM_API_KEY="<your-steam-key>" \
  FACEIT_API_KEY="<your-faceit-key>"
fly deploy
```
- In `fly.toml`, keep **`min_machines_running = 1`** (don't let it scale to zero):
  the rate limiter, singleflight stampede protection, and request coalescing live
  in process memory, so a cold start loses them.
- Confirm `internal_port = 8080` and that the HTTP service is enabled.
- Note the app URL: `https://<your-app>.fly.dev`. Check `https://<app>.fly.dev/api/health` → `{"status":"ok"}`.
- **Recommended (optional):** add a free **Upstash** Redis and
  `fly secrets set REDIS_URL="rediss://...upstash.io:6379"`. Without it the app
  still works (singleflight protects upstreams) but you lose the response cache —
  worth having under launch traffic so you don't hammer Leetify/FACEIT/Steam.

## 3. Seed data? (optional)
Production serves **live** data for any profile searched, so seeding is optional.
The leaderboard + native parsed-match sections will be sparse (demo parsing is
off), while the Leetify / FACEIT / Steam panels work for every profile. To load
demo content anyway, run the seed locally against Supabase:
```bash
cd backend
DATABASE_URL="postgresql://...pooler.supabase.com:5432/postgres?sslmode=require" go run ./cmd/seed
```

## 4. Vercel (frontend)
1. Import the GitHub repo into Vercel.
2. **Settings → Root Directory = `frontend`** (the Next app lives there).
   Framework preset auto-detects as Next.js.
3. Environment Variables (Production):
   - `API_INTERNAL_URL = https://<your-app>.fly.dev`
   - `SITE_URL = https://steamcommunity.run`  (no trailing slash)
4. Deploy. Test the `*.vercel.app` URL first — it should render live profiles.

## 5. Cloudflare DNS → Vercel
1. In Vercel → Project → Domains, add `steamcommunity.run` (and `www`). Vercel
   shows the DNS target.
2. In Cloudflare DNS, add the record Vercel asks for (apex: A `76.76.21.21` or a
   CNAME to `cname.vercel-dns.com` via CNAME flattening; `www`: CNAME
   `cname.vercel-dns.com`).
3. **Set those records to "DNS only" (grey cloud).** Vercel terminates TLS and
   provides its own global CDN; proxying through Cloudflare on top (orange cloud)
   commonly causes redirect/SSL loops. (If you specifically want Cloudflare in
   front, set SSL/TLS mode to **Full (strict)** — but grey-cloud is the simple,
   reliable path.)
4. Wait for Vercel to issue the cert (a minute or two).

## 6. Verify
- `https://steamcommunity.run/` → homepage.
- `https://steamcommunity.run/profiles/76561198077030352` → a live profile with
  Leetify + FACEIT + Steam panels (the mirror trick: this matches Steam's own
  URL shape).
- `https://steamcommunity.run/id/<vanity>` → resolves via Steam (needs
  `STEAM_API_KEY`, set in step 2).
- `https://steamcommunity.run/robots.txt` → `Sitemap: https://steamcommunity.run/sitemap.xml` (confirms `SITE_URL` took effect).

## Ongoing
- Push to `main` → Vercel auto-deploys the frontend; run `fly deploy` (or wire a
  GitHub Action) for the backend.
- Rotate any key by re-running `fly secrets set` (backend) or updating the Vercel
  env var (frontend) + redeploy.
