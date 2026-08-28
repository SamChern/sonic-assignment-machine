#!/usr/bin/env bash
# install.sh — provision the SonicSIM semantic (CLAP) service on the EC2 box.
#
# Idempotent: safe to re-run for upgrades. Mirrors deploy/librosa-mcp/install-rest.sh
# conventions but uses its OWN venv and port so it cannot disturb librosa-rest.
#
#   scp -r deploy/semantic-svc ubuntu@<host>:/tmp/
#   ssh ubuntu@<host> 'sudo bash /tmp/semantic-svc/install.sh'
set -euo pipefail

APP_DIR=/opt/semantic-svc
VENV="$APP_DIR/.venv"
PORT=8767
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> apt deps"
apt-get update -qq
apt-get install -y -qq python3-venv python3-dev build-essential ffmpeg libsndfile1

echo "==> app dir + cache dir"
install -d -o ubuntu -g ubuntu "$APP_DIR" "$APP_DIR/cache"
install -o ubuntu -g ubuntu -m 0644 "$SRC/server_semantic.py" "$APP_DIR/"
install -o ubuntu -g ubuntu -m 0644 "$SRC/gunicorn.conf.py"   "$APP_DIR/"
install -o ubuntu -g ubuntu -m 0644 "$SRC/requirements.txt"   "$APP_DIR/"

echo "==> venv (separate from /opt/librosa-mcp/.venv on purpose)"
if [ ! -d "$VENV" ]; then
  sudo -u ubuntu python3 -m venv "$VENV"
fi
sudo -u ubuntu "$VENV/bin/pip" install -q --upgrade pip wheel
# torch CPU wheels are ~200MB; this step takes several minutes on first run.
sudo -u ubuntu "$VENV/bin/pip" install -q -r "$APP_DIR/requirements.txt"
# laion-clap metadata hard-pins numpy==1.23.5 (unbuildable on py3.12 and
# incompatible with torch 2.4). Its real deps are pinned in requirements.txt,
# so install the package itself without resolving its metadata.
sudo -u ubuntu "$VENV/bin/pip" install -q --no-deps laion-clap==1.1.6
sudo -u ubuntu "$VENV/bin/python" -c "import laion_clap, numpy; print('clap ok, numpy', numpy.__version__)"


echo "==> auth token"
if [ ! -f /etc/semantic-svc.token ]; then
  openssl rand -hex 32 > /etc/semantic-svc.token
  chmod 600 /etc/semantic-svc.token
fi
TOKEN="$(cat /etc/semantic-svc.token)"
printf 'SEMANTIC_SVC_TOKEN=%s\n' "$TOKEN" > /etc/semantic-svc.env
chmod 600 /etc/semantic-svc.env

echo "==> warm the CLAP checkpoint into $APP_DIR/cache (one-off, ~2GB download)"
sudo -u ubuntu env HF_HOME="$APP_DIR/cache" TORCH_HOME="$APP_DIR/cache" \
  "$VENV/bin/python" - <<'PY' || echo "   (warm failed; first request will download instead)"
import laion_clap
m = laion_clap.CLAP_Module(enable_fusion=False)
m.load_ckpt()
print("checkpoint ready")
PY

echo "==> systemd"
install -m 0644 "$SRC/semantic-svc.service" /etc/systemd/system/semantic-svc.service
systemctl daemon-reload
systemctl enable semantic-svc
systemctl restart semantic-svc

echo "==> waiting for :$PORT"
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/healthz"; then
    echo "   up"
    break
  fi
  sleep 2
done
curl -s "http://127.0.0.1:$PORT/healthz"; echo

cat <<EOF

==> NEXT STEPS (manual)
1. Merge deploy/semantic-svc/nginx-semantic-svc.conf into the server block that
   already fronts /librosa-rest/, replacing TOKEN_GOES_HERE with the token in
   /etc/semantic-svc.token, then: nginx -t && systemctl reload nginx
2. In SonicSIM: Admin -> APIs & MCPs, set the semantic service credentials
   (base URL https://<your-host>/semantic and the token above).
3. Verify from outside the box:
   curl -H "Authorization: Bearer \$TOKEN" https://<your-host>/semantic/healthz
EOF
