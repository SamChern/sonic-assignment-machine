# Step 5 — AudioSet ontology + crosswalk: close the coverage gap

Most of Step 5 already exists in the build: the AudioSet importer, the crosswalk proposal/approve engine, and the approve/undo controls inside the catalog tree. What's missing is full coverage, so the Step 5 verification gate does not pass yet.

## Current state (verified against the database)

- 632 `aset.*` nodes imported, all with an audio-space embedding. Hierarchy present.
- `iab.*`: 51 nodes — 40 have proposals and at least one approved mapping, **11 have none**. All 11 lack an audio-space embedding (they were created later by ingest and only ever got a text embedding), and the proposal job skips nodes without one.
- Several of those 11 carry placeholder labels like "IAB category IAB7", which would produce weak matches even once embedded.
- `app.cat.*`: 3 nodes, embedded, but zero proposals — the proposal job has not been run across that prefix.
- `ctv.*`: 833 nodes, 262 proposed, 65 approved (partial by design — manual review continues).
- No `poi.brand.*` nodes exist yet, so that prefix is a no-op today.

## What to build

1. **Label enrichment before embedding.** When a taxonomy node's label is a placeholder (`IAB category <code>` or a bare code), resolve a human label from the existing IAB label map and use that enriched text for embedding and matching. Persist the improved label so the tree reads properly.

2. **Text-embedding fallback in the proposal job.** If a node has no `audio_embedding`, bridge its 1536-d text embedding into the AudioSet 512-d space (same bridge path Step 4 uses) and propose from that. Mark those proposals with a `via: "text_bridge"` flag so reviewers can see the evidence is weaker.

3. **Backfill sweep.** Extend the crosswalk function with a `backfill` action that walks every eligible prefix (`iab.*`, `ctv.genre.*`, `app.cat.*`, `poi.brand.*`) in batches, embedding what is missing (through the existing semantic embed path) and proposing top-3 matches for anything with no proposals. Returns per-prefix counts.

4. **Coverage gate surfaced in the UI.** In the crosswalk panel, add a compact "Step 5 gate" readout: number of `iab.*` nodes used by ingest that have at least one approved mapping, versus total, with a "Backfill + propose" button and a filter to jump straight to the unmapped ones for approval.

5. **Run it.** Trigger the backfill, then approve the 11 outstanding `iab.*` nodes (auto-approve above the configured cosine threshold, manual review for the rest) and confirm the gate reads 51/51.

## Technical notes

- Edge functions touched: `taxonomy-crosswalk` (new `backfill` action, text-bridge fallback), `_shared/audioset.ts` (proposal metadata `via`), `_shared/iabLabels.ts` (label resolution helper). The importer needs no change.
- No schema migration required — `taxonomy_nodes.crosswalk` jsonb already holds matches plus approval flags.
- Embedding calls reuse `semantic-embed`; batched to stay inside the function time budget, resumable so repeated calls make progress.
- UI: `AudioSetCrosswalkPanel.tsx` gains the gate strip and unmapped filter; `IntuiziCatalogTree.tsx` keeps its existing approve/undo control (shows a "text-bridged" hint on those proposals).
- Tests: Deno unit tests for label enrichment, bridge fallback selection, and the coverage calculation, mirroring existing `__tests__` patterns.

## Verify

- Every `iab.*` node referenced by `intuizi-ingest` has ≥1 approved crosswalk entry (gate reads 51/51).
- `app.cat.*` nodes each have top-3 proposals awaiting or holding approval.
- Re-running backfill is a no-op (idempotent), and existing approvals are never overwritten.
