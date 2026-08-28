#!/usr/bin/env bash
# Run ON the EC2 box. Downloads the semantic-svc installer bundle, then installs.
#   curl -fsSL https://sonicsimai.lovable.app/semantic-svc/bootstrap.sh | sudo bash
set -euo pipefail

BASE="${BASE:-https://sonicsimai.lovable.app/semantic-svc}"
DEST=/tmp/semantic-svc

mkdir -p "$DEST"
for f in install.sh gunicorn.conf.py requirements.txt semantic-svc.service \
         server_semantic.py smoke-test.sh nginx-semantic-svc.conf; do
  echo "==> fetching $f"
  curl -fsSL "$BASE/$f" -o "$DEST/$f"
done

echo "==> running installer"
bash "$DEST/install.sh"
