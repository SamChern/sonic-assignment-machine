# See my SonicSIM — Audioscope Visualizations

Yes, this is implementable. The HTML you shared is an oscilloscope on a `<canvas>` using the Web Audio API. The same technique ports cleanly into the app, and it can be driven by two signal sources depending on what the user is looking at.

## How it works here

The oscilloscope needs a signal per animation frame. The app has two that are already in place:

1. **Real audio** — uploaded files (`File` objects, already used by the audio player) and Spotify/Apple preview URLs stored on `audio_sources.preview_url` / `file_url`. These go through a real `AnalyserNode`, exactly like your snippet (time-domain waveform plus frequency spectrum).
2. **Synthesized scope** — for sources with no playable audio (CTV/Intuizi identifiers, saved analyses, aggregate fingerprints), the waveform is generated from stored data: the six category scores drive six harmonic bands, and where DSP features exist (`audio_sources.librosa_features` — tempo, spectral centroid, energy) they set pulse rate, brightness, and amplitude. This makes the animation a faithful visual of the semantic fingerprint rather than decoration.

Both feed one shared renderer, so visuals look identical regardless of source.


## What gets built

### 1. Shared engine
- `src/lib/audioscope/` — signal providers (`liveAudio`, `synthetic`) exposing one interface: `getWaveform()` / `getSpectrum()`.
- `src/components/visuals/Audioscope.tsx` — canvas renderer with three modes:
  - **Scope**: the line wave from your snippet (grid, horizon line, glow trail).
  - **Radial**: waveform wrapped into a circle around the fingerprint — reads as a "SonicSIM" identity ring.
  - **Node pulse**: the ontological network with each of the 6 category nodes breathing/pulsing on its own band, edges brightening with signal strength.
- Styling uses existing semantic tokens (teal/ink palette, the 6 category colors) — not the neon green of the demo file. Respects `prefers-reduced-motion` (renders a static frame), pauses when off-screen, single `requestAnimationFrame` loop, DPR-aware sizing.

### 2. "See my SonicSIM" tab
Added in three places, same component:
- **Universal users** — new tab alongside Select Sources / Network / Analysis on the home page.
- **Enterprise workspace** — new tab in `/workspace`.
- **Admin dashboard** — new tab, with the ability to pick any user/identifier cohort.

Inside the tab: a picker for *what* to visualize (aggregate sonic fingerprint, or one individual semantic analysis), the visualization-mode toggle, transport controls (play/pause, replay), and a full-screen/present mode for demoing.

### 3. Compare mode
In the admin and enterprise compare views, next to the spider chart:
- **Dual scope** — the two fingerprints drawn as overlaid waveforms in each entity's color; visual divergence corresponds to the similarity score.
- **Difference band** — the per-category delta rendered as a filled region, so the similarity number has a visual explanation.
- Similarity score displayed as a phase-lock readout (in sync = similar, out of phase = divergent).

### 4. Node-level integration
The network visualization gets an optional "animate" toggle so an individual analysis can be watched pulsing in the ontology graph, keeping existing link-strength rendering intact.

## Technical notes
- No new backend, no new tables, no new dependencies — canvas 2D plus Web Audio, both already available.
- `AudioContext` is created only on user gesture (browser autoplay policy). No microphone access is used anywhere.
- Cross-origin preview URLs are loaded with `crossOrigin="anonymous"`; if a provider blocks analysis, the component falls back to the synthesized scope automatically so the tab never renders empty.
- Synthetic mode is deterministic per source id, so a given fingerprint always animates the same way — comparable across sessions and screenshots.
- Mobile: reduced particle/line counts and capped frame rate below 640px, following the existing mobile-optimization pattern.

## Out of scope
The Vimeo reference is a rendered motion-graphics piece; this delivers the in-app real-time equivalent, not a video export. If you also want an exportable MP4 of a user's SonicSIM, that's a separate Remotion pass.
