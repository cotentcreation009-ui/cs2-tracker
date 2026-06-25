# Deploy: single GCE VM + Cloudflare (free-trial credit)

Run the **whole stack** (Caddy → Next.js frontend → Go backend → Postgres + Redis)
on one Google Compute Engine VM via `docker-compose.prod.yml`, fronted by
Cloudflare, paid by the $300 / 90-day free-trial credit. Only Caddy is exposed;
everything else stays on the internal Docker network.

> The stack is portable docker-compose — the exact same files run on Hetzner/any
> VPS later. "Migration" at the end is just: bring it up on a new box, repoint DNS.

## Cost & credit reality (read first)
- **e2-medium** (2 vCPU shared / 4 GB) ≈ **$24/mo**; **e2-small** (2 GB) ≈ **$12/mo**.
- Over the 90-day trial that's only ~$40–75 of the $300 — **you lose the credit to the
  90-day expiry, not to spending.**
- The trial **never auto-charges your card.** When the 90 days (or $300) run out it
  **auto-suspends** the billing account; after a **30-day grace period** the VM + DB
  are **permanently deleted**. → Back up the DB before the trial lapses, or click
  *Upgrade* to keep running on pay-as-you-go.
- **Pick e2-medium.** `next build` (which runs on the box) is RAM-hungry and OOM-kills
  on 2 GB. If you insist on e2-small, add a 2 GB swap file before building (Step 3b).

---

## 1. Create the VM (gcloud)
```bash
gcloud services enable compute.googleapis.com

# Reserve a STATIC IP first (so Cloudflare's A record never goes stale)
gcloud compute addresses create cs2-ip --region=us-central1
gcloud compute addresses describe cs2-ip --region=us-central1 --format='get(address)'

# Create the box (e2-medium / Ubuntu 24.04 / 30 GB), attach the IP, tag it
gcloud compute instances create cs2 \
  --zone=us-central1-a \
  --machine-type=e2-medium \
  --image-family=ubuntu-2404-lts --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-balanced \
  --address=cs2-ip --tags=cs2
```
(Console equivalent: Compute Engine → Create instance → E2 / e2-medium, Ubuntu 24.04
30 GB, pick the reserved IP, tick *Allow HTTP/HTTPS*.)

**Firewall** — the default VPC opens SSH but **not 80/443**. Open them to Cloudflare
only (so nobody can hit your origin IP directly):
```bash
gcloud compute firewall-rules create allow-cf-web --network=default \
  --direction=INGRESS --action=ALLOW --rules=tcp:80,tcp:443 --target-tags=cs2 \
  --source-ranges="$(curl -s https://www.cloudflare.com/ips-v4 | paste -sd, -)"
# SSH only from your own IP (find it: curl ifconfig.me)
gcloud compute firewall-rules create allow-ssh-me --network=default \
  --direction=INGRESS --action=ALLOW --rules=tcp:22 \
  --source-ranges="YOUR.IP.ADDR/32" --target-tags=cs2
```
> Cloudflare IP ranges drift rarely; refresh the rule occasionally, or add
> Authenticated Origin Pulls (Step 5b) as a crypto backstop.

