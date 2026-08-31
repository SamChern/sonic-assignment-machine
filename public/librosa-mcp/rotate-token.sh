#!/usr/bin/env bash
# rotate-token.sh — re-key the librosa REST service on the EC2 box.
#
# Symptom this fixes: SonicSIM analyses come back with empty pitch / rhythm /
# timbre and the audio server answers `401 {"detail":"Invalid token"}`. That
# means /etc/librosa-rest.env on the box no longer matches the token stored in
# the app (a reinstall or a manual edit rotated one side only).
#
# Usage on the box (as a sudoer):
#
#   sudo bash rotate-token.sh              # generate a fresh token
#   sudo bash rotate-token.sh <token>      # or set a token you already have
#
# It prints the token at the end. Paste it into:
#   SonicSIM -> Admin -> APIs & MCPs -> Librosa REST -> LIBROSA_REST_TOKEN
# and keep the URL at the service root (e.g. http://<host>) — the app calls
# /health, /analyze and /analyze_full off that root, NOT a /librosa-rest prefix.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run with sudo" >&2
  exit 1
fi

TOKEN="${1:-$(openssl rand -hex 32)}"

printf '%s\n' "$TOKEN" > /etc/librosa-rest.token
chmod 600 /etc/librosa-rest.token
printf 'LIBROSA_REST_TOKEN=%s\n' "$TOKEN" > /etc/librosa-rest.env
chmod 600 /etc/librosa-rest.env

# The MCP sibling shares the box; keep it on the same secret when present.
if [ -f /etc/librosa-mcp.env ]; then
  printf 'LIBROSA_REST_TOKEN=%s\n' "$TOKEN" > /etc/librosa-mcp.env
  chmod 600 /etc/librosa-mcp.env
fi

# nginx (when it fronts the service) hard-codes the expected Bearer value.
NGINX_CONF=/etc/nginx/sites-available/librosa-rest
if [ -f "$NGINX_CONF" ]; then
  sed -i -E "s|\"Bearer [A-Za-z0-9]+\"|\"Bearer ${TOKEN}\"|" "$NGINX_CONF"
  nginx -t && systemctl reload nginx
fi

systemctl restart librosa-rest
systemctl is-active librosa-rest || true

echo "==> waiting for the service to answer /health"
for _ in $(seq 1 30); do
  if curl -fsS -H "Authorization: Bearer ${TOKEN}" http://127.0.0.1:8766/health >/dev/null; then
    echo "   ok"
    break
  fi
  sleep 1
done
curl -s -H "Authorization: Bearer ${TOKEN}" http://127.0.0.1:8766/health; echo

cat <<EOF

==> COPY THIS INTO THE APP (Admin -> APIs & MCPs -> Librosa REST)
LIBROSA_REST_TOKEN=${TOKEN}
EOF
