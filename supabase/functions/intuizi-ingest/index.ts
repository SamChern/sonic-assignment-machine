// Intuizi S3 ingest worker.
//
// Bounded, single-flight, idempotent batch job:
//  1. Read the paused/parked state — exit while paused (one probe row allowed
//     after a credit/policy pause, to detect out-of-band recovery).
//  2. Acquire the DB lease — a second concurrent run exits instead of racing.
//  3. List a bounded number of unprocessed objects under each report prefix.
//  4. Normalize rows, roll them up per identifier, resolve taxonomy tags,
//     score through analyze-audio, update calibration priors + embeddings.
//  5. Mark files/identifiers done in the same step that processes them.
//
// Callable by an admin JWT (manual run from Intuizi Console) or a
// service-role bearer token (the scheduled pg_cron trigger).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildTaxonomyContext,
  CATEGORIES,
  type Category,
  embed,
  type OntologyTag,
  resolveTag,
  updateCalibration,
} from "../_shared/ontology.ts";
import {
  applyNormalizationToAnalysis,
  loadNormalization,
} from "../_shared/normalization.ts";
import {
  activationIdFromKey,
  fetchObjectRows,
  identifierOf,
  ingestPrefixes,
  isAudioKey,
  isRosterRow,
  isSummaryRow,
  normalizeRow,
  normalizeSummaryRows,
  partitionDateFromKey,
  REPORT_TYPES,
  type ReportType,
  reportTypeFromKey,
} from "../_shared/intuizi.ts";
import {
  attachProfileEmbedding,
  callUpstream,
  getUpstreamCreds,
} from "../_shared/librosa.ts";



import { headObject, listObjects, s3BackendInfo, s3Configured, signReadUrl } from "../_shared/s3.ts";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ---- Work bounds (every run ends, even with work remaining) ----------------
const MAX_FILES_PER_RUN = 3;
const MAX_IDENTIFIERS_PER_RUN = 40;
const MAX_ROWS_PER_FILE = 5000;
// The edge gateway kills a request after 150s of idle time. Stop taking new work
// well before that and return a partial summary; remaining work resumes next run.
const RUN_BUDGET_MS = 105_000;
// Expected rows per user/device in an Intuizi activation delivery. Used only by
// the pre-ingest parquet validation log to flag deliveries whose shape drifted.
const EXPECTED_ROWS_PER_USER = Number(
  Deno.env.get("INTUIZI_EXPECTED_ROWS_PER_USER") ?? "100",
);

const LEASE_SECONDS = 600;

type Json = Record<string, unknown>;

const SIGNAL_COLUMN: Record<ReportType, string> = {
  ctv: "ctv_signals",
  apps: "apps_signals",
  visitation: "visitation_signals",
  demographics: "demographics_signals",
  origin: "origin_signals",
};

// ---- Manual-key ingest helpers ---------------------------------------------

/** Accept a bare key, an `s3://bucket/key` URI, or an https console URL. */
function normalizeKeyInput(raw: string): string {
  let v = raw.trim().replace(/^["'<]|["'>]$/g, "");
  if (!v) return "";
  if (v.startsWith("s3://")) v = v.slice(5).split("/").slice(1).join("/");
  else if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      // console links look like /s3/object/<bucket>?prefix=<key>
      const prefix = u.searchParams.get("prefix");
      v = prefix ?? u.pathname.replace(/^\//, "").split("/").slice(1).join("/");
      v = decodeURIComponent(v);
    } catch { /* fall through with raw value */ }
  }
  return v.replace(/^\/+/, "");
}

function isManifestKey(key: string): boolean {
  return /(manifest|_keys|filelist)[^/]*\.(json|txt|csv)$/i.test(key);
}

/** Read a manifest object and pull out the S3 keys it lists. */
async function readManifestKeys(key: string): Promise<string[]> {
  const url = await signReadUrl(key);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`manifest read failed [${res.status}]`);
  const text = await res.text();
  const out: string[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const walk = (v: unknown) => {
      if (typeof v === "string") {
        const k = normalizeKeyInput(v);
        if (k && /\.[a-z0-9]{2,8}$/i.test(k)) out.push(k);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(JSON.parse(trimmed));
  } else {
    for (const line of trimmed.split(/\r?\n/)) {
      for (const cell of line.split(",")) {
        const k = normalizeKeyInput(cell);
        if (k && /\.[a-z0-9]{2,8}$/i.test(k)) out.push(k);
      }
    }
  }
  return Array.from(new Set(out));
}


function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: number })?.status;
  if (s) return s;
  const msg = errMsg(e);
  const m = msg.match(/gateway (\d{3})|\[(\d{3})\]/);
  return m ? Number(m[1] ?? m[2]) : undefined;
}

/** Readable message for Errors, PostgrestErrors and FunctionsHttpError bodies. */
function errMsg(e: unknown): string {
  if (e instanceof Error) {
    // deno-lint-ignore no-explicit-any
    const ctx = (e as any).context;
    const extra = ctx && typeof ctx === "object"
      ? ` :: ${JSON.stringify(ctx).slice(0, 400)}`
      : "";
    return `${e.message}${extra}`;
  }
  if (e && typeof e === "object") {
    // deno-lint-ignore no-explicit-any
    const o = e as any;
    const parts = [o.message, o.details, o.hint, o.code].filter(Boolean);
    return parts.length ? parts.join(" | ") : JSON.stringify(o).slice(0, 600);
  }
  return String(e);
}

/**
 * Ingest one audio object from S3.
 *
 * 1. Register (or reuse) an `audio_sources` row keyed on the object key.
 * 2. Measure acoustics on the Librosa service using a short-lived signed URL —
 *    the bytes never pass through this function.
 * 3. Cache `librosa_features` + profile embedding, then score through
 *    `analyze-audio` (which reads the cached features as its evidence tier).
 */
