#!/usr/bin/env bash
# smoke-test.sh — verify the semantic service end to end.
#
#   bash smoke-test.sh https://<host>/semantic "$TOKEN"
#   bash smoke-test.sh http://127.0.0.1:8769 "$(sudo cat /etc/semantic-svc.token)"
set -euo pipefail

BASE="${1:?usage: smoke-test.sh <base-url> <token>}"
TOKEN="${2:?usage: smoke-test.sh <base-url> <token>}"
AUTH="Authorization: Bearer $TOKEN"
fails=0

step() { printf '\n== %s\n' "$1"; }
ok()   { printf '   ok: %s\n' "$1"; }
bad()  { printf '   FAIL: %s\n' "$1"; fails=$((fails + 1)); }

step "healthz"
health=$(curl -sf -H "$AUTH" "$BASE/healthz") || { bad "healthz unreachable"; echo "$fails failure(s)"; exit 1; }
echo "$health"
python3 - "$health" <<'PY' && ok "healthz shape" || bad "healthz shape"
import json, sys
h = json.loads(sys.argv[1])
assert h.get("ok") is True and h.get("text_dim") == 512 and h.get("target_dim") == 1536
PY

step "auth is enforced"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/embed_text" \
  -H 'Content-Type: application/json' -d '{"texts":["x"]}')
[ "$code" = "401" ] && ok "unauthenticated call rejected (401)" || bad "expected 401, got $code"

step "embed_text (first call loads the model; may take ~60s)"
emb=$(curl -sf --max-time 240 -X POST "$BASE/embed_text" -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{"texts":["a calm acoustic guitar","an aggressive news anchor voice","a calm acoustic guitar"]}')
python3 - "$emb" <<'PY' && ok "512-d text vectors, similarity ordering sane" || bad "embed_text"
import json, sys, math
d = json.loads(sys.argv[1])
assert d["dims"] == 512, d["dims"]
v = d["vectors"]
assert len(v) == 3 and all(len(x) == 512 for x in v)
dot = lambda a, b: sum(x * y for x, y in zip(a, b))
same, diff = dot(v[0], v[2]), dot(v[0], v[1])
print(f"   identical-text cos={same:.4f}  different-text cos={diff:.4f}")
assert same > 0.99, "identical texts must embed identically"
assert same > diff, "identical texts must be closer than unrelated ones"
PY

step "bridge 512 -> 1536 preserves cosine similarity"
vecs=$(python3 - "$emb" <<'PY'
import json, sys
print(json.dumps({"vectors": json.loads(sys.argv[1])["vectors"][:2]}))
PY
)
br=$(curl -sf --max-time 60 -X POST "$BASE/bridge" -H "$AUTH" \
  -H 'Content-Type: application/json' -d "$vecs")
python3 - "$emb" "$br" <<'PY' && ok "1536-d bridge output, similarity preserved" || bad "bridge"
import json, sys
src = json.loads(sys.argv[1])["vectors"][:2]
out = json.loads(sys.argv[2])
assert out["dims"] == 1536, out["dims"]
o = out["vectors"]
assert len(o) == 2 and all(len(x) == 1536 for x in o)
dot = lambda a, b: sum(x * y for x, y in zip(a, b))
before, after = dot(*src), dot(*o)
print(f"   mode={out['mode']}  cos before={before:.4f}  after={after:.4f}")
assert abs(before - after) < 1e-3, "bridge must preserve kNN ranking"
PY

printf '\n'
if [ "$fails" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
else
  echo "$fails check(s) FAILED"
  exit 1
fi
