// Step 5 — AudioSet ontology importer.
//
// Admin-only. Ingests the raw `ontology.json` from github.com/audioset/ontology
// into public.taxonomy_nodes as `aset.<slug>` codes, preserving hierarchy via
// parent_code. Idempotent: existing `aset.*` rows are updated in place (label /
// parent only) and never duplicated. Embeddings are produced afterwards by
// `semantic-backfill` (Step 3), which picks up rows with a NULL audio_embedding.
//
// Body: { ontology: unknown, dry_run?: boolean } | { status_only: true }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";
import {
  AUDIOSET_PREFIX,
  AUDIOSET_VERSION,
  buildAudioSetNodes,
  coerceOntology,
} from "../_shared/audioset.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CHUNK = 400;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.status_only === true) {
      return json({ success: true, ...(await readStatus(admin)) });
    }

    const entries = coerceOntology(body.ontology);
    if (entries.length === 0) {
      return json({
        success: false,
        error:
          "No AudioSet entries found. Upload the raw ontology.json array (each item needs `id` and `name`).",
      }, 400);
    }

    const nodes = buildAudioSetNodes(entries);
    if (body.dry_run === true) {
      return json({
        success: true,
        dry_run: true,
        parsed: entries.length,
        nodes: nodes.length,
        roots: nodes.filter((n) => !n.parent_code).length,
        max_depth: nodes.reduce((m, n) => Math.max(m, n.depth), 0),
        sample: nodes.slice(0, 8).map((n) => ({ code: n.code, label: n.label, parent_code: n.parent_code })),
      });
    }

    // Existing aset rows -> update path (keeps ids, embeddings and crosswalks).
    const existing = new Map<string, string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("taxonomy_nodes")
        .select("id, code")
        .like("code", `${AUDIOSET_PREFIX}%`)
        .range(from, from + 999);
      if (error) return json({ success: false, error: error.message }, 500);
      for (const r of data ?? []) existing.set((r as { code: string }).code, (r as { id: string }).id);
      if (!data || data.length < 1000) break;
    }

    const toInsert = nodes.filter((n) => !existing.has(n.code));
    const toUpdate = nodes.filter((n) => existing.has(n.code));

    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];

    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const slice = toInsert.slice(i, i + CHUNK).map((n) => ({
        code: n.code,
        label: n.label,
        parent_code: n.parent_code,
        taxonomy_version: AUDIOSET_VERSION,
        crosswalk: { audioset_source: { mid: n.mid, description: n.description } },
      }));
      const { error } = await admin.from("taxonomy_nodes").insert(slice);
      if (error) errors.push(error.message);
      else inserted += slice.length;
    }

    for (const n of toUpdate) {
      const { error } = await admin
        .from("taxonomy_nodes")
        .update({
          label: n.label,
          parent_code: n.parent_code,
          taxonomy_version: AUDIOSET_VERSION,
          updated_at: new Date().toISOString(),
        })
        .eq("code", n.code);
      if (error) errors.push(error.message);
      else updated++;
    }

    return json({
      success: errors.length === 0,
      parsed: entries.length,
      nodes: nodes.length,
      inserted,
      updated,
      errors: errors.slice(0, 5),
      duration_ms: Date.now() - startedAt,
      ...(await readStatus(admin)),
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});

// deno-lint-disable-next-line no-explicit-any
async function readStatus(admin: any) {
  const total = await admin
    .from("taxonomy_nodes")
    .select("id", { count: "exact", head: true })
    .like("code", `${AUDIOSET_PREFIX}%`);
  const embedded = await admin
    .from("taxonomy_nodes")
    .select("id", { count: "exact", head: true })
    .like("code", `${AUDIOSET_PREFIX}%`)
    .not("audio_embedding", "is", null);
  const aset_nodes = total?.count ?? 0;
  const aset_embedded = embedded?.count ?? 0;
  return {
    aset_nodes,
    aset_embedded,
    aset_pending_embedding: Math.max(0, aset_nodes - aset_embedded),
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
