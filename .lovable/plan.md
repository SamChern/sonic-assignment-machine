Revised scaling plan. Constraint honored: **nothing depends on changing the librosa REST/MCP API, and Phase 1 requires no changes to EC2 instance config, SSH, ports, Nginx, or AWS endpoints.** The librosa endpoint is treated as a fixed, opaque, rate-limited third-party service you call but do not control.

## Operating assumptions

- The librosa REST API stays exactly as it is: same host, same ports (8765/8766), same Nginx, same token, same synchronous `/analyze` and `/analyze_full` contracts.
- You cannot SSH-tune, restart, containerize, or re-deploy that box right now.
- Everything in Phase 1 happens in code you control: the React frontend, the Lovable Cloud edge functions, and the database.

---

## Phase 1 — Immediate wins, zero infrastructure changes

All of these live in `supabase/functions/*` and `src/*`. They reduce load on the EC2 box rather than making the box faster.

### 1.1 Aggressive result caching (biggest single win)

Today `librosa-analyze-full` caches on `audio_sources.librosa_features`, but the cache is per-`audio_source_id` — the same track analyzed by two different users runs twice on EC2.

- Add a content-addressed cache keyed by a stable fingerprint of the audio input (Spotify/Apple track ID, or a SHA-256 of the audio URL plus the analysis parameters `duration`/`n_mfcc`/`max_frames`/`recurrence_size`).
- New table `public.librosa_cache` with `cache_key text unique`, `features jsonb`, `params jsonb`, `hit_count int`, `created_at`, `last_hit_at`.
- On every analyze request: look up `cache_key` first; on hit, return immediately and increment `hit_count` — EC2 is never contacted.
- On miss, call EC2, then write both `librosa_cache` and `audio_sources.librosa_features`.
- Result: for popular catalog tracks the EC2 call rate drops toward zero as the cache warms.

### 1.2 Single-flight / de-duplication of concurrent identical requests

Two users hitting the same new track at the same moment currently produce two EC2 jobs.

- Add `public.librosa_inflight` (`cache_key` primary key, `started_at`, `edge_instance`) or reuse `librosa_cache` with a `status` column (`pending` / `ready` / `failed`).
- The edge function attempts an insert of a `pending` row. If the insert wins, it calls EC2. If it loses (row already `pending`), it polls the cache row for up to N seconds instead of calling EC2.
- Stale `pending` rows older than the analysis timeout are treated as failed and retried.

### 1.3 Client-side and edge-side concurrency limiting

The EC2 box is single-threaded per worker and you cannot add workers. So the app must stop sending it more than it can take.

- Add a global concurrency gate in the edge function: a `public.librosa_slots` counter table or an advisory-lock-based limiter that caps simultaneous in-flight EC2 calls (start at 2, tune from observed latency).
- Requests beyond the cap are queued (see 1.4) or rejected with a friendly "analysis queued" response rather than piling onto Nginx's `limit_req` and getting 503s.
- In `useLibrosaFeatures`, serialize batch analyses instead of firing them in parallel; add exponential backoff on 429/502/503 from the proxy.

### 1.4 Database-backed job queue (no SQS, no infra)

You can build the async decoupling entirely inside Lovable Cloud.

- New table `public.analysis_jobs` (`id`, `audio_source_id`, `cache_key`, `params jsonb`, `status`, `attempts`, `last_error`, `priority`, `created_at`, `started_at`, `finished_at`).
- Add `status` and `error_message` columns to `audio_sources` so the UI can show progress.
- The user-facing path enqueues a job and returns immediately — no user ever waits on a 60-second EC2 call.
- A `pg_cron` schedule (every 10–30 s) invokes a `librosa-worker` edge function that claims up to N pending jobs with `FOR UPDATE SKIP LOCKED`, calls the existing unchanged EC2 `/analyze_full` endpoint, writes results to the cache, and marks jobs done.
- Retries with backoff on transient failures; permanent failure after 3 attempts with the error surfaced in the UI.

### 1.5 UI changes for async

- `useLibrosaFeatures` polls or subscribes via Supabase Realtime on `audio_sources.status` / `analysis_jobs.status` instead of awaiting the analysis inline.
- `AnalysisResults` and the CTV admin page show `pending` / `processing` / `done` / `failed` states with a queue position or spinner.
- Optimistic display of already-cached scores while heavier librosa visuals fill in later.

### 1.6 Reduce per-call cost on the EC2 side without touching it

You control the request parameters, so shrink the work you ask for.

- Cap analysis `duration` (30–60 s of audio is enough for the 6-category scoring; full-track analysis is rarely worth 5x the CPU).
- Lower `max_frames` and `recurrence_size` for the default path; reserve high-resolution runs for admin/CTV work.
- Skip `laplacian_segmentation` and the recurrence matrix on the user path — request them only when `LibrosaVisuals` is actually opened.
- Split into a "fast profile" call (scalars only) and an on-demand "full visuals" call. Most users never open the visuals.
- Trim payload size: don't round-trip large float arrays you never render.

### 1.7 Graceful degradation when EC2 is unavailable

The librosa box is a single point of failure you can't harden right now, so make the app tolerate its absence.

