#!/usr/bin/env bash
# One-shot bootstrap for a fresh Hetzner Cloud Ubuntu 24.04 server that will run
# the csrun.win stack (docker-compose.prod.yml + docker-compose.posters.yml).
#
# Run ONCE as root on the new box:
#   bash bootstrap.sh
#
# What it does, and why each piece is here (see docs/MIGRATE-TO-HETZNER.md):
#   - Docker CE from Docker's own apt repo (Ubuntu's docker.io lags compose v2).
#   - A `cs2` user that owns the checkouts and runs compose, sudo + docker group,
#     with root's authorized_keys copied so the same SSH key works for both.
#   - ufw: SSH from anywhere (key-only), 80/443 ONLY from Cloudflare's published
#     ranges — the same origin lockdown the GCE firewall rule `allow-cf-web` had.
#     Cloudflare's ranges: https://www.cloudflare.com/ips (snapshot 2026-09-18).
#   - A 2 GB swapfile: a poster print master peaks ~1.2 GB on top of ~2 GB of
#     stack; 8 GB is plenty, the swap is the margin that stops an OOM kill from
#     ever being the failure mode.
#   - Docker log rotation (json-file does not rotate by itself → fills the disk).
#   - Unattended security upgrades, same as the GCE box had.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "run as root" >&2; exit 1; fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw rsync unattended-upgrades sysstat git

# --- Docker CE ---------------------------------------------------------------
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -q
apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# Build cache GC: the GCE box accumulated 25 GB of BuildKit cache (21 GB
# reclaimable) over 83 days of --build deploys, a third of its disk, and dockerd
# sat at 385 MB RSS holding the metadata. Cap it.
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "builder": { "gc": { "enabled": true, "defaultKeepStorage": "4GB" } }
}
EOF
systemctl restart docker

# The GCE box's journal had grown to 941 MB with no cap.
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/90-cap.conf <<'EOF'
[Journal]
SystemMaxUse=200M
MaxRetentionSec=14day
EOF
systemctl restart systemd-journald

# --- the cs2 user ------------------------------------------------------------
if ! id cs2 >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" cs2
fi
usermod -aG sudo,docker cs2
echo "cs2 ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/cs2
chmod 0440 /etc/sudoers.d/cs2
install -d -m 0700 -o cs2 -g cs2 /home/cs2/.ssh
if [ -f /root/.ssh/authorized_keys ]; then
  install -m 0600 -o cs2 -g cs2 /root/.ssh/authorized_keys /home/cs2/.ssh/authorized_keys
fi
install -d -o cs2 -g cs2 /home/cs2/backups /home/cs2/csrun

# --- swap --------------------------------------------------------------------
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
echo "vm.swappiness=10" > /etc/sysctl.d/90-swappiness.conf

# --- firewall: SSH open (key-only), web only from Cloudflare ------------------
CF_V4="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22"
CF_V6="2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'ssh (key auth only)'
for r in $CF_V4 $CF_V6; do
  ufw allow from "$r" to any port 80 proto tcp comment 'cloudflare'
  ufw allow from "$r" to any port 443 proto tcp comment 'cloudflare'
done
ufw --force enable

# key-only SSH
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd || true

# --- unattended upgrades -----------------------------------------------------
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

echo
echo "bootstrap done: docker $(docker --version | cut -d, -f1), user cs2, ufw active, 2G swap"
