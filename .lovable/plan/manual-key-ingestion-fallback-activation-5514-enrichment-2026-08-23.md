# Manual-key ingestion fallback + activation 5514 enrichment

## What I verified first

- The 5514 delivery ingested cleanly as a file: `…activation_id5514.parquet`, status `done`, 4,598 of 4,598 rows processed, 0 failures.
- But those 4,598 rows are a **device roster only**. Every identifier row from that file carries `scope: "roster"` and an **empty tag list** — the parquet holds join keys (MAID/HEM), no taxonomy columns (`contentgenre`, `channelname`, `iab_cats`, `CategoryName`, `TaxonomyName`).
- Across the whole database: 5,090 identifiers, **1** with taxonomy tags, 492 linked to an audio source, and the taxonomy tree has **1** node total. So the semantic layer has essentially nothing to score for 5514 yet.
- The levers themselves are live and configured: speech normalization rows exist for `global` (off), `ctv` (bias 0.40), `intuizi` (bias 0.65), and the ingest worker already loads normalization + calibration priors per scope.

Conclusion: 5514 is **matched** (identifiers registered and joinable) but not yet **measured or enriched** — not a pipeline bug, a missing companion report. The plan covers both the ingestion fallback you asked for and closing that enrichment gap.

## Part 1 — Backup ingestion when `s3:ListBucket` isn't available

The worker already accepts an explicit `object_key` and skips discovery entirely, so the whole fallback works on `s3:GetObject` alone. What's missing is a way for you to use it without curl.

Add to the Integration Status / ingestion admin area a **"Ingest by key"** card:

- Textarea accepting one or more S3 keys (or full `s3://bucket/key` URIs, parsed down to the key), one per line.
- Optional report-type dropdown per batch (`ctv`, `apps`, `visitation`, `demographics`, `origin`, or auto-infer from the filename) for cases where the name doesn't reveal it.
- "Validate" pass: `headObject` on each key first, so a typo or a permission problem shows as a clear row-level error before any work starts.
- "Ingest" runs the keys sequentially through the existing `object_key` path, streaming per-key results (rows read, identifiers scored, roster-only warning, errors) into the same ledger view you already use.
- Roster-only detection surfaced explicitly: when a file yields identifiers but zero tags, the result row says "roster only — no taxonomy columns; semantic scoring skipped" instead of looking like a silent success.

Two supporting additions:

- **Manifest support.** If Intuizi drops (or you paste) a small `manifest.json`/`.txt` listing the delivery's object keys, point the ingest-by-key card at that manifest key and it expands to the full file list. This gives you discovery-like behavior with `GetObject` only.
- **Prefix probe.** A "test access" button that reports, per configured prefix, whether `ListBucket` currently works — so you always know which mode you're in rather than guessing from an AccessDenied string.

### Your workflow, once this exists

1. Intuizi tells you a delivery landed (or you see it in the AWS console).
2. Copy the object key(s) from the console.
3. Admin → Integration Status → Ingest by key → paste → Validate → Ingest.
4. Post-Ingestion Wizard picks the activation up from the ledger for the semantic stages.

No IAM change required. If you later get `ListBucket` on the prefix, auto-discovery resumes with no code change and the manual card stays as the override.

## Part 2 — Making 5514 measurable and enriched

To score 5514 through the ontology, one of these has to happen:

- **Preferred: ingest 5514's companion taxonomy report.** Per the Intuizi taxonomy guides, the CTV report carries `contentgenre`, `contenttype`, `channelname`, `iab_cats`; the apps report carries `CategoryName`, `TaxonomyName`, `Signals`. Any of those files for activation 5514, ingested by key, joins to the already-registered 4,598 identifiers on `primary_identifier` and immediately produces taxonomy nodes, tag weights, calibration priors, and six-category scores. The roster is exactly the right substrate for that join — nothing is wasted.
- **If only a roster ever arrives for 5514**, it can still contribute at the cohort level (population counts, overlap with other activations, sub-clustering) but it cannot carry a semantic fingerprint. The wizard should say so rather than showing an empty analysis.

Additions so the state is legible and the levers demonstrably apply:

- **Activation readiness badge** in the wizard: `roster only` / `taxonomy present` / `scored`, with identifier counts and tag counts, so 5514's status is unambiguous at a glance.
- **Enrichment coverage row**: identifiers with tags vs. total, per activation.
- **Normalization provenance**: show which normalization scope was applied to a scored activation (`intuizi` at 0.65 for these feeds) and the per-category deltas it produced, so you can see the speech-skew correction actually firing on the CTV/spoken-word-heavy signals rather than trusting the setting.
- **Backfill action**: after a companion taxonomy file lands, a "re-score activation" button walks the activation's existing identifiers in bounded batches (the worker's per-run identifier budget is 40, so a 4,598-identifier activation needs repeated runs — the button loops with progress instead of you clicking 115 times).

## Technical notes

- No IAM/policy work is required for Part 1; `s3:GetObject` on the delivery prefix is sufficient. `HeadObject` uses the same permission.
- `intuizi-ingest` already branches on `body.object_key` and infers `report_type` via `reportTypeFromKey`, falling back to an explicit `report_type` — the new UI drives that existing contract, no new backend action needed beyond a `validate` mode and multi-key batching.
- The roster path is `isRosterRow` in `_shared/intuizi.ts`; the "roster only" warnings key off the same predicate so UI and worker can't disagree.
- Re-scoring reuses the existing lease + ledger, so parallel clicks can't double-process a file.
