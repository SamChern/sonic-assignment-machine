#!/usr/bin/env bash
# install.sh — One-shot installer for the Librosa MCP bridge on EC2 (Ubuntu 22.04+).
#
# Usage (from the box, after `scp -r deploy/librosa-mcp ubuntu@<host>:~/`):
#   cd ~/librosa-mcp
#   sudo HOSTNAME=mcp.audio.example.com EMAIL=you@example.com ./install.sh
#
# Idempotent: re-running will reinstall packages, re-deploy the unit + nginx
# config, and reload services without recreating the token unless you delete
# /etc/librosa-mcp.token first.
#
# Required env:
#   HOSTNAME — public DNS name pointing at this box (used for nginx + TLS)
#   EMAIL    — email for Let's Encrypt registration
#
# Optional env:
#   USERNAME — Linux user that owns the venv (default: ubuntu)
#   SKIP_TLS — set to "1" to skip certbot (handy if you already have certs)

set -euo pipefail

HOSTNAME="${HOSTNAME:?Set HOSTNAME=your.public.host before running}"
EMAIL="${EMAIL:?Set EMAIL=you@example.com before running}"
USERNAME="${USERNAME:-ubuntu}"
SKIP_TLS="${SKIP_TLS:-0}"

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log() { echo -e "\033[1;36m[librosa-mcp]\033[0m $*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo (needs to write to /etc, /opt, manage systemd, nginx)." >&2
  exit 1
fi

# -- 1. System packages -------------------------------------------------------
log "Installing system packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y libsndfile1 ffmpeg python3-pip nginx \
  $( [[ "$SKIP_TLS" == "1" ]] || echo "certbot python3-certbot-nginx" )

# -- 2. uv + mcp-proxy (run as the unprivileged user) -------------------------
log "Installing uv + mcp-proxy as $USERNAME…"
sudo -u "$USERNAME" -H bash -lc '
  set -e
  if ! command -v uv >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
  fi
  source $HOME/.local/bin/env
  uv tool install --force mcp-music-analysis
  uv tool install --force mcp-proxy
'

# -- 3. Extended server + venv ------------------------------------------------
log "Deploying extended server to /opt/librosa-mcp…"
mkdir -p /opt/librosa-mcp
cp "$KIT_DIR/server_extended.py" /opt/librosa-mcp/
chown -R "$USERNAME:$USERNAME" /opt/librosa-mcp

sudo -u "$USERNAME" -H bash -lc '
  set -e
  source $HOME/.local/bin/env
  if [[ ! -d /opt/librosa-mcp/.venv ]]; then
    uv venv /opt/librosa-mcp/.venv
  fi
  /opt/librosa-mcp/.venv/bin/pip install --upgrade \
    "fastmcp==0.4.1" "librosa>=0.10" "numpy>=1.21" "scipy>=1.10" \
    "scikit-learn>=1.0" "soundfile==0.13.1" "matplotlib>=3.5" \
    "requests" "pytubefix==8.12.2"
'

# -- 4. Bearer token ----------------------------------------------------------
if [[ ! -f /etc/librosa-mcp.token ]]; then
  log "Generating Bearer token…"
  openssl rand -hex 32 > /etc/librosa-mcp.token
  chmod 600 /etc/librosa-mcp.token
else
  log "Reusing existing /etc/librosa-mcp.token"
fi
TOKEN="$(cat /etc/librosa-mcp.token)"

# -- 5. systemd unit ----------------------------------------------------------
log "Installing systemd unit…"
install -m 0644 "$KIT_DIR/librosa-mcp.service" /etc/systemd/system/librosa-mcp.service
# Patch User=/Group= if a non-default username was provided
if [[ "$USERNAME" != "ubuntu" ]]; then
  sed -i "s/^User=ubuntu/User=$USERNAME/;s/^Group=ubuntu/Group=$USERNAME/" \
    /etc/systemd/system/librosa-mcp.service
  sed -i "s|/home/ubuntu/|/home/$USERNAME/|g" /etc/systemd/system/librosa-mcp.service
fi
systemctl daemon-reload
systemctl enable --now librosa-mcp
systemctl restart librosa-mcp
sleep 2
systemctl --no-pager status librosa-mcp | head -n 15 || true

# -- 6. nginx site ------------------------------------------------------------
log "Installing nginx site for $HOSTNAME…"
NGINX_SRC="$KIT_DIR/nginx-librosa-mcp.conf"
NGINX_DST=/etc/nginx/sites-available/librosa-mcp
cp "$NGINX_SRC" "$NGINX_DST"
sed -i "s/YOUR_HOST/$HOSTNAME/g" "$NGINX_DST"
sed -i "s|TOKEN_GOES_HERE|$TOKEN|" "$NGINX_DST"
ln -sf "$NGINX_DST" /etc/nginx/sites-enabled/librosa-mcp

# Remove the placeholder cert lines if certs don't exist yet — certbot will add them.
if [[ ! -f "/etc/letsencrypt/live/$HOSTNAME/fullchain.pem" && "$SKIP_TLS" != "1" ]]; then
  log "No existing cert — temporarily switching nginx to HTTP-only so certbot can bootstrap."
  # Replace the SSL server block with a plain :80 server pointing at the same location,
  # so certbot --nginx can take over and rewrite it.
  cat > "$NGINX_DST" <<EOF
server {
    listen 80;
    server_name $HOSTNAME;
    location / { return 200 "bootstrap\n"; add_header Content-Type text/plain; }
}
EOF
  nginx -t && systemctl reload nginx
  certbot --nginx -d "$HOSTNAME" --non-interactive --agree-tos -m "$EMAIL" --redirect
  # Now redeploy the real config (certbot will add ssl_certificate lines on reload).
  cp "$NGINX_SRC" "$NGINX_DST"
  sed -i "s/YOUR_HOST/$HOSTNAME/g" "$NGINX_DST"
  sed -i "s|TOKEN_GOES_HERE|$TOKEN|" "$NGINX_DST"
fi

nginx -t
systemctl reload nginx

# -- 7. Done ------------------------------------------------------------------
cat <<EOF

──────────────────────────────────────────────────────────────────────
  Librosa MCP bridge is live.

  MCP Server URL : https://$HOSTNAME/librosa/sse
  Auth Scheme    : Bearer
  Auth Token     : $TOKEN

  Paste these into Lovable → /admin/integrations → MCP Servers tab.

  Smoke test:
    ./smoke-test.sh https://$HOSTNAME $TOKEN
──────────────────────────────────────────────────────────────────────
EOF
