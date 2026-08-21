// Shared librosa access layer: content-addressed caching, single-flight,
// concurrency capping, circuit breaking and call logging.
//
// IMPORTANT: this layer never changes the upstream contract. It calls the same
// unchanged Librosa REST endpoints (/analyze, /analyze_full) on the same host
// and port. Everything here exists to send that service FEWER and SMALLER
// requests, not to reconfigure it.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { formatLibrosaProfile } from "./evidence.ts";
import { embedAudioProfileCached } from "./inference.ts";

export const INTEGRATION_ID = "librosa_rest";

/** Max simultaneous in-flight upstream calls we allow ourselves to make. */
export const MAX_INFLIGHT = 2;
/** Consecutive upstream failures before the circuit breaker opens. */
export const BREAKER_THRESHOLD = 4;
/** How long the breaker stays open. */
export const BREAKER_COOLDOWN_MS = 60_000;
/** A pending cache row older than this is considered abandoned. */
export const INFLIGHT_TTL_MS = 10 * 60_000;

/**
 * 1.6 — Fast profile defaults. We control the request parameters even though we
 * cannot touch the EC2 box, so the default path asks for far less CPU.
 * High-resolution runs are opt-in (admin / CTV / "open the visuals").
 */
export const FAST_PROFILE = {
  duration: 45,
  n_mfcc: 20,
  max_frames: 256,
  recurrence_size: 0,
} as const;

export const FULL_PROFILE = {
  duration: 120,
  n_mfcc: 20,
  max_frames: 1024,
  recurrence_size: 256,
} as const;

export interface AnalysisParams {
  duration: number;
  n_mfcc: number;
  max_frames: number;
  recurrence_size: number;
}

export interface AudioInput {
  audio_url?: string;
  audio_b64?: string;
  youtube_url?: string;
}

/** Resolve requested params against a profile, clamped to sane ceilings. */
export function resolveParams(
  body: Record<string, unknown>,
  profile: "fast" | "full" = "fast",
): AnalysisParams {
  const base = profile === "full" ? FULL_PROFILE : FAST_PROFILE;
  const num = (k: keyof AnalysisParams, max: number) => {
    const v = body[k];
    const n = typeof v === "number" && Number.isFinite(v) ? v : base[k];
    return Math.max(0, Math.min(max, Math.round(n)));
  };
  return {
    duration: Math.max(5, num("duration", 300)),
    n_mfcc: Math.max(1, num("n_mfcc", 40)),
    max_frames: Math.max(32, num("max_frames", 2048)),
    recurrence_size: num("recurrence_size", 512),
  };
}

/**
 * 1.1 — Stable content-addressed cache key. Identical audio + identical
 * analysis settings always maps to the same key, regardless of which user or
 * which audio_source row triggered it.
 */
export async function computeCacheKey(
  input: AudioInput,
  params: AnalysisParams,
  identity?: string | null,
): Promise<string> {
  // Prefer a provider identity (Spotify/Apple track id) when we have one: two
  // rows for the same track then share one cache entry even if their signed
  // preview URLs differ.
  const subject = identity
    ? `id:${identity}`
    : input.audio_url
      ? `url:${stripVolatileQuery(input.audio_url)}`
      : input.youtube_url
        ? `yt:${input.youtube_url}`
        : `b64:${await sha256(input.audio_b64 ?? "")}`;

  const canonical = JSON.stringify({
    subject,
    d: params.duration,
    m: params.n_mfcc,
    f: params.max_frames,
    r: params.recurrence_size,
    v: 1,
  });
  return await sha256(canonical);
}

/** Drop expiring signature params so signed CDN URLs still cache-collapse. */
function stripVolatileQuery(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(x-amz-|sig|signature|token|expires|se|sp|sv|st)/i.test(k)) {
        u.searchParams.delete(k);
      }
    }
    return `${u.origin}${u.pathname}?${u.searchParams.toString()}`;
  } catch {
    return url;
  }
}

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CacheHit {
  features: Record<string, unknown>;
}

