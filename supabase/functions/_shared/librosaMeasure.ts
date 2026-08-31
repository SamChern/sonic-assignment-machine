// On-demand librosa measurement for audio we hold a URL for.
//
// Why this exists: the musical read (pitch / rhythm / timbre) is derived from
// librosa scalars, and `analyze-audio` only ever *read* those scalars out of
// `audio_sources.librosa_features`. A file the listener just uploaded has no
// cached blob yet, so their own music fell back to CLAP tags alone and the
// musical read stayed empty — only pre-measured (Intuizi / backfilled) rows
// showed real pitch/rhythm/timbre numbers.
//
// This module measures the audio inline, once, through the same unchanged
// upstream endpoint and the same content-addressed cache the async worker uses:
//
//   url -> librosa_cache (content-addressed) -> /analyze on EC2
//       -> audio_sources.librosa_features + profile_embedding
//
// It is enrichment, never a dependency: every failure path returns null and the
// caller falls through to the previous evidence tiers.

import {
  attachProfileEmbedding,
  breakerOpen,
  callUpstream,
  claimFlight,
  computeCacheKey,
  failFlight,
  finishFlight,
  FAST_PROFILE,
  getUpstreamCreds,
  inflightCount,
  logCall,
  MAX_INFLIGHT,
  readCache,
} from "./librosa.ts";

/** Hard ceiling on how many fresh upstream measurements one request may trigger. */
export const MAX_INLINE_MEASUREMENTS = 3;

export interface MeasureResult {
  features: Record<string, unknown>;
  /** Where the numbers came from — useful for logging/telemetry. */
  origin: "cache" | "measured";
}

/**
 * Ensure librosa features exist for one audio URL.
 *
 * `allowUpstream` lets the caller cap fresh EC2 work per request: when false we
 * only serve what is already cached.
 */
export async function ensureLibrosaFeatures(
  // deno-lint-ignore no-explicit-any
  admin: any,
  opts: {
    url: string;
    audioSourceId?: string | null;
    userId?: string | null;
    /** Provider track id, so two rows for the same track share a cache entry. */
    identity?: string | null;
    allowUpstream?: boolean;
  },
): Promise<MeasureResult | null> {
  const url = (opts.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return null;

  const params = { ...FAST_PROFILE };
  const input = { audio_url: url };

  let cacheKey: string | null = null;
  try {
    cacheKey = await computeCacheKey(input, params, opts.identity ?? null);

    const cached = await readCache(admin, cacheKey);
    if (cached.status === "ready") {
      await persistFeatures(admin, opts, cached.features);
      return { features: cached.features, origin: "cache" };
    }
    if (cached.status === "pending") return null; // another caller is measuring it

    if (opts.allowUpstream === false) return null;
    if (await breakerOpen(admin)) return null;
    if ((await inflightCount(admin)) >= MAX_INFLIGHT) return null;
    if (!(await claimFlight(admin, cacheKey, params))) return null;

    const creds = await getUpstreamCreds(admin);
    if (!creds) {
      await failFlight(admin, cacheKey, "Librosa REST credentials not configured");
      return null;
    }

    const res = await callUpstream(creds, "/analyze", { ...input, ...params });
    logCall(admin, {
      cache_key: cacheKey,
      audio_source_id: opts.audioSourceId ?? null,
      outcome: res.ok ? "ok" : "error",
      cache_hit: false,
      duration_ms: res.durationMs,
      http_status: res.status ?? null,
      error_message: res.error ?? null,
    });

    if (!res.ok || !res.parsed) {
      await failFlight(admin, cacheKey, res.error ?? "Upstream failure");
      return null;
    }

    const features = (res.parsed.features ?? res.parsed.result ?? res.parsed) as Record<
      string,
      unknown
    >;
    await finishFlight(admin, cacheKey, features);
    await persistFeatures(admin, opts, features);
    return { features, origin: "measured" };
  } catch (e) {
    console.warn("ensureLibrosaFeatures failed:", e instanceof Error ? e.message : e);
    if (cacheKey) {
      try {
        await failFlight(admin, cacheKey, e instanceof Error ? e.message : "unknown error");
      } catch { /* ignore */ }
    }
    return null;
  }
}

/** Write the measurement back onto the row so it is paid for once per file. */
async function persistFeatures(
  // deno-lint-ignore no-explicit-any
  admin: any,
  opts: { audioSourceId?: string | null; userId?: string | null; identity?: string | null },
  features: Record<string, unknown>,
) {
  if (!opts.audioSourceId) return;
  try {
    await admin
      .from("audio_sources")
      .update({ librosa_features: features, analysis_status: "ready", analysis_error: null })
      .eq("id", opts.audioSourceId);
    await attachProfileEmbedding(admin, {
      cacheKey: null,
      audioSourceId: opts.audioSourceId,
      userId: opts.userId ?? null,
      features,
    });
  } catch (e) {
    console.warn("persistFeatures failed:", e instanceof Error ? e.message : e);
  }
}
