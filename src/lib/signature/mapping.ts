/**
 * Sonic Signature mapping + deterministic synthesis (Step 15) — CLIENT MIRROR.
 *
 * Verbatim mirror of `supabase/functions/_shared/signature.ts`, which is the
 * canonical source. Keep the two in sync: the WebAudio fallback must produce the
 * same sound as the server render, so client and server share these constants.
 *
 * Nothing here is random: every choice derives from a seeded PRNG keyed on the
 * subject hash, so the same vector + tags always produce identical audio.
 */

export const SIGNATURE_AXES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

export type SignatureAxis = (typeof SIGNATURE_AXES)[number];
export type SignatureVector = Record<SignatureAxis, number>;

export const SIGNATURE_SAMPLE_RATE = 22050;
export const SIGNATURE_DURATION = 3.5;

export type AmbienceKind = "room" | "rain" | "crowd" | "traffic";

export interface SignatureParams {
  /** Root note in MIDI. */
  rootMidi: number;
  mode: "major" | "minor";
  /** 0..1 — consonance / harmonic warmth of the added voices. */
  warmth: number;
  bpm: number;
  /** Notes per beat: 1, 2, 3 or 4. */
  subdivision: number;
  /** Simultaneous chorus voices (1 = solo). */
  voices: number;
  /** Chorus detune spread in cents. */
  detuneCents: number;
  /** Formant pair (Hz) for the voice-like lead. */
  formants: [number, number];
  /** 0..1 — contour travel of the lead across the phrase. */
  contour: number;
  /** 0..1 — vibrato depth on the lead. */
  vibrato: number;
  ambience: AmbienceKind;
  /** 0..1 — level of the ambience bed. */
  ambienceLevel: number;
  /** 0..1 — chance of grace notes / ornament density. */
  ornament: number;
  /** 0..1 — how far the second half of the phrase varies from the first. */
  variation: number;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const norm = (score: number) => clamp01((Number(score) || 0) / 100);

/** Ambience bed drawn from the subject's tag families. */
export function ambienceFromTags(tags: readonly string[]): AmbienceKind {
  const hay = tags.join(" ").toLowerCase();
  if (/(weather|rain|storm|forecast|climate)/.test(hay)) return "rain";
  if (/(event|concert|festival|stadium|arena|sport|live|venue|nightlife)/.test(hay)) return "crowd";
  if (/(traffic|transit|commut|auto|travel|airport|road|ooh)/.test(hay)) return "traffic";
  return "room";
}

/** Six-axis vector -> synthesis parameters. Pure and total. */
export function vectorToParams(
  vector: SignatureVector,
  tags: readonly string[] = [],
): SignatureParams {
  const emotional = norm(vector.emotional);
  const cognitive = norm(vector.cognitive);
  const social = norm(vector.social);
  const communication = norm(vector.communication);
  const contextual = norm(vector.contextual);
  const artistic = norm(vector.artistic);

  return {
    rootMidi: 57, // A3 — fixed so subjects are comparable by ear
    mode: emotional >= 0.5 ? "major" : "minor",
    warmth: emotional,
    bpm: Math.round(72 + cognitive * 78),
    subdivision: cognitive < 0.3 ? 1 : cognitive < 0.55 ? 2 : cognitive < 0.8 ? 3 : 4,
    voices: 1 + Math.round(social * 4),
    detuneCents: Math.round(social * 14),
    formants: [
      Math.round(420 + communication * 480),
      Math.round(1_180 + communication * 1_320),
    ],
    contour: communication,
    vibrato: 0.15 + communication * 0.55,
    ambience: ambienceFromTags(tags),
    ambienceLevel: 0.05 + contextual * 0.22,
    ornament: artistic,
    variation: 0.2 + artistic * 0.7,
  };
}

/** Stable digest of the rounded vector + sorted tags. */
export async function subjectHash(
  vector: SignatureVector,
  tags: readonly string[] = [],
): Promise<string> {
  const rounded = SIGNATURE_AXES.map((a) => Math.round((Number(vector[a]) || 0) / 2) * 2).join(",");
  const tagPart = [...tags].map((t) => t.toLowerCase().trim()).filter(Boolean).sort().join("|");
  const bytes = new TextEncoder().encode(`v1:${rounded}:${tagPart}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** Deterministic PRNG (mulberry32) seeded from the subject hash. */
export function seededRandom(hash: string): () => number {
  let seed = 0;
  for (let i = 0; i < hash.length; i++) seed = (seed * 33 + hash.charCodeAt(i)) >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Scale degrees (semitones from root) for the phrase. */
function scaleFor(mode: "major" | "minor"): number[] {
  return mode === "major" ? [0, 2, 4, 7, 9, 12] : [0, 2, 3, 7, 10, 12];
}

/**
 * Render the signature to mono float samples in [-1, 1].
 * Same params + same hash => same samples, always.
 */
export function renderSignature(
  params: SignatureParams,
  hash: string,
  sampleRate = SIGNATURE_SAMPLE_RATE,
  duration = SIGNATURE_DURATION,
): Float32Array {
  const rand = seededRandom(hash);
  const total = Math.floor(sampleRate * duration);
  const out = new Float32Array(total);

  const beat = 60 / params.bpm;
  const noteDur = beat / params.subdivision;
  const noteCount = Math.max(2, Math.floor(duration / noteDur));
  const scale = scaleFor(params.mode);

  // Build the note plan first so the whole phrase is decided deterministically.
  const plan: { midi: number; ornamentMidi: number | null }[] = [];
  for (let i = 0; i < noteCount; i++) {
    const half = i / noteCount > 0.5;
    const drift = half ? params.variation : 0;
    const pick = Math.floor((rand() * (1 - 0.4 * (1 - drift)) + 0.2) * scale.length) % scale.length;
    const midi = params.rootMidi + scale[pick] + (half && rand() < drift ? 12 : 0);
    const ornamentMidi = rand() < params.ornament * 0.6 ? midi + (rand() < 0.5 ? 2 : -1) : null;
    plan.push({ midi, ornamentMidi });
  }

  // Ambience bed (deterministic noise, filtered by kind).
  let lp = 0;
  let lp2 = 0;
  for (let n = 0; n < total; n++) {
    const white = rand() * 2 - 1;
    let bed: number;
    switch (params.ambience) {
      case "rain":
        lp += (white - lp) * 0.45;
        bed = lp * 0.9 + white * 0.1;
        break;
      case "crowd":
        lp += (white - lp) * 0.08;
        lp2 += (lp - lp2) * 0.08;
        bed = lp2 * 3.2;
        break;
      case "traffic":
        lp += (white - lp) * 0.02;
        bed = lp * 6.0;
        break;
      default:
        lp += (white - lp) * 0.015;
        bed = lp * 5.0;
        break;
    }
    out[n] = bed * params.ambienceLevel;
  }

  // Lead + chorus voices.
  const voiceCount = params.voices;
  for (let i = 0; i < plan.length; i++) {
    const start = Math.floor(i * noteDur * sampleRate);
    const len = Math.min(Math.floor(noteDur * sampleRate * 1.35), total - start);
    if (len <= 0) break;
    const baseHz = midiToHz(plan[i].midi);

    for (let v = 0; v < voiceCount; v++) {
      const detune = v === 0 ? 0 : ((v % 2 === 0 ? 1 : -1) * params.detuneCents * (1 + v * 0.3)) / 1200;
      const hz = baseHz * Math.pow(2, detune);
      const gain = (v === 0 ? 0.5 : 0.34 / voiceCount) * (0.7 + 0.3 * params.warmth);

      for (let n = 0; n < len; n++) {
        const t = n / sampleRate;
        const pos = n / len;
        // Percussive-to-sustained envelope shaped by warmth.
        const attack = Math.min(1, pos / (0.02 + 0.12 * params.warmth));
        const release = Math.pow(1 - pos, 1.6 - params.warmth * 0.8);
        const env = attack * release;

        const vib = 1 + Math.sin(2 * Math.PI * 5.2 * t) * 0.006 * params.vibrato;
        const f = hz * vib;
        // Formant-weighted partials give the lead its voice-like quality.
        let s = Math.sin(2 * Math.PI * f * t);
        for (let p = 2; p <= 6; p++) {
          const pf = f * p;
          const nearF1 = Math.exp(-Math.pow((pf - params.formants[0]) / 420, 2));
          const nearF2 = Math.exp(-Math.pow((pf - params.formants[1]) / 620, 2));
          const w = (nearF1 * 0.8 + nearF2 * 0.5) * (0.35 + 0.55 * params.warmth) / p;
          s += Math.sin(2 * Math.PI * pf * t) * w;
        }
        // Contour: the phrase rises or settles across its length.
        const contourGain = 1 + (params.contour - 0.5) * 0.6 * (i / plan.length);
        out[start + n] += s * env * gain * contourGain * 0.32;
      }
    }

    // Grace note ahead of the beat.
    const orn = plan[i].ornamentMidi;
    if (orn !== null) {
      const oLen = Math.min(Math.floor(noteDur * sampleRate * 0.22), total - start);
      const oHz = midiToHz(orn);
      for (let n = 0; n < oLen; n++) {
        const t = n / sampleRate;
        const env = Math.pow(1 - n / oLen, 2);
        out[start + n] += Math.sin(2 * Math.PI * oHz * t) * env * 0.16;
      }
    }
  }

  // Global fades + soft clip.
  const fade = Math.floor(sampleRate * 0.06);
  for (let n = 0; n < total; n++) {
    let s = out[n];
    if (n < fade) s *= n / fade;
    if (n > total - fade) s *= (total - n) / fade;
    out[n] = Math.tanh(s * 1.1) * 0.92;
  }
  return out;
}

/** Wrap float samples as a 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate = SIGNATURE_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return bytes;
}

/** Euclidean distance between a vector and an archetype centroid. */
export function archetypeDistance(
  vector: SignatureVector,
  centroid: Partial<SignatureVector>,
): number {
  let sum = 0;
  for (const axis of SIGNATURE_AXES) {
    const d = (Number(vector[axis]) || 0) - (Number(centroid[axis]) || 50);
    sum += d * d;
  }
  return Math.sqrt(sum);
}
