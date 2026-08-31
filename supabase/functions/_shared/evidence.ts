// Phase 2 — acoustic evidence layer.
//
// Librosa is an ENRICHMENT, never a requirement. This module resolves the best
// available acoustic evidence for a source, in descending order of quality:
//
//   1. librosa    — measured features from the analysis service (if cached)
//   2. provider   — Spotify/Apple supplied audio features (no EC2 involved)
//   3. neighbors  — kNN over profile_embedding: borrow the acoustic character
//                   of the nearest already-analyzed sources as a prior
//   4. none       — metadata only
//
// The chosen tier drives a confidence multiplier, so a source scored without
// librosa is still fully usable — just flagged as less certain.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/**
 * Portable extraction contract. Any future replacement for the librosa service
 * only has to satisfy this schema version — nothing else in the app changes.
 */
export const FEATURE_SCHEMA_VERSION = "acoustic.v1";

export type EvidenceKind = "clap" | "librosa" | "provider" | "neighbors" | "none";

/** Confidence multiplier per evidence tier. */
export const EVIDENCE_WEIGHT: Record<EvidenceKind, number> = {
  // CLAP listened to the audio itself in the semantic space the ontology
  // lives in, so it is the strongest evidence tier we have.
  clap: 1.0,
  librosa: 1.0,
  provider: 0.8,
  neighbors: 0.6,
  none: 0.4,
};

const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

const round1 = (n: unknown) => (typeof n === "number" ? Math.round(n * 10) / 10 : n);
const round2 = (n: unknown) => (typeof n === "number" ? Math.round(n * 100) / 100 : n);

/* -------------------------------------------------------------------------- */
/* 1. librosa                                                                  */
/* -------------------------------------------------------------------------- */

