# Intuizi → SonicSIM ingestion (S3, backend-only)

## What the endpoint doc actually establishes

Intuizi's Activation Endpoints doc has no pull API for audience delivery. Endpoint ID 1 (AWS) delivers files into an S3 bucket you own, using three fields you give Intuizi in their console: **Bucket Name**, **Access Key**, **Secret Access Key**. So ingestion is one-directional and file-driven: Intuizi pushes to S3, SonicSIM reads from S3.

Important consequence: the EC2 PEM/SSH key plays no role in this path. SSH is for operating your box, not for moving Intuizi data. Since the ingest runner lives in the backend (your choice), the EC2 instance is not in the ingest loop at all — the backend reads S3 directly.

## The flow

```text
Intuizi console (audience activation, ~10K/mo)
        │  writes files (CSV / .gz / Parquet)
        ▼
S3 bucket you own: sonicsim-intuizi-inbound
   ctv/dt=YYYY-MM-DD/…   apps/dt=…/…
   visitation/dt=…/…     demographics/dt=…/…   origin/dt=…/…
        │  list + fetch (read-only credentials)
        ▼
intuizi-ingest  (new scheduled backend function)
   list new keys → claim lock → fetch → normalize rows →
   dedupe on primary_identifier + report + day
        ▼
existing ctv-ingest logic
   audio_sources → taxonomy_nodes (+ embeddings) →
   analyze-audio → source_analyses → category_calibration
        ▼
fingerprints / network UI  +  Integration Status page
```

## What gets built

**1. S3 access.** Connect an AWS S3 connection (read scope) pointed at the inbound bucket, so the backend lists and downloads through the managed gateway rather than holding raw AWS keys in app code. The write credentials you hand Intuizi stay separate and are created in AWS by you — the plan documents the least-privilege IAM policy for both sides.

**2. `intuizi_ingest_files` table.** One row per S3 object: key, report type, partition date, size, etag, status (`discovered` / `processing` / `done` / `failed`), row counts, error text, timestamps. This is the idempotency ledger — a re-run skips objects already `done`.

**3. `intuizi_identifiers` table.** Per-identifier rollup keyed on `primary_identifier`, holding the signal payload from each report type as jsonb plus a resolved tag list. This is what lets one person's CTV + apps + visitation + demographics + origin rows collapse into one fingerprint.

**4. `intuizi-ingest` function** (scheduled via pg_cron, hourly). Bounded and safe per the background-job rules:
- single-flight lease row, so overlapping runs exit
- fixed cap per run (e.g. 5 files / 500 rows), remainder waits for the next tick
- progress marked per file and per row in the same step that processes it
- circuit breaker: pause on credit/permission denials, park on repeated rate limits, guard checks paused state at entry

Per report type it maps the fields that matter and drops the plumbing:

| Report | Fields promoted into tags/signals | Carried as metadata only |
|---|---|---|
| CTV | contentgenre, contenttype, channelname, iab_cats | device id, useragent |
| Apps | CategoryName, TaxonomyName, Signals | bundle id, platform |
| Visitation | brandName, visit timestamp/daypart, distance (as confidence weight) | lat/long precision, POI id |
| Demographics | age band, income band, household composition | raw segment codes |
| Origin | home/work geo class, travel context | exact coordinates |

Every promoted field becomes a `taxonomy_nodes` row (code + label + embedding) and an `audio_source_tags` link, so Intuizi signals participate in the existing kNN warm-start and Bayesian `category_calibration` priors exactly like Spotify/Apple sources.

**5. Admin UI.** A new "Intuizi" section on the existing `/admin/pipeline` (Integration Status) page: file ledger with per-file drill-down (key, rows, errors), last successful run, paused/parked state with a resume control, and a "run now" trigger. Plus a manual "process a single S3 key" input for backfills and testing.

**6. Runbook.** Written to the repo: the exact three values to paste into Intuizi's console, the IAM policy for Intuizi's writer and SonicSIM's reader, prefix layout, cadence, and backfill procedure.

## Out of scope for now

Outbound/activation write-back (semantic segments returned to Intuizi) is deliberately excluded — inbound only, per your answer.

## Technical notes

- `primary_identifier` is the join key across all reports; visitation's `eid` is normalized onto it. It is never a model feature.
- Normalizer handles CSV, gzipped CSV, and Parquet; oversized objects are split into row batches across runs rather than loaded whole, since the backend function has bounded memory.
- Identifier-level rows are pseudonymous, never surfaced in public UI; the tables are admin-read-only under RLS with grants limited to `authenticated` (admin policy) and `service_role`.