// deno-lint-disable-next-line no-explicit-any
async function ingestAudioObject(admin: any, args: {
  key: string;
  ownerId: string;
  probeOnly: boolean;
}) {
  const { key, ownerId, probeOnly } = args;
  const name = key.split("/").pop() || key;

  const { data: existing } = await admin
    .from("audio_sources")
    .select("id,librosa_features")
    .eq("user_id", ownerId)
    .eq("source_type", "s3_audio")
    .contains("ctv_metadata", { object_key: key })
    .maybeSingle();

  let audioSourceId: string | null = existing?.id ?? null;
  if (!audioSourceId) {
    const { data: src, error: srcErr } = await admin
      .from("audio_sources")
      .insert({
        user_id: ownerId,
        source_type: "s3_audio",
        name,
        ctv_metadata: { provider: "s3", object_key: key, ingested_at: new Date().toISOString() },
      })
      .select("id").single();
    if (srcErr) throw srcErr;
    audioSourceId = src.id;
  }

  // A probe run only registers the file; it does no paid downstream work.
  if (probeOnly) return audioSourceId;

  let features: Record<string, unknown> | null = existing?.librosa_features ?? null;
  if (!features) {
    const creds = await getUpstreamCreds(admin);
    if (!creds) throw new Error("Librosa REST credentials are not configured");
    const audioUrl = await signReadUrl(key);
    const up = await callUpstream(creds, "/analyze_full", {
      audio_url: audioUrl,
      identity: key,
    });
    if (!up.ok) {
      throw Object.assign(new Error(up.error ?? "librosa upstream failed"), {
        status: up.status,
      });
    }
    features = (up.parsed?.features ?? up.parsed ?? null) as Record<string, unknown> | null;
    if (features) {
      await admin.from("audio_sources")
        .update({ librosa_features: features })
        .eq("id", audioSourceId);
      await attachProfileEmbedding(admin, {
        cacheKey: null,
        audioSourceId,
        userId: ownerId,
        features,
      });
    }
  }

  await invokeAnalyzeAudio(admin, {
    sources: [{ name, type: "file", audio_source_id: audioSourceId }],
    user_id: ownerId,
    save_results: true,
  });


  return audioSourceId;
}

/**
 * Rate-limit telemetry for one invocation. Emitted as a single structured JSON
 * log line per file and per run so an activation failure can be diagnosed
 * without replaying the ingest.
 */
const rateMetrics = {
  attempts: 0,
  retries: 0,
  terminal: 0,
  rateLimited: 0,
  byReport: {} as Record<string, number>,
  retryAfterMs: [] as number[],
  reset() {
    this.attempts = 0;
    this.retries = 0;
    this.terminal = 0;
    this.rateLimited = 0;
    this.byReport = {};
    this.retryAfterMs = [];
  },
  /** Percentile summary of the observed `retryAfterMs` hints. */
  retryAfterSummary() {
    const v = [...this.retryAfterMs].sort((a, b) => a - b);
    if (!v.length) return null;
    const at = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    return {
      n: v.length,
      min: v[0],
      p50: at(0.5),
      p95: at(0.95),
      max: v[v.length - 1],
      mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
    };
  },
  snapshot() {
    return {
      analyze_attempts: this.attempts,
      analyze_retries: this.retries,
      rate_limited_calls: this.rateLimited,
      terminal_errors: this.terminal,
      rate_limits_by_report_type: this.byReport,
      retry_after_ms: this.retryAfterSummary(),
    };
  },
};

/**
 * Invoke `analyze-audio` with bounded backoff. The AI gateway rate-limits the
 * whole workspace (`429` / `RateLimitError` with `retryAfterMs`), which used to
 * land rows in `failed_rows` even though the taxonomy mapped fine. Retryable:
 * 429 + 5xx. Terminal: 400/401/402/403 — re-sending returns the same error.
 */
