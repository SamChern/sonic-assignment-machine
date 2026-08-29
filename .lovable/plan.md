# Step 1 — Schema migration: already in place, plus one gap to close

I checked the live database against the Step 1 SQL before writing this. Every object Step 1 asks for already exists, so there is no new migration to author for the structure itself.

## What is already there (verified)

- `taxonomy_nodes.audio_embedding` exists as `vector(512)`; the original `embedding` is untouched at `vector(1536)`.
- `taxonomy_nodes.grounding_count` (integer) and `crosswalk` (jsonb) exist.
- The HNSW cosine index `taxonomy_nodes_audio_embedding_idx` exists on the new vector.
- `embedding_bridges` exists with `name`, `from_dim`, `to_dim`, `weights_url`, `eval_agreement`, `is_active`.
- `sonic_cohorts` exists with `slug`, `name`, `description`, `centroid`, `member_count`, `narrative`, and `export_eligible` as a stored generated column on the `member_count >= 1000` floor.
- `sonic_cohort_members` exists keyed by `cohort_id` + `subject_key` (plus a `holdout` flag added later for the Step 11 lift loop).
- Row Level Security is enabled on all three new tables. `sonic_cohort_members` has no policies at all, so `subject_key` is unreachable from any client role — exactly the intended service-role-only posture.

## The one gap

`embedding_bridges` and `sonic_cohorts` each have an admin-read policy, but neither table has table-level privileges granted to the `authenticated` or `service_role` roles. On this backend a policy without a matching grant still returns a permission error, so admin reads of those two tables would fail if anything queried them directly today. Cohort reads currently go through the `org_cohort_aggregates` security-definer function, which is why nothing has broken yet.

Fix in one small additive migration:

- Grant read on `embedding_bridges` and `sonic_cohorts` to `authenticated` (the admin-read policies then gate the rows).
- Grant full privileges on `embedding_bridges`, `sonic_cohorts`, and `sonic_cohort_members` to `service_role`, so the cohort builder, activation export, and corpus grounding workers keep writing under their own role rather than relying on privilege leakage.

No columns, types, policies, or indexes are changed. `sonic_cohort_members` stays policy-free, so the grant does not expose it to client roles.

## Verify

- Re-read the grants for the three tables and confirm the new rows appear.
- Confirm an admin-session read of `sonic_cohorts` returns rows instead of a permission error.
- Confirm `analyze-audio` and `intuizi-score-worker` still run unchanged — neither touches these tables on its hot path.

## Then

Say the word for Step 2 and I will treat it as EC2 runbook work the same way the existing `deploy/librosa-mcp` and `deploy/semantic-svc` directories are structured, rather than as app code.
