# Step 2 recovery: prove the drain before restarting bulk ingest

## Current evidence

This is not ready for another blind restart.

- The ingest ledger currently has **23 done**, **7 discovered**, **1 processing**, **1 blocked**, and **2 skipped** files.
- The seven waiting files plus the stale processing file represent roughly **371.5M remaining source rows**.
- The last processing heartbeat is over an hour old, and `worker_heartbeats` is empty. The EC2 service is therefore not running the heartbeat-enabled worker currently in the repository.
- The database is still under enough pressure that simple queue count queries time out or lose the connection. This must be stabilized before adding more queue work.
- No IAM change is needed: the one unreadable object is already isolated as `blocked`; the other files use the existing working credentials.
- The repository’s downloadable `public/ingest-worker/worker.py` is stale: it still uses 1,000-row batches and lacks rollup/heartbeat support. The deploy copy is newer, but its rollup path is not safe to run yet: it ignores saved offsets, restarts giant files from row zero, and the promotion function silently stops after 400,000 rollup rows.

## Recovery plan

### 1. Freeze producers; preserve checkpoints

- Stop the EC2 ingest service temporarily so it cannot enqueue while the database is saturated.
- Do not rediscover, reset, or delete ledger rows.
- Leave the inaccessible S3 object `blocked` and the two structurally unusable files `skipped`.
- Snapshot ledger status, offsets, queue state, and worker state as the recovery baseline.

**Gate:** no ingest file changes its `rows_offset` for five minutes.

### 2. Restore a reliable scoring drain first

- Add an internal scheduled kick for `intuizi-score-worker`; do not rely only on fire-and-forget self-invocation.
- Keep claims tiny and single-lane initially, backed by the existing ready/stale partial indexes.
- Remove claim-path housekeeping that can update hundreds of exhausted rows on every claim; move dead-letter cleanup to a separate bounded maintenance RPC.
- Run database maintenance through the backend tool after writes are quiesced, then verify claim latency and completed-row throughput.
- Keep ingestion paused until the pending count declines continuously and database health checks stop timing out.

**Gate:** three consecutive five-minute samples show (a) pending decreases, (b) done increases, (c) no pooler/statement timeout, and (d) no new owner-null failures.

### 3. Make large-file rollups resumable and bounded

- Replace Python dictionary aggregation and repeated `LIMIT/OFFSET` scans with a DuckDB SQL aggregation written to a local checkpoint file.
- Resume from the ledger’s saved row offset instead of row zero.
- Stage rollups idempotently with a uniqueness key on object + subject + taxonomy + day and conflict-safe writes; never delete all staged rows on a retry.
- Advance the ledger checkpoint only after the corresponding staged chunk is committed.
- Refactor promotion to stream bounded subject batches with its own cursor. Remove the 400,000-row silent cutoff and do not build the full subject set in Edge Function memory.
- Mark a file `done` only after all rollup pages are promoted; leave it `loaded` and retryable if promotion stops.

**Gate:** run one already-checkpointed large file through two forced stop/resume cycles. Its offset must only move forward, staged weights must not double, promotion must reach the final row, and the file must finish once.

### 4. Keep the EC2 update atomic and minimal

- Make `public/ingest-worker/worker.py` identical to the verified deploy copy so direct-download and Git installs cannot diverge.
- Update the installer/runbook to install all required files and print the installed worker version/hash.
- Publish one exact command block for the user: stop service, pull, run syntax/smoke checks, install, restart, and tail logs. No AWS IAM edits and no extra infrastructure.

**Gate:** `worker_heartbeats` receives a fresh row, the installed hash matches the repository hash, and the log reports `batch_rows=250` plus resumable rollup mode.

### 5. Resume in controlled stages

1. Restart scoring only and confirm the drain gate.
2. Resume one large ingest file, not all seven.
3. Observe two checkpoints and one promotion cycle.
4. If healthy, allow the remaining discovered files to proceed serially.
5. Report completion from ledger totals plus downstream scored/failed counts—not from “no pending files.”

## Stop conditions

Automatically pause and preserve the current checkpoint on any of these:

- two callback/database timeouts in ten minutes;
- no scoring completions for five minutes while pending work exists;
- database health or connection-pool failures;
- stale worker heartbeat;
- promotion cursor not advancing;
- a new permanent object-read error.

## Success criteria

- All readable files are `done`; permanent source defects remain explicitly `blocked` or `skipped`.
- Ledger offsets equal source totals for completed files.
- Staged rollups are fully promoted with no silent cap or duplicate weights.
- The scoring queue drains to zero eligible pending/processing rows; dead letters are separately enumerated with reasons.
- The admin health view shows a current EC2 heartbeat and actual drain progress.
- No IAM policy, role, or bucket change is required.
