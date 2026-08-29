# Intuizi ingest worker (Step 2.5 control-plane refactor)

This is the EC2 half of the ingest split. In the recommended queue-free mode the
worker leases discovered files from the Lovable Cloud control plane over HTTPS.
It performs the CPU-heavy DuckDB decode and row-to-ontology normalization, then
reports bounded, checkpointed results through `ingest-worker-callback`.

Scoring did not move: the callback upserts into `intuizi_score_queue` and
`intuizi-score-worker` still runs the six-category ontology exactly as before.

```text
intuizi-ingest (edge, metadata only)
   └── SQS: { object_key, report_type, file_id, trace_id, rows_offset, max_rows }
        └── ingest-worker (EC2, this service)
             ├── claim      -> ledger: processing + heartbeat
             ├── DuckDB read slice from s3://<bucket>/<key>
             ├── normalize_row() -> tags + signals + confidence
             ├── progress   -> intuizi_score_queue upsert + cursor advance
             └── complete   -> ledger: done | partial (resume point saved)
                  └── intuizi-score-worker (edge) scores the queue
```

Why: Parquet decode inside an edge invocation kept hitting `IDLE_TIMEOUT` (150s)
and `WORKER_RESOURCE_LIMIT` (546). No decode happens on the edge anymore, so
neither limit is reachable, and total ingest time is unbounded.

## Files

| File | Purpose |
| --- | --- |
| `worker.py` | Pull/SQS worker: claim → decode → checkpointed callbacks → complete |
| `normalize.py` | Python port of `_shared/intuizi.ts::normalizeRow` (tag codes must stay identical) |
| `requirements.txt` | boto3, duckdb, requests |
| `ingest-worker.service` | systemd unit, CPU/memory capped for the 2 vCPU / 7 GB box |
| `install.sh` | provision / update the service |
| `smoke-test.sh` | verifies callback auth and an optional real S3 read |

## 1. AWS prerequisites

Pull mode requires only the S3 read credentials already used by SonicSIM. It
does not require SQS permissions or IAM changes. The queue setup below is
optional and only applies when `MODE=sqs` is deliberately selected.

Create the queue and a dead-letter queue in the same region as the bucket:

```bash
REGION=us-west-2
aws sqs create-queue --queue-name sonicsim-ingest-dlq --region $REGION
DLQ_ARN=$(aws sqs get-queue-attributes --queue-url <dlq-url> \
  --attribute-names QueueArn --region $REGION --query 'Attributes.QueueArn' --output text)

aws sqs create-queue --queue-name sonicsim-ingest --region $REGION \
  --attributes "{\"VisibilityTimeout\":\"900\",\"MessageRetentionPeriod\":\"345600\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"4\\\"}\"}"
```

The IAM user already used for direct S3 access needs, on top of
`s3:GetObject` / `s3:ListBucket` for the inbound bucket:

* `sqs:SendMessage` and `sqs:GetQueueAttributes` on the queue (used by the edge
  control plane);
* `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility` and
  `sqs:GetQueueAttributes` on the queue (used by this worker).

Prefer an EC2 instance role for the worker — then leave
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` out of the env file entirely; both
boto3 and DuckDB pick up the instance credentials.

## 2. Backend secrets

Set these on the Lovable Cloud side (the control plane reads them):

* `SQS_QUEUE_URL` — the queue URL above
* `SQS_REGION` — optional, inferred from the URL
* `INGEST_WORKER_SECRET` — long random string, shared with this worker
* `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — existing direct-S3 credentials

Generate the shared secret once: `openssl rand -hex 32`.

## 3. Worker env file

```bash
sudo mkdir -p /etc/sonicsim
sudo tee /etc/sonicsim/ingest-worker.env >/dev/null <<'EOF'
SUPABASE_URL=https://<your-project>.supabase.co
INGEST_WORKER_SECRET=<same value as the backend secret>
SQS_QUEUE_URL=https://sqs.us-west-2.amazonaws.com/<account>/sonicsim-ingest
AWS_REGION=us-west-2
S3_BUCKET=<inbound delivery bucket>
# Omit the two lines below when the instance role provides credentials.
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>
# Tuning: rows per SQS message before checkpoint, identifiers per callback.
MAX_ROWS_PER_MESSAGE=200000
BATCH_ROWS=250
EOF
sudo chmod 600 /etc/sonicsim/ingest-worker.env
```

## 4. Install and start

```bash
scp -r deploy/ingest-worker ubuntu@<ec2-host>:/tmp/
ssh ubuntu@<ec2-host> 'sudo bash /tmp/ingest-worker/install.sh'
```

Then verify before running real traffic:

```bash
ssh ubuntu@<ec2-host> 'bash /opt/sonicsim/ingest-worker/smoke-test.sh <an-object-key.parquet>'
```

A healthy smoke test shows queue attributes, HTTP `400` from the callback (a
`401` means the shared secret does not match), and a column list plus a few
normalized tag codes for the sample file.

## 5. Running more than one worker

The design is single-flight per file, not per box: the claim callback marks the
ledger row `processing` and the control plane skips rows with a fresh heartbeat.
Two workers can therefore run safely — but on a 2 vCPU box, one worker with
`threads=2` in DuckDB saturates it. Scale by adding an instance, not by adding
processes on this one.

## 6. Operating notes

* Follow logs: `journalctl -u ingest-worker -f`. Each batch logs
  `trace=<trace_id> key=<object_key> rows=<offset>/<total> queued=<n>` — the same
  `trace_id` appears on the ledger row, the queue rows and the score-worker logs.
* A file that ends `partial` has its resume point in `rows_offset` /
  `row_group_cursor`; re-running discovery re-dispatches from there.
* A worker crash leaves the SQS message to reappear after the visibility timeout;
  the resume is cursor-based, so no rows are re-queued twice (the queue is unique
  on `object_key` + `identifier`).
* After four failed receives a message lands in the DLQ. Inspect with
  `aws sqs receive-message --queue-url <dlq-url>` and fix the file or the mapping
  before re-driving.
* `normalize.py` must stay byte-for-byte equivalent in behaviour to
  `supabase/functions/_shared/intuizi.ts` — the tag codes are the taxonomy keys
  used by calibration and the kNN warm start.
