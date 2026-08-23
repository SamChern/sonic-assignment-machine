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
// Callable by an admin JWT (manual run from Integration Status) or a
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
  INGEST_PREFIXES,
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



import { listObjects, s3BackendInfo, s3Configured, signReadUrl } from "../_shared/s3.ts";
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

    for (const { prefix, report_type } of INGEST_PREFIXES) {
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

  const summary = {
    files_processed: 0,
    files_failed: 0,
    identifiers_scored: 0,
    roster_identifiers: 0,

    rows_read: 0,
    probe_only: probeOnly,
    paused: false,
    pause_reason: null as string | null,
    errors: [] as string[],
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
        .select("id,processed_rows").single();
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
        const rawRows = (await fetchObjectRows(
          url,
          cand.key,
          MAX_ROWS_PER_FILE,
          EXPECTED_ROWS_PER_USER,
        )).slice(0, MAX_ROWS_PER_FILE);

        summary.rows_read += rawRows.length;

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
            const { data: ana, error: anaErr } = await admin.functions.invoke("analyze-audio", {
              body: {
                sources: [{
                  name: label,
                  type: "file",
                  audio_source_id: audioSourceId,
                  taxonomy_context: taxonomyContext,
                }],
                user_id: ownerId,
                save_results: true,
              },
            });
            if (anaErr) throw anaErr;
            const sourceOut = ana?.sources?.[0];
            if (!sourceOut) throw new Error("analyze-audio returned no source");

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
        await admin.from("intuizi_ingest_files").update({
          status: breakerTripped ? "paused" : (remaining > 0 ? "partial" : "done"),
          total_rows: rawRows.length,
          processed_rows: (fileRow.processed_rows ?? 0) + scoredInFile,
          failed_rows: failedInFile,
          cursor_offset: perIdentifier.size - remaining,
          finished_at: remaining > 0 || breakerTripped ? null : new Date().toISOString(),
          error_message: failedInFile ? summary.errors.slice(-3).join("\n").slice(0, 2000) : null,
        }).eq("id", fileRow.id);

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

    await admin.from("intuizi_ingest_state").update({
      last_run_at: new Date().toISOString(),
      last_run_summary: summary,
      last_error: summary.errors[0]?.slice(0, 1000) ?? null,
    }).eq("id", "singleton");

    return json(summary);
  } catch (e) {
    const msg = errMsg(e);
    console.error("intuizi-ingest failed:", msg);
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