/** 1.1 — Cache read. Bumps hit accounting on a hit. */
export async function readCache(
  admin: SupabaseClient,
  cacheKey: string,
): Promise<{ status: "ready"; features: Record<string, unknown> } | { status: "pending" | "failed" | "miss" }> {
  const { data } = await admin
    .from("librosa_cache")
    .select("status, features, started_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (!data) return { status: "miss" };

  if (data.status === "ready" && data.features) {
    // Hit accounting is fire-and-forget so it can never block serving a valid
    // cached result.
    bumpHit(admin, cacheKey);
    return { status: "ready", features: data.features as Record<string, unknown> };

  }

  if (data.status === "pending") {
    const age = Date.now() - new Date(data.started_at as string).getTime();
    if (age < INFLIGHT_TTL_MS) return { status: "pending" };
    return { status: "miss" }; // abandoned, safe to retry
  }

  return { status: data.status === "failed" ? "failed" : "miss" };
}

function bumpHit(admin: SupabaseClient, cacheKey: string) {
  admin
    .from("librosa_cache")
    .select("hit_count")
    .eq("cache_key", cacheKey)
    .maybeSingle()
    .then(({ data }) => {
      if (!data) return;
      return admin
        .from("librosa_cache")
        .update({ hit_count: (data.hit_count ?? 0) + 1, last_hit_at: new Date().toISOString() })
        .eq("cache_key", cacheKey);
    })
    .catch(() => {});
}

/**
 * 1.2 — Single flight. Returns true if THIS caller won the right to run the
 * upstream analysis; false means another caller is already running it.
 */
export async function claimFlight(
  admin: SupabaseClient,
  cacheKey: string,
  params: AnalysisParams,
): Promise<boolean> {
  const { error } = await admin.from("librosa_cache").insert({
    cache_key: cacheKey,
    params,
    status: "pending",
    started_at: new Date().toISOString(),
  });
  if (!error) return true;

  // Row exists. Take it over only if the previous attempt is stale or failed.
  const { data } = await admin
    .from("librosa_cache")
    .select("status, started_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (!data) return false;

  const stale =
    data.status === "failed" ||
    Date.now() - new Date(data.started_at as string).getTime() > INFLIGHT_TTL_MS;
  if (!stale) return false;

  const { error: takeoverErr } = await admin
    .from("librosa_cache")
    .update({ status: "pending", started_at: new Date().toISOString(), error_message: null })
    .eq("cache_key", cacheKey)
    .eq("status", data.status);
  return !takeoverErr;
}

export async function finishFlight(
  admin: SupabaseClient,
  cacheKey: string,
  features: Record<string, unknown>,
) {
  await admin
    .from("librosa_cache")
    .update({
      status: "ready",
      features,
      ready_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("cache_key", cacheKey);
}

export async function failFlight(admin: SupabaseClient, cacheKey: string, message: string) {
  await admin
    .from("librosa_cache")
    .update({ status: "failed", error_message: message.slice(0, 500) })
    .eq("cache_key", cacheKey);
}

/** 1.3 — Global concurrency gate over in-flight upstream calls. */
export async function inflightCount(admin: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - INFLIGHT_TTL_MS).toISOString();
  const { count } = await admin
    .from("librosa_cache")
    .select("cache_key", { count: "exact", head: true })
    .eq("status", "pending")
    .gte("started_at", since);
  return count ?? 0;
}

/** 1.7 — Circuit breaker derived from the recent call log. */
export async function breakerOpen(admin: SupabaseClient): Promise<boolean> {
  const since = new Date(Date.now() - BREAKER_COOLDOWN_MS).toISOString();
  const { data } = await admin
    .from("librosa_call_log")
    .select("outcome")
    .gte("created_at", since)
    .eq("cache_hit", false)
    .order("created_at", { ascending: false })
    .limit(BREAKER_THRESHOLD);

  if (!data || data.length < BREAKER_THRESHOLD) return false;
  return data.every((r) => r.outcome === "error");
}

/** 1.8 — Fire-and-forget call log. Never allowed to break a request. */
export function logCall(
  admin: SupabaseClient,
  row: {
    cache_key?: string | null;
    audio_source_id?: string | null;
    outcome: "hit" | "ok" | "error" | "queued" | "breaker_open" | "throttled";
    cache_hit?: boolean;
    duration_ms?: number | null;
    http_status?: number | null;
    error_message?: string | null;
  },
) {
  admin
    .from("librosa_call_log")
    .insert({
      cache_key: row.cache_key ?? null,
      audio_source_id: row.audio_source_id ?? null,
      outcome: row.outcome,
      cache_hit: row.cache_hit ?? false,
      duration_ms: row.duration_ms ?? null,
      http_status: row.http_status ?? null,
      error_message: row.error_message ? row.error_message.slice(0, 500) : null,
    })
    .then(() => {})
    .catch(() => {});
}

export async function getUpstreamCreds(
  admin: SupabaseClient,
): Promise<{ baseUrl: string; token: string } | null> {
  const { data } = await admin
    .from("integration_credentials")
    .select("field_key, field_value")
    .eq("integration_id", INTEGRATION_ID);

  const creds: Record<string, string> = {};
  for (const r of data ?? []) creds[r.field_key] = r.field_value;

  const baseUrl = (creds.LIBROSA_REST_URL || "").replace(/\/+$/, "");
  const token = creds.LIBROSA_REST_TOKEN;
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

export interface UpstreamResult {
  ok: boolean;
  parsed?: Record<string, unknown>;
  status?: number;
  error?: string;
  durationMs: number;
}

/** Calls the UNCHANGED upstream endpoint. No port/endpoint changes required. */
export async function callUpstream(
  creds: { baseUrl: string; token: string },
  path: "/analyze" | "/analyze_full",
  body: Record<string, unknown>,
  timeoutMs = 180_000,
): Promise<UpstreamResult> {
  const t0 = Date.now();
  try {
    const resp = await fetch(`${creds.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await resp.text();
    const durationMs = Date.now() - t0;

    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        error: `Upstream HTTP ${resp.status}: ${text.slice(0, 500)}`,
        durationMs,
      };
    }
    try {
      return { ok: true, parsed: JSON.parse(text), status: resp.status, durationMs };
    } catch {
      return {
        ok: false,
        status: resp.status,
        error: `Unparseable upstream response: ${text.slice(0, 300)}`,
        durationMs,
      };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Network error",
      durationMs: Date.now() - t0,
    };
  }
}

/**
 * Content-addressed profile embedding.
 *
 * Whenever Librosa features become available for an audio source, derive the
 * acoustic profile string and store its vector on `audio_sources.profile_embedding`
 * so kNN warm-starts work for uploads too. The vector itself is resolved through
 * `embedAudioProfileCached`, keyed by this cache key — so the second (and every
 * later) upload of the same audio reuses the stored vector and makes ZERO calls
 * to the EC2 inference server.
 *
 * Never throws: embeddings are enrichment, not a precondition for analysis.
 */
export async function attachProfileEmbedding(
  // deno-lint-disable-next-line no-explicit-any
  admin: any,
  args: {
    cacheKey: string | null;
    audioSourceId: string | null;
    userId?: string | null;
    features: Record<string, unknown> | null;
  },
): Promise<"audio_cache" | "text_cache" | "computed" | "skipped"> {
  try {
    if (!args.features) return "skipped";
    const profile = formatLibrosaProfile(args.features);
    if (!profile) return "skipped";

    const { vector, source } = await embedAudioProfileCached(
      admin,
      args.cacheKey,
      profile,
    );
    if (!vector) return "skipped";

    if (args.audioSourceId) {
      const q = admin
        .from("audio_sources")
        .update({ profile_embedding: vector })
        .eq("id", args.audioSourceId);
      await (args.userId ? q.eq("user_id", args.userId) : q);
    }
    return source;
  } catch (e) {
    console.warn(
      "attachProfileEmbedding failed:",
      e instanceof Error ? e.message : e,
    );
    return "skipped";
  }
}