## 2. Install Docker (on the VM)
```bash
gcloud compute ssh cs2 --zone=us-central1-a   # SSH in
```
```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
sudo systemctl enable docker            # so the stack restarts after a VM reboot
docker compose version                   # confirm V2 plugin
```
**3b. (e2-small only)** add swap so the Next build doesn't OOM:
```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. Cloudflare TLS (Origin Certificate)
Browsers see Cloudflare's edge cert; this secures the Cloudflare→origin hop so you
can use **Full (strict)** with the proxy on (Let's Encrypt can't validate behind the
orange cloud — Origin CA is the reliable path, valid 15 years, no renewal).

1. Cloudflare → **SSL/TLS → Origin Server → Create Certificate**. Hostnames
   `steamcommunity.run, *.steamcommunity.run`, RSA, 15 years, PEM. **Copy both**
   the cert and the private key (key is shown once).
2. On the VM, in the repo dir, save them next to `docker-compose.prod.yml` as
   **`origin.pem`** (cert) and **`origin.key`** (key). They're gitignored.
3. Cloudflare → **SSL/TLS → Overview → Full (strict)**; Edge Certificates →
   Min TLS 1.2, Always Use HTTPS on.

## 4. Deploy the stack
```bash
git clone <your repo> cs2-tracker && cd cs2-tracker
cp .env.example .env
chmod 600 .env                      # keep secrets readable only by you
openssl rand -hex 32                # paste as INTERNAL_API_SECRET
```
Edit `.env` and set:
```
POSTGRES_PASSWORD=<openssl rand -hex 24>
STEAM_API_KEY=<your key>
FACEIT_API_KEY=<your key>
SITE_URL=https://steamcommunity.run
DOMAIN=steamcommunity.run
INTERNAL_API_SECRET=<the openssl value>
```
Then bring it up (only Caddy binds 80/443; DB/Redis/backend/frontend stay internal):
```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps          # all healthy?
docker compose -f docker-compose.prod.yml run --rm backend seed   # optional demo data
```
Migrations auto-run on backend boot — no separate migrate step.

## 5. Point the domain + lock the origin
1. Cloudflare → **DNS** → A record `@` → the reserved static IP, **Proxied (orange)**.
   (Add `www` too if you want it.)
2. The Step-1 firewall already restricts 80/443 to Cloudflare IPs — your origin can't
   be hit directly.
3. **5b (recommended extra): Authenticated Origin Pulls (mTLS).** Belt-and-suspenders
   so a drifted IP list can't expose you: Cloudflare → SSL/TLS → Origin Server →
   *Authenticated Origin Pulls* (zone-level) ON, then on the VM download
   `https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem`,
   mount it into Caddy and add a `client_auth` block to the `tls` directive. (Skip for
   v1 if you want; the IP firewall already gates access.)

## 6. Operational hardening (do before ads)
```bash
# Docker log rotation (json-file doesn't rotate → fills a small disk). Global:
echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker

# Nightly Postgres backup to a bucket (set $POSTGRES_USER/$POSTGRES_DB):
( crontab -l 2>/dev/null; echo '0 4 * * * cd ~/cs2-tracker && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U cs2 cs2tracker | gzip > ~/cs2-$(date +\%F).sql.gz' ) | crontab -

# Auto security updates:
sudo apt-get install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
```
Also enable a snapshot schedule on the GCE disk (Console → Disks → Snapshot schedule).

## 7. Budget alert (protect the credit)
Console → **Billing → Budgets & alerts → Create budget**. Scope to this **project**,
Monthly, **$25**, thresholds 50/90/100% (+100% forecasted), email on. Note: a budget
is **alerts only — not a hard cap.** You don't need the Pub/Sub kill-switch here (one
fixed-cost VM can't runaway-spend, and the trial auto-suspends rather than charging).
Watch **Billing → Credits** weekly; set a calendar reminder ~10 days before day 90.

## 8. Verify
```bash
curl -sI https://steamcommunity.run/            | grep -i -E 'server|cf-cache-status'   # server: cloudflare
curl -sI https://steamcommunity.run/api/search?q=zy                                       # works (proxied)
curl -k --max-time 5 https://<STATIC_IP>/                                                 # should TIME OUT (origin locked)
curl -s https://steamcommunity.run/robots.txt   | grep -i sitemap                         # SITE_URL took effect
```
Then load the site, view a profile (live Leetify/FACEIT/Steam panels), and do a search.

## 9. Cloudflare caching (keep origin egress tiny)
Caching → **Cache Rules**: (1) *bypass* anything where URI path starts with `/api/`
(dynamic), priority highest; (2) *eligible for cache*, Edge TTL **Respect origin**, for
everything else. The app already sends correct `Cache-Control` (immutable for
`/_next/static`, short for pages), so "respect origin" does the right thing. Optionally
enable **Always Online** + **Tiered Cache**.

## 10. Migrating off GCP later (≈ an afternoon)
Because it's all docker-compose:
1. Spin up a Hetzner CX22 (or any VPS), install Docker (Step 2).
2. `git clone`, copy your `.env` + `origin.pem`/`origin.key`, restore the latest
   `pg_dump` into the fresh Postgres volume.
3. `docker compose -f docker-compose.prod.yml up -d --build`.
4. Repoint the Cloudflare A record to the new IP, update the CF-IP firewall rule.
No code changes, no lock-in.
