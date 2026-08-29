# Step 10 — The Scope: finish the instrument

Most of Step 10 already ships in the app: `SemanticScope.tsx` renders the three lenses (waveform time lens via `Audioscope`, `ScrollingSpectrogram` with Meyda RMS/centroid traces, six-axis meaning lens fed by the `scope-window-score` function once per `scope.window_seconds`), `silhouette.ts` synthesizes zero-audio traces, `AudioscopeCompare` overlays two subjects, and the debug payload is gated server-side by an admin role check. Role lenses are wired: consumer in the home Listen tab, enterprise in the workspace SonicSIM, debug in the Admin Workbench.

What is missing is the "instrument" half: you can watch tags fire, but you cannot scrub back to 0:42 and inspect what the model heard, and nothing yet proves the live radial agrees with the stored analysis.

## 1. Timestamped tag-fire trail with scrub-back

- Record every scored window as `{ t, tags, scores, features }` keyed to media time, not to frame count, so the trail survives pause/seek and speed changes.
- Draw the trail as small markers on a thin timeline strip directly under the waveform (keeps the waveform itself untouched). Hovering a marker shows the tags and similarities; clicking seeks the media element to that time and freezes the meaning lens on that window's snapshot until playback resumes.
- Silhouette (zero-audio) mode keeps the trail read-only — the synthesized trace has no seekable timeline.

## 2. Scrub-and-inspect for enterprise analysis views

- Add `wavesurfer.js` v7 (BSD-3) as an enterprise-only inspection surface next to the scope, not a replacement for it: full-track waveform, click/drag to seek, region highlights drawn from the tag-fire trail.
- Loaded lazily (dynamic import) so consumer and admin bundles are unaffected; it drives the same `HTMLMediaElement` the scope already reads, so no second AudioContext appears.

## 3. Verification harness

- New test comparing a fixture track's accumulated window scores against a stored `source_analyses` row within tolerance (per-axis absolute difference), so drift in the scoring path fails CI.
- Snapshot test asserting `createSilhouetteSignal` is deterministic: identical scores + tags + seed produce a byte-identical trace, and two different subjects diverge on the axes `silhouetteDivergence` reports.
- Role test extended to assert the consumer lens renders no debug drawer and issues no admin RPC, and that the consumer "does this feel right?" tap writes `category_feedback`.

## 4. Size discipline

`AudioscopeCompare.tsx` (537) and `SonicSimPanel.tsx` (560) are on the legacy ledger. The trail and inspect work lands in new modules (`src/lib/audioscope/trail.ts`, `src/components/visuals/ScopeTrail.tsx`, `src/components/visuals/WaveInspect.tsx`) and the legacy budgets ratchet down rather than up.

## Technical notes

- Throttling stays as-is: one `scope-window-score` call per window, enforced on both client and server; the trail only stores results, it never triggers extra calls.
- `prefers-reduced-motion` continues to select Static mode by default; the trail and inspect views are static by nature and remain fully usable there.
- No schema changes. The trail is session state; nothing new is persisted beyond the existing `category_feedback` writes.
