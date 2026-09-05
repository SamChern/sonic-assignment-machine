# SONICSIM optimization pass — executing the September audit in full

Four batches, in order (Part 2 of the audit). Every numbered finding is listed so nothing is dropped. Part 3 (the "next level" ideas) is explicitly out of scope for this pass — noted at the end.

## Verified before planning

- `share_cards` really grants read access to anonymous callers with an all-rows policy.
- `supabase/config.toml` has no entry for `pixel-collect` or `ingest-worker-bootstrap`.
- `public/ingest-worker`, `public/librosa-mcp`, `public/semantic-svc` are live on the site (server code, service files, token-rotation script).
- In `analyze-audio`, a cache read error leaves nothing queued, so the caller gets an empty success.
- The score worker sends one item per scoring call; calibration does a select+update per tag per category; a cache hit still writes a counter.
- No error boundary and no shared admin guard exist; role checks are copy-pasted redirects in many files.
- The Creator access level points at `/?tab=library`, not `/creator`.
- `.env` is not git-ignored; `d3` is imported wholesale in 6 files; the MCP dev plugin runs in production builds.

## One deliberate deviation

The audit asks to re-enable the "Semantic Scope" option on the home visualization. You explicitly had it removed as duplicative of "Scope", so **I am not re-adding it.** The related work still happens: the scope visual code stays lazy-loaded so its DSP library leaves the first-paint bundle.

## Batch A — Security & integrity (C1–C5 + RLS scoping)

- **C1** Remove anonymous read and the all-rows policy on `share_cards`; add a single-row `get_share_card(p_token)` lookup function and point the share view at it. Public links keep working.
- **C2** Make the embedding call report which model actually produced a vector; store the cache row under that model's key and skip the write when it differs from what was asked for. Add an admin cleanup that deletes mismatched cache rows.
- **C3** Mark the pixel endpoint and the worker bootstrap as no-login callers so beacons stop failing.
- **C4** Delete all three published server-code folders from `public/`; `deploy/` stays the only copy.
- **C5** On a cache read error in `analyze-audio`, analyze all sources instead of returning empty.
- **H7** Key the analysis cache on the content/feature fingerprint instead of the filename, so two people uploading `mix.mp3` stop sharing results.
- **RLS** Rewrite the "any logged-in user" read rules on `audio_sources`, `profiles`, `user_fingerprints`, `source_cache`, `librosa_cache`, `librosa_call_log`, `semantic_normalization`, `job_worker_state`, `sonic_signatures` to owner or organization scoping. Archetypes and taxonomy stay public.
- **H9** Stamp the organization on cohort creation and validate submitted member lists against that organization.
- **H8** Escape wildcard characters (or use exact match) in the dataset-scoring lookup so a record named `%` can't pull another tenant's analysis.
- Add `.env` to `.gitignore` and commit `.env.example`.
- Note (not changed this pass): `integration_credentials.field_value` is cleartext at rest. Encrypting it needs a key decision — I'll flag it, not silently change it.

## Batch B — Token & compute (H1–H6, H8, H10–H11 + medium efficiency)

Target: same outputs, ~70% less model spend on the backlog. I'll report estimated tokens per 1,000 items before and after.

- **H1** Group queued items by identical tag context and score 5–10 per call, mapping results back per item.
- **H2** Replace the per-tag calibration loop with one atomic database function updating all tag/category pairs in a single statement (also fixes silent corruption under concurrency).
- **H3** Drop the per-hit counter write; if kept, one batched atomic increment per signature at end of run.
- **H4** Scoring regression: default 5 samples, concurrency 3, request timeout, never force cache bypass by default.
- **H5** Run the CLAP, waveform, profile-lookup and tag-only stages concurrently (limit 5) and fetch profile vectors in one query.
- **H6** Replace the per-row normalization loop after bulk insert with one call over the inserted ids.
- **H8** Collapse the N+1 dataset-scoring loop into one lookup plus one bulk write.
- **H10** Process the retention job in 10,000-row chunks, committing per chunk.
- **H11** Add the rollups table to retention; index it by creation date; drop the redundant key index.
- Medium: reuse web-search results on resolver escalation instead of re-searching; replace whole-table status counts in the resolver and sound curator with count-only queries; remove sleeps inside functions (end the run, let the next tick continue); add 30s timeouts to every storage and proxy fetch; delete the duplicate `invokeAnalyzeAudio` in ingest and the four copies of `slugify` in favour of shared ones; memoize the Spotify token and stop logging credential lengths; move the scope-window rate limit from per-instance memory into the database.
- Indexes/storage: add a last-used timestamp plus nightly prune to the embedding cache; add a vector index on cohort centroids; drop the duplicate queue index.

