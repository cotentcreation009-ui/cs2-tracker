# Migrating csrun.win off GCE (to Contabo, or any Ubuntu VPS)

*Written 2026-09-18 from a live inventory of the `cs2` GCE VM. Supersedes §10 of
`DEPLOY-GCE-SINGLE-BOX.md`. Target chosen 2026-09-18: **Contabo Cloud VPS 4**
(4 vCPU / 8 GB / 100 GB, US Central) at ~$7.90/month — Hetzner's US locations
priced the 8 GB box at $73.49, more than GCE.*

## Why

The GCE box (e2-standard-2, 80 GB pd-balanced, static IP) costs ~$60/month and runs
at 2–4 % CPU / 2.1 GB of 8 GB RAM (peak ~3.3 GB during a poster print master). A
Contabo Cloud VPS 4 (4 vCPU, 8 GB, 100 GB, "unlimited" fair-use traffic, US Central)
is ~$8/month for a bigger machine. Everything is docker-compose behind Cloudflare, so
the move is a copy plus a DNS edit. The procedure is provider-agnostic: any Ubuntu
24.04 box with root SSH works.

## What lives on the VM outside git (the inventory that has to move)

| Thing | Where on GCE | Size | How it moves |
|---|---|---|---|
| Secrets | `~/cs2-tracker/.env` (20 vars) | — | scp; drop `DEMO_GCS_BUCKET` (empty, disables direct upload → falls back to through-server upload, which is what runs today) |
| Cloudflare Origin cert | `~/cs2-tracker/origin.pem`, `origin.key` | — | scp; valid for any origin, no reissue |
| Postgres | volume `cs2-tracker_pgdata` (61 MB DB) | 121 MB | `pg_dump` → restore into the fresh volume; final delta dump at cutover |
| Steam bot token | volume `cs2-tracker_gcbot_data` (1 KB) | — | tar the volume; **stop the GCE bot before starting the new one** (Steam allows one session) |
| Redis | volume | — | cache only; not copied |
| Caddy state | `caddy_data`/`caddy_config` | — | not copied; cert is a bind mount |
| Poster repo | `~/csrun-app` (branch `feat/headless-renderer`) + deploy key `~/.ssh/csrun_deploy` | — | scp key, clone with `GIT_SSH_COMMAND` |
| Poster art | `~/csrun/assets-cs2` **17 GB**, `backdrops`, `emblems`, `map-icons`, `gallery`, `masters`, `data/csrun.db` | 17 GB | rsync GCE → new box directly (~$2 GCE egress). Bucket copy would be the same bytes, slower |
| Backups | `~/backups/*.sql.gz` (14 days) + GCS bucket | 261 MB | last 3 copied; new cron targets Cloudflare R2 |
| Firewall | GCE rule `allow-cf-web` (80/443 from Cloudflare only) | — | reproduced by `deploy/vps/bootstrap.sh` with ufw |

## Order of operations

1. **Owner**: order the VPS (Contabo: Cloud VPS 4, US Central, Ubuntu 24.04, no
   panel, no auto-backup). Contabo's order form has no SSH-key field: it emails a root
   password. Add the operator's public key in the Contabo panel if offered; otherwise
   the operator logs in once with the password and the bootstrap disables password
   auth. Send the IPv4.
2. **Operator**: `scp deploy/vps/bootstrap.sh root@NEW:` and run it. Docker, `cs2`
   user, ufw, swap, log rotation, build-cache + journal caps, unattended upgrades,
   password SSH off.
3. **Operator, on GCE**: create a one-off key pair for the transfer and add its public
   half to `/home/cs2/.ssh/authorized_keys` on NEW. Then from GCE:
   ```bash
   rsync -a --info=progress2 -e "ssh -i ~/.ssh/migrate" ~/csrun/ cs2@NEW:~/csrun/
   scp -i ~/.ssh/migrate ~/cs2-tracker/.env ~/cs2-tracker/origin.pem ~/cs2-tracker/origin.key cs2@NEW:~/
   scp -i ~/.ssh/migrate ~/.ssh/csrun_deploy cs2@NEW:~/.ssh/
   ```
4. **Operator, on NEW**: clone both repos, put `.env`/certs in place, remove
   `DEMO_GCS_BUCKET`, set the AI provider (`ANTHROPIC_API_KEY` — Vertex's keyless
   GCE auth does not exist here), `chown -R 10001:10001 ~/csrun/assets-cs2 ~/csrun/masters ~/csrun/data`
   (the render worker's uid), then
   `docker compose -f docker-compose.prod.yml -f docker-compose.posters.yml up -d --build`.
   Restore a fresh dump into Postgres. Copy the gc-bot token into `gcbot_data` but keep
   `gc-bot` **stopped** until cutover.
5. **Operator**: verify against the new IP without touching DNS:
   `curl --resolve csrun.win:443:NEW https://csrun.win/api/health`, a profile page, a
   poster preview (`--resolve posters.csrun.win:443:NEW`).
6. **Cutover** (~5 min of downtime, do it at a quiet hour):
   - GCE: `docker compose stop backend worker gc-bot frontend posters-web` (Caddy keeps
     answering 502 → Cloudflare shows its error page for a few minutes).
   - GCE: final `pg_dump | gzip`, scp to NEW, restore (drop + recreate the DB first).
   - NEW: `docker compose ... up -d` (all services, gc-bot included).
   - **Owner** (or operator with a DNS-edit API token): Cloudflare DNS → A records
     `csrun.win`, `www`, `posters` → NEW IPv4, keep **Proxied**. Propagation is seconds
     behind the orange cloud.
   - Verify from the outside; watch `docker logs` for 10 minutes.
7. **Backups on the new box**: nightly `pg_dump` cron as before, off-box copy to
   Cloudflare R2 (`rclone`, free tier). Contabo's paid auto-backup was declined; R2 is
   the off-box copy, and it must be in place before GCP is deleted.
8. **Decommission GCP, after 7 clean days**:
   - `gcloud compute instances stop cs2` (keep 3 days: disk still bills ~$0.30/day),
     then `gcloud compute instances delete cs2` and `gcloud compute addresses delete cs2-ip`.
   - Copy the last backups out of `gs://…-backups` (or just leave the bucket: 0.4 GB
     is cents) and delete `gs://csrun-posters-assets` (17 GB, ~$0.40/month) once the
     rsync'd copy has been verified twice.
   - Vertex AI / BigQuery APIs: disable. Then either delete the project or unlink it
     from billing. **Do not delete the billing account** — `foodscanner` and
     `wyldmarket` are on it.

## Things that change behaviour, said plainly

- **AI read on profiles**: Vertex worked keylessly because the VM was inside Google.
  Off Google the code's fallback is the Anthropic provider (`ANTHROPIC_API_KEY`,
  Haiku 4.5 by default). Without either, the button says "AI analysis isn't
  configured" — honest, not broken.
- **`gsutil` backup upload**: gone with the box; replaced (step 7).
- **gcloud SSH**: gone; plain `ssh cs2@NEW` with the operator's key.
- **Region**: us-central1 (Iowa) → Contabo US Central (St. Louis). Cloudflare fronts
  both; the origin hop barely changes for US users.
- **Provider support**: Contabo is ticket-only, hours to days. The mitigation IS this
  document: nightly off-box backups + a scripted rebuild on any Ubuntu box.

## Rollback

Until GCP is deleted, rollback is the DNS edit in reverse plus `docker compose up -d`
on GCE. Orders placed on the new box in between would need a reverse `pg_dump`; the shop
has no live checkout yet, so in practice nothing is lost.
