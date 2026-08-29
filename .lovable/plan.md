# Step 2 ingest: not complete — 6 files died on a callback timeout

The worker's "no pending files; waiting" line is not success. It went idle because
every remaining file was parked as `failed`, so there is nothing left to lease.

What the ledger actually shows right now:

| Status | Files | Rows total | Rows processed |
| --- | --- | --- | --- |
| done | 24 | 27.1M | 27.1M |
| failed | 9 | 351.7M | 8.7M |
| pending | 1 | 2.5K | — |

The six big CTV/web/demographics files all failed with the same error you pasted:
`callback 500: canceling statement due to statement timeout`. Their checkpoints
survived (e.g. the 108M-row activation 5585 file stopped at row 400,000), so no
work has to be redone — but nothing will resume until the files are unparked.

The other three failures are different and legitimate: one S3 object returns
`403 AccessDenied`, one Parquet has a schema but zero rows, one CSV has only
`day, uniques` columns. Those belong in `skipped`, not `failed`.

## Why the callback times out

Each batch of 1,000 identifiers is written with a single upsert into
`intuizi_score_queue` — a table now at 743 MB with six indexes and 478,401
pending rows. Every conflicting row rewrites its tuple (including the `tags` and
`signals` JSON) and all six index entries, and past a certain table size that one
statement crosses the database statement timeout. The worker retries four times,
each retry is the same too-big statement, and then it gives up and parks the file.

Separately: scoring has produced no completed rows since 18:48 while 478,401 sit
pending, so the queue is only growing. That gets confirmed and restarted as step 1.

## The fix, in order

1. **Restart the drain.** Confirm `intuizi-score-worker` is being invoked and
   kick it; a queue that never empties is what pushed the table past the timeout
   in the first place.
2. **Make the enqueue write cheap.** Replace the 1,000-row upsert with a single
   security-definer RPC that takes the batch as one JSON argument, sets a local
   statement timeout below the platform limit, inserts with
   `ON CONFLICT (object_key, identifier)` and only updates rows still `pending`
   (already-scored rows are left untouched instead of rewritten). The callback
   chunks each batch into sub-statements of 250 rows so no single statement can
   run long, and returns the real inserted/updated counts.
3. **Never lose a file to a transient write error.** A callback timeout is
   retryable, not terminal: the worker reports it, the control plane parks the
   file as `pending` with `dispatch_attempts + 1` (up to a registry cap) instead
   of `failed`, and the next lease resumes from the saved `rows_offset`.
4. **Requeue the six parked files** so they resume from their checkpoints, and
   reclassify the 403 / zero-row / no-column three as `skipped` with their
   reason preserved.
5. **Rollup mode for the giant files.** Per-identifier queueing 350M rows is not
   a realistic path — at the current rate the queue alone would outgrow the
   database. Add the missing `rollups` / `loaded` phases to `worker.py` (the
   callback already implements them; `ingest_rollups` is still empty because the
   worker never sends them). Files above a registry threshold
   (`ingest.rollup_row_threshold`, default 5,000,000 rows) aggregate to
   subject × taxonomy × day in DuckDB and post chunked rollups, then `loaded`
   triggers `promote-rollups`. Smaller files keep the exact per-identifier path
   they use today.
6. **Fix the S3 403.** The failing object is under the same prefix as the ones
   that work, so this is an object-level or KMS permission gap rather than a
   bucket one; I will pin down which and tell you the one IAM statement to add.
7. **Worker heartbeat.** `worker_heartbeats` is empty, so the Admin "Ingest
   worker health" card cannot show liveness. Add the heartbeat post to the
   worker's idle loop so the card reflects the box.

## Terminal work for you

One command sequence at the end, same shape as before: `git pull`, reinstall
`worker.py`, `systemctl restart ingest-worker`. Everything else (RPC, callback,
requeue, registry knobs) happens on the backend side with no terminal work.

## Technical detail

- New migration: `enqueue_score_tasks(p_rows jsonb)` security-definer RPC with
  `SET LOCAL statement_timeout`, plus `requeue_ingest_file(p_id, p_reason)` and
  the `ingest.rollup_row_threshold` / `ingest.max_dispatch_attempts` registry keys.
- `ingest-worker-callback`: progress phase calls the RPC in 250-row chunks;
  retryable write failures return a `retryable: true` payload and requeue the
  file rather than returning a bare 500.
- `deploy/ingest-worker/worker.py`: rollup aggregation branch, heartbeat post,
  `BATCH_ROWS` default lowered to 250, and treating a `retryable` callback
  response as a clean stop-and-resume instead of a crash.
- Verification: requeue one 80M-row file, watch two lease→progress cycles
  complete without a timeout, confirm `ingest_rollups` fills for a rollup-mode
  file and `promote-rollups` moves it into the ontology queue.
