// Background drain for public.analysis_jobs.
//
// Invoked on a schedule (pg_cron -> pg_net) and callable by an admin from the
// UI. Claims a small number of pending jobs with FOR UPDATE SKIP LOCKED and
// runs them against the UNCHANGED Librosa REST endpoint, never exceeding the
// concurrency the upstream service can absorb.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthzError, requireAdmin } from "../_shared/admin.ts";
import {
  breakerOpen,
  callUpstream,
  claimFlight,
  failFlight,
  finishFlight,
  getUpstreamCreds,
  logCall,
  MAX_INFLIGHT,
  readCache,
} from "../_shared/librosa.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Privileged endpoint: scheduled runs (service role) or admins only.
    try {
      await requireAdmin(req, admin);
    } catch (e) {
      if (e instanceof AuthzError) return json({ success: false, error: e.message }, e.status);
      throw e;
    }

    if (await breakerOpen(admin)) {
      return json({ success: true, skipped: "circuit_breaker_open", processed: 0 });
    }

    const { data: claimed, error: claimErr } = await admin.rpc(
      "claim_analysis_jobs",
      { p_limit: MAX_INFLIGHT },
    );
    if (claimErr) return json({ success: false, error: claimErr.message }, 500);

    const jobs = (claimed ?? []) as Array<Record<string, unknown>>;
    if (jobs.length === 0) return json({ success: true, processed: 0 });

    const creds = await getUpstreamCreds(admin);
    if (!creds) {
      for (const j of jobs) {
        await releaseJob(admin, j, "Librosa REST API not configured");
      }
      return json({ success: false, error: "Librosa REST API not configured" }, 503);
    }

    let ok = 0;
    let failed = 0;

    // Strictly sequential: one upstream request at a time.
    for (const job of jobs) {
      const cacheKey = job.cache_key as string;
      const audioSourceId = (job.audio_source_id as string | null) ?? null;
      const userId = (job.user_id as string | null) ?? null;
      const p = (job.params ?? {}) as Record<string, unknown>;

      // Another path may have filled the cache since this job was queued.
      const cached = await readCache(admin, cacheKey);
      if (cached.status === "ready") {
        await completeJob(admin, job, audioSourceId, userId, cached.features);
        logCall(admin, {
          cache_key: cacheKey,
          audio_source_id: audioSourceId,
          outcome: "hit",
          cache_hit: true,
        });
        ok++;
        continue;
      }

      await claimFlight(admin, cacheKey, {
        duration: Number(p.duration ?? 45),
        n_mfcc: Number(p.n_mfcc ?? 20),
        max_frames: Number(p.max_frames ?? 256),
        recurrence_size: Number(p.recurrence_size ?? 0),
      });

      const upstreamBody: Record<string, unknown> = {};
      for (const k of [
        "audio_url",
        "audio_b64",
        "youtube_url",
        "duration",
        "n_mfcc",
        "max_frames",
        "recurrence_size",
      ]) {
        if (p[k] !== undefined && p[k] !== null) upstreamBody[k] = p[k];
      }

      if (
        !upstreamBody.audio_url &&
        !upstreamBody.audio_b64 &&
        !upstreamBody.youtube_url
      ) {
        await hardFailJob(admin, job, audioSourceId, userId, "No audio input on job");
        failed++;
        continue;
      }

      await setSourceStatus(admin, audioSourceId, userId, "processing");
      const res = await callUpstream(creds, "/analyze_full", upstreamBody);

      if (res.ok && res.parsed) {
        await finishFlight(admin, cacheKey, res.parsed);
        await completeJob(admin, job, audioSourceId, userId, res.parsed);
        logCall(admin, {
          cache_key: cacheKey,
          audio_source_id: audioSourceId,
          outcome: "ok",
          duration_ms: res.durationMs,
          http_status: res.status ?? null,
        });
        ok++;
      } else {
        const msg = res.error ?? "Upstream failed";
        await failFlight(admin, cacheKey, msg);
        logCall(admin, {
          cache_key: cacheKey,
          audio_source_id: audioSourceId,
          outcome: "error",
          duration_ms: res.durationMs,
          http_status: res.status ?? null,
          error_message: msg,
        });
        const attempts = Number(job.attempts ?? 1);
        if (attempts >= MAX_ATTEMPTS) {
          await hardFailJob(admin, job, audioSourceId, userId, msg);
        } else {
          await releaseJob(admin, job, msg);
        }
        failed++;
        // Stop the batch after an upstream failure — don't hammer the service.
        break;
      }
    }

    return json({ success: true, processed: ok + failed, ok, failed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return json({ success: false, error: msg }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function completeJob(
  admin: any,
  job: Record<string, unknown>,
  audioSourceId: string | null,
  userId: string | null,
  features: Record<string, unknown>,
) {
  await admin
    .from("analysis_jobs")
    .update({ status: "done", finished_at: new Date().toISOString(), last_error: null })
    .eq("id", job.id as string);

  if (audioSourceId) {
    const q = admin
      .from("audio_sources")
      .update({
        librosa_features: features,
        analysis_status: "ready",
        analysis_error: null,
      })
      .eq("id", audioSourceId);
    await (userId ? q.eq("user_id", userId) : q);
  }
}

// deno-lint-ignore no-explicit-any
async function releaseJob(admin: any, job: Record<string, unknown>, error: string) {
  await admin
    .from("analysis_jobs")
    .update({ status: "pending", last_error: error.slice(0, 500) })
    .eq("id", job.id as string);
}

// deno-lint-ignore no-explicit-any
async function hardFailJob(
  admin: any,
  job: Record<string, unknown>,
  audioSourceId: string | null,
  userId: string | null,
  error: string,
) {
  await admin
    .from("analysis_jobs")
    .update({
      status: "failed",
      last_error: error.slice(0, 500),
      finished_at: new Date().toISOString(),
    })
    .eq("id", job.id as string);
  await setSourceStatus(admin, audioSourceId, userId, "failed", error);
}

// deno-lint-ignore no-explicit-any
async function setSourceStatus(
  admin: any,
  audioSourceId: string | null,
  userId: string | null,
  status: string,
  error?: string,
) {
  if (!audioSourceId) return;
  const q = admin
    .from("audio_sources")
    .update({
      analysis_status: status,
      analysis_error: error ? error.slice(0, 500) : null,
    })
    .eq("id", audioSourceId);
  await (userId ? q.eq("user_id", userId) : q);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
