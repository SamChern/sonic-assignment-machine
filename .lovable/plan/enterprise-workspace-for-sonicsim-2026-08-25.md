# Enterprise Workspace for SonicSIM

A licensed enterprise customer signs in and lands on their own workspace — their analyses, their uploaded data, their predictions — with the same semantic engine the admin console uses, but scoped so they never see another organization's data.

The first organization mirrors the SAM-Master account: that account becomes the owner of an org named "SAM-Master", and its existing analyses are attached to it so the new dashboard has real data on day one.

## Access model

- New concept: **organizations** with multi-seat membership (owner / analyst / viewer). One user can belong to one or more orgs.
- Analyses, uploaded datasets, prediction runs, and pixel events all carry an organization stamp. Access rules allow a member to see only their own org's rows; platform admins keep full visibility.
- A new sign-in destination `/workspace`. Members land there; admins keep the existing admin dashboard and can also open any workspace.

## The workspace dashboard

Sections, top to bottom:

1. **Recent analyses** — the same list, filters, sorting, details drawer and delete flow as the SonicSIM Analysis Results page, restricted to the org.
2. **Upload My Own Data**
   - Batch CSV upload (live in this build) with a documented schema shown on the page: `external_user_id`, optional `audio_url` / `source_name`, optional KPI columns, free-form attribute columns. Column mapping preview, row validation, then rows are queued for semantic scoring through the existing analysis job pipeline.
   - Cloud connections (scaffolded): GCP / GCS / BigQuery, AWS S3, Snowflake. Each shows required fields, saves credentials to the existing secure credentials store, and offers a connection test. Actual scheduled reads land in a later phase; the UI says so plainly.
3. **Dataset Discovery** — the homepage discovery pattern, but neighbors are **datasets** instead of people. Ranks other datasets (the org's own, plus opted-in shared/public ones) by 6-category fingerprint similarity, with shared-strength category, overlap count, and a "compare" action.
4. **Predict SonicSIM-Users** — pick source datasets, adjust or normalize the 6 category weights with sliders (reusing the existing normalization controls), then get ranked look-alike users from the org's own uploaded records. Results export as CSV, and to a connected cloud/CRM destination once that connection is live.
5. **Predict SonicSIM-Outcomes** — choose a KPI (site traffic, CPC, CTR, page views, VCR, time on site), attach KPI data (uploaded CSV or pixel events), and get a fitted relationship between the 6 semantic scores and that KPI: per-category influence, predicted value for a candidate dataset, and confidence based on sample size.

## Pixel and tag capture (live)

- Each org gets a SonicSIM tag id and a small hosted script that reports page views and named conversion events.
- A public collection endpoint accepts events keyed by tag id, validates them, and writes to a pixel-events table that feeds Predict SonicSIM-Outcomes.
- A **Tag setup** panel gives the copy-paste snippet plus the GTM walkthrough from your notes (Google tag base, conversion action tag with Conversion ID/Label, preview/validate, publish), and the equivalent notes for Meta and TikTok pixels so events from those platforms can be mapped as KPI sources.

## Build order

1. Organizations, memberships, access rules; seed the SAM-Master org and backfill its analyses.
2. `/workspace` shell, navigation, and Recent analyses.
3. CSV upload + schema doc + scoring queue; cloud connection forms.
4. Dataset Discovery.
5. Predict SonicSIM-Users.
6. Pixel tag, collection endpoint, tag setup panel.
7. Predict SonicSIM-Outcomes on pixel + uploaded KPI data.

## Technical notes

- New tables: `organizations`, `organization_members` (role enum), `enterprise_datasets`, `enterprise_records` (per-row uploaded users + KPI values), `dataset_connections` (cloud config, credentials referenced from `integration_credentials`), `prediction_runs`, `pixel_tags`, `pixel_events`. Every table gets grants plus org-scoped policies via a `has_org_access(uuid)` security-definer helper, mirroring the existing `has_role` pattern.
- `source_analyses`, `audio_sources` gain a nullable `organization_id`; existing policies stay intact and org policies are added alongside so nothing currently visible breaks.
- Look-alike matching reuses `fingerprintMath` + pgvector (`match_audio_profiles` pattern) so scoring code is shared, not duplicated.
- Outcome modeling: ridge-regularized least squares over the 6 normalized scores, computed in an edge function; small and deterministic, no external model needed.
- Pixel collection is a public edge function (`verify_jwt = false`) validating tag id + origin, rate-limited per tag, writing through the service role.
- CSV parsing happens client-side for preview and server-side for the authoritative insert.
- Enterprise pages reuse `SavedAnalysisDrawer`, `SpeechNormalizationPanel`, `IdentifierFilterBar`, and the existing list/search/sort patterns so the workspace feels identical to the admin analysis page.
