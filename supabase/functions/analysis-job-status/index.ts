// Job status endpoint for background audio processing.
//
// Returns the caller's analysis_jobs rows (admins may ask for all), enriched
// with queue position, a coarse progress percentage and the linked audio
// source name — so the UI can show progress and users can resume checking
// after a reload.
//
// It also acts as the queue kick: when the caller still has pending work and
// the worker is neither paused nor already leased, this function invokes
// librosa-worker exactly once behind a short single-flight lease. Bounded
// batch size, attempt caps and the circuit breaker all live in the worker.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ACTIVE = ["pending", "processing"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ success: false, error: "Missing auth" }, 401);
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return json({ success: false, error: "Missing auth" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    // Validate the caller with the trusted backend client. This avoids
    // coupling user-token validation to the runtime's anon-key binding while
    // still cryptographically verifying the JWT with the auth service.
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
    const userId = userData.user.id;

    const body = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};
    const raw = (body ?? {}) as Record<string, unknown>;

    const jobIds = Array.isArray(raw.job_ids)
      ? (raw.job_ids as unknown[]).filter((v) => typeof v === "string").slice(0, 200) as string[]
      : null;
    const sourceIds = Array.isArray(raw.audio_source_ids)
      ? (raw.audio_source_ids as unknown[]).filter((v) => typeof v === "string").slice(0, 200) as string[]
      : null;
    const activeOnly = raw.active_only === true;
    const allUsers = raw.all_users === true;
    const kick = raw.kick !== false;
    const limit = Math.min(Math.max(Number(raw.limit ?? 25) || 25, 1), 100);

    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    const scopeAll = allUsers && isAdmin === true;

    let q = admin
      .from("analysis_jobs")
      .select(
        "id,kind,status,attempts,priority,last_error,created_at,started_at,finished_at,audio_source_id,user_id",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!scopeAll) q = q.eq("user_id", userId);
    if (activeOnly) q = q.in("status", ACTIVE);
    if (jobIds?.length) q = q.in("id", jobIds);
    if (sourceIds?.length) q = q.in("audio_source_id", sourceIds);

    const { data: jobRows, error: jobErr } = await q;
    if (jobErr) return json({ success: false, error: jobErr.message }, 500);

    const jobs = jobRows ?? [];

    // Names for the linked audio sources (single round trip).
    const linkedIds = [
      ...new Set(
        jobs.map((j) => j.audio_source_id).filter((v): v is string => !!v),
      ),
    ];
    const nameMap = new Map<string, { name: string; analysis_status: string }>();
    if (linkedIds.length) {
      const { data: srcs } = await admin
        .from("audio_sources")
        .select("id,name,analysis_status")
        .in("id", linkedIds);
      for (const s of srcs ?? []) {
        nameMap.set(s.id as string, {
          name: (s.name as string) ?? "Audio source",
          analysis_status: (s.analysis_status as string) ?? "unknown",
        });
      }
    }

    // Global queue depth -> queue position for pending jobs.
    const { data: pendingAll } = await admin
      .from("analysis_jobs")
      .select("id,created_at,priority")
      .eq("status", "pending")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(500);
    const order = new Map<string, number>();
    (pendingAll ?? []).forEach((row, i) => order.set(row.id as string, i + 1));

    const { data: workerRow } = await admin
      .from("job_worker_state")
      .select("paused,pause_reason,paused_at,last_kick_at,last_error,lease_until")
      .eq("id", "singleton")
      .maybeSingle();

    const paused = workerRow?.paused === true;

    // Gated kick: only when this caller actually has pending work.
    let kicked = false;
    const hasPending = jobs.some((j) => j.status === "pending");
    if (kick && hasPending && !paused) {
      const { data: leased } = await admin.rpc("acquire_job_worker_lease", {
        p_owner: `status-${crypto.randomUUID()}`,
        p_seconds: 20,
      });
      if (leased === true) {
        kicked = true;
        // Fire and forget: the worker owns its own bounded batch + breaker.
        admin.functions
          .invoke("librosa-worker", { body: { source: "job-status-kick" } })
          .catch(async (e: unknown) => {
            const msg = e instanceof Error ? e.message : "worker kick failed";
            await admin
              .from("job_worker_state")
              .update({ last_error: msg.slice(0, 500) })
              .eq("id", "singleton");
          });
      }
    }

    return json({
      success: true,
      is_admin: isAdmin === true,
      worker: {
        paused,
        pause_reason: workerRow?.pause_reason ?? null,
        paused_at: workerRow?.paused_at ?? null,
        last_kick_at: workerRow?.last_kick_at ?? null,
        last_error: workerRow?.last_error ?? null,
        busy: !!workerRow?.lease_until &&
          new Date(workerRow.lease_until as string) > new Date(),
      },
      kicked,
      queue_depth: (pendingAll ?? []).length,
      jobs: jobs.map((j) => {
        const src = j.audio_source_id ? nameMap.get(j.audio_source_id) : null;
        return {
          id: j.id,
          kind: j.kind,
          status: j.status,
          attempts: j.attempts ?? 0,
          last_error: j.last_error ?? null,
          created_at: j.created_at,
          started_at: j.started_at ?? null,
          finished_at: j.finished_at ?? null,
          audio_source_id: j.audio_source_id ?? null,
          source_name: src?.name ?? null,
          source_status: src?.analysis_status ?? null,
          queue_position: j.status === "pending"
            ? order.get(j.id as string) ?? null
            : null,
          progress: progressFor(j.status as string, j.attempts as number),
        };
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return json({ success: false, error: msg }, 500);
  }
});

function progressFor(status: string, attempts: number) {
  switch (status) {
    case "pending":
      return attempts > 0 ? 25 : 10;
    case "processing":
      return 65;
    case "done":
      return 100;
    case "failed":
      return 100;
    default:
      return 0;
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
