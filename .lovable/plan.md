# Fix the Ingestion Compatibility page: why every source reads "blocking" or "mismatched"

I traced the harness (`ingestion-compatibility`), its shared helpers, the live edge-function
logs from today's runs, the stored integration credentials, and the configured secrets. Four
distinct causes, only one of which is the taxonomy issue you want left alone.

## What the evidence shows

Today's runs sampled the same three Parquet deliveries every time (logs, 14:44–14:46 UTC):

```text
file A  ctv     columns: primary_identifier, ip, ctv_taxonomy, contenttype,
                         contentgenre, channelname, iab_cats, country, provider, date_utc
file B  web     columns: primary_identifier, domain, page, ref, useragent,
                         country, iab_codes, signals, day, provider
file C  demos   columns: EID, Gender, MaritalStatus, AnnualIncome, Age, Visits
```

### Cause 1 — the harness checks a stale copy of the column aliases (harness bug)

The page's "Ontology feature columns" check uses its own `EXPECTED_FIELDS` list, which has
drifted from what `normalizeRow()` actually reads. For file B the normalizer happily maps
`domain` as the channel and `iab_codes` as IAB categories (and derives `web.topic.*` /
`web.referrer.*` from `page`/`ref`), but the harness's alias list omits `domain`, `site`,
`iab_codes` and `iabcodes` — so a delivery that normalizes fine is reported as 0/4 groups
matched, i.e. **Blocking**. Web reports also resolve to the `ctv` report type, so they are
graded against CTV-only expectations (`contentgenre`, `contenttype`) they will never have.

### Cause 2 — service probes read the wrong place for credentials (harness bug)

`ingestion-compatibility` resolves every service from environment secrets, but the rest of
the app stores these in the `integration_credentials` table. Confirmed contents there:
`librosa_rest` (URL + token) and `semantic_svc` (URL + token) are both configured — yet
`LIBROSA_REST_URL` does not exist as a secret, so the Librosa REST source is permanently
"Not applicable", and the semantic service is not a source on the page at all.

### Cause 3 — probe paths and required-key lists don't match the real services

The harness hard-codes one health path per feed. The real routes differ per service
(`/api/health` for the EC2 analysis API, `/health` for Librosa REST, `/healthz` for the
semantic service, `/v1/models` for an OpenAI-style inference server). It also requires
`EC2_INFERENCE_MODEL`, which is not set, so the EC2 inference source reports **Mismatch**
on credentials and then **Blocking** on a `/v1/models` probe the box cannot satisfy — that
machine has no GPU and runs no chat LLM by design, so this source can never go green.

### Cause 4 — genuine provider taxonomy gaps (left alone, as you asked)

File C's real columns (`Gender`, `MaritalStatus`, `AnnualIncome`) are not recognized by the
normalizer either, so demographics legitimately yields little. Same class of gap for POI /
marketing-audience deliveries. **No changes here.** These will be re-labelled as an explicit
"provider schema gap" finding instead of a generic blocking failure, so they stop masking the
real harness defects, and nothing about the mapping is touched.

## What I'll change

1. **Single source of truth for aliases.** Export the per-report-type alias groups from
   `supabase/functions/_shared/intuizi.ts` (the same lists `normalizeRow` reads) and have the
   harness import them, deleting its private `EXPECTED_FIELDS`. Drift becomes impossible.
2. **Grade by outcome, not by guesswork.** The feature-columns check becomes advisory
   (`warn` at worst) and the authoritative signal becomes the normalization yield already
   computed from real sampled rows. A delivery that produces tags can no longer be "Blocking".
3. **Web-report awareness.** When a key resolves to `ctv` but the columns are web-shaped
   (`domain`/`page`/`ref`/`iab_codes`), grade it against the web alias set and label it
   "web report (mapped via ctv)" instead of failing CTV-only expectations.
4. **Credential resolution parity.** Probes read `integration_credentials` first, then fall
   back to env secrets; add the semantic service as its own source; use the correct health
   path per service.
5. **Right severity for the inference source.** EC2 inference becomes an optional,
   informational source (skip when unconfigured, `warn` at worst) with copy stating that
   Lovable AI is the sanctioned path — consistent with the no-GPU EC2 posture.
6. **Provider-gap findings.** Unmapped provider columns report as a distinct
   "provider schema gap" finding with the observed column names, status `warn`, and no
   suggested code change.
7. **Page polish.** Two small front-end fixes in `src/pages/IngestionCompatibility.tsx`:
   scoped runs stop clobbering another feed's results during merge (object-store config
   checks are shared by two scopes), and each source card shows which credential store
   answered.

## Verification

- Re-run all five sources and the parallel run from the page; expect file A green, file B
  green/advisory, file C a single "provider schema gap" warning, Librosa REST and the
  semantic service probing live, EC2 inference informational.
- Add Deno tests asserting the exported alias groups match `normalizeRow` behaviour for the
  three real column sets above, so this can't regress.

## Out of scope

Any change to Intuizi taxonomy expectations or column mappings for POI, demographics,
marketing audience, CTV, app or web reports.
