// Callback endpoint for the EC2 DuckDB ingest worker (Step 2.5).
//
// The control plane (`intuizi-ingest`) dispatches one SQS message per report
// file. The worker on EC2 decodes the Parquet/CSV with DuckDB, normalizes rows
// into ontology tags + signals, and reports back here in bounded batches.
//
// This function does only cheap, bounded work:
//   - claim / heartbeat the ledger row so a stalled worker can be re-dispatched;
//   - upsert normalized identifiers into `public.intuizi_score_queue`
//     (idempotent per object_key + identifier, so a redelivered SQS message or a
//     resumed row group never duplicates or re-scores finished work);
//   - advance the ledger cursor (`row_group_cursor`, `rows_offset`) so a resume
//     picks up exactly where the worker stopped;
//   - close the file out as done / partial / failed;
//   - kick `intuizi-score-worker` once when new work landed.
//
// Scoring itself still happens in `intuizi-score-worker`, unchanged.
//
// Auth: the worker is a server on EC2 with no user session, so it authenticates
// with either the service-role bearer token or the shared INGEST_WORKER_SECRET.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { newTraceId } from "../_shared/failure.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Cap one callback body so a runaway worker cannot push an unbounded batch. */
const MAX_ROWS_PER_CALL = 2_000;
/** Cap one staged-rollup chunk (Step 2.5-alt). */
const MAX_ROLLUP_ROWS_PER_CALL = 5_000;


