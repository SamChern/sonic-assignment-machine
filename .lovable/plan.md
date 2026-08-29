# Step 4 — Context-aware scorer: close the gaps and verify

The three Step 4 behaviours are already in the code (confirmed by reading `analyze-audio` and its shared helpers): grounded-vector preference, per-neighbour exemplars written to `source_analyses.context_neighbors`, and a tag-only path that skips librosa. What is missing is the part that makes them actually fire in production, plus the verification the step asks for.

## What the current state actually is

- `analyze-audio` marks a subject `tag_only` when it has taxonomy context and no file URL, and excludes those subjects from the librosa and provider tiers.
- Neighbour exemplars (`{similarity, six_scores, top_tags}`) are built and stored: 42 of 2,159 analyses have a non-empty `context_neighbors` array (only rows scored since the column landed).
- Vector preference picks a node's grounded `audio_embedding` first, then the text `embedding`.
- Two things stop the grounded path from ever being taken today: no taxonomy node has `grounding_count > 0` yet, and the two vector spaces have different widths — 1,261 nodes carry a 512-d `audio_embedding` while 925 carry a 1,536-d text `embedding`.
- Because of the width difference, a tag-only subject built from grounded nodes produces a 512-d vector, and the kNN exemplar lookup is gated on `length === 1536`, so those subjects get no exemplars. There are no active rows in `embedding_bridges`, so nothing bridges 512 to 1,536 yet.
- 2,459 audio sources are tag-only (no file URL but tagged), so this is the dominant shape of subject, not an edge case.

## What to build

### 1. Bridge the grounded space into the catalog space
Add a bridge step so a 512-d subject vector can be compared against the 1,536-d catalog:

- Resolve the active bridge from `embedding_bridges`; when one exists, project via the `bridge` action of `semantic-embed`.
- When no bridge is available, fall back to deterministic zero-padding to 1,536 (the padding convention already used elsewhere in the project) so kNN still returns neighbours instead of silently returning none.
- Record which route was used (`bridge` / `pad` / `native`) in the evidence log and in the exemplar context text, so scoring stays auditable.

### 2. Mixed-space tag subjects
When a subject's tags span both spaces, build the subject vector in the space that carries the most weight, bridge it once, and keep the discarded-tag count visible in the prompt context instead of dropping it silently.

### 3. Verification harness (admin-triggered, read-mostly)
A small `scoring-regression` routine plus an admin card that:

- Picks a fixed, deterministic set of 50 already-analyzed sources (stable ordering, so re-runs compare like with like).
- Re-scores them through `analyze-audio` with caching bypassed and diffs the six axes against the stored analysis.
- Reports mean absolute delta per axis and flags any axis drifting beyond the calibration tolerance.
- Runs one tag-only subject and asserts the response came back with `evidence` not equal to `librosa` and no librosa call in `librosa_call_log` for that subject.

Results land in the existing admin surface next to the semantic service card; nothing is written to `source_analyses` by the harness.

### 4. Tests
Extend the existing Deno tests for the shared context helpers (bridge selection, padding fallback, mixed-space weighting) and add a Vitest test for the new admin regression card, matching current `__tests__` patterns.

## Explicitly unchanged

The request/response contract of `analyze-audio` stays identical, so `intuizi-score-worker`, `enterprise-score-dataset`, and `librosa-worker` keep working untouched.

## Technical notes

- Files: `supabase/functions/_shared/context.ts` (bridge + mixed-space logic), `supabase/functions/analyze-audio/index.ts` (wire the bridge before the kNN gate), a new `supabase/functions/scoring-regression/index.ts`, a new admin card under `src/components/admin/`, plus `supabase/functions/_shared/context_test.ts`.
- The kNN width gate at the tag-only branch is the specific line that changes: bridge first, then call `match_audio_profiles`.
- The grounded branch stays dormant until the Step 3 taxonomy backfill and grounding refresh produce `grounding_count > 0`; the bridge work is what makes it useful the moment they do.
- Tolerance for the 50-source comparison is read from `control_registry` rather than hard-coded.
