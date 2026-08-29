// Step 3 — semantic-backfill: populate taxonomy_nodes.audio_embedding with
// CLAP text embeddings of each node's label path, so CTV/audio taxonomy nodes
// live in the same space as audio embeddings.
//
// Admin-only (or internal service-role). Body: { limit?: number (1..500, def 100),
// status_only?: boolean, recompute?: boolean }
//
// Idempotent: only rows with a NULL audio_embedding are embedded unless
// `recompute` is set. Batched at 64 texts per service call.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";
import {
  clapEmbedTexts,
  getSemanticSvcConfig,
  logSemanticCall,
  semanticSvcBreakerOpen,
} from "../_shared/semanticSvc.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BATCH = 24;
const MIN_BATCH = 6;


interface Node {
  id: string;
  code: string;
  label: string | null;
  parent_code: string | null;
}

/**
 * Text handed to CLAP. Codes are dotted paths (`web.topic.sports`), so the
 * label plus a humanized path gives the model usable context without leaking
 * any identifier.
 */
function nodeText(n: Node): string {
  const path = (n.code ?? "").split(/[.>/]/).filter(Boolean).join(" ").replace(/[_-]+/g, " ");
  const label = (n.label ?? "").trim();
  const parts = [label, path].filter((p) => p.length > 0);
  const text = parts.join(" — ").trim();
  return text.length > 0 ? `audio content about ${text}` : "audio content";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawLimit = Number(body.limit ?? 100);
    const limit = Math.max(1, Math.min(500, Number.isFinite(rawLimit) ? Math.round(rawLimit) : 100));
    const recompute = body.recompute === true;

    const coverage = await readCoverage(admin);

    if (body.status_only === true) {
      const cfg = await getSemanticSvcConfig(admin);
      return json({
        success: true,
        configured: Boolean(cfg),
        space: cfg?.space ?? null,
        breaker_open: semanticSvcBreakerOpen(),
        ...coverage,
        ...(await readGrounding(admin)),
      });
    }


    const cfg = await getSemanticSvcConfig(admin);
    if (!cfg) {
      return json({
        success: false,
        configured: false,
        error: "Semantic service not configured (Admin -> APIs & MCPs -> Semantic Service)",
        ...coverage,
      }, 503);
    }

    let query = admin
      .from("taxonomy_nodes")
      .select("id, code, label, parent_code")
      .order("code", { ascending: true })
      .limit(limit);
    if (!recompute) query = query.is("audio_embedding", null);

    const { data: rows, error } = await query;
    if (error) return json({ success: false, error: error.message }, 500);

    const nodes = (rows ?? []) as Node[];
    let embedded = 0;
    let failed = 0;

    for (let i = 0; i < nodes.length; i += BATCH) {
      if (semanticSvcBreakerOpen()) break;
      const slice = nodes.slice(i, i + BATCH);
      // taxonomy_nodes.audio_embedding is vector(512) — CLAP's native width, so
      // vectors are stored raw (no 1536 projection).
      // The CPU box drops connections (nginx 502) on large batches, so halve the
      // batch and retry before giving up on these rows.
      let vectors = await clapEmbedTexts(cfg, slice.map(nodeText), true);
      if (!vectors && slice.length > MIN_BATCH) {
        const half = Math.ceil(slice.length / 2);
        const a = await clapEmbedTexts(cfg, slice.slice(0, half).map(nodeText), true);
        const b = await clapEmbedTexts(cfg, slice.slice(half).map(nodeText), true);
        if (a && b) vectors = [...a, ...b];
      }

      if (!vectors) {
        failed += slice.length;
        continue;
      }

      // Per-row update: pgvector writes have no multi-row upsert path that keeps
      // the other columns intact.
      const results = await Promise.all(
        slice.map((n, k) => {
          const v = vectors[k];
          if (!v) return Promise.resolve(false);
          return admin
            .from("taxonomy_nodes")
            .update({ audio_embedding: JSON.stringify(v), updated_at: new Date().toISOString() })
            .eq("id", n.id)
            .then(({ error: upErr }: { error: { message: string } | null }) => {
              if (upErr) {
                console.warn(`taxonomy_nodes update failed for ${n.code}:`, upErr.message);
                return false;
              }
              return true;
            });
        }),
      );
      for (const ok of results) ok ? embedded++ : failed++;
    }

    const after = await readCoverage(admin);
    await logSemanticCall(admin, {
      action: "backfill_taxonomy",
      outcome: failed > 0 && embedded === 0 ? "error" : "ok",
      duration_ms: Date.now() - startedAt,
      dims: 512,
      subject_ref: `${embedded} embedded / ${failed} failed`,
      error_message: failed > 0 ? `${failed} rows failed` : null,
    });

    return json({
      success: true,
      configured: true,
      space: cfg.space,
      candidates: nodes.length,
      embedded,
      failed,
      breaker_open: semanticSvcBreakerOpen(),
      duration_ms: Date.now() - startedAt,
      ...after,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return json({ success: false, error: msg }, 500);
  }
});

async function readCoverage(
  // deno-lint-disable-next-line no-explicit-any
  admin: any,
): Promise<{ total_nodes: number; embedded_nodes: number; remaining_nodes: number }> {
  const total = await admin
    .from("taxonomy_nodes")
    .select("id", { count: "exact", head: true });
  const done = await admin
    .from("taxonomy_nodes")
    .select("id", { count: "exact", head: true })
    .not("audio_embedding", "is", null);
  const total_nodes = total?.count ?? 0;
  const embedded_nodes = done?.count ?? 0;
  return {
    total_nodes,
    embedded_nodes,
    remaining_nodes: Math.max(0, total_nodes - embedded_nodes),
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
