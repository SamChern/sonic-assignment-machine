# Step 14 — The SONICSIM Sound Library

Grounding stops being invisible EC2 backstage and becomes a product surface: a versioned Grounding Pack, an honesty badge on every score, and an admin module to see coverage, fill gaps, and refresh the model.

## Verified current state

- `embedding_bridges` is **empty** — no pack, not even an identity stub, is registered.
- `taxonomy_nodes`: 5,076 rows, **0** with `grounding_count > 0`; 1,272 already carry a CLAP `audio_embedding` (text-derived, from `semantic-backfill`).
- Observed tag volume lives in `audio_source_tags` (33,286 rows: `ctv` 18,919, `iab` 9,697, `web` 3,662, `app` 965). `ingest_rollups` is currently empty, so coverage must be computed from `audio_source_tags` with rollups as an optional second source.
- `source_analyses` has no `grounding_level` column yet.
- `_shared/context.ts` already prefers a grounded audio vector over text and falls back cleanly — that function is where grounding level gets decided.

## 14a — Grounding packs

A pack is an artifact, never a live corpus connection: `{tag embeddings, bridge weights, coverage manifest, license ledger}` built offline, uploaded to storage, registered as a row in `embedding_bridges`, activated with one click.

- Extend `embedding_bridges` with pack fields: `version`, `manifest` (jsonb: per-taxonomy-code grounded flags + counts), `kind` (`identity_stub` | `pack`), `license_ledger` (jsonb), `activated_at`.
- Seed one `identity_stub` row so the product always has something to name, labeled **"Identity stub — not yet grounded"** wherever the active pack is shown.
- Storage: private bucket `grounding` for uploaded sample audio and pack files.
- "Sources & licenses" page (admin, quiet link) renders the ledger + per-asset attribution. No third-party brand names appear anywhere in the workflow UI.

## 14b — Honest scores

- Add `grounding_level text` to `source_analyses` (`text-only` | `bridged` | `grounded`), default `text-only`.
- Decide it in `analyze-audio` from the evidence actually used: any tag resolved through a pack audio embedding → `grounded`; catalog projection through an active bridge → `bridged`; otherwise `text-only`.
- Render a small badge on every analysis result surface (`AnalysisResults`, workspace analyses, saved-analysis drawer) with a tooltip explaining what the level means.

## 14c — The Sound Library admin module

New route `/admin/sound-library`, tile on the admin overview, admin-only like the other surfaces.

1. **Coverage meter** per taxonomy branch (`ctv.*`, `iab.*`, `web.*`, `app.*`, `poi.*`): signal-weighted grounded % = grounded tags ÷ observed tag weight, from the active pack manifest × tags actually seen. Backed by a SQL view/function so the page is one round trip.
2. **Gap list** sorted by signal volume — the uncovered tags the real data needs most, each with observed count and a "queue sound" action.
3. **Ingest sample audio**: upload files or paste URLs into `grounding_queue`. License and attribution fields are required; queued rows are embedded via `semantic-embed` and, on approval, attached to their taxonomy node as grounding examples in `grounding_assets` (which bumps `grounding_count`).
4. **Auto-curate — "Find sound for my gaps"**: new `sound-curator` edge function modeled on `signal-resolver` (lease, daily USD cap from `control_registry`, batch not streaming). It proposes CC-licensed clips for the top uncovered tags into `grounding_queue` as `proposed`, one row per clip with its license recorded. Nothing is auto-approved.
5. **Refresh model**: re-runs `semantic-backfill` against the active pack and flips `embedding_bridges.is_active`, with one-click revert to the previous pack (versioned, so reverting is safe).

## Technical notes

- Migration: `grounding_assets (id, taxonomy_code, taxonomy_node_id, source_url, storage_path, license, attribution, status, embedded_at, created_at)`, `grounding_queue (id, taxonomy_code, source_url, proposed_by, license, attribution, status, notes, review_by, reviewed_at, created_at)`, `embedding_bridges` new columns, private `grounding` bucket + storage policies. GRANTs on every new public table (`authenticated` read where policies allow, `service_role` full); RLS admin-only via `has_role(auth.uid(),'admin')`.
- Coverage function: `public.grounding_coverage()` (security definer, admin-gated) returning `branch, observed_tags, observed_weight, grounded_tags, grounded_weight` plus a companion `grounding_gaps(limit)` returning the top uncovered codes by volume.
- Control Room knobs (category `grounding`): `grounding.curator_daily_usd_cap`, `grounding.curator_batch_size`, `grounding.autocurate_enabled`, `grounding.min_clip_seconds`.
- New files stay under the 500-line ceiling: `src/pages/admin/AdminSoundLibrary.tsx` composing `SoundLibraryCoverage.tsx`, `GroundingQueuePanel.tsx`, `PackStatusCard.tsx`, plus `SourcesLicenses.tsx`; hook `useSoundLibrary.ts`.
- `sound-curator` reuses the resolver's lease/budget/pause plumbing (`job_worker_state`, `control.ts`) and the AI Gateway error semantics: `402`/`403` park the job, `429` backs off.
- Vitest coverage: coverage math, grounding-level derivation, curator budget cap, and admin RBAC on the new route/function.
