/**
 * On-device scoring — text side (Batch E, item 3).
 *
 * Turns a list of taxonomy tags (code/label plus optional weight) into a
 * six-axis fingerprint entirely in the browser: no model call, no credits, no
 * network. Used by the consumer door when `nextlevel.ondevice_enabled` is on.
 *
 * The audio-encoder path (a quantised CLAP in WASM) is deliberately NOT shipped
 * here — see `ON_DEVICE_AUDIO_STATUS` for what it would need.
 */

import { RESONANCE_AXES, type ResonanceAxis } from "./resonance";

export interface OnDeviceTag {
  code?: string | null;
  label?: string | null;
  weight?: number | null;
}

export interface OnDeviceFingerprint {
  scores: Record<ResonanceAxis, number>;
  /** How much tag weight actually matched the lexicon (0..1). */
  coverage: number;
  matchedTags: number;
  totalTags: number;
  engine: "on-device-text";
}

/**
 * Axis lexicon. Each keyword nudges one axis; keywords are matched as
 * substrings of the lowercased tag code and label together.
 */
const LEXICON: Record<ResonanceAxis, string[]> = {
  emotional: [
    "emotion", "happy", "sad", "love", "romance", "drama", "fear", "anger", "joy", "calm",
    "melancholy", "uplift", "intense", "tender", "nostalg", "hope", "tension", "warm",
  ],
  cognitive: [
    "news", "science", "education", "learn", "tech", "finance", "business", "analysis",
    "documentary", "tutorial", "strategy", "puzzle", "complex", "explain", "data", "research",
  ],
  social: [
    "crowd", "party", "sport", "family", "friend", "community", "group", "team", "chat",
    "audience", "live", "event", "celebration", "together", "social", "gathering",
  ],
  communication: [
    "speech", "speak", "talk", "voice", "vocal", "narration", "dialog", "podcast", "interview",
    "announce", "presenter", "host", "commentary", "spoken", "语", "monologue", "message",
  ],
  contextual: [
    "outdoor", "indoor", "street", "traffic", "weather", "rain", "city", "nature", "kitchen",
    "store", "retail", "travel", "car", "home", "office", "venue", "ambient", "room", "poi",
    "location", "place", "restaurant", "shop",
  ],
  artistic: [
    "music", "art", "design", "film", "cinema", "creative", "instrument", "guitar", "piano",
    "melody", "harmony", "composition", "style", "aesthetic", "craft", "dance", "theatre",
  ],
};

/** Baseline every axis starts from, so a single tag can't produce a 0/100 read. */
const BASELINE = 42;
const MAX_LIFT = 46;

export const ON_DEVICE_AUDIO_STATUS =
  "Audio encoding on-device is scaffolded but not shipped: it needs a quantised CLAP audio encoder (~40 MB int8 ONNX) in the grounding pack plus WebGPU/WASM fallback benchmarking. The text side below runs today with no model spend.";

export function onDeviceFingerprint(tags: OnDeviceTag[]): OnDeviceFingerprint {
  const lift = {} as Record<ResonanceAxis, number>;
  for (const axis of RESONANCE_AXES) lift[axis] = 0;

  let totalWeight = 0;
  let matchedWeight = 0;
  let matchedTags = 0;

  for (const tag of tags) {
    const text = `${tag.code ?? ""} ${tag.label ?? ""}`.toLowerCase();
    if (!text.trim()) continue;
    const weight = Math.max(0, Number(tag.weight ?? 1) || 0) || 1;
    totalWeight += weight;

    let hit = false;
    for (const axis of RESONANCE_AXES) {
      const hits = LEXICON[axis].reduce((n, kw) => (text.includes(kw) ? n + 1 : n), 0);
      if (hits > 0) {
        lift[axis] += weight * Math.min(2, hits);
        hit = true;
      }
    }
    if (hit) {
      matchedWeight += weight;
      matchedTags += 1;
    }
  }

  const maxLift = Math.max(1, ...RESONANCE_AXES.map((a) => lift[a]));
  const scores = {} as Record<ResonanceAxis, number>;
  for (const axis of RESONANCE_AXES) {
    const share = lift[axis] / maxLift; // 0..1, relative between axes
    scores[axis] = Math.round(Math.min(100, Math.max(0, BASELINE + share * MAX_LIFT)));
  }

  return {
    scores,
    coverage: totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) / 100 : 0,
    matchedTags,
    totalTags: tags.length,
    engine: "on-device-text",
  };
}