## Batch C — Consumer door

- One entry point: the single-input analyzer leads; the older multi-source picker becomes an "Add more sources" affordance inside it.
- Hero visual reads the visitor's most recent analysis; with none, it is labelled "Sample fingerprint" (no fabricated numbers presented as output).
- Hide the tag-weight mapping from consumers (admin/enterprise only); consumer version becomes "What drove each score", no weights.
- Plain-language grounding wording ("inferred from similar sounds we've heard").
- The floating build/version debug chip becomes a quiet toast on stale builds; detail admin-only.
- Fix the mobile bottom bar items, labels and active highlighting to match the real tabs.
- Creator access level routes to `/creator`.
- Move guest and monthly run limits server-side (returning a remaining count) and delete the browser-storage limit.
- Memoize the sign-in context so the whole app stops re-rendering on auth changes.
- Map consumer-facing errors to plain sentences.

## Batch D — Enterprise, Admin, Creator, cross-cutting

- **Enterprise:** rewrite Predict copy into audience language (people matched, match strength, confidence, lift) with statistics only in the confidence chip; put revoke-activation, delete-playbook and delete-dataset behind a named confirmation dialog; replace raw database error text with plain messages.
- **Admin:** one shared admin route wrapper (renders nothing until auth resolves) replacing the copy-pasted redirects; an error boundary around the app and around each large panel with a "reload this panel" action; remove or link the orphan CTV route; rename the duplicate pipeline route and merge its console entry with integrations; move the once-a-second timer into a tiny leaf element; pause worker-health polling when the tab is hidden.
- **Creator:** one grouped nav (Understand / Register / Catalog / Market) across the four creator routes; replace the internal codename with "the six categories".
- **Cross-cutting:** labels on every icon-only button (especially deletes); fixed-width tables become responsive inside horizontal scrollers; import d3 submodules; dev-gate the MCP plugin and move it to dev dependencies; keep one service-worker path; move the demo videos out of the bundle into storage; add `React.memo` where a heavy panel re-renders needlessly.
- Split the five 1,000+ line pages (`AdminWorkbench`, `ConfidenceBreakdownPanel`, `SemanticAnalysis`, `PostIngestionWizard`, `IntuiziConsolePanel`) into sub-components under 500 lines, no behaviour change.

## Technical notes

- Batch A: one additive migration (policy replacement, `get_share_card(p_token text)` security-definer RPC, RLS rewrites, explicit GRANTs) plus small code edits.
- Batch B: `upsert_calibration(pairs jsonb)`, chunked `run_intuizi_retention`, `embedding_cache.last_used_at` + prune, HNSW cosine index on `sonic_cohorts.centroid`.
- `embedText` returns `{ vector, space }`; the cache keys on the producing space and skips writes on mismatch.
- Worker batching groups on the existing `tag_signature`, mapping responses back by `audio_source_id`.
- Tests added for: batch grouping/mapping, calibration upsert math, share-token access, server-side quota, wildcard escaping.

## Part 3 — not in this pass

Resonance Point, Sonic Commons, on-device scoring, the `hear()` tool for other models, frames+sound multimodal, Sonic Passport, haptic signatures, live venue context, the public "what it learned" page. All depend on this foundation; I'll propose them as Steps 18a–18c afterwards.

## Verification

Anonymous read of `share_cards` fails; a pixel beacon returns 200 with no token; `sonicsimai.com/librosa-mcp/rotate-token.sh` 404s; worker logs show 5–10 sources per scoring call; Creator lands on `/creator`; typecheck, build, tests and the security linter clean.
