# Pre-launch checklist

Everything that can be done in code is done (see "Already handled" below). This
is what's left — split into **inputs you provide during setup** and **decisions
only you can make**. Pair this with [DEPLOY-VERCEL-SUPABASE-FLY.md](DEPLOY-VERCEL-SUPABASE-FLY.md).

## 1. Inputs you'll provide during backend setup
These need your accounts/credentials — we do them together when you're ready.

- **Supabase**: create a project → copy the **Session pooler** connection string,
  append `?sslmode=require` → this is `DATABASE_URL`.
- **Generate a shared secret** (once): `openssl rand -hex 32`. Set the SAME value
  as `INTERNAL_API_SECRET` on **both** Fly (backend) and Vercel (frontend). This
  locks the public backend to your frontend.
- **Fly (backend)** secrets: `DATABASE_URL`, `STEAM_API_KEY`, `FACEIT_API_KEY`,
  `INTERNAL_API_SECRET`, and optionally `REDIS_URL` (free Upstash). Pick a unique
  app name + region in `backend/fly.toml`.
- **Vercel (frontend)** env: `API_INTERNAL_URL=https://<your-app>.fly.dev`,
  `SITE_URL=https://csrun.win`, `INTERNAL_API_SECRET=<same secret>`.
  Root Directory = `frontend`.
- **Cloudflare**: point `csrun.win` at Vercel (DNS-only / grey cloud).

## 2. Decisions only you can make (before flipping ads on)
None block the backend going up; all block a *monetized public* launch.

- **Domain / trademark posture.** `csrun.win` deliberately mirrors
  Steam's URL — a trademark/impersonation gray area (Valve UDRP risk; ad networks
  ban impersonation; phishing-flag risk). Decide: accept the risk, or launch the
  brand on a neutral domain and keep `csrun.win` only as a redirect.
- **Privacy policy + Terms of Service.** *Required* by every ad network and by
  GDPR/CCPA. I can scaffold `/privacy` and `/terms` pages + footer links; the
  legal **content** needs your (or a lawyer's) approval.
- **Cookie/consent banner (CMP).** *Required* in the EU/UK before any ad/analytics
  cookie loads; personalized ads need a Google-certified CMP. Decide: add a CMP
  (Funding Choices/Cookiebot/etc.) or geo-gate ads off in the EU. I can wire a
  banner that defers ad/analytics scripts until consent.
- **Third-party API commercial use.** Confirm Leetify / FACEIT / Steam Web API
  permit ad-supported redistribution + short caching (there's a standing NOTE in
  the Leetify handler). Business/legal check.
- **Non-public profiles (GDPR).** We read Leetify's `privacy_mode` but don't yet
  hide non-public profiles. Decide whether to honor it (I can implement) + define
  a data-removal/takedown path.
- **Featured players.** The homepage features 5 real accounts
  ([FeaturedPlayers.tsx](../frontend/components/FeaturedPlayers.tsx)). Keep the
  pros, swap to accounts you control, or derive from real activity later.
- **Ad network + `ads.txt`.** Choose one (AdSense/Ezoic are realistic for a new
  site; Mediavine/Raptive need traffic) and add `ads.txt` once chosen.

## 3. Already handled (code-ready on `main` after this merges)
- **Backend locked down for public hosting**: optional `INTERNAL_API_SECRET` gate
  (only the frontend can reach the API; `/api/health` stays open for Fly), the
  dead demo-ingest routes removed (was an open write/DoS surface), `/api/health`
  trimmed (no key/DB/queue leakage), neutral 404/error copy.
- **Deploy config**: `backend/fly.toml`, `SITE_URL` + `CORS_ORIGINS` +
  `INTERNAL_API_SECRET` forwarded/documented in compose + `.env.example` files.
- **Frontend**: sends the internal token on every backend call; user-facing copy
  no longer leaks dev instructions (no "docker compose"/"ingest a demo"); header
  brand changed off "Tracker.gg"; a real root OpenGraph image (links no longer
  unfurl blank).
- **Verified**: `go build/vet/test` green; `next build`/`tsc` clean; the gate was
  tested end-to-end locally (anon → 401, `/api/health` → 200, frontend → 200).

## 4. Recommended fast-follows (optional, not blocking)
- Per-profile dynamic OpenGraph image (name + rating card) — highest-leverage
  shareability win; needs small `lib/meta.ts` coordination.
- Move the rate limiter to Redis if you ever run >1 backend machine.
- Upstash Redis for the full response cache under heavy traffic.
