#!/usr/bin/env bash
# Verify the ingest worker's three dependencies before trusting a real run:
#   1. S3 read on the delivery bucket (DuckDB httpfs)
#   2. the Supabase callback accepts the shared secret
#   3. the SQS queue is reachable and reports depth
#
#   bash smoke-test.sh [s3-object-key]
set -euo pipefail

# shellcheck disable=SC1091
set -a; . /etc/sonicsim/ingest-worker.env; set +a

KEY="${1:-}"
PY=/opt/sonicsim/ingest-worker/.venv/bin/python
[ -x "$PY" ] || PY=python3

echo "== 1. SQS reachable"
aws sqs get-queue-attributes \
  --queue-url "$SQS_QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --region "${AWS_REGION:-us-west-2}"

echo "== 2. callback auth (expects 400 'file_id or object_key is required', NOT 401)"
curl -s -o /tmp/cb.out -w '%{http_code}\n' \
  -X POST "${SUPABASE_URL%/}/functions/v1/ingest-worker-callback" \
  -H 'content-type: application/json' \
  -H "x-worker-secret: $INGEST_WORKER_SECRET" \
  -d '{}'
cat /tmp/cb.out; echo

if [ -n "$KEY" ]; then
  echo "== 3. DuckDB read of s3://$S3_BUCKET/$KEY"
  "$PY" - "$KEY" <<'PYEOF'
import os, sys
sys.path.insert(0, "/opt/sonicsim/ingest-worker")
from worker import connect_duckdb, reader_sql, read_slice, total_rows
from normalize import normalize_row, merge_by_identifier

key = sys.argv[1]
con = connect_duckdb()
print("total rows:", total_rows(con, key))
rows = read_slice(con, key, 0, 5)
print("columns:", list(rows[0].keys()) if rows else "none")
norm = [n for n in (normalize_row(os.environ.get("SMOKE_REPORT_TYPE", "ctv"), r) for r in rows) if n]
print("normalized:", len(norm), "of", len(rows))
for t in merge_by_identifier(norm)[:2]:
    print(" ", t["identifier"][:16], [x["code"] for x in t["tags"]][:6], "conf=", t["confidence"])
PYEOF
else
  echo "== 3. skipped (pass an object key to test a real file)"
fi

echo "== smoke test complete"
