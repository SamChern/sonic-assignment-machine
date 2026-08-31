# Roadmap

## Done
- [x] Consumer "Listen" → Browse library: non-Spotify library sources are now added, counted, chip-listed and analysed.
- [x] Admin "Audio signals to refresh" queue: table with status, confidence, grounding, lenses (low / ungrounded / stale) and a per-row refresh action.
- [x] My Library side-by-side compare: pick two saved analyses to compare category scores, grounding and confidence.
- [x] Musical read: pitch / rhythm / timbre + musicality derived from librosa + CLAP tag affinity, stored on source_analyses.musical_scores and shown in analysis.

## In progress
- [ ] Feed user-uploaded music files through librosa + CLAP so pitch/rhythm/timbre reflect the real audio (not just Intuizi samples).
- [ ] Originality Score (grounding confidence + taxonomy match + pitch/rhythm/timbre) surfaced in My Library.
- [ ] Dedicated music catalog page in My Library: upload albums / tracks / labels and link them to symbols.
- [ ] Ungrounded symbols: flag for a manual grounding run and show the agent's reasoning in the admin panel.
