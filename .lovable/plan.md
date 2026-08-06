# SonicSIM ↔ Intuizi Data Architecture (10K users/month)

Deliverable: a visual, digestible architecture spec for moving Intuizi console audiences and taxonomy reports into the Sonic Assignment Machine, plus a clear callout of which taxonomy fields actually feed the semantic engine.

## What gets produced

1. **Mermaid architecture diagram** (`/mnt/documents/SonicSIM_Intuizi_Architecture.mmd`) — end-to-end flow: Intuizi console → S3 delivery bucket → EC2 ingest worker → Lovable Cloud (backend) → ontology scoring → fingerprints/network UI, with the monthly 10K-user activation loop drawn as a closed cycle.
2. **Signal-relevance diagram** (`/mnt/documents/SonicSIM_Intuizi_Signal_Value.mmd`) — the four taxonomies (CTV, Web, Apps, Visitation) with high-value fields visually highlighted vs. fields carried as metadata only.
3. **One-page architecture PDF** (`/mnt/documents/SonicSIM_Intuizi_Architecture.pdf`) — design-forward summary page: the flow, the 10K/month cadence math, the field-priority table, and the continuous-learning loop. QA'd page-by-page before delivery.
4. **Markdown runbook** (`/mnt/documents/SonicSIM_Intuizi_Integration.md`) — the written outline: bucket policy/access model, file cadence, join keys, batch sizing, backfill and error handling.

No app code changes in this plan. If you want this as an in-app admin page instead of downloadable artifacts, say so and I'll fold it in.

## Architecture outline (what the diagrams will say)

**Delivery layer.** Intuizi writes reports to a dedicated AWS S3 bucket you own (`sonicsim-intuizi-inbound`), prefixed by report type and date: `ctv/dt=YYYY-MM-DD/`, `web/…`, `apps/…`, `visitation/…`. Intuizi's service identity gets read+write on that prefix only; SonicSIM reads with a separate least-privilege role. GCP is the alternative path per the integration guide, but S3 matches your existing EC2 footprint.

**Ingest layer (existing EC2).** The EC2 box already fronted by `aws-proxy` gains an ingest role: poll/notify on new S3 objects, normalize CSV/gz/Parquet into a canonical row shape, dedupe by `primary_identifier` + day, and hand batches to the backend. Reuses the queue + worker pattern already in place for Librosa (`analysis_jobs`, `librosa-worker`).

**Backend layer (Lovable Cloud).** New tables for cohort membership and per-identifier signal rollups, tags resolved into the existing `taxonomy_nodes` / `audio_source_tags` structures, and scores flowing through the existing `ctv-ingest` → `analyze-audio` → `category_calibration` path so CTV/web/app signals earn the same six-category ontology output as Spotify/Apple sources.

**Activation loop.** SonicSIM writes back a semantic segment file (identifier + dominant ontology category + score vector) to an `outbound/` prefix on the same bucket, which Intuizi's console re-activates — closing the learn/activate cycle without depending on the source to call back.

**10K users/month sizing.** Drawn on the diagram: ~10K identifiers/month ≈ 2.5K/week batches, one nightly file per report type, embedding + scoring cost bounded by the existing cache (`librosa_cache`, `profile_embedding` kNN warm-start) so repeat identifiers and repeat content cost near zero.

## Signal relevance — what gets visually highlighted

**High value (direct model input):**
- CTV: `contentgenre`, `contenttype`, `channelname`, `iab_cats` — these are the closest analogues to musical genre/mood and drive ontology priors directly.
- Web: `iab_codes`, `domain` — content affinity, strong signal for Cognitive/Contextual categories.
- Apps: `CategoryName`, `TaxonomyName`, `Signals` — app-category affinity plus intensity weighting.
- Visitation: `brandName`, `d_utc` timestamp — real-world context and daypart, feeding the Contextual and Social categories.

**Medium value (weighting/normalization):** `signals` volumes, `ctv_taxonomy` device ID (screen context), `useragent` device class, `distance` from POI centroid as a confidence weight.

**Low value / plumbing only:** `primary_identifier`, `ip`, `eid` (join keys, never features), `provider`, `country`, lat/long precision fields, `page`, `ref`.

## Technical notes

- Join key across all four reports is `primary_identifier` (EID/MAID/hashed IP/HEM). Visitation uses `eid` — mapped to the same canonical column at normalization time.
- Taxonomy codes become `taxonomy_nodes` rows with embeddings, so IAB and CTV codes participate in the existing kNN warm-start and Bayesian `category_calibration` updates.
- Files may arrive as CSV, gzipped CSV, or Parquet — the normalizer handles all three.
- Access control follows the Intuizi guide: bucket-policy grant scoped to the specific bucket, key rotation, access logging enabled.
