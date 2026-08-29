# Step 6 — Cohorts + Activation files: closing the gaps

Most of Step 6 already exists and was verified in the codebase:

- `cohort-builder` clusters Intuizi subject embeddings (k-means, `k` from `control_registry` `cohort.k`) under the same `acquire_intuizi_lease` / `release_intuizi_lease` single-flight pattern as `intuizi-score-worker`, and upserts `sonic_cohorts` + `sonic_cohort_members`.
- `activation-export` refuses non-eligible cohorts (409, 1,000-member floor), gzips one uppercase 32-hex EID per row, writes to `outbound/activation/dt=YYYY-MM-DD/cohort=<slug>/part-000.csv.gz`, withholds holdout members, and logs every attempt to `sonic_cohort_exports`.
- `ServerCohortPanel` shows cohorts, member counts, eligibility badges and recent export history, and never renders subject keys or EIDs.

Four things are genuinely outstanding.

## 1. Nightly schedule

`cron.job` currently holds only the retention, custody, telemetry and librosa-drain jobs — there is no nightly cohort build. Add a `cohort-builder-nightly` job at `35 3 * * *` (after the 03:15 retention purge and 03:45 custody scan so it clusters post-purge data) that POSTs to the function with `{"source":"cron"}`. The function's lease check already makes an overlapping tick a no-op.

## 2. Record activation runs against the org

`activation-export` only touches `org_intuizi_activations` when the caller passes both `organization_id` and `activation_id`. Instead, when they are omitted, resolve the grants itself: look up active `org_intuizi_activations` rows for the org(s) that the cohort's exported subjects belong to, and stamp `last_synced_at` plus a `last_export_object_key` / `last_export_row_count` on each matched grant row. Exports with no grant still succeed and still land in `sonic_cohort_exports` — they just report `activations_recorded: 0`.

## 3. Surface it in `SignalCohortPanel`

The step calls for the cohort list, counts, export status and last activation timestamp to live in `SignalCohortPanel`. Render `ServerCohortPanel` as a labelled "Server-side cohorts & Activation files" section inside `SignalCohortPanel` (the identifier-level sub-clustering stays above it), and add a per-cohort "Last activation" line driven by the newest succeeded export for that slug. No EIDs and no subject keys enter the browser — the panel reads only `sonic_cohorts` and `sonic_cohort_exports`, both of which are aggregate-only.

## 4. Verification harness

Add `src/test/activationExport.test.ts` covering the step's stated acceptance criteria against the shared helpers and a mocked function surface:

- a cohort under 1,000 members is refused with a 409 and no S3 write is attempted;
- an eligible cohort produces a gzip whose decompressed body is newline-delimited rows each matching `/^[0-9A-F]{32}$/`, with no header row, no blank trailing rows beyond the final newline, and no duplicates;
- the object key matches `outbound/activation/dt=YYYY-MM-DD/cohort=<slug>/part-000.csv.gz`;
- holdout members are absent from the file;
- the panel renders counts and statuses but never a subject key.

## Technical notes

- The S3 write stays on `_shared/s3.ts` `putObject` (SigV4 / signed-URL PUT). `aws-proxy` allows only GET and POST, so it cannot carry the gzip PUT; routing the export through it would mean widening that proxy's method allowlist, which is a bigger security surface than the existing signed-put path. Calling this out because the step text names `aws-proxy`.
- The cron job is created with `run_sql` (it embeds project-specific URL and key), not a migration.
- Grant-stamping columns on `org_intuizi_activations` go in a migration with the usual RLS/GRANT review; no new client-readable identifier columns.
- `audio_profile_embeddings` is empty today, so the builder will resolve all 5,636 linked identifiers through the `audio_sources.profile_embedding` fallback — expected, and the cohorts it produces are large enough to exercise both the eligible and non-eligible export paths.
