

# Implement 3 Quick Wins for Smarter Fingerprints

This plan adds three layered enhancements to the fingerprint system: **Confidence-Based Weighting**, **Temporal Fingerprints** (recent vs all-time), and **Collaborative Filtering** (taste neighbors / "users like you").

---

## 1. Confidence-Based Weighting

**Goal:** Fingerprints currently treat every analyzed source equally. A user with 3 songs has the same "weight" per category as one with 50. We weight averages by how confident the AI was and how many sources contributed.

**What changes**
- Add a `confidence` numeric column (0-1) to `source_analyses`, populated by the EC2 `/api/analyze-audio` route. Confidence is derived from how decisively the AI scored a source (variance across categories — flat 50/50/50 = low confidence; spread 90/20/70 = high confidence).
- Update `recalculate_user_fingerprint` to compute a **weighted average** using `confidence` per row instead of plain `AVG()`.
- Add a new `fingerprint_confidence` column on `user_fingerprints` representing overall trust (function of source count + average confidence). Surface this as a small badge on cards ("High confidence • 24 sources" vs "Low confidence • 3 sources").

**User-visible effect**
- Users with more and clearer-signal sources have more stable, trusted fingerprints. Sparse users no longer dominate cluster centroids.

---

## 2. Temporal Fingerprints (Recent vs All-Time)

**Goal:** Today every source counts forever. We add a "recent taste" view (last 30 days) alongside the all-time fingerprint so you can see how a user is evolving.

**What changes**
- Add columns to `user_fingerprints`: `emotional_avg_recent`, `cognitive_avg_recent`, … (6 total) plus `recent_sources_analyzed`.
- `recalculate_user_fingerprint` computes both:
  - **All-time:** every source the user has, normalized as today.
  - **Recent:** only `source_analyses.created_at > now() - interval '30 days'`, normalized against the same population stats.
- Add a `useFingerprints` hook option `mode: 'all' | 'recent'`, defaulting to `'all'`.
- In the **Admin Dashboard → Compare tab**, add a toggle: `[ All-Time | Last 30 Days ]`. The radar overlay, similarity matrix, and Insights summary all recalculate from whichever vector is selected.
- In the existing per-user **Network Visualization**, add a small "Drift" indicator showing the Euclidean distance between a user's recent and all-time vectors (e.g., "Taste shift: 12% — trending more Cognitive").

**User-visible effect**
- See momentum, not just history. Detect shifts ("user X used to be Artistic-heavy, now Social-heavy").

---

## 3. Collaborative Filtering ("Taste Neighbors")

**Goal:** Surface "users like you" recommendations using fingerprint similarity that already exists. No new ML — reuse the hybrid Euclidean+cosine metric.

**What changes**
- New component `TasteNeighbors.tsx` showing the **top 5 closest users** to the current viewer (or to a selected user in admin), with similarity %, avatar, top shared category, and a list of **sources they have that you don't**.
- Backend logic (client-side in the hook, since fingerprints are already cached):
  1. Compute similarity from current user's fingerprint to every other user's fingerprint.
  2. Pick top 5.
  3. For each neighbor, fetch their `audio_sources` (RLS already allows public read) and diff against the current user's sources by `spotify_id` / `name`.
- Add a new tab on the regular user **Index** page: **"Discover"** — shows taste neighbors and suggested sources to try.
- In the **Admin Dashboard**, add a "Neighbors" expandable panel on each user card listing their 3 closest matches.

**User-visible effect**
- Users get personalized recommendations grounded in real shared taste, not genre tags.

---

## Files Touched

**Database (1 migration)**
- `supabase/migrations/<new>.sql`:
  - `ALTER TABLE source_analyses ADD COLUMN confidence numeric DEFAULT 0.5`
  - `ALTER TABLE user_fingerprints ADD COLUMN ... _recent` (×6) + `recent_sources_analyzed` + `fingerprint_confidence`
  - Replace `recalculate_user_fingerprint` with version doing weighted + temporal calculation
  - Backfill `confidence` for existing rows from category variance
  - Run `recalculate_all_fingerprints()`

**EC2 server (manual deploy by you)**
- `/api/analyze-audio` route: include `confidence` field (variance-based) in response payload. I'll provide the snippet — you'll redeploy via PM2.

**Edge function**
- `supabase/functions/analyze-audio/index.ts`: pass `confidence` through to the `source_analyses` insert.

**Frontend**
- `src/hooks/useFingerprints.tsx`: add `recent` vectors + `confidence` to types; add helper `getTasteNeighbors(userId, limit)`.
- `src/components/FingerprintComparison.tsx`: All-Time / Recent toggle wired into existing similarity + radar logic.
- `src/components/AggregateNetworkVisualization.tsx`: render confidence as node opacity (low confidence = faded).
- `src/components/TasteNeighbors.tsx` (new): neighbor cards + suggested sources.
- `src/pages/Index.tsx`: add "Discover" tab hosting `<TasteNeighbors />`.
- `src/pages/AdminDashboard.tsx`: add temporal toggle in Compare tab; add Neighbors panel per user.

---

## Technical Notes

- Similarity reuses the existing hybrid metric in `FingerprintComparison.tsx` — extracted into `src/lib/fingerprintMath.ts` so both Compare and Discover share it.
- Backfilling `confidence` for existing `source_analyses` uses: `confidence = LEAST(1, STDDEV of [emo, cog, soc, com, con, art] / 30)` — clamps decisive scoring to 1.0.
- `fingerprint_confidence` formula: `LEAST(1, (sources / 10)) * AVG(source confidence)`. Caps at 10 sources for full trust.
- Recent window (30 days) is hardcoded for v1; can become configurable later.
- Taste neighbors are computed client-side from the already-cached `allFingerprints` query — no new network calls for the list itself.

