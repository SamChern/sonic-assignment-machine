# SONICSIM optimization pass — executing the September audit

Four batches, run in order. Nothing changes what a score means; the work is safety, cost, and clarity.

## Verified before planning

- `share_cards` really does grant read access to anonymous callers with a policy that allows every row.
- `supabase/config.toml` has no entry for `pixel-collect` or `ingest-worker-bootstrap`, so both require a login token they will never have.
- `public/ingest-worker`, `public/librosa-mcp`, `public/semantic-svc` are published on the live site (server code, service files, token-rotation script).
- In `analyze-audio`, when the cache lookup errors nothing is queued for analysis, so the caller gets an empty success.
- The score worker sends exactly one item per scoring call; calibration does a select+update per tag per category (~120 round trips per item); a cache hit still writes a counter row.
- No error boundary and no shared admin route guard exist anywhere; role checks are copy-pasted redirects.
- The Creator access level points at the consumer library tab, not `/creator`.
- `.env` is not ignored by git. `d3` is imported wholesale in 6 files; the MCP dev plugin runs in production builds.

## One deliberate deviation from the audit

The audit asks to re-enable the "Semantic Scope" option on the home visualization. You explicitly had it removed earlier as duplicative of "Scope". **I am not re-adding it.** Everything else in that section is done.

## Batch 1 — Security and data integrity

- Share links: remove anonymous read on `share_cards`, add a single-row lookup function that takes the share token, and switch the share view to it. Public links keep working; the table stops being dumpable.
- Turn off login requirement for the pixel endpoint and the worker bootstrap so beacons stop failing.
- Delete the three published server-code folders from `public/`; `deploy/` stays the only copy.
- Embedding cache: record which model actually produced a vector, store it under that model's key, and refuse to save when the fallback model answered. Add an admin cleanup action that deletes mismatched rows.
- `analyze-audio`: on a cache read error, analyze everything instead of returning empty.
- Key the analysis cache on the audio's content fingerprint rather than its filename, so two people uploading `mix.mp3` no longer share results.
- Tighten the "any logged-in user" read rules on `audio_sources`, `profiles`, `user_fingerprints`, `source_cache`, `librosa_cache`, `librosa_call_log`, `semantic_normalization`, `job_worker_state`, `sonic_signatures` to owner or organization scoping. Taxonomy and archetype tables stay public.
- Audience cohorts get their organization stamped on creation, and submitted member lists are validated against that organization.
- Add `.env` to `.gitignore` and commit an `.env.example`.

## Batch 2 — Cost and throughput

Target: same outputs, roughly 70% less model spend on the backlog.

- Group queued items by identical tag context and score 5–10 per call instead of one, mapping results back per item.
- Replace the per-tag calibration loop with one atomic database function that updates all tag/category pairs in a single statement (also fixes silent corruption under concurrency).
- Drop the per-hit counter write on cache hits (or batch one increment at end of run).
- Scoring regression diagnostic: default to 5 samples, limited concurrency, request timeouts, never force cache bypass by default.
- `analyze-audio`: run the CLAP, waveform, profile-lookup and tag-only stages concurrently (limit 5), fetch profile vectors in one query, and normalize inserted rows with one call instead of per row.
- Retention job: process in 10,000-row chunks committing per chunk, and include the rollups table; index it by creation date and drop the redundant index.
- Add a last-used timestamp plus nightly prune to the embedding cache; add a vector index on cohort centroids; drop the duplicate queue index.
- Replace whole-table status counts in the resolver and sound curator with count-only queries; reuse web-search results on escalation instead of re-searching; remove sleeps inside functions; add timeouts to every storage/proxy fetch; delete the duplicated helper copies.
- Report estimated tokens per 1,000 items before and after.

## Batch 3 — Consumer home

- One entry point: the single-input analyzer leads; the older multi-source picker becomes an "Add more sources" affordance inside it.
- The hero visualization reads the visitor's most recent analysis, and is labelled "Sample fingerprint" when they have none (no more fabricated numbers presented as output).
- Hide the tag-weight mapping block from consumers (admin/enterprise only); the consumer version becomes "What drove each score" without weights.
- Plain-language grounding wording ("inferred from similar sounds we've heard").
- The build/version debug chip becomes a quiet toast on stale builds, detail admin-only.
- Fix the mobile bottom bar so its items and labels match the actual tabs, with correct highlighting.
- Creator access level routes to `/creator`.
- Free-run limits move server-side and return a remaining count; the browser-storage limit goes away.
- Memoize the sign-in context so the whole app stops re-rendering on auth changes; map consumer-facing errors to plain sentences.

## Batch 4 — Enterprise, Admin, Creator

- Enterprise: rewrite Predict copy into audience language (people matched, match strength, confidence, lift) with statistics living only in the confidence chip; put revoke/delete actions behind a named confirmation dialog; replace raw database error text with plain messages.
- Admin: one shared admin route wrapper replaces eight copy-pasted redirects; an error boundary around the app and each large panel with a "reload this panel" action; remove or link the orphan CTV route; merge the duplicate console entry; move the once-a-second timer into a tiny leaf element; pause background health polling when the tab is hidden.
- Creator: one grouped nav (Understand / Register / Catalog / Market) across the four existing creator routes; replace the internal codename with "the six categories".
- Cross-cutting: labels on every icon-only button; fixed-width tables become responsive inside horizontal scrollers; import d3 submodules; dev-gate the MCP plugin and move it to dev dependencies; keep one service-worker path.
- Split the five 1,000+ line pages into sub-components under 500 lines each with no behaviour change.

## Technical notes

- Batch 1 is one additive migration (policy replacement, `get_share_card(p_token text)` security-definer RPC, RLS rewrites) plus small code edits; each new/changed policy keeps explicit GRANTs.
- Batch 2 adds `upsert_calibration(pairs jsonb)`, a chunked `run_intuizi_retention`, `embedding_cache.last_used_at` + prune, HNSW index on `sonic_cohorts.centroid`.
- `embedText` returns `{ vector, space }`; `embedCached` keys on the producing space and skips writes on mismatch.
- Worker batching groups by the existing `tag_signature`, mapping responses back by `audio_source_id`.
- Vitest coverage added for: batching group/map correctness, calibration upsert math, share-token RPC access, quota enforcement server-side.

## Verification

Anonymous read of `share_cards` fails; a pixel beacon returns 200 with no token; `sonicsimai.com/librosa-mcp/rotate-token.sh` 404s; worker logs show 5–10 sources per scoring call; Creator lands on `/creator`; typecheck, build, tests and the security linter all clean.
