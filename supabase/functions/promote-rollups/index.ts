// Step 2.5-alt: promote a staged rollup batch into the app's own structures.
//
// The EC2 ingest worker never touches app tables. It writes plain
// `(subject_key, taxonomy_code, day, weight)` rows into `public.ingest_rollups`
// for one object key and marks the ledger row `loaded`. This function owns the
// mapping from there:
//
//   1. read the object's rollup rows in bounded pages, grouped by subject;
//   2. fold each subject's tag codes into one scoring task (weights kept);
//   3. upsert those tasks into `public.intuizi_score_queue` idempotently
//      (unique on object_key + identifier, so a re-run replaces, never dupes);
//   4. kick `intuizi-score-worker` once, which resolves taxonomy codes through
//      `resolveTag` (creating unreviewed nodes, skipping suppressed sensitive
//      classes), upserts `intuizi_identifiers` / `audio_sources` /
//      `audio_source_tags` and scores the subject.
//
// Because step 4 reuses the existing scoring path, ingest can never drift from
// the ontology rules enforced everywhere else.
//
// Auth: service-role bearer token or the shared INGEST_WORKER_SECRET (the
// callback invokes it), or an admin session (manual re-promote from the ledger).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { activationIdFromKey } from "../_shared/intuizi.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Rollup rows read per page — bounded so a huge object cannot blow memory. */
const PAGE = 250;
/** Queue rows written per upsert batch. */
const QUEUE_BATCH = 250;
/** Tags kept per subject (the queue consumer caps at 64 as well). */
const MAX_TAGS_PER_SUBJECT = 64;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function secretMatches(provided: string | null): boolean {
  const expected = Deno.env.get("INGEST_WORKER_SECRET");
  if (!expected || !provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

async function authorized(req: Request, admin: ReturnType<typeof createClient>): Promise<boolean> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? null;
  if (bearer && SERVICE_KEY && bearer === SERVICE_KEY) return true;
  if (secretMatches(req.headers.get("x-worker-secret"))) return true;
  if (!bearer) return false;
  // Admin session: allow a manual re-promote from the ledger UI.
  const { data: userRes } = await admin.auth.getUser(bearer);
  const uid = userRes?.user?.id;
  if (!uid) return false;
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: uid, _role: "admin" });
  return isAdmin === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!(await authorized(req, admin))) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ success: false, error: "invalid JSON body" }, 400);
  }

  const objectKey = typeof body.object_key === "string" ? body.object_key.trim() : "";
  if (!objectKey) return json({ success: false, error: "object_key is required" }, 400);

  const { data: file } = await admin
    .from("intuizi_ingest_files")
    .select("id,object_key,report_type,status,trace_id,promotion_cursor,promoted_subjects")
    .eq("object_key", objectKey)
    .maybeSingle();

  const reportType = typeof body.report_type === "string"
    ? body.report_type
    : file?.report_type ?? null;
  const activationId = activationIdFromKey(objectKey);
  const ownerId = typeof body.owner_id === "string" ? body.owner_id : null;
  const traceId = typeof body.trace_id === "string" ? body.trace_id : file?.trace_id ?? null;
  const now = new Date().toISOString();

  // ---- Read one bounded, fully aggregated subject page ----------------------
  const afterSubject = typeof body.after_subject === "string"
    ? body.after_subject
    : file?.promotion_cursor ?? null;
  const { data: page, error: pageErr } = await admin.rpc("read_ingest_rollup_subject_batch", {
    p_object_key: objectKey,
    p_after_subject: afterSubject,
    p_limit: PAGE,
  });
  if (pageErr) return json({ success: false, error: pageErr.message, retryable: true }, 503);

  const subjects = ((page ?? []) as Array<{ subject_key: string; tags: unknown }>).flatMap((r) => {
    const subject = String(r.subject_key ?? "").trim();
    if (!subject || !Array.isArray(r.tags)) return [];
    const tags = r.tags.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const tag = raw as Record<string, unknown>;
      const code = String(tag.code ?? "").trim();
      if (!code) return [];
      return [{ code: code.slice(0, 200), weight: Number(tag.weight ?? 1) || 1 }];
    }).slice(0, MAX_TAGS_PER_SUBJECT);
    return tags.length ? [{ subject, tags }] : [];
  });

  if (subjects.length === 0) {
    if (file?.status === "loaded") {
      await admin.from("intuizi_ingest_files").update({
        status: "done",
        processed_rows: Number(file.promoted_subjects ?? 0) || 0,
        error_message: null,
        finished_at: now,
      }).eq("id", file.id);
    }
    return json({ success: true, object_key: objectKey, subjects: 0, queued: 0, complete: true });
  }

  // ---- Enqueue scoring tasks ----------------------------------------------
  const rows = subjects.map(({ subject, tags }) => ({
    object_key: objectKey,
    report_type: reportType,
    identifier: subject.slice(0, 512),
    activation_id: activationId,
    owner_id: ownerId,
    label: null as string | null,
    tags,
    signals: [],
    // Confidence scales gently with how many distinct tags a subject carries.
    confidence: Math.min(0.4 + tags.length * 0.05, 0.9),
    trace_id: traceId,
  }));

  // Same guarded RPC the worker callback uses: one bounded statement per chunk,
  // and rows already scored are left untouched instead of being rewritten.
  let queued = 0;
  for (let i = 0; i < rows.length; i += QUEUE_BATCH) {
    const slice = rows.slice(i, i + QUEUE_BATCH);
    const { data: n, error } = await admin.rpc("enqueue_score_tasks", { p_rows: slice });
    if (error) {
      const transient = /timeout|canceling statement|deadlock|lock/i.test(error.message);
      console.error(JSON.stringify({
        evt: "promote_rollups_enqueue_failed",
        object_key: objectKey,
        trace_id: traceId,
        retryable: transient,
        queued,
        error: error.message,
      }));
      if (file) {
        await admin.from("intuizi_ingest_files")
          .update({ error_message: `promote failed: ${error.message}`.slice(0, 2000) })
          .eq("id", file.id);
      }
      return json({
        success: false,
        error: error.message,
        retryable: transient,
        queued,
      }, transient ? 503 : 500);
    }
    queued += Number(n ?? 0) || 0;
  }


  const lastSubject = subjects[subjects.length - 1]?.subject ?? afterSubject;
  const promotedTotal = (Number(file?.promoted_subjects ?? 0) || 0) + rows.length;
  const complete = rows.length < PAGE;

  if (file && file.status === "loaded") {
    await admin.from("intuizi_ingest_files").update({
      status: complete ? "done" : "loaded",
      promotion_cursor: lastSubject,
      promoted_subjects: promotedTotal,
      processed_rows: promotedTotal,
      error_message: null,
      finished_at: complete ? now : null,
    }).eq("id", file.id);
  }

  if (!complete) {
    admin.functions.invoke("promote-rollups", {
      body: { object_key: objectKey, report_type: reportType, trace_id: traceId },
    }).catch((e: unknown) => console.warn("promote continuation failed", String(e)));
  }

  admin.functions.invoke("intuizi-score-worker", { body: { source: "promote_rollups" } })
    .catch((e: unknown) => console.warn("score worker kick failed", String(e)));

  console.log(JSON.stringify({
    evt: "promote_rollups",
    object_key: objectKey,
    report_type: reportType,
    activation_id: activationId,
    trace_id: traceId,
    subjects: subjects.length,
    queued,
    complete,
    promotion_cursor: lastSubject,
  }));

  return json({
    success: true,
    object_key: objectKey,
    subjects: subjects.length,
    queued,
    complete,
    promotion_cursor: lastSubject,
  });
});
