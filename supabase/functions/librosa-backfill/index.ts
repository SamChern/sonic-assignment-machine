// Phase 2 — cache warming / backfill.
//
// Enqueues low-priority fast-profile analysis jobs for audio sources that have
// no librosa features yet, at a trickle rate the (unchanged) analysis service
// can absorb. Over time most user-facing requests become cache hits, so the
// pipeline keeps working even if the service is capped or unavailable.
//
// Admin only. Body: { limit?: number }  (1..200, default 25)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { computeCacheKey, FAST_PROFILE, readCache } from "../_shared/librosa.ts";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";

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

    // Uniform authorization: admin role or internal service-role invocation.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }

    const body = await req.json().catch(() => ({}));
    const rawLimit = Number((body as Record<string, unknown>)?.limit ?? 25);
    const limit = Math.max(1, Math.min(200, Number.isFinite(rawLimit) ? Math.round(rawLimit) : 25));

    const { data: rows, error } = await admin
      .from("audio_sources")
      .select("id, user_id, spotify_id, preview_url, file_url, librosa_features")
      .is("librosa_features", null)
      .order("created_at", { ascending: true })
      .limit(limit * 3);
    if (error) return json({ success: false, error: error.message }, 500);

    let queued = 0;
    let alreadyCached = 0;
    let skipped = 0;

    for (const row of rows ?? []) {
      if (queued >= limit) break;

      const audioUrl = row.preview_url || row.file_url;
      if (!audioUrl) {
        skipped++;
        continue;
      }

      const cacheKey = await computeCacheKey(
        { audio_url: audioUrl },
        { ...FAST_PROFILE },
        row.spotify_id ?? null,
      );

      // Already analyzed by someone else — just attach the cached blob.
      const cached = await readCache(admin, cacheKey);
      if (cached.status === "ready") {
        await admin
          .from("audio_sources")
          .update({
            librosa_features: cached.features,
            analysis_status: "ready",
            analysis_error: null,
          })
          .eq("id", row.id);
        alreadyCached++;
        continue;
      }
      if (cached.status === "pending") {
        skipped++;
        continue;
      }

      // Don't double-queue.
      const { data: existing } = await admin
        .from("analysis_jobs")
        .select("id")
        .eq("cache_key", cacheKey)
        .in("status", ["pending", "processing"])
        .limit(1);
      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      const { error: insErr } = await admin.from("analysis_jobs").insert({
        audio_source_id: row.id,
        user_id: row.user_id,
        cache_key: cacheKey,
        kind: "librosa_fast",
        // Backfill runs behind every user-facing request.
        priority: 900,
        params: { audio_url: audioUrl, ...FAST_PROFILE },
      });
      if (insErr) {
        skipped++;
        continue;
      }

      await admin
        .from("audio_sources")
        .update({ analysis_status: "queued", analysis_error: null })
        .eq("id", row.id);
      queued++;
    }

    return json({
      success: true,
      queued,
      already_cached: alreadyCached,
      skipped,
      candidates: rows?.length ?? 0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return json({ success: false, error: msg }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
