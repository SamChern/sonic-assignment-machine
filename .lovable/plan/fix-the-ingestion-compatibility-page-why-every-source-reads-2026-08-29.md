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

---

# Part 2 — Ground the ontology in real audio (AudioSet / FSD50K / VGGSound / MTG-Jamendo / WavCaps)

You're right, and the database confirms it. What exists today:

- `taxonomy_nodes` holds 632 `aset.*` AudioSet classes, and all 632 have an `audio_embedding`
  — but **every one of those vectors came from `semantic-backfill`, which sends the node's
  label path to CLAP's *text* encoder**. Zero of them were produced from a sound file.
  `aset_with_text_emb = 0`, `aset_with_audio_emb = 632`: the "audio" column is text vectors
  stored in the audio slot.
- The semantic service on EC2 *does* expose `POST /embed_audio` (real CLAP audio encoder), and
  `_shared/inference.ts` calls it — but only for an audio source that already carries a
  playable URL (uploads, Spotify/Apple previews). Intuizi identifiers have no audio URL, so
  that path never fires for console signals.
- There is **no clip corpus in the database at all** — no table holds AudioSet, FSD50K,
  VGGSound, MTG-Jamendo or WavCaps clips, captions, or their embeddings. Nothing was ever
  downloaded or paired with taxonomy tags.

So Intuizi taxonomy tags are today compared against *text descriptions of sounds*, not sounds.
That is exactly the weak link you're pointing at.

## The fix: a clip corpus that anchors every taxonomy node in real sound

```text
corpus manifests            EC2 corpus worker (CPU, batched)         Postgres
FSD50K      ──┐             download clip → CLAP /embed_audio ──►  audio_corpus_clips
VGGSound    ──┤   labels    (16 kHz mono, 10 s window, cached)     audio_corpus_embeddings
MTG-Jamendo ──┤   +captions                                        taxonomy_node_exemplars
WavCaps     ──┘                          │                                │
AudioSet ontology (already imported) ◄───┴── mid/tag crosswalk ────► taxonomy_nodes
                                                                    .audio_embedding = mean of
                                                                     grounded clips (real audio)
```

1. **Corpus tables.** `audio_corpus_clips` (corpus, external id, source URL, license, duration,
   split, caption, label codes) and `audio_corpus_embeddings` (clip, model, `vector(512)`), plus
   `taxonomy_node_exemplars` (node → clip, similarity, rank). New `taxonomy_nodes` columns
   `audio_embedding_source` (`'audio' | 'text'`) and `grounded_clip_count` make the difference
   auditable per node. All service-role/admin only, with GRANTs written in the same migration.
2. **Manifest import.** A `corpus-import` edge function ingests each corpus's public label
   manifest (FSD50K `dev/eval` ground truth, VGGSound csv, MTG-Jamendo autotagging TSV, WavCaps
   caption json) and maps native labels onto AudioSet mids, then onto our `aset.*` codes via the
   existing crosswalk. AudioSet's own clips are YouTube-hosted and not redistributable, so
   AudioSet contributes the ontology (already in place) while FSD50K/VGGSound/Jamendo supply the
   actual sound for those classes — that is the standard practice and it needs no scraping.
3. **EC2 corpus worker** (`deploy/corpus-worker/`, same service pattern as `ingest-worker`):
   claims batches of unembedded clips, streams each file, calls `semantic-svc /embed_audio`,
   writes the 512-d vector, retries and rate-limits itself. CPU-only and off-peak — no GPU, in
   line with the box's capacity.
4. **Re-ground the taxonomy.** `semantic-backfill` gains an `audio` mode: a node's
   `audio_embedding` becomes the L2-normalized mean of its grounded clip vectors (min clip count
   from the Control Room), `audio_embedding_source = 'audio'`. CLAP text stays as an explicit
   fallback for nodes no corpus covers, and is labelled as such instead of masquerading as audio.
5. **Wire it into Intuizi scoring.** In `intuizi-score-worker` / `analyze-audio`, an identifier's
   normalized tags resolve to nodes, and each node now yields (a) an audio-grounded anchor vector
   and (b) its top exemplar clips with WavCaps-style captions. Those captions and the nearest
   grounded neighbours become the few-shot exemplars in the scorer prompt — so "CTV genre:
   documentary + web topic: cycling" is scored against how those sounds actually behave, not
   against their names. The identifier's weighted mean anchor vector is stored as
   `audio_sources.profile_embedding`, putting cohorts, kNN and Predict in real CLAP audio space.
6. **Control Room knobs** (no hard-coded values): per-corpus weight, minimum clips per node,
   whether text fallback is allowed, exemplar count per node, and the audio-window length.
7. **Admin visibility.** A "Corpus grounding" panel on the SonicSIM Analysis Results page shows
   clips per corpus, percent of nodes audio-grounded, coverage by ontology branch, and worker
   throughput — plus a per-analysis badge stating whether its anchors were audio- or text-grounded.

## Verification for Part 2

- Corpus tables populated and `grounded_clip_count > 0` for the AudioSet branches the Intuizi
  feeds actually hit; report percent of nodes still text-only.
- Re-score one previously ingested activation and diff the six category scores text-grounded vs
  audio-grounded, with the exemplar captions shown for review.
- `/embed_audio` latency and failure rate recorded in `semantic_call_log`.

## Out of scope

Any change to Intuizi taxonomy expectations or column mappings for POI, demographics,
marketing audience, CTV, app or web reports. Part 2 adds grounding beneath those tags; it does
not change which tags a delivery produces.

