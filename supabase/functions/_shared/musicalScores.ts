// Musical scores — pitch, rhythm and timbre for music-driven audio.
//
// The six SemanticAC categories answer "how does this audio relate to humans".
// They deliberately say nothing about *musical* craft, so a song and a spoken
// ad can score alike. This module adds the missing musical read, derived from
// measurements we already pay for:
//
//   librosa scalars (chroma, tonnetz, tempo, beat regularity, onset rate,
//   spectral centroid/rolloff/flatness/contrast, MFCC, ZCR)
//     + CLAP/AudioSet tag affinity (how musical vs. speech-like the audio is)
//     -> pitch / rhythm / timbre, each 0-100, plus a musicality weight
//
// Everything is bounded and deterministic: no extra model call, no extra cost.
// `musicality` says how much to trust the three scores — a spoken-word CTV
// signal lands near 0 and the UI can hide the block instead of pretending a
// voiceover has a key.

export interface MusicalScores {
  pitch: number;
  rhythm: number;
  timbre: number;
  /** 0-1: how music-like the audio is, i.e. how meaningful the trio is. */
  musicality: number;
  /** Short human-readable evidence trail. */
  notes: {
    key: string | null;
    mode: string | null;
    tempo_bpm: number | null;
    tonal_clarity: number;
    beat_regularity: number;
    brightness: number;
    speech_like: number;
  };
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const pct = (n: number) => Math.round(clamp01(n) * 1000) / 10;
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Peakiness of a distribution: 1 = one dominant bin, 0 = flat. */
function peakiness(values: number[]): number {
  const vals = values.filter((v) => Number.isFinite(v)).map((v) => Math.max(0, v));
  if (vals.length < 2) return 0;
  const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const p = vals.map((v) => v / total);
  // Normalised entropy, inverted.
  const entropy = -p.reduce((a, x) => (x > 0 ? a + x * Math.log(x) : a), 0);
  return clamp01(1 - entropy / Math.log(vals.length));
}

/** AudioSet codes/labels that mark music vs. speech. */
const MUSIC_HINTS = /music|instrument|guitar|piano|drum|violin|synth|bass|singing|song|melody|orchestr|choir|percussion/i;
const SPEECH_HINTS = /speech|speak|narrat|conversation|talk|voice|monologue|podcast|dialog|announc/i;

export interface MusicalTagHint {
  code?: string | null;
  label?: string | null;
  similarity?: number | null;
}

/**
 * Derive the musical trio. Returns null when there is no acoustic measurement
 * to stand on — a metadata-only subject has no honest pitch or timbre.
 */
export function deriveMusicalScores(
  // deno-lint-ignore no-explicit-any
  librosaFeatures: any,
  tags: MusicalTagHint[] = [],
): MusicalScores | null {
  const s = librosaFeatures?.scalars;
  if (!s || typeof s !== "object") return null;

  const chroma: number[] = Array.isArray(s.chroma_mean) ? s.chroma_mean.map(Number) : [];
  const tonnetz: number[] = Array.isArray(s.tonnetz_mean) ? s.tonnetz_mean.map(Number) : [];
  const contrast: number[] = Array.isArray(s.spectral_contrast_mean)
    ? s.spectral_contrast_mean.map(Number)
    : [];
  const mfcc: number[] = Array.isArray(s.mfcc_mean) ? s.mfcc_mean.map(Number) : [];

  // --- tag affinity: music-like vs speech-like -----------------------------
  let musicWeight = 0;
  let speechWeight = 0;
  for (const t of tags) {
    const text = `${t.code ?? ""} ${t.label ?? ""}`;
    const w = Math.max(0, Number(t.similarity ?? 0));
    if (MUSIC_HINTS.test(text)) musicWeight += w;
    if (SPEECH_HINTS.test(text)) speechWeight += w;
  }
  const tagTotal = musicWeight + speechWeight;
  const tagMusicality = tagTotal > 0 ? musicWeight / tagTotal : null;

  // --- pitch: is there a stable tonal centre? -----------------------------
  const tonalClarity = peakiness(chroma);
  // Tonnetz magnitude rises with consonant harmonic content.
  const tonnetzMag = tonnetz.length
    ? clamp01(
      Math.sqrt(tonnetz.reduce((a, v) => a + v * v, 0) / tonnetz.length) * 2,
    )
    : 0;
  const flatness = clamp01(num(s.spectral_flatness_mean) ?? 0);
  // Noisy (flat-spectrum) audio cannot carry pitch.
  const pitch = pct(
    0.55 * tonalClarity + 0.3 * tonnetzMag + 0.15 * (1 - flatness),
  );

  // --- rhythm: is there a steady, articulated pulse? ----------------------
  const tempo = num(s.tempo_bpm);
  // Musical tempi cluster 60-180 BPM; score the distance from that window.
  const tempoPlausibility = tempo === null
    ? 0.4
    : tempo >= 60 && tempo <= 180
      ? 1
      : clamp01(1 - Math.min(Math.abs(tempo - 120) - 60, 120) / 120);
  const beatRegularity = clamp01(num(s.beat_regularity) ?? 0);
  const onsetRate = num(s.onset_rate_per_sec) ?? 0;
  // ~1-6 onsets/sec is articulated music; far below is drone, far above is noise.
  const onsetFit = clamp01(1 - Math.abs(Math.min(onsetRate, 12) - 3.5) / 8.5);
  const rhythm = pct(
    0.45 * beatRegularity + 0.3 * tempoPlausibility + 0.25 * onsetFit,
  );

  // --- timbre: how rich and sculpted is the spectrum? ---------------------
  const centroid = num(s.spectral_centroid_mean) ?? 0;
  const brightness = clamp01(centroid / 5000);
  const rolloff = num(s.spectral_rolloff_mean) ?? 0;
  const bandwidth = clamp01(rolloff / 11000);
  const contrastMean = contrast.length
    ? clamp01(contrast.reduce((a, v) => a + v, 0) / contrast.length / 40)
    : 0;
  // MFCC spread (past the loudness coefficient) tracks spectral complexity.
  const mfccSpread = mfcc.length > 1
    ? clamp01(
      Math.sqrt(
        mfcc.slice(1).reduce((a, v) => a + v * v, 0) / (mfcc.length - 1),
      ) / 40,
    )
    : 0;
  const timbre = pct(
    0.35 * contrastMean + 0.25 * mfccSpread + 0.2 * bandwidth + 0.2 * brightness,
  );

  // --- musicality: trust weight for the trio ------------------------------
  const zcr = clamp01(num(s.zero_crossing_rate_mean) ?? 0);
  // Acoustic prior: tonal + pulsed + not fricative-heavy reads as music.
  const acousticMusicality = clamp01(
    0.4 * tonalClarity + 0.35 * beatRegularity + 0.25 * (1 - Math.min(zcr * 4, 1)),
  );
  const musicality = tagMusicality === null
    ? acousticMusicality
    : clamp01(0.6 * tagMusicality + 0.4 * acousticMusicality);

  return {
    pitch,
    rhythm,
    timbre,
    musicality: Math.round(musicality * 100) / 100,
    notes: {
      key: typeof s.estimated_key === "string" ? s.estimated_key : null,
      mode: typeof s.mode === "string" ? s.mode : null,
      tempo_bpm: tempo === null ? null : Math.round(tempo * 10) / 10,
      tonal_clarity: Math.round(tonalClarity * 100) / 100,
      beat_regularity: Math.round(beatRegularity * 100) / 100,
      brightness: Math.round(brightness * 100) / 100,
      speech_like: tagMusicality === null ? 0 : Math.round((1 - tagMusicality) * 100) / 100,
    },
  };
}

/** Compact prompt line so the scorer can reason about musical craft too. */
export function formatMusicalProfile(m: MusicalScores): string {
  return [
    `musical=pitch:${m.pitch} rhythm:${m.rhythm} timbre:${m.timbre}`,
    `musicality=${m.musicality}`,
    m.notes.key ? `key=${m.notes.key}${m.notes.mode ? ` ${m.notes.mode}` : ""}` : "",
    m.notes.tempo_bpm ? `tempo=${m.notes.tempo_bpm}bpm` : "",
  ].filter(Boolean).join(" ");
}
