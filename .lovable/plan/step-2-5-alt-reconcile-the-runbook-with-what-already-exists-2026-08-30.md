# Step 2.5-alt — reconcile the runbook with what already exists

## What I verified in the live backend

Half A of your runbook is already built, under slightly different names:

- Tables: `ingest_rollups` (with `source_offset` + unique index), `worker_heartbeats`.
- RPCs: `claim_next_ingest_file(p_worker)`, `complete_ingest_file(p_id, p_rows, p_status)`, `fail_ingest_file`, `skip_ingest_file`, `block_ingest_file`, `requeue_ingest_file`, `reap_stale_ingest_claims(p_stale_minutes)`, `lease_ingest_file`, `stage_ingest_rollups`, `read_ingest_rollup_subject_batch`.
- Claim bookkeeping columns exist as `worker_id` / `heartbeat_at` (not `claimed_by` / `claimed_at`).
- `promote-rollups`, `ingest-worker-callback`, `intuizi-score-worker` edge functions are deployed; SQS is already behind a flag defaulting off.

So Half A needs no rebuild. Two parts of the runbook cannot be used as written:

1. **`PG_DSN` / session-mode connection string.** This backend is Lovable Cloud–managed; the database password is not available to you or to me, so the worker cannot connect directly to Postgres and cannot use `LISTEN ingest_ready`. The existing worker already replaces this with an authenticated HTTPS callback (`INGEST_WORKER_SECRET`) plus short polling — same behaviour, no password.
2. **`NOTIFY ingest_ready` trigger.** Pointless without a direct connection; the poll + lease path covers it.

## What is actually blocking the drain (from the ledger)

Ledger now: 24 done, 5 failed (345M rows), 1 processing (stale), 1 discovered, 2 skipped, 1 blocked (S3 403). Every failure message is the same:

```text
callback 503 ... canceling statement due to statement timeout
```

And downstream: `intuizi_score_queue` holds **674,345 pending** rows while `ingest.score_concurrency = 1`, and `ingest.system_owner_user_id` is **empty** — so scored identifiers cannot create `audio_sources` rows (`user_id` is NOT NULL). `intuizi_identifiers` has 79,870 rows but `audio_sources` has zero Intuizi rows, which confirms the scorer is not completing.

The files did not fail because the worker is missing. They failed because each callback tries to write more than the database can commit inside one statement timeout, and the scoring stage behind it is stalled.

## The fix, in order

**1. Unblock scoring first (nothing else matters until the queue drains).**
- Seed `ingest.system_owner_user_id` with the admin user id so `audio_sources` inserts stop violating NOT NULL.
- Verify one score batch end-to-end (`intuizi-score-worker`) and confirm `audio_sources` / `source_analyses` rows appear.
- Raise `ingest.score_concurrency` / `ingest.score_batch_size` stepwise (1 → 3 → 6) while watching database health, not blindly.

**2. Make the callback timeout-proof instead of fatal.**
- Cap every write path in `ingest-worker-callback` to a bounded chunk (`ingest.worker_batch_rows`, currently 250) and always go through `stage_ingest_rollups`, which is replay-safe on `source_offset`.
- On a statement timeout, return a retryable response that tells the worker to stop cleanly and resume from its saved cursor — never a bare 500/503 that the worker turns into `fail_ingest_file`.
- Lower `ingest.rollup_row_threshold` so the large CTV/web files take the rollup path rather than per-identifier queue upserts.

**3. Requeue, don't re-ingest.**
- `requeue_ingest_file` on the 5 failed files and the stale `processing` one; each resumes from `rows_offset` / `row_group_cursor`, so the 8.6M rows already processed are not redone.
- Leave the S3 403 file `blocked` — that one needs the bucket read grant, not code.

**4. Sync the worker on the box (one command block, no new AWS work).**
- `deploy/ingest-worker/worker.py` and the downloadable `public/ingest-worker/worker.py` get the same treatment: honour the retryable callback response as stop-and-resume, keep `BATCH_ROWS=250`, heartbeat every cycle.
- You run one pull + `install.sh` + restart block; the install script already verifies the file hash. No `.env` change, no `PG_DSN`, no SQS.

**5. Admin ledger UI.**
- Keep the existing worker-health card; show claim owner (`worker_id`), heartbeat age, resume cursor and retryable-stop count per file, so a stop-and-resume is visibly different from a failure.

## Verification gates

- Score queue pending count falls for 15 minutes straight, and `audio_sources` Intuizi rows are non-zero.
- One requeued 80M-row file completes two lease → progress cycles with no timeout in the logs.
- `ingest_rollups` fills for that file and `promote-rollups` advances `promotion_cursor` without a timeout.
- Ledger shows a heartbeat under 5 minutes old.

## Technical notes

- No IAM, SQS, or role changes anywhere in this plan.
- All new tunables live in `control_registry` (Control Room), read with the existing 60s cache.
- Renames to match the runbook's `claimed_by` / `claimed_at` are deliberately skipped — the existing columns already carry that data and renaming would break deployed functions.
