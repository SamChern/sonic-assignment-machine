# Step 15 — Sonic Signatures & the SONICSIM Ensemble

Give every analysed subject a 3.5-second audible summary and one of twelve archetype identities, both derived deterministically from its six-axis vector.

## What you get

- **The :03 signature.** A short, synthesized sound per subject — not sampled from anyone's recording. Same subject, same sound, forever (seed = subject hash). Plays inline in the Semantic Scope, which visualises it while it sounds.
- **The Ensemble.** Twelve archetypes with a name, a one-line human meaning, the subject's distance to it, and 1–3 anchor artists shown strictly as "in the lineage of…" (editorial reference, never endorsement; anchors are historical creators only).
- **Signature card** in admin and enterprise analysis results: play button, live Scope visual, archetype name, meaning, distance, lineage line.

## One deliberate change from your prompt

Your prompt renders audio on the EC2 box. Recommendation: **render in the backend function itself, not on EC2.**

The synth is pure arithmetic — oscillators, an envelope, a noise bed — written straight to WAV bytes. Doing it in the backend gives byte-identical output with no terminal work on the box, no new nginx route, no GPU, and no dependency on the box being awake. The EC2 synth stays available as a later swap if you ever want richer timbres; nothing in the schema or UI changes if you do.

## Sound design (the mapping)

| Axis | Controls |
|---|---|
| Emotional | mode and harmonic warmth — minor↔major third, consonance of the added voices |
| Cognitive | tempo (72–150 BPM) and rhythmic subdivision complexity |
| Social | ensemble density — one voice ↔ layered chorus with detuning |
| Communication | a formant-filtered voice-like lead contour (rise/fall shaped by the score) |
| Contextual | ambience bed chosen from the subject's tag families — room tone, rain for weather-heavy web tags, crowd for live-event/POI tags, traffic for out-of-home |
| Artistic | ornamentation: grace notes, variation depth on the second half of the phrase |

Determinism: every random choice comes from a seeded generator keyed on the subject hash, so re-running produces identical bytes.

## The twelve archetypes

Seeded as centroids in six-axis space — dominant pair at 75/70, remaining axes 45–55, per the table you supplied (Torchbearer, Architect, Gatherer, Cartographer, Flame, Herald, Contemplative, Weaver, Pilgrim, Prism, Anchor, Undertow). Assignment is nearest centroid by Euclidean distance; the card shows the raw distance so a subject sitting between two archetypes reads honestly.

## Build steps

1. **Schema** — `sonic_signatures` table: `subject_hash` (primary key), `vector`, `audio_path`, `archetype_slug`, `distance`, `params`, `created_at`. Read access for the owning user / their organization and admins. A private `signatures` storage bucket for the rendered WAVs. A seeded `sonic_archetypes` table holding the twelve centroids, meanings and anchors, so the Ensemble is data, not hard-coded strings.
2. **`signature-render` function** — takes a six-axis vector plus top tags, derives the subject hash, returns the cached row if it exists, otherwise maps vector → synthesis parameters, renders a 3.5s WAV, stores it, assigns the nearest archetype, and writes the row. Idempotent by hash.
3. **Client synth fallback** — a WebAudio path in `src/lib/signature/` that reads the same parameter mapping, so the card can sound immediately while the server render lands (and works if storage is unreachable).
4. **UI** — `SignatureCard.tsx` (play/stop, archetype name, meaning, distance, lineage line) wired into the existing analysis result surfaces for admin and enterprise, with the Semantic Scope driven by the playing snippet.

## Technical notes

- Shared mapping module (`_shared/signature.ts`) is the single source of truth for vector → parameters; the WebAudio fallback imports the same constants so client and server agree.
- WAV is emitted as 22.05 kHz mono 16-bit PCM — small (~150 KB), universally playable, and trivially deterministic.
- Subject hash = stable digest of the rounded six-axis vector plus the sorted top tag codes, so tiny score jitter does not churn the cache but a real re-score does.
- The Scope consumes the snippet through the existing `useSignal` audio path, so no new visualiser is introduced.

## Verification (Steps 14 + 15 together)

- With the stub grounding pack, results show `text-only` badges; after a real pack loads, coverage meters move and badges flip to `grounded`.
- The same subject renders byte-identical audio twice (checksum compared).
- An approved Auto-curate clip appears in the pack ledger with its license intact.
- Archetype assignment is stable across re-scores of the same subject.

## Already in flight (finishing first)

Agent integrations (MCP) is mid-build: the tools, the OAuth-protected server entry and the Supabase client factory are written; still to do are the Vite plugin line, the consent route, OAuth server activation, and deploying the `mcp` function. That gets finished before Step 15 begins.
