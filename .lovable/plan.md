## Goal

Let admins ingest CTV-derived audio (ad/segment audio + taxonomy tags as metadata) and run it through the existing SemanticAC pipeline so the output is interchangeable with Spotify/Apple/Upload sources. End users see CTV items as normal sources in Select Sources, Network, and Analysis. The backend keeps every derivative needed to learn continuously without re-calling the original CTV source.

## 1. Data model (schema changes)

Reuse `audio_sources` + `source_analyses` so CTV items behave like any other source. Add:

- `audio_sources.source_type` value: `'ctv'` (no schema change — column is already free-form text).
- `audio_sources.ctv_metadata jsonb` — raw CTV payload per row: device id (hashed), program/channel, ad pod position, daypart, content rating, IAB tags, language, loudness LUFS, etc.
- New table `public.ctv_ingest_batches` — one row per upload/feed pull: source feed name, file uri, row counts, ingested_by, status.
- New table `public.taxonomy_nodes` — normalized tag dictionary (`code`, `label`, `parent_code`, `taxonomy_version`, `embedding vector(1536)`). Tags from `ctv_metadata.tags[]` resolve to rows here.
- New join `public.audio_source_tags` (`audio_source_id`, `node_id`, `weight`).
- New table `public.category_feedback` — admin/user re-labels: `source_analysis_id`, `category` (one of the 6), `delta` (-1..+1) or `corrected_score` (0-100), `rater_user_id`, `note`. Drives online calibration.
- New table `public.category_calibration` — per `(taxonomy_node_id, category)` rolling stats: `n`, `mean_score`, `m2` (Welford), `bias` (current additive correction learned from feedback), `updated_at`. This is the "knowledge the model retains" so future analyses don't need to re-hit the LLM or the original CTV feed.
- Enable `pgvector` for taxonomy + acoustic-profile embeddings (1536-d, `openai/text-embedding-3-small`).

All tables get RLS: admins write, authenticated read where appropriate, `service_role` full for edge functions. GRANTs in the same migration.

## 2. Ingestion pipeline (admin-only)

New route `/admin/ctv` + edge function `ctv-ingest`:

1. Admin uploads/links a CTV feed (CSV/JSON/JSONL) into the existing `admin-audio-tests` bucket (or a new `ctv-feeds` bucket).
2. `ctv-ingest` parses rows → for each row:
   - Download/clip audio (if URL or storage path provided) → push through existing `librosa-analyze-full` to populate `audio_sources.librosa_features` (cached).
   - Upsert `audio_sources` row with `source_type='ctv'`, name, `ctv_metadata`, librosa blob.
   - Resolve tags → upsert `taxonomy_nodes`, link via `audio_source_tags`.
   - Invoke existing `analyze-audio` with the acoustic profile **plus** a new "Taxonomy context" prompt block (tag path + sibling stats from `category_calibration`).
   - Persist normal `source_analyses` row (so the 6 scores + `category` work everywhere unchanged).
3. Batch row updated with success/failure counts.

End users then see CTV items in Select Sources / Library exactly like Spotify tracks — no UI fork required.

## 3. Ontology mapping — keeping outputs comparable

`analyze-audio` already returns the 6 scores from acoustic profile + LLM. For CTV we extend the prompt with:

- The taxonomy path (e.g. `Auto > Truck Ad > Dialogue+Music Bed`).
- Prior means/std-dev for each of the 6 categories from `category_calibration` for that node (and its parents as fallback). These act as a Bayesian prior the LLM is told to anchor on unless acoustics contradict.
- Loudness/dialogue/music ratios from librosa.

Result: a CTV source produces the same `(emotional, cognitive, social, communication, contextual, artistic)` vector + dominant category, so all existing components (`AnalysisResults`, `FingerprintComparison`, `NetworkVisualization`, similarity math) work with zero changes.

## 4. Continuous learning loop (no source callbacks needed)

This is the "heavy" option you picked. Three layers, all in the DB:

a. **Aggregates** — after every `source_analyses` insert for a CTV row, an edge function `update-calibration` walks the row's tags and updates Welford running mean/variance in `category_calibration` per (node, category). Cheap, exact, no LLM.

b. **Embeddings & nearest-neighbor warm start** — on ingest we compute and store:
   - `taxonomy_nodes.embedding` from the label/path.
   - `audio_sources.profile_embedding vector(1536)` from a textual acoustic+tag summary.
   When a new CTV row arrives, `analyze-audio` first does a pgvector kNN against prior CTV `profile_embedding`s and injects "5 nearest historical sources scored: …" into the prompt. Over time this makes scores converge and reduces LLM variance.

c. **Feedback calibration** — `category_feedback` rows (admin re-labels in Analysis, or a thumbs up/down on the dominant category badge) feed a nightly job (`pg_cron` → `recalibrate-categories` edge fn) that updates a per-node additive `bias` term using simple gradient step: `bias += lr * mean(corrected - predicted)`. Future scores are returned as `score + bias`, clamped 0-100. No retraining, no re-fetching from CTV.

All three together mean the system gets smarter from its own history; the original CTV file/URL can disappear after ingest and we still keep librosa features, embeddings, tag links, scores, and calibration deltas.

## 5. UI surface (minimal)

- New admin page `/admin/ctv`: upload feed, view batch history, see per-batch success/failure.
- Admin-only re-label control on existing `AnalysisResults` source card: a small "correct categories" popover writes to `category_feedback`. Hidden for non-admins (uses existing `useAuth` admin check).
- No new user-facing tab. CTV rows appear in existing source lists/network because they're just `audio_sources` rows.

## 6. Rollout order

1. Migration: new tables, pgvector, `ctv_metadata` + `profile_embedding` columns, RLS, GRANTs.
2. Edge fn `ctv-ingest` (parse + librosa + analyze + persist + tag link).
3. Edge fn `update-calibration` (trigger from `ctv-ingest` and from manual re-analysis).
4. Prompt extension in `analyze-audio` to read `category_calibration` priors + kNN neighbors.
5. Admin UI: `/admin/ctv` upload + batch list; re-label popover in `AnalysisResults`.
6. `pg_cron` nightly `recalibrate-categories`.
7. Smoke test with a small CTV sample feed; verify CTV row renders in Network and contributes to a user fingerprint identically to a Spotify track.

## Technical notes

- Reuse `LOVABLE_API_KEY` for embeddings (`openai/text-embedding-3-small`, 1536-d) — already in secrets.
- Tag resolution is fuzzy: exact code match → label match → embedding nearest-neighbor with threshold; unknown tags get created with `taxonomy_version='auto'` for admin review.
- Hash any device/user identifiers from CTV before storing (`encode(digest(...), 'hex')`); we keep aggregates, not PII.
- The `category` generated column on `source_analyses` keeps working because we still write the 6 scores normally; the bias is applied at write time, not at view time.
- All edge functions follow existing CORS + `verify_jwt=false` + in-code auth pattern used by `analyze-audio`.