type Json = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Constant-time-ish comparison for the shared secret. */
function secretMatches(provided: string | null): boolean {
  const expected = Deno.env.get("INGEST_WORKER_SECRET");
  if (!expected || !provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

function authorized(req: Request): boolean {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? null;
  if (bearer && SERVICE_KEY && bearer === SERVICE_KEY) return true;
  return secretMatches(req.headers.get("x-worker-secret"));
}

interface WorkerTag {
  code: string;
  label?: string | null;
  parent_code?: string | null;
  weight?: number | null;
}

interface WorkerIdentifier {
  identifier: string;
  label?: string | null;
  tags?: WorkerTag[];
  signals?: Json[];
  confidence?: number | null;
}

/** Validate + clamp one identifier row from the worker. */
function cleanIdentifier(raw: unknown): WorkerIdentifier | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const identifier = typeof r.identifier === "string" ? r.identifier.trim() : "";
  if (!identifier || identifier.length > 512) return null;

  const tags = Array.isArray(r.tags)
    ? r.tags.flatMap((t) => {
      if (!t || typeof t !== "object") return [];
      const tag = t as Record<string, unknown>;
      const code = typeof tag.code === "string" ? tag.code.trim() : "";
      if (!code) return [];
      return [{
        code: code.slice(0, 200),
        label: typeof tag.label === "string" ? tag.label.slice(0, 300) : null,
        parent_code: typeof tag.parent_code === "string" ? tag.parent_code.slice(0, 200) : null,
        weight: Number(tag.weight ?? 1) || 1,
      }];
    }).slice(0, 64)
    : [];

  const signals = Array.isArray(r.signals)
    ? (r.signals.filter((s) => s && typeof s === "object") as Json[]).slice(0, 200)
    : [];

  const confidence = Math.min(Math.max(Number(r.confidence ?? 0.5) || 0.5, 0), 1);

  return {
    identifier,
    label: typeof r.label === "string" ? r.label.slice(0, 300) : null,
    tags,
    signals,
    confidence,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!authorized(req)) {
    console.warn(JSON.stringify({ evt: "worker_callback_unauthorized" }));
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Json;
  try {
    body = (await req.json()) as Json;
  } catch {
    return json({ success: false, error: "invalid JSON body" }, 400);
  }

  const workerIdRaw = typeof body.worker_id === "string" ? body.worker_id.slice(0, 200) : null;

  // ---- Config (Step 2.5-alt): hand the HTTP worker its S3 settings ----------
  // The worker holds no S3 keys and no database password of its own; it asks for
  // read credentials at startup, which keeps every secret in the backend.
  if (body.phase === "config") {
    const accessKeyId = Deno.env.get("S3_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("S3_SECRET_ACCESS_KEY");
    const bucket = Deno.env.get("S3_BUCKET");
    if (!accessKeyId || !secretAccessKey || !bucket) {
      return json({
        success: false,
        error: "S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_BUCKET must be configured",
      }, 503);
    }
    return json({
      success: true,
      config: {
        bucket,
        region: Deno.env.get("S3_REGION") ?? "us-west-2",
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
      },
    });
  }

  // ---- Heartbeat (Step 2.5-alt): worker liveness for the admin health card --
  if (body.phase === "heartbeat") {
    const { error } = await admin.from("worker_heartbeats").upsert({
      worker_id: workerIdRaw ?? "unknown-worker",
      host: typeof body.host === "string" ? body.host.slice(0, 200) : null,
      last_seen: new Date().toISOString(),
      stats: (body.stats && typeof body.stats === "object" ? body.stats : {}) as Json,
    }, { onConflict: "worker_id" });
    if (error) return json({ success: false, error: error.message }, 500);
    return json({ success: true });
  }

  // ---- Claim (Step 2.5-alt): hand the worker the next discovered file -------
  // `claim_next_ingest_file` uses FOR UPDATE SKIP LOCKED, so two workers can
  // never take the same file.
  if (body.phase === "claim_next") {
    const { data, error } = await admin.rpc("claim_next_ingest_file", {
      p_worker: workerIdRaw ?? "unknown-worker",
    });
    if (error) return json({ success: false, error: error.message }, 500);
    const claim = Array.isArray(data) ? data[0] : data;
    if (!claim) return json({ success: true, file: null });
    console.log(JSON.stringify({
      evt: "worker_claimed_next",
      trace_id: claim.trace_id,
      object_key: claim.object_key,
      worker_id: workerIdRaw,
    }));
    return json({
      success: true,
      file: {
        file_id: claim.id,
        object_key: claim.object_key,
        report_type: claim.report_type,
        trace_id: claim.trace_id,
      },
    });
  }

  // ---- Rollups (Step 2.5-alt): staged summary rows for one object ----------
  // The worker sends chunks; `replace: true` on the first chunk clears any prior
  // rows for that object, which is what makes a re-run idempotent.
  if (body.phase === "rollups") {
    const key = typeof body.object_key === "string" ? body.object_key.trim() : "";
    if (!key) return json({ success: false, error: "object_key is required" }, 400);
    const raw = Array.isArray(body.rows) ? body.rows : [];
    if (raw.length > MAX_ROLLUP_ROWS_PER_CALL) {
      return json({
        success: false,
        error:
          `too many rollup rows in one call (${raw.length} > ${MAX_ROLLUP_ROWS_PER_CALL}) — send smaller chunks`,
      }, 400);
    }
    if (body.replace === true) {
      const { error: delErr } = await admin.from("ingest_rollups").delete().eq("object_key", key);
      if (delErr) return json({ success: false, error: delErr.message }, 500);
    }
    const reportType = typeof body.report_type === "string" ? body.report_type : null;
    const rows = raw.flatMap((r) => {
      if (!r || typeof r !== "object") return [];
      const row = r as Record<string, unknown>;
      const subject = typeof row.subject_key === "string" ? row.subject_key.trim() : "";
      const code = typeof row.taxonomy_code === "string" ? row.taxonomy_code.trim() : "";
      if (!subject || !code) return [];
      const day = typeof row.day === "string" && /^\d{4}-\d{2}-\d{2}/.test(row.day)
        ? row.day.slice(0, 10)
        : null;
      return [{
        object_key: key,
        report_type: reportType,
        subject_key: subject.slice(0, 512),
        taxonomy_code: code.slice(0, 200),
        day,
        weight: Number(row.weight ?? 1) || 1,
      }];
    });
    if (rows.length) {
      const { error: insErr } = await admin.from("ingest_rollups").insert(rows);
      if (insErr) return json({ success: false, error: insErr.message }, 500);
    }
    return json({ success: true, inserted: rows.length, rejected: raw.length - rows.length });
  }

  // ---- Lease (pull mode): hand the worker the next pending file -------------
  // Queue-free path: instead of an SQS message, the worker asks for work. The
  // RPC picks one row with FOR UPDATE SKIP LOCKED, so two workers can never
  // take the same file, and returns the saved resume cursor.
  if (body.phase === "lease") {
    const staleAfterMin = Math.min(Math.max(Number(body.stale_after_minutes ?? 15) || 15, 2), 240);
    const { data, error } = await admin.rpc("lease_ingest_file", {
      p_worker_id: workerIdRaw ?? "unknown-worker",
      p_stale_after: `${staleAfterMin} minutes`,
    });
    if (error) return json({ success: false, error: error.message }, 500);
    const lease = Array.isArray(data) ? data[0] : data;
    if (!lease) return json({ success: true, lease: null });
    console.log(JSON.stringify({
      evt: "worker_leased_file",
      trace_id: lease.trace_id,
      object_key: lease.object_key,
      worker_id: workerIdRaw,
      resume_rows_offset: lease.rows_offset,
    }));
    return json({
      success: true,
      lease: {
        file_id: lease.file_id,
        object_key: lease.object_key,
        report_type: lease.report_type,
        trace_id: lease.trace_id,
        row_group_cursor: Number(lease.row_group_cursor ?? 0) || 0,
        rows_offset: Number(lease.rows_offset ?? 0) || 0,
        total_rows: Number(lease.total_rows ?? 0) || 0,
      },
    });
  }


  const fileId = typeof body.file_id === "string" ? body.file_id : null;
  const objectKey = typeof body.object_key === "string" ? body.object_key : null;
  if (!fileId && !objectKey) {
    return json({ success: false, error: "file_id or object_key is required" }, 400);
  }

  // `progress` = mid-file batch, `complete` = worker finished its slice,
  // `failed` = worker could not process the file. Step 2.5-alt adds `loaded`
  // (rollups staged, promote them) and `skipped` (summary-only file).
  const phase = typeof body.phase === "string" ? body.phase : "progress";
  if (!["claim", "progress", "complete", "failed", "loaded", "skipped"].includes(phase)) {
    return json({ success: false, error: `unknown phase "${phase}"` }, 400);
  }



  const rawRows = Array.isArray(body.identifiers) ? body.identifiers : [];
  if (rawRows.length > MAX_ROWS_PER_CALL) {
    return json({
      success: false,
      error: `too many identifiers in one call (${rawRows.length} > ${MAX_ROWS_PER_CALL}) — send smaller batches`,
    }, 400);
  }

  // ---- Locate the ledger row ------------------------------------------------
  const ledgerQuery = admin
    .from("intuizi_ingest_files")
    .select(
      "id,object_key,report_type,status,total_rows,processed_rows,failed_rows,row_group_cursor,rows_offset,row_groups_total,trace_id",
    );
  const { data: file, error: fileErr } = fileId
    ? await ledgerQuery.eq("id", fileId).maybeSingle()
    : await ledgerQuery.eq("object_key", objectKey!).maybeSingle();

  if (fileErr) return json({ success: false, error: fileErr.message }, 500);
  if (!file) {
    return json({
      success: false,
      error: `no ledger row for ${fileId ?? objectKey} — the control plane must dispatch a file before the worker reports on it`,
    }, 404);
  }

  const traceId = typeof body.trace_id === "string" && body.trace_id
    ? body.trace_id
    : file.trace_id ?? newTraceId("worker");
  const workerId = workerIdRaw;
  const now = new Date().toISOString();

  // ---- Claim: the worker took the message off the queue ---------------------
  if (phase === "claim") {
    await admin.from("intuizi_ingest_files").update({
      status: "processing",
      worker_id: workerId,
      heartbeat_at: now,
      started_at: now,
      trace_id: traceId,
      error_message: null,
    }).eq("id", file.id);
    console.log(JSON.stringify({
      evt: "worker_claimed_file",
      trace_id: traceId,
      object_key: file.object_key,
      worker_id: workerId,
      resume_at_group: file.row_group_cursor ?? 0,
      resume_rows_offset: file.rows_offset ?? 0,
    }));
    return json({
      success: true,
      file_id: file.id,
      trace_id: traceId,
      resume: {
        row_group_cursor: Number(file.row_group_cursor ?? 0) || 0,
        rows_offset: Number(file.rows_offset ?? 0) || 0,
      },
    });
  }

  // ---- Loaded (Step 2.5-alt): rollups staged, promote them ------------------
  if (phase === "loaded") {
    const rollupRows = Math.max(Number(body.rows ?? body.rows_read ?? 0) || 0, 0);
    const { error: rpcErr } = await admin.rpc("complete_ingest_file", {
      p_id: file.id,
      p_rows: rollupRows,
      p_status: "loaded",
    });
    if (rpcErr) return json({ success: false, error: rpcErr.message }, 500);
    console.log(JSON.stringify({
      evt: "worker_file_loaded",
      trace_id: traceId,
      object_key: file.object_key,
      worker_id: workerId,
      rollup_rows: rollupRows,
    }));
    // Promote inline so the worker's next claim does not race the mapping.
    const { data: promo, error: promoErr } = await admin.functions.invoke("promote-rollups", {
      body: {
        object_key: file.object_key,
        report_type: file.report_type,
        trace_id: traceId,
      },
    });
    if (promoErr) {
      console.error(JSON.stringify({
        evt: "promote_invoke_failed",
        trace_id: traceId,
        object_key: file.object_key,
        error: String(promoErr),
      }));
      return json({ success: true, file_id: file.id, status: "loaded", promoted: false });
    }
    return json({
      success: true,
      file_id: file.id,
      status: "loaded",
      promoted: true,
      promote: promo ?? null,
    });
  }

  // ---- Skipped (Step 2.5-alt): summary-only file, nothing to learn ---------
  if (phase === "skipped") {
    const reason = typeof body.reason === "string"
      ? body.reason
      : "no identifier/taxonomy columns";
    const { error: rpcErr } = await admin.rpc("skip_ingest_file", {
      p_id: file.id,
      p_reason: reason.slice(0, 2000),
    });
    if (rpcErr) return json({ success: false, error: rpcErr.message }, 500);
    console.log(JSON.stringify({
      evt: "worker_file_skipped",
      trace_id: traceId,
      object_key: file.object_key,
      worker_id: workerId,
      reason: reason.slice(0, 300),
    }));
    return json({ success: true, file_id: file.id, status: "skipped" });
  }


  // ---- Failed: park the file so the next dispatch retries it ---------------
  if (phase === "failed") {
    const msg = typeof body.error === "string" ? body.error : "worker reported a failure";
    await admin.from("intuizi_ingest_files").update({
      status: "failed",
      error_message: msg.slice(0, 2000),
      heartbeat_at: now,
      finished_at: now,
      worker_id: workerId,
      trace_id: traceId,
    }).eq("id", file.id);
    console.error(JSON.stringify({
      evt: "worker_file_failed",
      trace_id: traceId,
      object_key: file.object_key,
      worker_id: workerId,
      error: msg.slice(0, 500),
    }));
    return json({ success: true, file_id: file.id, status: "failed" });
  }

  // ---- Progress / complete: enqueue scoring tasks --------------------------
  const rows = rawRows.map(cleanIdentifier).filter((r): r is WorkerIdentifier => r !== null);
  const rejected = rawRows.length - rows.length;
  const reportType = typeof body.report_type === "string" ? body.report_type : file.report_type;
  const activationId = typeof body.activation_id === "string" ? body.activation_id : null;
  const ownerId = typeof body.owner_id === "string" ? body.owner_id : null;

  let queued = 0;
  if (rows.length) {
    // Idempotent progress marking: the unique key on (object_key, identifier)
    // means a redelivered message or a resumed row group updates the pending
    // task instead of creating a second one. Rows already scored are left alone.
    const { error: qErr, count } = await admin
      .from("intuizi_score_queue")
      .upsert(
        rows.map((r) => ({
          object_key: file.object_key,
          report_type: reportType,
          identifier: r.identifier,
          activation_id: activationId,
          owner_id: ownerId,
          label: r.label,
          tags: r.tags,
          signals: r.signals,
          confidence: r.confidence,
          status: "pending",
          trace_id: traceId,
          next_attempt_at: now,
          last_error: null,
        })),
        { onConflict: "object_key,identifier", ignoreDuplicates: false, count: "exact" },
      );
    if (qErr) {
      console.error(JSON.stringify({
        evt: "worker_enqueue_failed",
        trace_id: traceId,
        object_key: file.object_key,
        error: qErr.message,
      }));
      return json({ success: false, error: qErr.message }, 500);
    }
    queued = count ?? rows.length;
  }

  // ---- Advance the ledger --------------------------------------------------
  const rowsRead = Number(body.rows_read ?? 0) || 0;
  const failedRows = Number(body.failed_rows ?? 0) || 0;
  const complete = phase === "complete" && body.complete !== false;

  const patch: Json = {
    status: complete ? "done" : "processing",
    worker_id: workerId,
    heartbeat_at: now,
    trace_id: traceId,
    processed_rows: (Number(file.processed_rows ?? 0) || 0) + rowsRead,
    failed_rows: (Number(file.failed_rows ?? 0) || 0) + failedRows,
    error_message: null,
  };
  if (body.row_group_cursor !== undefined) {
    patch.row_group_cursor = Number(body.row_group_cursor) || 0;
  }
  if (body.rows_offset !== undefined) patch.rows_offset = Number(body.rows_offset) || 0;
  if (body.row_groups_total !== undefined) {
    patch.row_groups_total = Number(body.row_groups_total) || null;
  }
  if (body.total_rows !== undefined) patch.total_rows = Number(body.total_rows) || 0;
  if (complete) {
    patch.finished_at = now;
    patch.cursor_offset = patch.processed_rows;
  } else if (phase === "complete") {
    // Worker hit its own slice budget with rows remaining: `partial` is the
    // signal the control plane re-dispatches from the saved cursor.
    patch.status = "partial";
    patch.finished_at = null;
  }

  const { error: upErr } = await admin
    .from("intuizi_ingest_files")
    .update(patch)
    .eq("id", file.id);
  if (upErr) return json({ success: false, error: upErr.message }, 500);

  // Kick the scorer once per callback that produced work. Gated on new work, so
  // an idle callback never chains another invocation.
  if (queued > 0) {
    admin.functions.invoke("intuizi-score-worker", { body: { source: "worker_callback" } })
      .catch((e: unknown) => console.warn("score worker kick failed", String(e)));
  }

  console.log(JSON.stringify({
    evt: "worker_callback",
    trace_id: traceId,
    object_key: file.object_key,
    report_type: reportType,
    activation_id: activationId,
    worker_id: workerId,
    phase,
    status: patch.status,
    rows_read: rowsRead,
    identifiers_queued: queued,
    rejected_rows: rejected,
    row_group_cursor: patch.row_group_cursor ?? file.row_group_cursor ?? 0,
    row_groups_total: patch.row_groups_total ?? file.row_groups_total ?? null,
  }));

  return json({
    success: true,
    file_id: file.id,
    trace_id: traceId,
    status: patch.status,
    identifiers_queued: queued,
    rejected_rows: rejected,
  });
});
