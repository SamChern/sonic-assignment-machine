# Roadmap

## Done
- [x] Consumer "Listen" → Browse library: non-Spotify library sources are now added, counted, chip-listed and analysed.
- [x] Admin "Audio signals to refresh" queue: table with status, confidence, grounding, lenses (low / ungrounded / stale) and a per-row refresh action.
- [x] My Library side-by-side compare: pick two saved analyses to compare category scores, grounding and confidence.
- [x] Musical read: pitch / rhythm / timbre + musicality derived from librosa + CLAP tag affinity, stored on source_analyses.musical_scores and shown in analysis.

## In progress
- [x] Top-right "Doors" label renamed to "Portal".
- [ ] Catalog score module: rank labels by originality, grounding confidence and catalog completeness, surfaced in admin.
- [ ] Verify the musical read on a real user-uploaded music file (pitch / rhythm / timbre) and compare it against Intuizi CTV samples.
- [ ] Feed user-uploaded music files through librosa + CLAP so pitch/rhythm/timbre reflect the real audio (not just Intuizi samples).
- [ ] Originality Score (grounding confidence + taxonomy match + pitch/rhythm/timbre) surfaced in My Library.
- [ ] Dedicated music catalog page in My Library: upload albums / tracks / labels and link them to symbols.
- [ ] Ungrounded symbols: flag panel — pick an ungrounded symbol, run a manual grounding, show the agent's reasoning in admin.
- [ ] Catalog originality: track originality from its linked analysis; a label's originality is a weighted average of its linked symbols.
- [ ] Symbol market page: list catalog tracks for sale with their originality and category scores.
- [ ] Real-market baselines: analyze real Apple/Spotify releases and write their measured centre/spread into market_baselines.
- [ ] Sonic Signature card: make it visually prominent in the teal palette and hide raw edge-function error text.
- [ ] Enterprise Intuizi analysis sync: retry in batches until it completes, then surface synced analyses on the homepage.
- [x] Admin "Preview as" row collapsed behind a click-to-expand toggle.

## Intuizi backlog scoring
- [x] Bulk materialize step works across the whole queue (all activations)
- [ ] Drain the ~1.1M pending identifiers via cached tag patterns (no AI credits)
- [ ] Admin dashboard: AI credit usage per activation's scoring, to budget the backlog
