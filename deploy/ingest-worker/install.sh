#!/usr/bin/env bash
# Install / update the Intuizi ingest worker on the EC2 box.
#
#   sudo bash install.sh
#
# Expects /etc/sonicsim/ingest-worker.env to exist (see README.md for the keys).
set -euo pipefail

APP_DIR=/opt/sonicsim/ingest-worker
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> system packages"
apt-get update -y
apt-get install -y python3-venv python3-pip

echo "==> app dir $APP_DIR"
mkdir -p "$APP_DIR"
install -m 644 "$SRC_DIR/worker.py" "$APP_DIR/worker.py"
install -m 644 "$SRC_DIR/normalize.py" "$APP_DIR/normalize.py"
install -m 644 "$SRC_DIR/requirements.txt" "$APP_DIR/requirements.txt"
install -m 755 "$SRC_DIR/smoke-test.sh" "$APP_DIR/smoke-test.sh"

echo "==> virtualenv"
if [ ! -d "$APP_DIR/.venv" ]; then
  python3 -m venv "$APP_DIR/.venv"
fi
"$APP_DIR/.venv/bin/pip" install --upgrade pip
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

if [ ! -f /etc/sonicsim/ingest-worker.env ]; then
  echo "!! /etc/sonicsim/ingest-worker.env is missing — create it before starting (see README.md)"
  exit 1
fi
chmod 600 /etc/sonicsim/ingest-worker.env

echo "==> systemd unit"
install -m 644 "$SRC_DIR/ingest-worker.service" /etc/systemd/system/ingest-worker.service
systemctl daemon-reload
systemctl enable ingest-worker
systemctl restart ingest-worker

sleep 3
systemctl --no-pager --lines=20 status ingest-worker || true
echo "==> done. follow logs with: journalctl -u ingest-worker -f"