// deno-lint-ignore no-explicit-any
async function invokeAnalyzeAudio(
  // deno-lint-ignore no-explicit-any
  admin: any,
  body: Json,
  reportType = "unknown",
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const MAX_ATTEMPTS = 4;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    rateMetrics.attempts++;
    const { data, error } = await admin.functions.invoke("analyze-audio", { body });
    if (!error) {
      if (!data?.sources?.[0]) throw new Error("analyze-audio returned no source");
      return data;
    }
    lastErr = error;
    const msg = String(error?.message ?? error);
    const status = Number((error as { status?: number })?.status ?? 0);
    const terminal = [400, 401, 402, 403].includes(status) ||
      /InsufficientCredits|PaymentRequired|Forbidden|Unauthorized/i.test(msg);
    const isRateLimit = !terminal && (status === 429 || /RateLimit|rate limit/i.test(msg));
    const retryable = !terminal &&
      (isRateLimit || status >= 500 || /timeout|503|502/i.test(msg));
    if (isRateLimit) {
      rateMetrics.rateLimited++;
      rateMetrics.byReport[reportType] = (rateMetrics.byReport[reportType] ?? 0) + 1;
    }
    if (terminal) rateMetrics.terminal++;
    const hinted = Number(msg.match(/"retryAfterMs"\s*:\s*(\d+)/)?.[1] ?? 0);
    if (hinted > 0) rateMetrics.retryAfterMs.push(hinted);
    if (!retryable || attempt === MAX_ATTEMPTS) {
      console.log(JSON.stringify({
        evt: "analyze_audio_giving_up",
        report_type: reportType,
        attempt,
        status,
        terminal,
        rate_limited: isRateLimit,
        retry_after_ms: hinted || null,
        message: msg.slice(0, 300),
      }));
      break;
    }
    const backoff = Math.max(hinted, 400 * 2 ** (attempt - 1));
    const jitter = Math.floor(Math.random() * 250);
    rateMetrics.retries++;
    console.log(JSON.stringify({
      evt: "analyze_audio_retry",
      report_type: reportType,
      attempt,
      max_attempts: MAX_ATTEMPTS,
      status,
      rate_limited: isRateLimit,
      retry_after_ms: hinted || null,
      wait_ms: backoff + jitter,
      message: msg.slice(0, 200),
    }));
    await new Promise((r) => setTimeout(r, backoff + jitter));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}



Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  // Uniform authorization: admin role or internal service-role (scheduled) run.
  const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
  if (authz instanceof AuthzError) return json({ error: authz.message }, authz.status);
  const isCron = authz.isInternal;
  const actorId: string | null = authz.userId;

  let body: Json = {};
  try { body = await req.json(); } catch { /* empty body = scheduled run */ }
  const action = String(body.action ?? "run");

  const { data: state } = await admin
    .from("intuizi_ingest_state").select("*").eq("id", "singleton").maybeSingle();

  // ---- Owner controls -----------------------------------------------------
  if (action === "status") {
    return json({ state, s3_configured: s3Configured(), s3: s3BackendInfo() });
  }

  // ---- Access probe --------------------------------------------------------
  // Reports, per configured prefix, whether s3:ListBucket currently works, so
  // the admin knows whether auto-discovery or the manual key path is in play.
  if (action === "probe_access") {
    if (!s3Configured()) {
      return json({ error: "Amazon S3 is not configured for this project yet.", prefixes: [] }, 400);
    }
    const prefixes: {
      prefix: string;
      report_type: ReportType | null;
      list_ok: boolean;
      objects_seen: number;
      error: string | null;
    }[] = [];
    for (const { prefix, report_type } of ingestPrefixes()) {
      try {
        const objs = await listObjects(prefix, 5);
        prefixes.push({ prefix, report_type, list_ok: true, objects_seen: objs.length, error: null });
      } catch (e) {
        prefixes.push({
          prefix,
          report_type,
          list_ok: false,
          objects_seen: 0,
          error: errMsg(e).slice(0, 400),
        });
      }
    }
    return json({
      s3: s3BackendInfo(),
      list_available: prefixes.some((p) => p.list_ok),
      mode: prefixes.some((p) => p.list_ok) ? "auto-discovery" : "manual keys only",
      prefixes,
    });
  }

  // ---- Validate explicit keys (manual ingest fallback) ---------------------
  // Uses HeadObject only (same s3:GetObject permission), so it works even when
  // s3:ListBucket is denied. Accepts raw keys or s3://bucket/key URIs, and can
  // expand a manifest object that lists the delivery's keys.
  if (action === "validate_keys") {
    if (!s3Configured()) {
      return json({ error: "Amazon S3 is not configured for this project yet.", keys: [] }, 400);
    }
    const requested = Array.isArray(body.object_keys)
      ? (body.object_keys as unknown[]).map((k) => normalizeKeyInput(String(k))).filter(Boolean)
      : [];
    if (!requested.length) return json({ error: "object_keys is required", keys: [] }, 400);

    // Manifest expansion: a .json / .txt / .csv listing of keys.
    const expanded: string[] = [];
    const manifestNotes: string[] = [];
    for (const key of requested) {
      if (body.expand_manifest && isManifestKey(key)) {
        try {
          const keys = await readManifestKeys(key);
          manifestNotes.push(`${key}: expanded to ${keys.length} key(s)`);
          expanded.push(...keys);
        } catch (e) {
          manifestNotes.push(`${key}: manifest could not be read — ${errMsg(e).slice(0, 200)}`);
        }
      } else {
        expanded.push(key);
      }
    }

    const unique = Array.from(new Set(expanded)).slice(0, 200);
    const { data: ledger } = await admin
      .from("intuizi_ingest_files")
      .select("object_key,status,total_rows,processed_rows,finished_at")
      .in("object_key", unique);
    const ledgerMap = new Map((ledger ?? []).map((l) => [l.object_key, l]));

    const keys = [] as Record<string, unknown>[];
    for (const key of unique) {
      const isAudio = isAudioKey(key);
      const rt = isAudio ? null : reportTypeFromKey(key);
      const prior = ledgerMap.get(key) ?? null;
      try {
        const head = await headObject(key);
        keys.push({
          object_key: key,
          ok: head.size > 0,
          size: head.size,
          content_type: head.contentType,
          last_modified: head.lastModified,
          is_audio: isAudio,
          report_type: rt,
          needs_report_type: !isAudio && !rt,
          already_ingested: prior?.status === "done",
          prior_status: prior?.status ?? null,
          error: head.size > 0 ? null : "object is empty (0 bytes)",
        });
      } catch (e) {
        keys.push({
          object_key: key,
          ok: false,
          size: 0,
          is_audio: isAudio,
          report_type: rt,
          needs_report_type: !isAudio && !rt,
          already_ingested: prior?.status === "done",
          prior_status: prior?.status ?? null,
          error: errMsg(e).slice(0, 400),
        });
      }
    }
    return json({ keys, manifest_notes: manifestNotes, s3: s3BackendInfo() });
  }

  // ---- Activation readiness / enrichment coverage --------------------------
  // Answers "is this activation roster-only, tagged, or scored?" without
  // needing ListBucket.
  if (action === "readiness") {
    const activationId = typeof body.activation_id === "string" ? body.activation_id : null;

    const { data: files } = await admin
      .from("intuizi_ingest_files")
      .select("object_key,report_type,status,total_rows,processed_rows,failed_rows,finished_at")
      .order("discovered_at", { ascending: false })
      .limit(200);

    const matching = (files ?? []).filter((f) =>
      !activationId || (activationIdFromKey(f.object_key) ?? "unassigned") === activationId
    );

    // Identifier-level coverage per activation. Counted with head-only count
    // queries so the 1000-row read cap cannot understate a large delivery.
    const cols = Object.values(SIGNAL_COLUMN);
    const activationIds = activationId
      ? [activationId]
      : Array.from(
        new Set([
          ...(files ?? []).map((f) => activationIdFromKey(f.object_key) ?? "unassigned"),
          "unassigned",
        ]),
      );

    const coverage: Record<string, { identifiers: number; tagged: number; scored: number }> = {};
    for (const act of activationIds) {
      const bucket = coverage[act] = { identifiers: 0, tagged: 0, scored: 0 };
      for (const col of cols) {
        const base = () => {
          const q = admin
            .from("intuizi_identifiers")
            .select("id", { count: "exact", head: true })
            .not(col, "eq", "{}");
          return act === "unassigned"
            ? q.is(`${col}->>activation_id`, null)
            : q.eq(`${col}->>activation_id`, act);
        };
        const [all, tagged, scored] = await Promise.all([
          base(),
          base().not("tag_codes", "eq", "{}"),
          base().not(`${col}->>scores`, "is", null),
        ]);
        bucket.identifiers += all.count ?? 0;
        bucket.tagged += tagged.count ?? 0;
        bucket.scored += scored.count ?? 0;
      }

    }


    const readinessOf = (c?: { identifiers: number; tagged: number; scored: number }) =>
      !c || c.identifiers === 0
        ? "not ingested"
        : c.scored > 0
          ? "scored"
          : c.tagged > 0
            ? "taxonomy present"
            : "roster only";

    const activations = Object.entries(coverage).map(([activation_id, c]) => ({
      activation_id,
      ...c,
      tag_coverage: c.identifiers ? c.tagged / c.identifiers : 0,
      readiness: readinessOf(c),
    })).sort((a, b) => b.identifiers - a.identifiers);

    return json({
      activation_id: activationId,
      readiness: activationId ? readinessOf(coverage[activationId]) : null,
      coverage: activationId ? (coverage[activationId] ?? null) : null,
      activations,
      files: matching,
      normalization_scope: "intuizi",
    });
  }


  // ---- Activation discovery (guided wizard) --------------------------------
  // Groups every inbound object by the `activation_id<N>` token in its name so
  // the wizard can offer a pick-list before running the semantic stages.
  if (action === "activations") {
    if (!s3Configured()) {
      return json({ error: "Amazon S3 is not connected for this project yet.", activations: [] }, 400);
    }
    type FileEntry = {
      object_key: string;
      report_type: ReportType | null;
      size: number;
      prefix: string;
      status: string | null;
      total_rows: number | null;
      processed_rows: number | null;
      finished_at: string | null;
      error_message: string | null;
    };
    const byActivation = new Map<string, FileEntry[]>();
    const listErrors: string[] = [];

    for (const { prefix, report_type } of ingestPrefixes()) {
      let objects: Awaited<ReturnType<typeof listObjects>> = [];
      try {
        objects = await listObjects(prefix, 200);
      } catch (e) {
        listErrors.push(`list ${prefix}: ${errMsg(e)}`);
        continue;
      }
      for (const o of objects) {
        if (o.key.endsWith("/")) continue;
        const activation = activationIdFromKey(o.key) ?? "unassigned";
        const list = byActivation.get(activation) ?? [];
        list.push({
          object_key: o.key,
          report_type: report_type ?? reportTypeFromKey(o.key),
          size: o.size,
          prefix,
          status: null,
          total_rows: null,
          processed_rows: null,
          finished_at: null,
          error_message: null,
        });
        byActivation.set(activation, list);
      }
    }

    const allKeys = [...byActivation.values()].flat().map((f) => f.object_key);
    if (allKeys.length) {
      const { data: ledger } = await admin
        .from("intuizi_ingest_files")
        .select("object_key,status,total_rows,processed_rows,finished_at,error_message")
        .in("object_key", allKeys);
      const ledgerMap = new Map((ledger ?? []).map((l) => [l.object_key, l]));
      for (const files of byActivation.values()) {
        for (const f of files) {
          const l = ledgerMap.get(f.object_key);
          if (!l) continue;
          f.status = l.status;
          f.total_rows = l.total_rows;
          f.processed_rows = l.processed_rows;
          f.finished_at = l.finished_at;
          f.error_message = l.error_message;
        }
      }
    }

    const activations = [...byActivation.entries()]
      .map(([activation_id, files]) => ({
        activation_id,
        // Summary reports carry the taxonomy rollup and must be ingested first —
        // roster files then link their device ids to that scored profile.
        files: files.sort((a, b) =>
          Number(b.prefix.includes("summary")) - Number(a.prefix.includes("summary")) ||
          a.object_key.localeCompare(b.object_key)
        ),
        empty_files: files.filter((f) => f.size <= 64).length,
        total_bytes: files.reduce((n, f) => n + f.size, 0),
        done_files: files.filter((f) => f.status === "done").length,
      }))
      .sort((a, b) => b.activation_id.localeCompare(a.activation_id));

    return json({ activations, errors: listErrors, s3: s3BackendInfo() });
  }

  if (action === "resume" || action === "pause") {
    if (isCron) return json({ error: `${action} requires an admin` }, 403);
    const paused = action === "pause";
    await admin.from("intuizi_ingest_state").update({
      paused,
      pause_reason: paused ? String(body.reason ?? "paused by admin") : null,
      paused_at: paused ? new Date().toISOString() : null,
      parked_until: null,
      consecutive_rate_limits: 0,
    }).eq("id", "singleton");
    return json({ paused });
  }

  if (!s3Configured()) {
    const info = s3BackendInfo();
    return json({
      error: info.placeholder
        ? "The enterprise S3 ingestion path is selected (S3_BACKEND=enterprise) but not configured yet — set S3_ENTERPRISE_BASE_URL and S3_ENTERPRISE_API_KEY, or unset S3_BACKEND to use the connector gateway."
        : "Amazon S3 is not connected for this project yet — link the inbound bucket connection, then run again.",
      s3_configured: false,
      s3: info,
    }, 400);
  }

  // ---- Paused / parked guard at the entry point ---------------------------
  let probeOnly = false;
  if (state?.parked_until && new Date(state.parked_until) > new Date()) {
    return json({ skipped: "parked after repeated rate limits", parked_until: state.parked_until });
  }
  if (state?.paused) {
    if (action === "run_now" && !isCron) {
      // An admin explicitly asked for a run while paused — treat it as a probe.
      probeOnly = true;
    } else {
      probeOnly = true;
    }
  }

  // ---- Single-flight lease ------------------------------------------------
  const leaseOwner = `intuizi-ingest:${crypto.randomUUID()}`;
  const { data: acquired, error: leaseErr } = await admin
    .rpc("acquire_intuizi_lease", { p_owner: leaseOwner, p_seconds: LEASE_SECONDS });
  if (leaseErr) return json({ error: `lease error: ${leaseErr.message}` }, 500);
  if (!acquired) return json({ skipped: "another run holds the lease" });

  rateMetrics.reset();
  const runStart = Date.now();
  const outOfTime = () => Date.now() - runStart > RUN_BUDGET_MS;
  const summary = {
    files_processed: 0,
    files_failed: 0,
    identifiers_scored: 0,
    roster_identifiers: 0,
    audio_files_scored: 0,


    rows_read: 0,
    probe_only: probeOnly,
    paused: false,
    pause_reason: null as string | null,
    time_budget_exhausted: false,
    errors: [] as string[],
    // Rate-limit telemetry for this run, filled in before responding.
    rate_metrics: null as Record<string, unknown> | null,
  };
  let breakerTripped = false;


  // audio_sources.user_id is required — attribute generated rows to an admin.
  let ownerId = actorId;
  if (!ownerId) {
    const { data: anyAdmin } = await admin
      .from("user_roles").select("user_id").eq("role", "admin")
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    ownerId = anyAdmin?.user_id ?? null;
  }

  try {
    if (!ownerId) throw new Error("No admin user exists to own ingested sources");

    // ---- Discover a bounded set of unprocessed objects --------------------
    const candidates: {
      key: string;
      report_type: ReportType | "audio";
      size: number;
      etag: string | null;
    }[] = [];
    const claimed = new Set<string>();

    const explicitKey = typeof body.object_key === "string" ? body.object_key : null;
    if (explicitKey) {
      if (isAudioKey(explicitKey)) {
        candidates.push({ key: explicitKey, report_type: "audio", size: 0, etag: null });
      } else {
        const requested = body.report_type as ReportType | undefined;
        const rt = requested ?? reportTypeFromKey(explicitKey) ?? undefined;
        if (!rt || !REPORT_TYPES.includes(rt)) {
          throw new Error(
            `could not infer report_type from "${explicitKey}" — pass report_type ` +
              `(one of ${REPORT_TYPES.join(", ")})`,
          );
        }
        candidates.push({ key: explicitKey, report_type: rt, size: 0, etag: null });
      }
    } else {
      for (const { prefix, report_type } of ingestPrefixes()) {
        if (candidates.length >= MAX_FILES_PER_RUN) break;
        let objects: Awaited<ReturnType<typeof listObjects>> = [];
        try {
          objects = await listObjects(prefix, 100);
        } catch (e) {
          const msg = errMsg(e);
          summary.errors.push(`list ${prefix}: ${msg}`);
          continue;
        }
        const dataObjects = objects.filter(
          (o) => o.size > 0 && !o.key.endsWith("/") && !claimed.has(o.key),
        );
        if (!dataObjects.length) continue;

        const { data: seen } = await admin
          .from("intuizi_ingest_files")
          .select("object_key,status")
          .in("object_key", dataObjects.map((o) => o.key));
        const done = new Set(
          (seen ?? []).filter((s) => s.status === "done").map((s) => s.object_key),
        );

        for (const o of dataObjects) {
          if (done.has(o.key) || claimed.has(o.key)) continue;
          // Audio files are ingested as real audio, not as report rows.
          const rt: ReportType | "audio" | null = isAudioKey(o.key)
            ? "audio"
            : (report_type ?? reportTypeFromKey(o.key));
          if (!rt) {
            summary.errors.push(`skipped ${o.key}: report type not recognizable from the file name`);
            continue;
          }
          claimed.add(o.key);
          candidates.push({ key: o.key, report_type: rt, size: o.size, etag: o.etag });
          if (candidates.length >= MAX_FILES_PER_RUN) break;
        }
      }
    }



    if (!candidates.length) {
      // Idle path stops here — it does not kick more work.
      await admin.from("intuizi_ingest_state").update({
        last_run_at: new Date().toISOString(),
        last_run_summary: { ...summary, idle: true },
        last_error: null,
      }).eq("id", "singleton");
      return json({ ...summary, idle: true });
    }

    const identifierBudget = probeOnly ? 1 : MAX_IDENTIFIERS_PER_RUN;

    for (const rawCand of candidates) {
      if (breakerTripped) break;
      if (outOfTime()) { summary.time_budget_exhausted = true; break; }

      const { data: fileRow, error: fileErr } = await admin
        .from("intuizi_ingest_files")
        .upsert({
          object_key: rawCand.key,
          report_type: rawCand.report_type,
          etag: rawCand.etag,
          size_bytes: rawCand.size || null,
          partition_date: partitionDateFromKey(rawCand.key),
          status: "processing",
          started_at: new Date().toISOString(),
          error_message: null,
        }, { onConflict: "object_key" })
        .select("id,report_type,processed_rows,row_group_cursor,rows_offset,row_groups_total").single();
      if (fileErr) {
        summary.errors.push(`ledger ${rawCand.key}: ${fileErr.message}`);
        summary.files_failed++;
        continue;
      }

      // ---- Audio file: download + acoustic analysis, then ontology scoring --
      if (rawCand.report_type === "audio") {
        try {
          await ingestAudioObject(admin, {
            key: rawCand.key,
            ownerId: ownerId!,
            probeOnly,
          });
          await admin.from("intuizi_ingest_files").update({
            status: "done",
            total_rows: 1,
            processed_rows: 1,
            failed_rows: 0,
            cursor_offset: 1,
            finished_at: new Date().toISOString(),
            error_message: null,
          }).eq("id", fileRow.id);
          summary.files_processed++;
          summary.audio_files_scored++;
        } catch (e) {
          const msg = errMsg(e);
          await admin.from("intuizi_ingest_files").update({
            status: "failed",
            error_message: msg.slice(0, 2000),
            finished_at: new Date().toISOString(),
          }).eq("id", fileRow.id);
          summary.files_failed++;
          summary.errors.push(`${rawCand.key}: ${msg}`);
        }
        continue;
      }

      const cand = rawCand as {
        key: string;
        report_type: ReportType;
        size: number;
        etag: string | null;
      };


      try {
        const url = await signReadUrl(cand.key);
        // Resume from the last transformed row group instead of re-reading rows
        // that were already normalized in an earlier (possibly timed-out) run.
        const resumeGroup = Number(fileRow.row_group_cursor ?? 0) || 0;
        const chunk = await fetchObjectChunk(
          url,
          cand.key,
          MAX_ROWS_PER_FILE,
          EXPECTED_ROWS_PER_USER,
          resumeGroup,
        );
        const checkpoint = chunk.checkpoint;
        const rawRows = chunk.rows.slice(0, MAX_ROWS_PER_FILE);

        summary.rows_read += rawRows.length;

        if (checkpoint && !rawRows.length && checkpoint.exhausted) {
          // Every row group has already been transformed — close the file out.
          await admin.from("intuizi_ingest_files").update({
            status: "done",
            row_group_cursor: checkpoint.nextRowGroup,
            row_groups_total: checkpoint.rowGroupsTotal,
            rows_offset: checkpoint.nextRowsOffset,
            finished_at: new Date().toISOString(),
            error_message: null,
          }).eq("id", fileRow.id);
          summary.files_processed++;
          continue;
        }


        // ---- Roll rows up per identifier ---------------------------------
        const perIdentifier = new Map<string, {
          tags: Map<string, OntologyTag>;
          signals: Json[];
          confidence: number;
          labels: string[];
        }>();

        const addNorm = (norm: ReturnType<typeof normalizeRow>) => {
          if (!norm) return;
          const entry = perIdentifier.get(norm.primary_identifier) ?? {
            tags: new Map<string, OntologyTag>(),
            signals: [],
            confidence: 0,
            labels: [],
          };
          for (const t of norm.tags) entry.tags.set(t.code, t);
          if (entry.signals.length < 25) entry.signals.push(norm.signals as Json);
          entry.confidence = Math.max(entry.confidence, norm.confidence);
          if (norm.label && entry.labels.length < 4) entry.labels.push(norm.label);
          perIdentifier.set(norm.primary_identifier, entry);
        };

        for (const raw of rawRows) {
          addNorm(normalizeRow(cand.report_type, raw as Record<string, unknown>));
        }

        // Fallback A — audience-level summary report (taxonomy rollup, no device
        // identifier). Folded into one synthetic activation profile and scored.
        if (!perIdentifier.size && rawRows.length) {
          const summaryRows = (rawRows as Record<string, unknown>[]).filter(isSummaryRow);
          for (const norm of normalizeSummaryRows(cand.report_type, summaryRows, cand.key)) {
            addNorm(norm);
          }
        }

        // Fallback B — roster delivery (maid / hem only). No ontological content,
        // so nothing to score: register the identifiers against the matching
        // activation profile so the audience is joinable downstream.
        if (!perIdentifier.size && rawRows.length) {
          const rosterIds = Array.from(new Set(
            (rawRows as Record<string, unknown>[])
              .filter(isRosterRow)
              .map((r) => identifierOf(r))
              .filter(Boolean),
          ));
          if (rosterIds.length) {
            const activation = activationIdFromKey(cand.key);
            let activationSourceId: string | null = null;
            if (activation) {
              const { data: actRow } = await admin
                .from("intuizi_identifiers")
                .select("audio_source_id")
                .eq("primary_identifier", `activation:${activation}`)
                .maybeSingle();
              activationSourceId = actRow?.audio_source_id ?? null;
            }
            const nowIso = new Date().toISOString();
            for (let i = 0; i < rosterIds.length; i += 500) {
              const chunk = rosterIds.slice(i, i + 500).map((id) => ({
                primary_identifier: id,
                audio_source_id: activationSourceId,
                observation_count: 1,
                last_seen_at: nowIso,
                [SIGNAL_COLUMN[cand.report_type]]: {
                  scope: "roster",
                  activation_id: activation,
                  object_key: cand.key,
                  registered_at: nowIso,
                },
              }));
              const { error: rosterErr } = await admin
                .from("intuizi_identifiers")
                .upsert(chunk, { onConflict: "primary_identifier" });
              if (rosterErr) throw rosterErr;
            }
            await admin.from("intuizi_ingest_files").update({
              status: "done",
              total_rows: rawRows.length,
              processed_rows: rosterIds.length,
              failed_rows: 0,
              cursor_offset: rosterIds.length,
              finished_at: nowIso,
              error_message: null,
            }).eq("id", fileRow.id);
            summary.files_processed++;
            summary.roster_identifiers += rosterIds.length;
            continue;
          }
        }

        if (!perIdentifier.size && rawRows.length) {
          const cols = Object.keys(rawRows[0] ?? {}).slice(0, 12).join(", ");
          throw new Error(
            `no usable rows — identifier or taxonomy fields missing. columns seen: ${cols}`,
          );
        }


        let scoredInFile = 0;
        let failedInFile = 0;

        for (const [identifier, entry] of perIdentifier) {
          if (summary.identifiers_scored >= identifierBudget) break;
          if (outOfTime()) { summary.time_budget_exhausted = true; break; }

          const { data: existing } = await admin
            .from("intuizi_identifiers")
            .select("id,audio_source_id,tag_codes,observation_count")
            .eq("primary_identifier", identifier)
            .maybeSingle();

          const tags = [...entry.tags.values()];
          const tagCodes = tags.map((t) => t.code);

          // Dedup: identical tag set already scored for this identifier.
          const previousCodes: string[] = existing?.tag_codes ?? [];
          const unchanged = previousCodes.length > 0 &&
            tagCodes.every((c) => previousCodes.includes(c));
          if (unchanged) continue;

          const label = `Intuizi ${cand.report_type}: ${entry.labels[0] ?? identifier.slice(0, 12)}`;

          try {
            // 1. audio_sources row (reused across runs per identifier)
            let audioSourceId: string | null = existing?.audio_source_id ?? null;
            if (!audioSourceId) {
              const { data: src, error: srcErr } = await admin
                .from("audio_sources")
                .insert({
                  user_id: ownerId,
                  source_type: "intuizi",
                  name: label,
                  ctv_metadata: {
                    provider: "intuizi",
                    report_type: cand.report_type,
                    object_key: cand.key,
                    identifier,
                    signals: entry.signals,
                  },
                })
                .select("id").single();
              if (srcErr) throw srcErr;
              audioSourceId = src.id;
            }

            // 2. Taxonomy tags
            const nodeIds: string[] = [];
            for (const t of tags) {
              try { nodeIds.push(await resolveTag(admin, t)); } catch (e) {
                if ([402, 403, 429].includes(statusOf(e) ?? 0)) throw e;
                console.warn("tag resolve failed", t.code, e);
              }
            }
            if (nodeIds.length) {
              await admin.from("audio_source_tags").upsert(
                nodeIds.map((nid) => ({
                  audio_source_id: audioSourceId,
                  node_id: nid,
                  weight: entry.confidence,
                })),
                { onConflict: "audio_source_id,node_id" },
              );
            }

            // 3. Calibration priors + kNN warm start
            let taxonomyContext = await buildTaxonomyContext(admin, nodeIds);
            const queryEmbedding = await embed(
              `intuizi ${cand.report_type}; tags: ${tagCodes.join(",")}`,
            );
            if (queryEmbedding) {
              const { data: neighbors } = await admin.rpc("match_audio_profiles", {
                query_embedding: queryEmbedding,
                match_count: 5,
                exclude_id: audioSourceId,
              });
              if (neighbors?.length) {
                // deno-lint-ignore no-explicit-any
                const lines = neighbors.map((n: any) =>
                  `  - ${n.name} (sim=${Number(n.similarity).toFixed(2)}): ` +
                  `emo=${Math.round(n.emotional_score)} cog=${Math.round(n.cognitive_score)} ` +
                  `soc=${Math.round(n.social_score)} com=${Math.round(n.communication_score)} ` +
                  `ctx=${Math.round(n.contextual_score)} art=${Math.round(n.artistic_score)}`
                ).join("\n");
                taxonomyContext = `${taxonomyContext}\nnearest_neighbors:\n${lines}`;
              }
            }

            // 4. Score through the same ontology path as music sources
            const ana = await invokeAnalyzeAudio(admin, {
              sources: [{
                name: label,
                type: "file",
                audio_source_id: audioSourceId,
                taxonomy_context: taxonomyContext,
              }],
              user_id: ownerId,
              save_results: true,
            }, fileRow.report_type ?? "unknown");

            const sourceOut = ana.sources[0];


            const scoreMap = {} as Record<Category, number>;
            for (const c of sourceOut.categories ?? []) {
              scoreMap[(c.name ?? "").toLowerCase() as Category] = Number(c.score) || 0;
            }

            // 4b. Speech-skew normalization: Intuizi CTV / audio-app feeds skew
            // toward vocal + spoken-word signals, which inflates Communication.
            // Rewrite the saved analysis with the corrected profile (raw scores
            // retained for audit) before learning from it.
            const normCfg = await loadNormalization(admin, "intuizi");
            const normScores = await applyNormalizationToAnalysis(
              admin, audioSourceId!, scoreMap, normCfg,
            );
            for (const c of CATEGORIES) scoreMap[c] = normScores[c] ?? scoreMap[c];

            // 5. Continuous learning: calibration + profile embedding
            await updateCalibration(admin, nodeIds, scoreMap);
            const profileEmbedding = await embed(
              `intuizi ${cand.report_type}; tags: ${tagCodes.join(",")}; ` +
              `scores: ${CATEGORIES.map((c) => `${c}=${scoreMap[c] ?? "?"}`).join(",")}`,
            );
            if (profileEmbedding) {
              await admin.from("audio_sources")
                .update({ profile_embedding: profileEmbedding })
                .eq("id", audioSourceId);
            }

            // 6. Idempotent progress marking, in the same step as the work
            const mergedCodes = Array.from(new Set([...previousCodes, ...tagCodes]));
            await admin.from("intuizi_identifiers").upsert({
              primary_identifier: identifier,
              [SIGNAL_COLUMN[cand.report_type]]: {
                rows: entry.signals,
                confidence: entry.confidence,
                scores: scoreMap,
                object_key: cand.key,
                scored_at: new Date().toISOString(),
              },
              tag_codes: mergedCodes,
              audio_source_id: audioSourceId,
              observation_count: (existing?.observation_count ?? 0) + entry.signals.length,
              last_seen_at: new Date().toISOString(),
            }, { onConflict: "primary_identifier" });

            summary.identifiers_scored++;
            scoredInFile++;

            if (probeOnly) {
              // Probe succeeded — clear the pause and stop this run.
              await admin.from("intuizi_ingest_state").update({
                paused: false,
                pause_reason: null,
                paused_at: null,
                parked_until: null,
                consecutive_rate_limits: 0,
              }).eq("id", "singleton");
              break;
            }
          } catch (e) {
            const st = statusOf(e);
            const msg = errMsg(e);
            failedInFile++;
            summary.errors.push(`${identifier}: ${msg}`);

            // ---- Circuit breaker: halt the whole job, not just this item --
            if (st === 402 || st === 403) {
              breakerTripped = true;
              summary.paused = true;
              summary.pause_reason = msg.slice(0, 500);
              await admin.from("intuizi_ingest_state").update({
                paused: true,
                pause_reason: msg.slice(0, 500),
                paused_at: new Date().toISOString(),
              }).eq("id", "singleton");
              break;
            }
            if (st === 429) {
              const next = (state?.consecutive_rate_limits ?? 0) + 1;
              if (next >= 3) {
                breakerTripped = true;
                summary.paused = true;
                summary.pause_reason = `rate limited ${next}x — parked until the next scheduled run`;
                await admin.from("intuizi_ingest_state").update({
                  consecutive_rate_limits: next,
                  parked_until: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                  last_error: msg.slice(0, 500),
                }).eq("id", "singleton");
                break;
              }
              await admin.from("intuizi_ingest_state")
                .update({ consecutive_rate_limits: next }).eq("id", "singleton");
              // Bounded backoff before the next item.
              await new Promise((r) => setTimeout(r, 2000 * next));
            }
          }
        }

        const remaining = perIdentifier.size - scoredInFile - failedInFile;
        // A Parquet file is only "done" once its last row group is transformed.
        const chunkComplete = !checkpoint || checkpoint.exhausted;
        const fileStatus = breakerTripped
          ? "paused"
          : (remaining > 0 || !chunkComplete ? "partial" : "done");
        await admin.from("intuizi_ingest_files").update({
          status: fileStatus,
          total_rows: rawRows.length,
          processed_rows: (fileRow.processed_rows ?? 0) + scoredInFile,
          failed_rows: failedInFile,
          cursor_offset: perIdentifier.size - remaining,
          // Only advance the row-group checkpoint when this chunk's rows were
          // fully drained, so nothing is skipped on resume.
          row_group_cursor: checkpoint
            ? (remaining > 0 || breakerTripped ? checkpoint.startRowGroup : checkpoint.nextRowGroup)
            : 0,
          row_groups_total: checkpoint?.rowGroupsTotal ?? null,
          rows_offset: checkpoint
            ? (remaining > 0 || breakerTripped ? checkpoint.rowsOffset : checkpoint.nextRowsOffset)
            : 0,
          finished_at: fileStatus === "done" ? new Date().toISOString() : null,
          error_message: failedInFile ? summary.errors.slice(-3).join("\n").slice(0, 2000) : null,
        }).eq("id", fileRow.id);

        // Structured per-file coverage + rate-limit metrics.
        console.log(JSON.stringify({
          evt: "ingest_file_coverage",
          object_key: cand.key,
          report_type: fileRow.report_type ?? "unknown",
          activation_id: cand.key.toLowerCase().match(/activation[_-]?id(\d+)/)?.[1] ?? null,
          status: breakerTripped ? "paused" : (remaining > 0 ? "partial" : "done"),
          rows: rawRows.length,
          identifiers: perIdentifier.size,
          enriched: scoredInFile,
          failed: failedInFile,
          identifier_only: Math.max(0, remaining),
          coverage_pct: perIdentifier.size
            ? Math.round((scoredInFile / perIdentifier.size) * 100)
            : null,
          ...rateMetrics.snapshot(),
        }));

        summary.files_processed++;

      } catch (e) {
        const st = statusOf(e);
        const msg = errMsg(e);
        await admin.from("intuizi_ingest_files").update({
          status: "failed",
          error_message: msg.slice(0, 2000),
          finished_at: new Date().toISOString(),
        }).eq("id", fileRow.id);
        summary.files_failed++;
        summary.errors.push(`${cand.key}: ${msg}`);

        if (st === 402 || st === 403) {
          breakerTripped = true;
          summary.paused = true;
          summary.pause_reason = msg.slice(0, 500);
          await admin.from("intuizi_ingest_state").update({
            paused: true,
            pause_reason: msg.slice(0, 500),
            paused_at: new Date().toISOString(),
          }).eq("id", "singleton");
        }
      }
    }

    // Roster-only deliveries carry device identifiers but no taxonomy content,
    // so nothing can be scored until a companion report arrives. Report it
    // explicitly instead of letting it look like a silent success.
    const rosterOnly = summary.roster_identifiers > 0 && summary.identifiers_scored === 0;
    if (rosterOnly) {
      summary.errors.push(
        "roster-only delivery: identifiers were registered but no taxonomy columns were present, so no semantic scores were produced. Ingest the matching CTV/apps/visitation/demographics/origin report for this activation.",
      );
    }
    (summary as Json).roster_only = rosterOnly;

    summary.rate_metrics = rateMetrics.snapshot();
    console.log(JSON.stringify({ evt: "ingest_run_summary", ...summary }));
    await admin.from("intuizi_ingest_state").update({
      last_run_at: new Date().toISOString(),
      last_run_summary: summary,
      last_error: summary.errors[0]?.slice(0, 1000) ?? null,
    }).eq("id", "singleton");

    return json(summary);


  } catch (e) {
    const msg = errMsg(e);
    summary.rate_metrics = rateMetrics.snapshot();
    console.error(JSON.stringify({ evt: "ingest_run_failed", error: msg, ...summary }));
    await admin.from("intuizi_ingest_state").update({
      last_run_at: new Date().toISOString(),
      last_run_summary: summary,
      last_error: msg.slice(0, 1000),
    }).eq("id", "singleton");
    return json({ ...summary, error: msg }, 500);

  } finally {
    // Always release the lease so a stuck run cannot block the schedule.
    try {
      await admin.rpc("release_intuizi_lease", { p_owner: leaseOwner });
    } catch (_) { /* best effort */ }
  }
});
