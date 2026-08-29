# Step 2.5 — get the ingest worker draining, with a runbook you can paste

I checked the live backend before writing this, and your runbook's Part 4 cannot run yet. Two hard blockers, both on my side, not yours:

1. **The worker on disk is SQS-based.** `deploy/ingest-worker/worker.py` requires `SQS_QUEUE_URL` plus SQS-capable AWS keys, and the control plane (`intuizi-ingest`) only dispatches via SQS SendMessage. No queue is configured (no `SQS_QUEUE_URL` secret exists), so it currently refuses to dispatch with "the ingest queue is not configured yet". The "Step 2.5-alt (Supabase-queue)" variant your runbook assumes was never built.
2. **The `.env` in your runbook asks for the service role key.** That key is not available on Lovable Cloud, and the worker doesn't need it — the callback function authenticates with a shared secret (`INGEST_WORKER_SECRET`), which also does not exist yet.

Current ledger state, for reference: 21 `done`, 5 `partial`, 5 `discovered`, 3 `failed`. The 10 partial/discovered files are what a running worker would drain.

So this session does the Lovable half (Step 2.5-alt), then hands you a corrected copy-paste runbook. Part 3 of your document (the semantic service) is unaffected and can be run any time — though `deploy/semantic-svc/` in the repo already has an installer that does the same job more safely; I'd use that one.

## Phase 1 — Queue-free pull mode (Lovable)

Add a pull path so the worker needs no SQS, no queue permissions, and no new AWS setup:

- `ingest-worker-callback` gains a `lease` phase: the worker asks for the next file, the function atomically picks the oldest `discovered`/`partial`/stale-heartbeat row, stamps `worker_id`/`heartbeat_at`/`status='processing'`, and returns the object key, report type and resume cursor. Concurrency-safe via a `SELECT … FOR UPDATE SKIP LOCKED` RPC so two workers never take the same file.
- `worker.py` gets a `MODE=pull` branch: loop → `lease` → decode the slice with DuckDB → the existing `progress`/`complete`/`failed` callbacks → sleep and repeat when the lease returns nothing. The SQS consumer stays intact for later.
- `intuizi-ingest` stops treating a missing queue as a dispatch failure when pull mode is on: discovery keeps writing ledger rows, and the "queue not configured" error becomes an informational status instead of a hard stop.
- Create the `INGEST_WORKER_SECRET` secret (I'll generate it and give it to you for the `.env`).
- The admin ingest ledger panels get a "worker mode / last heartbeat" line so you can see the pull worker is alive.

## Phase 2 — Your corrected runbook

After Phase 1 I'll write the exact terminal blocks into `deploy/ingest-worker/RUNBOOK.md` and paste them into chat, in the same "type this, expect that" style. The differences from your document:

- `.env` becomes: `SUPABASE_URL`, `INGEST_WORKER_SECRET`, `MODE=pull`, `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. No service role key, no queue URL.
- Getting the code onto the box: `git pull` only works if your EC2 checkout tracks the GitHub repo Lovable syncs to. The runbook includes a check for that, plus a `curl`-the-files fallback (same pattern as `public/semantic-svc/bootstrap.sh`) if it doesn't.
- The systemd unit points at your actual checkout path, which we confirm in Part 2 rather than assume.

## What I need from you (after Phase 1, one message)

Run these three and paste the output — they tell me the username, the checkout path, and whether git sync is usable:

```bash
whoami; ls -d ~/*/deploy/ingest-worker 2>/dev/null
git -C ~/sonic-assignment-machine remote -v 2>/dev/null
systemctl is-active librosa-rest; python3 --version
```

Nothing there changes anything on the box.

## Technical notes

- New RPC `lease_ingest_file(p_worker_id text, p_stale_after interval)` — `SECURITY DEFINER`, service-role only, `FOR UPDATE SKIP LOCKED`, resumes from `row_group_cursor`/`rows_offset` so a killed worker restarts mid-file rather than re-reading it.
- Idempotency stays ETag-keyed exactly as today, so pull and SQS modes are interchangeable and a redelivery no-ops.
- No table, column, or function is dropped or renamed; the SQS path remains the default when `SQS_QUEUE_URL` is set.
