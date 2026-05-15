#!/usr/bin/env bash
# install-rest.sh — sets up the REST sibling of the librosa MCP server.
# Assumes you've already run install.sh (the MCP setup) so /opt/librosa-mcp/.venv
# and server_extended.py are in place.
#
# Usage:  sudo ./install-rest.sh
#
# Outputs at the end:
#   - REST token (paste into Lovable /admin/integrations → Librosa REST API)
#   - Service status

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="/opt/librosa-mcp/.venv"

if [[ ! -x "$VENV_DIR/bin/pip" ]]; then
  echo "→ $VENV_DIR is missing or incomplete; bootstrapping REST-only librosa venv"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y libsndfile1 ffmpeg python3-venv python3-pip nginx
  mkdir -p /opt/librosa-mcp
  cp "$SCRIPT_DIR/server_extended.py" /opt/librosa-mcp/server_extended.py
  chown -R ubuntu:ubuntu /opt/librosa-mcp
  rm -rf "$VENV_DIR"
  sudo -u ubuntu python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --upgrade pip
  "$VENV_DIR/bin/pip" install --quiet \
    "librosa>=0.10" "numpy>=1.21" "scipy>=1.10" \
    "scikit-learn>=1.0" "soundfile==0.13.1" "matplotlib>=3.5" \
    "requests" "pytubefix==8.12.2"
fi

echo "→ Installing FastAPI + uvicorn into the existing venv"
"$VENV_DIR/bin/pip" install --quiet \
  "fastapi>=0.111" "uvicorn[standard]>=0.30" "pydantic>=2.5"

echo "→ Copying server_rest.py"
cp "$SCRIPT_DIR/server_rest.py" /opt/librosa-mcp/server_rest.py
chown ubuntu:ubuntu /opt/librosa-mcp/server_rest.py

echo "→ Generating REST Bearer token"
TOKEN="$(openssl rand -hex 32)"
echo "$TOKEN" > /etc/librosa-rest.token
chmod 600 /etc/librosa-rest.token
# systemd EnvironmentFile= format: KEY=value, no quotes.
echo "LIBROSA_REST_TOKEN=$TOKEN" > /etc/librosa-rest.env
chmod 600 /etc/librosa-rest.env

echo "→ Installing systemd unit"
cp "$SCRIPT_DIR/librosa-rest.service" /etc/systemd/system/librosa-rest.service
systemctl daemon-reload
systemctl enable --now librosa-rest

sleep 2
systemctl --no-pager status librosa-rest | head -15 || true

echo
echo "→ Local smoke test"
curl -sS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8766/health || true
echo

cat <<EOF

==================================================================
  Librosa REST API installed.

  Bearer token (save in Lovable):
    $TOKEN

  Token file:    /etc/librosa-rest.token
  Service:       systemctl status librosa-rest
  Logs:          journalctl -u librosa-rest -f
  Local URL:     http://127.0.0.1:8766
  (public via nginx — see nginx-librosa-rest.conf to wire /librosa-rest/)

  Next:
    1. Add the location block from nginx-librosa-rest.conf to your
       existing librosa server block (replace TOKEN_GOES_HERE).
    2. sudo nginx -t && sudo systemctl reload nginx
    3. From your laptop:
         curl -sS -H "Authorization: Bearer $TOKEN" \\
           https://YOUR_HOST/librosa-rest/health
    4. In Lovable → /admin/integrations → REST APIs → Librosa REST API
       paste the URL (https://YOUR_HOST/librosa-rest) and the token.
==================================================================
EOF
