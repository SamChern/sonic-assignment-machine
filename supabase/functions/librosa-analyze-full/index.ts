// Proxy to the Librosa REST /analyze_full endpoint, wrapped in a caching,
// single-flight, concurrency-capped, circuit-broken layer.
//
// The upstream contract is UNCHANGED: same host, same port, same endpoint. All
// of the machinery here exists to send that service fewer and smaller requests.
//
// Body: { audio_url? | audio_b64? | youtube_url?, audio_source_id?,
//         identity?, profile?: "fast" | "full", async?: boolean,
//         duration?, n_mfcc?, max_frames?, recurrence_size? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  breakerOpen,
  callUpstream,
  claimFlight,
  computeCacheKey,
  failFlight,
  finishFlight,
  getUpstreamCreds,
  inflightCount,
  logCall,
  MAX_INFLIGHT,
  readCache,
  resolveParams,
  attachProfileEmbedding,
} from "../_shared/librosa.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ success: false, error: "Missing auth" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ success: false, error: "Body must be JSON" }, 400);
    }

    const provided = ["audio_url", "audio_b64", "youtube_url"].filter(
      (k) =>
        typeof (body as Record<string, unknown>)[k] === "string" &&
        ((body as Record<string, string>)[k] ?? "").length > 0,
    );
    if (provided.length !== 1) {
      return json(
        {
          success: false,
          error: "Provide exactly one of audio_url, audio_b64, youtube_url.",
        },
        400,
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const audioSourceId =
      typeof body.audio_source_id === "string" ? body.audio_source_id : null;
    const identity = typeof body.identity === "string" ? body.identity : null;
    const profile = body.profile === "full" ? "full" : "fast";
    const wantAsync = body.async === true;

    const params = resolveParams(body as Record<string, unknown>, profile);
    const input = {
      audio_url: typeof body.audio_url === "string" ? body.audio_url : undefined,
      audio_b64: typeof body.audio_b64 === "string" ? body.audio_b64 : undefined,
      youtube_url:
        typeof body.youtube_url === "string" ? body.youtube_url : undefined,
    };
    const cacheKey = await computeCacheKey(input, params, identity);

    // ---- 1.1 content-addressed cache -------------------------------------
    const cached = await readCache(admin, cacheKey);
    if (cached.status === "ready") {
      logCall(admin, {
        cache_key: cacheKey,
        audio_source_id: audioSourceId,
        outcome: "hit",
        cache_hit: true,
      });
      await persist(admin, audioSourceId, userId, cached.features, "ready");
      const embedSource = await attachProfileEmbedding(admin, {
        cacheKey,
        audioSourceId,
        userId,
        features: cached.features as Record<string, unknown> | null,
      });
      return json({
        success: true,
        cached: true,
        cache_key: cacheKey,
        embedding_source: embedSource,
        result: cached.features,
      });
    }

    // Legacy per-row cache: still honour an existing librosa_features blob.
    if (audioSourceId) {
      const { data: existing } = await admin
        .from("audio_sources")
        .select("librosa_features")
        .eq("id", audioSourceId)
        .maybeSingle();
      if (existing?.librosa_features) {
        logCall(admin, {
          cache_key: cacheKey,
          audio_source_id: audioSourceId,
          outcome: "hit",
          cache_hit: true,
        });
        return json({
          success: true,
          cached: true,
          cache_key: cacheKey,
          result: existing.librosa_features,
        });
      }
    }

    // ---- 1.7 circuit breaker ---------------------------------------------
    if (await breakerOpen(admin)) {
      logCall(admin, {
        cache_key: cacheKey,
        audio_source_id: audioSourceId,
        outcome: "breaker_open",
      });
      const jobId = await enqueue(admin, {
        cacheKey,
        audioSourceId,
        userId,
        params,
        input,
        identity,
      });
      await persist(admin, audioSourceId, userId, null, "pending");
      return json(
        {
          success: true,
          queued: true,
          degraded: true,
          job_id: jobId,
          cache_key: cacheKey,
          message:
            "Audio analysis service is unavailable; the job is queued and will run automatically.",
        },
        202,
      );
    }

    // ---- 1.2 single flight + 1.3 concurrency cap + 1.4 queue -------------
    const alreadyRunning = cached.status === "pending";
    const overCap = (await inflightCount(admin)) >= MAX_INFLIGHT;

    if (wantAsync || alreadyRunning || overCap) {
      const jobId = await enqueue(admin, {
        cacheKey,
        audioSourceId,
        userId,
        params,
        input,
        identity,
      });
      logCall(admin, {
        cache_key: cacheKey,
        audio_source_id: audioSourceId,
        outcome: alreadyRunning || overCap ? "throttled" : "queued",
      });
      await persist(admin, audioSourceId, userId, null, "pending");
      return json(
        {
          success: true,
          queued: true,
          job_id: jobId,
          cache_key: cacheKey,
          message: alreadyRunning
            ? "This audio is already being analyzed; results will appear shortly."
            : "Analysis queued.",
        },
        202,
      );
    }

    const won = await claimFlight(admin, cacheKey, params);
    if (!won) {
      const jobId = await enqueue(admin, {
        cacheKey,
        audioSourceId,
        userId,
        params,
        input,
        identity,
      });
      await persist(admin, audioSourceId, userId, null, "pending");
      return json(
        { success: true, queued: true, job_id: jobId, cache_key: cacheKey },
        202,
      );
    }

    // ---- upstream call (unchanged endpoint) -------------------------------
    const creds = await getUpstreamCreds(admin);
    if (!creds) {
      await failFlight(admin, cacheKey, "Librosa REST API not configured");
      return json(
        { success: false, error: "Librosa REST API not configured by admin" },
        503,
      );
    }

    await persist(admin, audioSourceId, userId, null, "processing");

    const upstreamBody: Record<string, unknown> = { ...input, ...params };
    for (const k of Object.keys(upstreamBody)) {
      if (upstreamBody[k] === undefined) delete upstreamBody[k];
    }

    const res = await callUpstream(creds, "/analyze_full", upstreamBody);

    if (!res.ok || !res.parsed) {
      await failFlight(admin, cacheKey, res.error ?? "Upstream failed");
      logCall(admin, {
        cache_key: cacheKey,
        audio_source_id: audioSourceId,
        outcome: "error",
        duration_ms: res.durationMs,
        http_status: res.status ?? null,
        error_message: res.error ?? null,
      });
      await persist(admin, audioSourceId, userId, null, "failed", res.error);
      return json({ success: false, error: res.error ?? "Upstream failed" }, 502);
    }

    await finishFlight(admin, cacheKey, res.parsed);
    logCall(admin, {
      cache_key: cacheKey,
      audio_source_id: audioSourceId,
      outcome: "ok",
      duration_ms: res.durationMs,
      http_status: res.status ?? null,
    });
    await persist(admin, audioSourceId, userId, res.parsed, "ready");
    const embedSource = await attachProfileEmbedding(admin, {
      cacheKey,
      audioSourceId,
      userId,
      features: res.parsed as Record<string, unknown> | null,
    });

    return json({
      success: true,
      cached: false,
      cache_key: cacheKey,
      embedding_source: embedSource,
      result: res.parsed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return json({ success: false, error: msg }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function enqueue(admin: any, args: {
  cacheKey: string;
  audioSourceId: string | null;
  userId: string;
  params: Record<string, unknown>;
  input: Record<string, unknown>;
  identity: string | null;
}): Promise<string | null> {
  // Don't stack duplicate jobs for the same cache key.
  const { data: existing } = await admin
    .from("analysis_jobs")
    .select("id")
    .eq("cache_key", args.cacheKey)
    .in("status", ["pending", "processing"])
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data, error } = await admin
    .from("analysis_jobs")
    .insert({
      cache_key: args.cacheKey,
      audio_source_id: args.audioSourceId,
      user_id: args.userId,
      kind: "librosa_full",
      params: { ...args.params, ...args.input, identity: args.identity },
      status: "pending",
    })
    .select("id")
    .maybeSingle();
  if (error) console.warn("enqueue failed:", error.message);
  return (data?.id as string) ?? null;
}

// deno-lint-ignore no-explicit-any
async function persist(
  admin: any,
  audioSourceId: string | null,
  userId: string,
  features: Record<string, unknown> | null,
  status: string,
  error?: string | null,
) {
  if (!audioSourceId) return;
  const patch: Record<string, unknown> = {
    analysis_status: status,
    analysis_error: error ? error.slice(0, 500) : null,
  };
  if (features) patch.librosa_features = features;
  const { error: updErr } = await admin
    .from("audio_sources")
    .update(patch)
    .eq("id", audioSourceId)
    .eq("user_id", userId);
  if (updErr) console.warn("persist failed:", updErr.message);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