- Circuit breaker in the edge function: after K consecutive upstream failures, stop calling EC2 for a cool-down window and serve cached/partial results.
- Fall back to the existing Spotify/Apple audio-features path plus the LLM scoring when librosa is unavailable, flagging the analysis with lower `confidence`.
- Never block a user's fingerprint or the Network view on librosa — those already work from `source_analyses`.

### 1.8 Observability you own

- Log every EC2 call with duration, cache hit/miss, and status into a `public.librosa_call_log` table (sampled or with a retention window).
- Surface a small panel on the admin page: cache hit rate, p50/p95 upstream latency, failure rate, queue depth.
- This gives you the data to decide when the EC2 box actually needs to change — and the evidence to justify it.

---

## Phase 2 — Reduce dependence on librosa entirely (2–4 weeks)

Goal: the pipeline stays fully functional and scalable even if the librosa service is capped, slow, or gone.

- **Make librosa optional, not required.** `analyze-audio` already produces the 6 scores from metadata plus the LLM. Formalize librosa features as an *enrichment* that raises `confidence`, never a hard dependency.
- **Precompute and backfill.** Use the queue from 1.4 to warm the cache for the catalog during off-peak hours at a trickle rate the EC2 box can absorb. Over time most requests are cache hits.
- **Embedding-based substitution.** For a track with no librosa features, use `match_audio_profiles` kNN on `profile_embedding` to borrow the acoustic character of nearest analyzed neighbors as a prior. Already partially built for CTV — extend it to the general path.
- **Provider features first.** Prefer Spotify/Apple-supplied audio features when available; only fall back to librosa for uploads and CTV audio where no provider features exist.
- **Portable extraction contract.** Define the librosa feature schema as a versioned interface so a future replacement (a managed audio-analysis API, a serverless function, or a rebuilt worker) can satisfy it without touching the rest of the app.

---

## Phase 3 — Database and backend scaling (independent of EC2)

- Tune the pgvector index on `audio_sources.profile_embedding` (`hnsw` with appropriate `m`/`ef_construction`, or `ivfflat` with `lists` scaled to row count). Re-tune as rows pass 100k and 1M.
- Add covering indexes for the hot read paths: `source_analyses(user_id, created_at desc)`, `audio_sources(user_id, source_type)`, `librosa_cache(cache_key)`, `analysis_jobs(status, created_at)`.
- Use `supabase--slow_queries` and `EXPLAIN (ANALYZE, BUFFERS)` to find the real offenders before adding indexes.
- Move large arrays (mel spectrograms, recurrence matrices) out of row-inline `jsonb` into a separate table or Lovable Cloud storage, keeping only scalars hot.
- Archive `librosa_call_log`, failed jobs, and superseded feature blobs on a retention schedule.
- Watch `db_health`; scale Lovable Cloud compute only when the saturated metric is actually memory or connections.

---

## Phase 4 — Frontend efficiency

- Lazy-load `LibrosaVisuals`, the D3 network, and admin bundles with `React.lazy` so first paint doesn't ship the heavy visualization code.
- Virtualize long source lists in `UserLibrary` / Select Sources.
- Memoize the network layout and fingerprint math; recompute only on actual data change.
- Debounce search inputs against Spotify/Apple endpoints.
- Cache read queries client-side with React Query stale times so tab switches don't re-fetch.

---

## Phase 5 — When you regain EC2 control (parked, not required)

Keep this as a backlog, explicitly not a dependency for anything above:

- Multiple uvicorn/gunicorn workers, `/tmp` on tmpfs, thread/process pool for the CPU-bound analysis.
- Containerize the worker, publish to ECR, put it behind an auto-scaling group driven by the queue depth you'll already be measuring from Phase 1.
- Move ingress to an ALB and workers to a private subnet.
- Spot instances for the bulk of analysis compute.

Because Phase 1 already introduces a real queue, a content-addressed cache, and status-driven UI, this future migration becomes a drop-in change to a single edge function — the frontend and database never learn that anything moved.

---

## Recommended order

1. **1.1 content-addressed cache** — largest immediate reduction in EC2 calls, small change.
2. **1.6 smaller requests** — cuts per-call CPU on the box without touching it.
3. **1.4 + 1.5 queue and async UI** — removes the user-facing latency coupling entirely.
4. **1.2 + 1.3 single-flight and concurrency cap** — protects the box from thundering herds.
5. **1.7 + 1.8 circuit breaker and metrics** — resilience plus the data to plan Phase 2/5.

## Technical notes

- All new tables get RLS policies and GRANTs in the same migration, following the existing project pattern (admins manage, authenticated read where appropriate, `service_role` full for edge functions).
- The queue worker uses `pg_cron` + `pg_net` to invoke the edge function; the schedule insert must use the insert tool (contains project-specific URL and key), not a migration.
- No changes to `supabase/functions/librosa-analyze/index.ts` or `librosa-analyze-full/index.ts` upstream contracts — the new caching/queue layer wraps them.
- No changes to `deploy/librosa-mcp/*`, Nginx configs, systemd units, or `aws-proxy` endpoint routing.