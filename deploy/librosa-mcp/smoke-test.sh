#!/usr/bin/env bash
# smoke-test.sh — Verify a deployed Librosa MCP bridge from any machine.
#
# Usage:
#   ./smoke-test.sh https://mcp.audio.example.com <bearer-token>
#
# Checks (in order):
#   1. /healthz returns 200
#   2. /librosa/sse without a token returns 401
#   3. /librosa/sse with the token starts streaming "event:" lines
#
# Exits non-zero on any failure.

set -euo pipefail

BASE="${1:?Usage: $0 <https://host> <token>}"
TOKEN="${2:?Usage: $0 <https://host> <token>}"
BASE="${BASE%/}"  # strip trailing slash

pass() { echo -e "  \033[1;32m✓\033[0m $*"; }
fail() { echo -e "  \033[1;31m✗\033[0m $*"; exit 1; }

echo "→ Smoke testing $BASE"

# 1. healthz ------------------------------------------------------------------
code=$(curl -sk -o /dev/null -w "%{http_code}" "$BASE/healthz" || true)
if [[ "$code" == "200" ]]; then
  pass "healthz returned 200"
else
  fail "healthz returned $code (expected 200) — nginx not serving the site?"
fi

# 2. SSE without token --------------------------------------------------------
code=$(curl -sk -o /dev/null -w "%{http_code}" "$BASE/librosa/sse" || true)
if [[ "$code" == "401" ]]; then
  pass "unauthenticated request rejected with 401"
else
  fail "unauthenticated request returned $code (expected 401) — auth misconfigured"
fi

# 3. SSE with token — should stream within 5s --------------------------------
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
# -N disables curl buffering; --max-time 5 stops after 5s of streaming
curl -skN --max-time 5 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/event-stream" \
  "$BASE/librosa/sse" > "$tmp" 2>/dev/null || true

if grep -q "^event:" "$tmp"; then
  first=$(grep -m1 "^event:" "$tmp")
  pass "SSE stream is live ($first)"
else
  echo "  --- response body (first 500 bytes) ---"
  head -c 500 "$tmp" || true
  echo
  fail "no SSE events received within 5s — check journalctl -u librosa-mcp"
fi

echo
echo "All checks passed. Paste into Lovable /admin/integrations:"
echo "  URL   : $BASE/librosa/sse"
echo "  Token : $TOKEN"