// deno-lint-ignore no-explicit-any
export function formatLibrosaProfile(features: any): string | null {
  if (!features || typeof features !== "object") return null;
  const s = features.scalars;
  if (!s || typeof s !== "object") return null;

  const mfcc = Array.isArray(s.mfcc_mean) ? s.mfcc_mean.slice(0, 7).map(round1) : [];
  const contrast = Array.isArray(s.spectral_contrast_mean)
    ? s.spectral_contrast_mean.map(round1)
    : [];
  const chroma = Array.isArray(s.chroma_mean) ? s.chroma_mean.map(round2) : [];
  const tonnetz = Array.isArray(s.tonnetz_mean) ? s.tonnetz_mean.map(round2) : [];
  const dominantPitches = chroma.length === 12
    ? chroma
      .map((v: number, i: number) => ({ v, name: PITCH_NAMES[i] }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((p) => `${p.name}:${p.v}`)
    : [];

  return [
    `source=librosa schema=${FEATURE_SCHEMA_VERSION}`,
    `tempo=${round1(s.tempo_bpm)}bpm`,
    `key=${s.estimated_key ?? "?"}${s.mode ? ` ${s.mode}` : ""}`,
    `beat_regularity=${round1(s.beat_regularity)}`,
    `onset_rate=${round1(s.onset_rate_per_sec)}/s`,
    `rms=${round1(s.rms_mean)}`,
    `spec_centroid=${round1(s.spectral_centroid_mean)}Hz`,
    `spec_rolloff=${round1(s.spectral_rolloff_mean)}Hz`,
    `spec_flatness=${round1(s.spectral_flatness_mean)}`,
    `zcr=${round1(s.zero_crossing_rate_mean)}`,
    contrast.length ? `contrast=[${contrast.join(",")}]` : "",
    mfcc.length ? `mfcc[0..6]=[${mfcc.join(",")}]` : "",
    dominantPitches.length ? `dominant_pitches=[${dominantPitches.join(",")}]` : "",
    chroma.length ? `chroma=[${chroma.join(",")}]` : "",
    tonnetz.length ? `tonnetz=[${tonnetz.join(",")}]` : "",
  ].filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */
/* 2. provider features (Spotify) — no analysis service involved               */
/* -------------------------------------------------------------------------- */

export interface ProviderFeatures {
  id: string;
  tempo: number;
  key: number;
  mode: number;
  time_signature: number;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  liveness: number;
  speechiness: number;
  loudness: number;
}

/**
 * Server-side Spotify audio-features fetch (client-credentials). Returns an
 * empty map when credentials are missing or Spotify restricts the endpoint —
 * callers then fall through to the next evidence tier.
 */
export async function fetchProviderFeatures(
  trackIds: string[],
): Promise<Map<string, ProviderFeatures>> {
  const out = new Map<string, ProviderFeatures>();
  const ids = [...new Set(trackIds.filter((id) => /^[A-Za-z0-9]{22}$/.test(id)))];
  if (ids.length === 0) return out;

  const clientId = Deno.env.get("SPOTIFY_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("SPOTIFY_CLIENT_SECRET")?.trim();
  if (!clientId || !clientSecret) return out;

  try {
    const tokenResp = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResp.ok) return out;
    const token = (await tokenResp.json()).access_token as string;

    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const resp = await fetch(
        `https://api.spotify.com/v1/audio-features?ids=${chunk.join(",")}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
      );
      if (!resp.ok) break; // 403 = restricted app; fall through silently
      const parsed = await resp.json();
      for (const f of parsed.audio_features ?? []) {
        if (f && typeof f.id === "string") out.set(f.id, f as ProviderFeatures);
      }
    }
  } catch {
    // Provider features are optional; never fail the analysis on them.
  }
  return out;
}

export function formatProviderProfile(f: ProviderFeatures): string {
  const key = f.key >= 0 && f.key < 12 ? PITCH_NAMES[f.key] : "?";
  return [
    `source=spotify schema=${FEATURE_SCHEMA_VERSION}`,
    `tempo=${round1(f.tempo)}bpm`,
    `key=${key} ${f.mode === 1 ? "major" : "minor"}`,
    `time_signature=${f.time_signature}/4`,
    `energy=${round2(f.energy)}`,
    `valence=${round2(f.valence)}`,
    `danceability=${round2(f.danceability)}`,
    `acousticness=${round2(f.acousticness)}`,
    `instrumentalness=${round2(f.instrumentalness)}`,
    `liveness=${round2(f.liveness)}`,
    `speechiness=${round2(f.speechiness)}`,
    `loudness=${round1(f.loudness)}dB`,
  ].join(" ");
}

/* -------------------------------------------------------------------------- */
/* 3. neighbour substitution via profile_embedding kNN                         */
/* -------------------------------------------------------------------------- */

export interface NeighborPrior {
  text: string;
  neighbors: number;
}

/**
 * When a source has no measured features, borrow the semantic character of its
 * nearest analyzed neighbors (pgvector kNN) as a Bayesian prior for the LLM.
 */
export async function neighborPrior(
  admin: SupabaseClient,
  audioSourceId: string,
  matchCount = 5,
): Promise<NeighborPrior | null> {
  const { data: row } = await admin
    .from("audio_sources")
    .select("profile_embedding")
    .eq("id", audioSourceId)
    .maybeSingle();

  const embedding = row?.profile_embedding;
  if (!embedding) return null;

  const { data: neighbors, error } = await admin.rpc("match_audio_profiles", {
    query_embedding: embedding,
    match_count: matchCount,
    exclude_id: audioSourceId,
  });
  if (error || !neighbors || neighbors.length === 0) return null;

  // deno-lint-ignore no-explicit-any
  const rows = neighbors as any[];
  const parts: string[] = [];
  for (const cat of CATEGORIES) {
    const vals = rows
      .map((n) => Number(n[`${cat}_score`]))
      .filter((v) => Number.isFinite(v));
    if (vals.length === 0) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(
      vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length,
    );
    parts.push(`${cat}=${Math.round(mean)}±${Math.round(std)}`);
  }
  if (parts.length === 0) return null;

  const avgSim = rows
    .map((n) => Number(n.similarity))
    .filter((v) => Number.isFinite(v))
    .reduce((a, b, _i, arr) => a + b / arr.length, 0);

  return {
    text:
      `nearest_neighbors=${rows.length} avg_similarity=${round2(avgSim)} ` +
      `prior[${parts.join(" ")}]`,
    neighbors: rows.length,
  };
}

/* -------------------------------------------------------------------------- */
/* confidence                                                                  */
/* -------------------------------------------------------------------------- */

/** Blend score-spread confidence with the evidence tier weight. */
export function blendConfidence(spreadConfidence: number, evidence: EvidenceKind): number {
  const c = spreadConfidence * EVIDENCE_WEIGHT[evidence];
  return Math.max(0.05, Math.min(1, Math.round(c * 1000) / 1000));
}
