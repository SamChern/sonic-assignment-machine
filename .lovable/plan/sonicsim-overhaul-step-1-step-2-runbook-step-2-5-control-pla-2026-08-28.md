# SonicSIM overhaul — Step 1, Step 2 runbook, Step 2.5 control plane

Three deliverables this session, matching your answers: implement Step 1, hand you a Step 2 EC2 runbook, and do the Step 2.5 ingest control-plane refactor fully.

Ground rule carried through everything: evolve, never rebuild. No existing table, column, edge function, or RPC is dropped or renamed. EIDs stay join keys only — never features, never embedded, never logged.

## Phase 1 — Step 1 schema migration

Additive migration, exactly the SQL from your doc:

- `taxonomy_nodes` gains `audio_embedding vector(512)`, `grounding_count int default 0`, `crosswalk jsonb default '{}'`, plus an HNSW cosine index on the new vector.
- New tables `embedding_bridges`, `sonic_cohorts` (with the `export_eligible` generated column at the 1,000-member floor), `sonic_cohort_members`.
- RLS mirroring `audio_profile_embeddings`: service-role write, admin read. `sonic_cohort_members` is service-role only — `subject_key` is never reachable from a client role. GRANTs written in the same migration as each CREATE TABLE.

Verify: migration applies clean; a scoring-worker run and an `analyze-audio` call both still succeed unchanged.

## Phase 2 — Step 2 EC2 semantic service (your box, my runbook)

I can't touch your EC2 instance, so I'll write the full runbook into the repo as `deploy/semantic-svc/` following your `deploy/librosa-mcp` conventions, ready for you to copy up and run:

- `requirements.txt` (pinned `laion-clap`, `torch`), `server_rest.py` with `POST /embed_text`, `POST /embed_audio`, `POST /bridge`, `GET /healthz`, reusing the librosa service's audio-fetch/validation shape.
- Identity-stub `/bridge`: linear/zero-pad 512→1536 until Step 8 trains real weights, so the pipeline is testable end to end today.
- `semantic-svc.service` systemd unit, `nginx-semantic-svc.conf`, `gunicorn.conf.py`, `smoke-test.sh`, and a `README.md` with the exact install/verify sequence.

Because the service isn't live yet, anything the app builds against it degrades gracefully rather than erroring — the health surface reports "not configured" and callers fall back to the existing Lovable AI embedding path. No `semantic-embed` edge function this session (that's Step 3).

## Phase 3 — Step 2.5 ingest control plane (full refactor)

**Read this before approving:** doing 2.5 fully means `intuizi-ingest` stops parsing Parquet. Until your DuckDB worker is running on EC2, Parquet ingestion does not progress — including the ~35k identifiers currently mid-flight. Already-queued scoring jobs keep draining normally (`intuizi-score-worker` and `intuizi_score_queue` are untouched), and small CSV files keep working through a preserved legacy path. If you'd rather not take that gap, say so and I'll gate the parse path behind a flag instead.

Backend changes:

- `intuizi-ingest` becomes discovery + ledger + dispatch + status only. All Parquet decode paths (`_shared/parquet.ts` usage, row-group budgeting, `planWorkCaps`, phase CPU metering, deadline logic) are removed from the request path; a `legacy_csv` mode stays for small CSV files.
- `intuizi_ingest_files` becomes the canonical ledger: adds `etag`, `rollup_rows`, and a status machine `discovered → processing → rolled_up → loaded → enqueued → failed`, checkpointed at each transition and deduped by ETag so SQS at-least-once redelivery no-ops. Existing columns (`rows_offset`, `row_group_cursor`, `processed_rows`) are kept for history, not written by the new path.
- Dispatch: one SQS message per discovered object. **Correction to the doc:** `aws-proxy` is an allowlisted EC2 HTTP proxy with no AWS-API capability, so SQS SendMessage is added to the existing SigV4 driver in `supabase/functions/_shared/s3.ts` (renamed conceptually to an AWS-signing helper, file kept in place) rather than routed through `aws-proxy`. Queue URL and region come from `integration_credentials`, same handling as the S3 bucket config.
- Backpressure: before dispatch, read `intuizi_score_queue` depth and pause enqueueing above a high-water mark. Files keep landing and rolling up; nothing is dropped.
- Lease reuse: `acquire_intuizi_lease` guards one dispatcher at a time.
- A `POST /status` action returns per-file ledger state, files/night, rows→rollups counts, and time-from-drop-to-enqueued.

Worker skeleton (for you to deploy, written into the repo): `deploy/ingest-worker/worker.py` with DuckDB + httpfs, memory limit and spill directory, one set-based projection/pushdown query per report type, Arrow out, and a Postgres load path that writes the same rows the edge function used to and then enqueues `intuizi_score_queue` identically. Plus systemd unit, SQS consumer loop with ETag idempotency, and `smoke-test.sh`.

UI changes:

- `ScoreQueueHealthPanel` and `EnrichmentReadinessPanel` render the ledger status machine, per-file progress, rollup counts, and drop→enqueued latency.
- `PostIngestionWizard` stage 2 becomes "dispatched to ingest worker" with ledger-driven progress; the CPU/deadline/resume affordances that only made sense for in-function parsing are removed, and `PhaseCpuChart` history is kept read-only for past runs.

Verify: drop a copy of a real 800MB file into a test prefix — ledger walks `discovered → enqueued` with no manual steps, rollups land, score queue fills, edge-function logs show no memory pressure; kill the worker mid-file and confirm clean resume by ETag.

## What I'll need from you

- The SQS queue URL and region (I'll request them as secrets when I reach dispatch), plus confirmation the S3 event notification on `inbound/` is wired to that queue.
- Nothing else — Step 1 and the runbook files need no input.

## Not in this session

Steps 3–12 (semantic-embed, `analyze-audio` context rework, AudioSet crosswalk, cohorts/activation, retention, Control Room, Semantic Scope, Predict loop, front-end consolidation) stay for later sessions in your recommended order: 9 → 3 → 4 → 5 → 12 → 10 → 6 → 7 → 11.
