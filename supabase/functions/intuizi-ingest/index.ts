// Intuizi S3 ingest worker.
//
// Bounded, single-flight, idempotent batch job:
//  1. Acquire the DB lease (a second concurrent run exits immediately).
//  2. Read the paused/circuit-breaker state — exit while paused, except for a
//     single probe row after a credit/policy pause.
//  3. List a bounded number of unseen objects under each report prefix.
//  4. Normalize rows, roll them up per identifier, resolve taxonomy tags,
//     score through analyze-audio, and update calibration priors.
//  5. Mark every file/identifier done in the same step that processes it.
//
// Callable by: an admin JWT (manual run from the Integration Status page) or a
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
  fetchObjectRows,
  identifierOf,
  normalizeRow,
  partitionDateFromKey,
  REPORT_TYPES,
  type ReportType,
} from "../_shared/intuizi.ts";
import { listObjects, s3Configured, signReadUrl } from "../_shared/s3.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// ---- Work bounds (rule 1: every run ends, even with work remaining) --------
const MAX_FILES_PER_RUN = 3;
const MAX_IDENTIFIERS_PER_RUN = 40;
const MAX_ROWS_PER_FILE = 5000;
const LEASE_SECONDS = 600;
const LOCK_NAME = "intuizi_ingest";

type Json = Record<string, unknown>;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");

  // ---- Auth: service-role (cron) or admin user -----------------------------
  let isCron = bearer === SERVICE_KEY;
  let actorId: string | null = null;
  if (!isCron) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: roleRow } = await admin
      .from("user_roles").select("id")
      .eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Admin only" }, 403);
    actorId = user.id;
  }

  let body: Json = {};
  try { body = await req.json(); } catch { /* empty body = scheduled run */ }
  const action = String(body.action ?? "run");

  // ---- Owner controls -----------------------------------------------------
  if (action === "status") {
    const { data: state } = await admin
      .from("intuizi_ingest_state").select("*").eq("lock_name", LOCK_NAME).maybeSingle();
    return json({ state, s3_configured: s3Configured() });
  }
  if (action === "resume") {
    if (isCron) return json({ error: "resume requires an admin" }, 403);
    await admin.from("intuizi_ingest_state").upsert({
      lock_name: LOCK_NAME,
      paused: false,
      pause_reason: null,
      consecutive_rate_limits: 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: "lock_name" });
    return json({ resumed: true });
  }
  if (action === "pause") {
    if (isCron) return json({ error: "pause requires an admin" }, 403);
    await admin.from("intuizi_ingest_state").upsert({
      lock_name: LOCK_NAME,
      paused: true,
      pause_reason: String(body.reason ?? "paused by admin"),
      updated_at: new Date().toISOString(),
    }, { onConflict: "lock_name" });
    return json({ paused: true });
  }

  if (!s3Configured()) {
    return json({
      error:
        "Amazon S3 is not connected for this project yet — link the inbound bucket connection, then run again.",
      s3_configured: false,
    }, 400);
  }

  // ---- Rule 5: paused-state guard at the entry point ----------------------
  const { data: state } = await admin
    .from("intuizi_ingest_state").select("*").eq("lock_name", LOCK_NAME).maybeSingle();

  let probeOnly = false;
  if (state?.paused) {
    const reason = String(state.pause_reason ?? "");
    const rateLimited = /rate limit|429/i.test(reason);
    if (rateLimited) {
      // Transient — the next scheduled run retries normally.
      await admin.from("intuizi_ingest_state")
        .update({ paused: false, pause_reason: null, consecutive_rate_limits: 0, updated_at: new Date().toISOString() })
        .eq("lock_name", LOCK_NAME);
    } else {
      // Credit/policy pause: allow one probe row to detect out-of-band recovery.
      probeOnly = true;
    }
  }

  // ---- Rule 2: single-flight lease ----------------------------------------
  const { data: acquired, error: leaseErr } = await admin
    .rpc("acquire_intuizi_lease", { p_lock_name: LOCK_NAME, p_ttl_seconds: LEASE_SECONDS });
  if (leaseErr) return json({ error: `lease error: ${leaseErr.message}` }, 500);
  if (!acquired) return json({ skipped: "another run holds the lease" });

  const summary = {
    files_processed: 0,
    files_failed: 0,
    identifiers_scored: 0,
    rows_read: 0,
    probe_only: probeOnly,
    paused: false,
    pause_reason: null as string | null,
    errors: [] as string[],
  };

  // Attribute generated sources to an admin account (audio_sources.user_id is required).
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
    const explicitKey = typeof body.object_key === "string" ? body.object_key : null;
    const candidates: { key: string; report_type: ReportType; size: number; etag: string | null }[] = [];

    if (explicitKey) {
      const rt = (body.report_type as ReportType) ?? null;
      if (!rt || !REPORT_TYPES.includes(rt)) throw new Error("object_key requires a valid report_type");
      candidates.push({ key: explicitKey, report_type: rt, size: 0, etag: null });
    } else {
      for (const rt of REPORT_TYPES) {
        if (candidates.length >= MAX_FILES_PER_RUN) break;
        let objects: Awaited<ReturnType<typeof listObjects>> = [];
        try {
          objects = await listObjects(`${rt}/`, 100);
        } catch (e) {
          summary.errors.push(`list ${rt}/: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        const dataObjects = objects.filter((o) => o.size > 0 && !o.key.endsWith("/"));
        if (!dataObjects.length) continue;

        const { data: seen } = await admin
          .from("intuizi_ingest_files")
          .select("object_key,status")
          .in("object_key", dataObjects.map((o) => o.key));
        const seenDone = new Set(
          (seen ?? []).filter((s) => s.status === "done").map((s) => s.object_key),
        );

        for (const o of dataObjects) {
          if (seenDone.has(o.key)) continue;
          candidates.push({ key: o.key, report_type: rt, size: o.size, etag: o.etag });
          if (candidates.length >= MAX_FILES_PER_RUN) break;
        }
      }
    }

    if (!candidates.length) {
      // Rule 8: idle path stops here, it does not kick more work.
      await admin.from("intuizi_ingest_state").upsert({
        lock_name: LOCK_NAME,
        last_run_at: new Date().toISOString(),
        last_result: "idle — no new objects",
        updated_at: new Date().toISOString(),
      }, { onConflict: "lock_name" });
      return json({ ...summary, idle: true });
    }

    const identifierBudget = probeOnly ? 1 : MAX_IDENTIFIERS_PER_RUN;

    for (const cand of candidates) {
      // Rule 3: ledger row written before and after processing.
      const { data: fileRow, error: fileErr } = await admin
        .from("intuizi_ingest_files")
        .upsert({
          object_key: cand.key,
          report_type: cand.report_type,
          etag: cand.etag,
          size_bytes: cand.size,
          partition_date: partitionDateFromKey(cand.key),
          status: "processing",
          started_at: new Date().toISOString(),
          error_message: null,
        }, { onConflict: "object_key" })
        .select("id,attempts").single();
      if (fileErr) {
        summary.errors.push(`ledger ${cand.key}: ${fileErr.message}`);
        summary.files_failed++;
        continue;
      }

      try {
        const url = await signReadUrl(cand.key);
        const rawRows = (await fetchObjectRows(url, cand.key)).slice(0, MAX_ROWS_PER_FILE);
        summary.rows_read += rawRows.length;

        // ---- Roll up rows per identifier ---------------------------------
        const perIdentifier = new Map<string, {
          tags: Map<string, OntologyTag>;
          signals: Json[];
          confidence: number;
          labels: string[];
        }>();

        for (const raw of rawRows) {
          const norm = normalizeRow(cand.report_type, raw as Record<string, unknown>);
          if (!norm) continue;
          const entry = perIdentifier.get(norm.primary_identifier) ?? {
            tags: new Map<string, OntologyTag>(),
            signals: [],
            confidence: 0,
            labels: [],
          };
          for (const t of norm.tags) entry.tags.set(t.code, t);
          entry.signals.push(norm.signals as Json);
          entry.confidence = Math.max(entry.confidence, norm.confidence);
          if (norm.label && entry.labels.length < 4) entry.labels.push(norm.label);
          perIdentifier.set(norm.primary_identifier, entry);
        }

        if (!perIdentifier.size && rawRows.length) {
          const sampleKeys = Object.keys(rawRows[0] ?? {}).slice(0, 12).join(", ");
          throw new Error(
            `no usable rows — identifier or taxonomy fields missing. columns seen: ${sampleKeys}`,
          );
        }

        let scoredInFile = 0;
        for (const [identifier, entry] of perIdentifier) {
          if (summary.identifiers_scored >= identifierBudget) break;

          // Rule 3 + DB dedup: skip identifiers already scored for this file.
          const { data: existing } = await admin
            .from("intuizi_identifiers")
            .select("id,audio_source_id,last_object_key")
            .eq("primary_identifier", identifier)
            .eq("report_type", cand.report_type)
            .maybeSingle();
          if (existing?.last_object_key === cand.key) continue;

          const tags = [...entry.tags.values()];
          const label = `Intuizi ${cand.report_type}: ${entry.labels[0] ?? identifier.slice(0, 12)}`;

          // 1. audio_sources row (reused across runs for the same identifier)
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
                  primary_identifier_hash: identifier,
                  signals: entry.signals.slice(0, 25),
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

          // 3. Priors + kNN warm start
          let taxonomyContext = await buildTaxonomyContext(admin, nodeIds);
          const queryEmbedding = await embed(
            `intuizi ${cand.report_type}; tags: ${tags.map((t) => t.code).join(",")}`,
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

          // 4. Score
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

          // 5. Continuous learning: calibration + profile embedding
          await updateCalibration(admin, nodeIds, scoreMap);
          const profileEmbedding = await embed(
            `intuizi ${cand.report_type}; tags: ${tags.map((t) => t.code).join(",")}; ` +
            `scores: ${CATEGORIES.map((c) => `${c}=${scoreMap[c] ?? "?"}`).join(",")}`,
          );
          if (profileEmbedding) {
            await admin.from("audio_sources")
              .update({ profile_embedding: profileEmbedding })
              .eq("id", audioSourceId);
          }

          // 6. Idempotent progress marking (same step as the work)
          await admin.from("intuizi_identifiers").upsert({
            primary_identifier: identifier,
            report_type: cand.report_type,
            audio_source_id: audioSourceId,
            tag_codes: tags.map((t) => t.code),
            signals: { rows: entry.signals.slice(0, 25), confidence: entry.confidence },
            scores: scoreMap,
            last_object_key: cand.key,
            last_scored_at: new Date().toISOString(),
          }, { onConflict: "primary_identifier,report_type" });

          summary.identifiers_scored++;
          scoredInFile++;

          if (probeOnly) {
            // Probe succeeded — clear the pause and stop for this run.
            await admin.from("intuizi_ingest_state").update({
              paused: false,
              pause_reason: null,
              consecutive_rate_limits: 0,
              updated_at: new Date().toISOString(),
            }).eq("lock_name", LOCK_NAME);
            break;
          }
        }

        const remaining = perIdentifier.size - scoredInFile;
        await admin.from("intuizi_ingest_files").update({
          status: remaining > 0 ? "partial" : "done",
          rows_total: rawRows.length,
          rows_processed: scoredInFile,
          identifiers_seen: perIdentifier.size,
          finished_at: remaining > 0 ? null : new Date().toISOString(),
          error_message: null,
        }).eq("id", fileRow.id);

        summary.files_processed++;
      } catch (e) {
        const status = (e as { status?: number })?.status;
        const msg = e instanceof Error ? e.message : String(e);

        await admin.from("intuizi_ingest_files").update({
          status: "failed",
          attempts: (fileRow.attempts ?? 0) + 1,
          error_message: msg.slice(0, 2000),
          finished_at: new Date().toISOString(),
        }).eq("id", fileRow.id);
        summary.files_failed++;
        summary.errors.push(`${cand.key}: ${msg}`);

        // ---- Rule 4: circuit breaker ---------------------------------------
        if (status === 402 || status === 403 || /gateway 40[23]/.test(msg)) {
          summary.paused = true;
          summary.pause_reason = msg.slice(0, 500);
          await admin.from("intuizi_ingest_state").upsert({
            lock_name: LOCK_NAME,
            paused: true,
            pause_reason: msg.slice(0, 500),
            updated_at: new Date().toISOString(),
          }, { onConflict: "lock_name" });
          break;
        }
        if (status === 429 || /gateway 429|rate limit/i.test(msg)) {
          const next = (state?.consecutive_rate_limits ?? 0) + 1;
          if (next >= 3) {
            summary.paused = true;
            summary.pause_reason = `rate limited (${next} in a row) — parked until the next scheduled run`;
            await admin.from("intuizi_ingest_state").upsert({
              lock_name: LOCK_NAME,
              paused: true,
              pause_reason: summary.pause_reason,
              consecutive_rate_limits: next,
              updated_at: new Date().toISOString(),
            }, { onConflict: "lock_name" });
            break;
          }
          await admin.from("intuizi_ingest_state").upsert({
            lock_name: LOCK_NAME,
            consecutive_rate_limits: next,
            updated_at: new Date().toISOString(),
          }, { onConflict: "lock_name" });
        }
      }
    }

    await admin.from("intuizi_ingest_state").upsert({
      lock_name: LOCK_NAME,
      last_run_at: new Date().toISOString(),
      last_result:
        `files=${summary.files_processed}/${summary.files_processed + summary.files_failed} ` +
        `identifiers=${summary.identifiers_scored}`,
      updated_at: new Date().toISOString(),
    }, { onConflict: "lock_name" });

    return json(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("intuizi-ingest failed:", msg);
    await admin.from("intuizi_ingest_state").upsert({
      lock_name: LOCK_NAME,
      last_run_at: new Date().toISOString(),
      last_result: `error: ${msg.slice(0, 300)}`,
      updated_at: new Date().toISOString(),
    }, { onConflict: "lock_name" });
    return json({ ...summary, error: msg }, 500);
  } finally {
    // Always release the lease so a stuck run cannot block the schedule.
    await admin.rpc("release_intuizi_lease", { p_lock_name: LOCK_NAME }).catch(() => {});
  }
});
