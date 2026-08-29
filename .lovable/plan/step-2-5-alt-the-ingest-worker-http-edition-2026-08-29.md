# Step 2.5-alt — The ingest worker, HTTP edition

Appends to Step 2.5 rather than replacing it. The runbook's design is kept (a small EC2 program claims one file at a time, boils it down to summary rows, writes them back, marks the file done), with one change you chose: the worker talks to the app's existing secured worker endpoint instead of connecting straight to the database. That means no database password and no S3 keys ever land on the EC2 box, and the fragile session-pooler requirement disappears.

Current state confirmed from live data: the ledger holds 1 file stuck at `discovered`, 1 stuck at `processing`, 8 `failed`, 23 `done`. The control plane already discovers files, writes ledger rows and tracks `worker_id` / `heartbeat_at`; the worker HTTP endpoint (`ingest-worker-callback`) already supports lease, progress, complete and failed, guarded by a shared worker secret. What has never existed is the program on EC2 that consumes it, plus the staging table it should write to.

## What gets built in the app (I do this — no terminal)

**1. Staging table `ingest_rollups`**
Plain `(object_key, report_type, subject_key, taxonomy_code, day, weight)` rows, indexed on object key and subject key, service-role only. The worker writes here and nowhere else, so worker parsing and app schema stay independent and a bad run is undone by deleting that object's rows and re-running.

**2. Worker health table `worker_heartbeats`**
`worker_id, host, last_seen, stats`. Service-role write, admin read.

**3. Claim / finish RPCs**
`claim_next_ingest_file`, `complete_ingest_file`, `fail_ingest_file`, `skip_ingest_file` — the runbook's four, with `FOR UPDATE SKIP LOCKED` on claim so two workers never take the same file. They are created in the database and exposed through the HTTP endpoint; nothing calls them directly from EC2.

**4. A reaper**
Nightly-pattern pg_cron job every 10 minutes returning any `processing` row older than 30 minutes to `discovered` and clearing the claim. This is what unsticks the row currently frozen at `processing`.

**5. Endpoint extensions on `ingest-worker-callback`**
New actions the worker needs: `claim` (returns the next file), `rollups` (bulk-insert the summary rows for one object, replacing any prior rows for it), `skip`, `heartbeat`, and `config` (hands the worker the S3 bucket, region and short-lived read credentials at startup, so they are never stored on the box). Every action stays behind the existing worker secret; unauthorized calls return 401 as they do today.

**6. New edge function `promote-rollups`**
Takes an object key, reads its rollup rows and maps them into the app's own structures: upsert subjects into `intuizi_identifiers`, resolve each `taxonomy_code` against `taxonomy_nodes` (creating unreviewed nodes for unknown codes), write `audio_source_tags` weights, then enqueue scoring in `intuizi_score_queue` idempotently. Suppressed taxonomy nodes are skipped, so Step 7's sensitive-class rules still hold. Fires automatically when a file reaches `loaded`.

**7. SQS path switched off**
The SQS dispatch in `intuizi-ingest` goes behind a `USE_SQS` flag defaulting to false; the control plane only discovers files and writes `discovered` rows. The admin ledger drops the SQS warning and gains a worker-health card (claim status, last heartbeat, files done, stale-worker warning); the missing-secrets banner only checks S3 keys.

**8. The worker program is served by the app**
`worker.py`, its requirements and the systemd unit are generated in the repo and served by a small authenticated route, so your terminal steps are short pastes that download rather than a 120-line heredoc. Column mapping matches the runbook exactly: classify by the columns a file actually has (not its filename), first present identifier column wins, volume columns become a log-scaled weight, comma-separated IAB lists are exploded, and files with no identifier/taxonomy columns are marked `skipped` rather than `failed`.

## What you do on EC2 (four short blocks, roughly 15 minutes)

1. `mkdir ~/ingest-worker`, create a venv, `pip install duckdb psycopg2-binary`-free — only `duckdb` and `requests` are needed on the HTTP path.
2. Write a three-line `.env`: the app's function URL, the worker secret, and a worker id. No database password, no S3 keys.
3. One `curl` that downloads `worker.py` from the app.
4. Run it once in the foreground to watch the stuck files drain, then paste the systemd block to make it permanent (`Restart=always`, starts on reboot).

Daily check stays one line: `systemctl is-active ingest-worker` plus the last few log lines. Everything else you watch from the admin ledger.

## Verification

- The `discovered` file and the reaped `processing` file both reach `loaded`, with rollup rows written and scoring queued.
- A summary-only file (day + uniques, no identifier) lands as `skipped` with a reason, not `failed`.
- Killing the worker mid-file leaves the row re-queued by the reaper within 10 minutes.
- The admin ledger shows a heartbeat inside the last 5 minutes and no SQS warning.
- A call to the endpoint without the worker secret returns 401; `ingest_rollups` and `worker_heartbeats` are unreadable from a normal signed-in session.
- Re-running the same object replaces rather than duplicates its rollup rows.

## Technical notes

- Wake-up is a 15-second poll with jittered backoff to 60 seconds when idle — the LISTEN/NOTIFY trigger is not needed on the HTTP path, and no port-5432 session-pooler string is required.
- Claim, complete, fail and skip go through `SECURITY DEFINER` functions; `ingest_rollups` and `worker_heartbeats` are service-role only with admin read for the health card.
- `promote-rollups` is idempotent per object key and reuses the existing taxonomy resolution and suppression helpers so behaviour cannot drift from `intuizi-ingest`.
- The rollup insert is chunked (~5,000 rows per request) with retry on 429/5xx.
- The worker-health card and ledger changes stay inside the existing admin components under the 500-line ceiling.
- Existing SQS code is left in place, dormant behind the flag, so Step 2.5 can be re-enabled without a rebuild.
