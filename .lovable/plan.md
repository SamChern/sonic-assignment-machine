## Goal

Make librosa do real work for SemanticAC: (1) richer numeric features feed the AI scoring model, (2) those same arrays render as interactive visuals in the Analysis tab. No new heavy dependencies on the frontend (D3 + Canvas only).

## Architecture

```text
[Audio file/URL] → EC2 librosa-rest (/analyze_full)
        ↓ JSON: scalars + arrays (mel, mfcc, chroma, recurrence, beats)
   ┌────┴──────────────────────────────┐
   ↓                                   ↓
analyze-audio edge fn          AnalysisResults UI
(feeds AI prompt with          (D3/Canvas heatmaps,
 spectral/rhythm/tonal         tonnetz, recurrence)
 summary stats)
```

One upstream call per source. Result is cached in `audio_sources.librosa_features` (jsonb) to avoid recomputation.

## Backend changes (EC2 — server_rest.py)

Add a new `POST /analyze_full` endpoint (keeps existing `/analyze` untouched). Returns a single JSON document with:

- **Scalars (for the model):** duration, tempo_bpm, beat_regularity (1 − std/mean of inter-beat intervals), onset_rate, estimated_key, mode (major/minor via Krumhansl profile correlation), rms_mean, rms_std.
- **Spectral set (means + stds):** centroid, rolloff, bandwidth, flatness, contrast (7 bands), zero_crossing_rate.
- **MFCC summary:** `mfcc_mean[20]`, `mfcc_std[20]`, `delta_mfcc_mean[20]`, `delta_mfcc_std[20]`.
- **Tonal:** `chroma_mean[12]`, `tonnetz_mean[6]`, `tonnetz_std[6]`.
- **Arrays for visuals (downsampled to ≤300 frames to keep payload <150KB):**
  - `mel_db[n_mels=64][T]` (log-mel spectrogram)
  - `mfcc[20][T]`
  - `chroma[12][T]`
  - `onset_envelope[T]`, `beat_frames[]`, `times[T]`
  - `recurrence[N][N]` (N≤200) — self-similarity matrix from `librosa.segment.recurrence_matrix(..., mode='affinity')`
  - `segments[]` — boundary times from `librosa.segment.agglomerative` (k=8)

Helpers added to the module: `_downsample_2d(M, max_T)`, `_to_compact_list` (round to 3 decimals).

## Backend changes (Supabase)

1. **Migration:** add `librosa_features jsonb` column to `audio_sources` (nullable). Index on `(user_id)` already exists.
2. **New edge function `librosa-analyze-full`:** mirrors existing `librosa-analyze` but calls `/analyze_full`, persists the result to `audio_sources.librosa_features`, and returns it. RLS-respecting, auth-gated.
3. **`analyze-audio` edge fn:** when `librosa_features` is present on the source, inject a compact "Acoustic profile" block into the AI prompt (tempo, key, mode, spectral means, MFCC[0..6], beat regularity). This sharpens scoring without growing token cost (<400 tokens added).

## Frontend changes (hybrid visuals)

New component `src/components/visuals/LibrosaVisuals.tsx` with three panels (lazy-rendered, only when a source has `librosa_features`):

1. **MFCC heatmap + beat overlay** — Canvas (20×T cells, viridis colormap from existing `style/semantic-category-colors` palette mapped to magnitude); SVG overlay draws vertical ticks at `beat_frames` and an onset envelope sparkline above.
2. **Chromagram + tonnetz radial** — Canvas chromagram (12×T) on the left; D3 radial 6-axis tonnetz mean plot on the right (re-uses ontological-fingerprint radial layout conventions).
3. **Self-similarity matrix + segment boundaries** — Canvas N×N heatmap with horizontal/vertical lines at `segments[]`. Click a segment band → seeks the audio player to that timestamp.

All colors come from `index.css` semantic tokens; no raw hex. Renders inside the existing **Analysis** tab under each source's `AnalysisResults` card (collapsible "Acoustic visuals" accordion — default collapsed, opt-in).

New hook `src/hooks/useLibrosaFeatures.tsx` — fetches/caches `librosa_features`, calls `librosa-analyze-full` if missing.

## Admin tooling

Extend `LibrosaAudioTester` with a fourth output mode "Full analysis" that calls `librosa-analyze-full` and renders the same visuals — lets admins QA the pipeline at `/admin/integrations`.

## Out of scope (per memory rules)

- No "SAM-based similarity" tab, no "category legend" tab.
- No new top-level tabs; visuals live inside existing Analysis tab.

## Technical details

- Payload budget: `_downsample_2d` ensures ≤300 time frames; with float32→round(3)→string, full doc stays ~120 KB gzipped.
- Caching: `librosa_features` is computed once per source. Re-extraction triggered only by an admin "Recompute" button.
- Auth: re-uses `integration_credentials` for `LIBROSA_REST_URL` / `LIBROSA_REST_TOKEN`.
- Mode detection: correlate mean chroma with Krumhansl-Schmuckler major/minor profiles → take argmax.
- Beat regularity: `1 - std(diff(beat_times)) / mean(diff(beat_times))`, clipped to [0,1].

## Files touched

- `deploy/librosa-mcp/server_rest.py` — add `/analyze_full` + helpers
- `public/librosa-mcp/server_rest.py` — mirror for EC2 bootstrap
- new `supabase/functions/librosa-analyze-full/index.ts`
- `supabase/functions/analyze-audio/index.ts` — inject acoustic profile into prompt
- migration: `audio_sources.librosa_features jsonb`
- new `src/hooks/useLibrosaFeatures.tsx`
- new `src/components/visuals/LibrosaVisuals.tsx` (+ small `MfccHeatmap.tsx`, `Chromagram.tsx`, `RecurrenceMatrix.tsx`, `TonnetzRadial.tsx`)
- `src/components/AnalysisResults.tsx` — add collapsible visuals section
- `src/components/admin/LibrosaAudioTester.tsx` — "Full analysis" mode
