// CTV ingest: accepts admin-submitted batches of CTV audio rows, runs them
// through librosa + analyze-audio, persists results as regular audio_sources,
// links taxonomy tags, generates embeddings, and updates calibration stats.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const CATEGORIES = ["emotional", "cognitive", "social", "communication", "contextual", "artistic"] as const;
type Category = typeof CATEGORIES[number];

interface CtvTag {
  code: string;
  label?: string;
  parent_code?: string;
  weight?: number;
}

interface CtvRow {
  external_id?: string;
  name: string;
  audio_url?: string;
  audio_source_id?: string; // reuse existing
  tags?: CtvTag[];
  metadata?: Record<string, unknown>;
  for_user_id?: string; // optionally attribute to a specific user
}

interface IngestRequest {
  feed_name: string;
  file_uri?: string;
  rows: CtvRow[];
}

async function embed(text: string): Promise<number[] | null> {
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.data?.[0]?.embedding ?? null;
  } catch { return null; }
}

async function resolveTag(supabase: any, tag: CtvTag) {
  const { data: existing } = await supabase
    .from("taxonomy_nodes").select("id").eq("code", tag.code).maybeSingle();
  if (existing) return existing.id as string;
  const label = tag.label ?? tag.code;
  const embedding = await embed(`${tag.code} :: ${label}${tag.parent_code ? ` (under ${tag.parent_code})` : ""}`);
  const { data: inserted, error } = await supabase
    .from("taxonomy_nodes")
    .insert({ code: tag.code, label, parent_code: tag.parent_code ?? null, embedding })
    .select("id").single();
  if (error) throw error;
  return inserted.id as string;
}

async function buildTaxonomyContext(supabase: any, nodeIds: string[]): Promise<string> {
  if (!nodeIds.length) return "";
  const { data: nodes } = await supabase
    .from("taxonomy_nodes").select("code,label").in("id", nodeIds);
  const { data: calib } = await supabase
    .from("category_calibration").select("category,mean_score,m2,n,bias").in("taxonomy_node_id", nodeIds);
  const tagLine = (nodes ?? []).map((n: any) => `${n.code}(${n.label})`).join(", ");
  if (!calib || calib.length === 0) return `tags=[${tagLine}] (no prior; cold start)`;
  // Aggregate priors across the row's tags
  const byCat: Record<string, { sum: number; n: number; varSum: number; bias: number }> = {};
  for (const c of calib) {
    const k = c.category as string;
    const std = c.n > 1 ? Math.sqrt(Number(c.m2) / (c.n - 1)) : 0;
    byCat[k] ??= { sum: 0, n: 0, varSum: 0, bias: 0 };
    byCat[k].sum += Number(c.mean_score) * c.n;
    byCat[k].n += c.n;
    byCat[k].varSum += std * std;
    byCat[k].bias += Number(c.bias);
  }
  const priorParts = CATEGORIES.map(cat => {
    const a = byCat[cat];
    if (!a || a.n === 0) return `${cat}=?`;
    const mean = a.sum / a.n;
    const std = Math.sqrt(a.varSum / Object.keys(byCat).length);
    return `${cat}=${mean.toFixed(0)}±${std.toFixed(0)}`;
  }).join(" ");
  return `tags=[${tagLine}] prior(${priorParts})`;
}

async function updateCalibration(supabase: any, nodeIds: string[], scores: Record<Category, number>) {
  for (const nodeId of nodeIds) {
    for (const cat of CATEGORIES) {
      const x = Number(scores[cat]) || 0;
      const { data: row } = await supabase
        .from("category_calibration")
        .select("id,n,mean_score,m2,bias")
        .eq("taxonomy_node_id", nodeId).eq("category", cat).maybeSingle();
      if (!row) {
        await supabase.from("category_calibration").insert({
          taxonomy_node_id: nodeId, category: cat, n: 1, mean_score: x, m2: 0, bias: 0,
        });
      } else {
        // Welford
        const n = row.n + 1;
        const delta = x - Number(row.mean_score);
        const mean = Number(row.mean_score) + delta / n;
        const delta2 = x - mean;
        const m2 = Number(row.m2) + delta * delta2;
        await supabase.from("category_calibration")
          .update({ n, mean_score: mean, m2, updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth: require admin
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: roleRow } = await supabase
    .from("user_roles").select("id").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!roleRow) {
    return new Response(JSON.stringify({ error: "Admin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let body: IngestRequest;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!body?.feed_name || !Array.isArray(body.rows) || body.rows.length === 0) {
    return new Response(JSON.stringify({ error: "feed_name and rows[] required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: batch, error: batchErr } = await supabase
    .from("ctv_ingest_batches")
    .insert({
      feed_name: body.feed_name,
      file_uri: body.file_uri ?? null,
      total_rows: body.rows.length,
      status: "running",
      ingested_by: user.id,
    })
    .select("id").single();
  if (batchErr) {
    return new Response(JSON.stringify({ error: batchErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let success = 0, failed = 0;
  const errors: string[] = [];

  for (const row of body.rows) {
    try {
      // 1. Ensure audio_sources row
      let audioSourceId = row.audio_source_id ?? null;
      const targetUserId = row.for_user_id ?? user.id;
      if (!audioSourceId) {
        const { data: src, error: srcErr } = await supabase
          .from("audio_sources")
          .insert({
            user_id: targetUserId,
            source_type: "ctv",
            name: row.name,
            file_url: row.audio_url ?? null,
            ctv_metadata: row.metadata ?? {},
          })
          .select("id").single();
        if (srcErr) throw srcErr;
        audioSourceId = src.id;
      }

      // 2. Run librosa if we have an audio URL (best-effort, non-fatal)
      if (row.audio_url) {
        try {
          await supabase.functions.invoke("librosa-analyze-full", {
            body: { audio_source_id: audioSourceId, audio_url: row.audio_url },
            headers: { Authorization: authHeader },
          });
        } catch (e) {
          console.warn("librosa failed for", row.name, e);
        }
      }

      // 3. Resolve tags
      const nodeIds: string[] = [];
      for (const t of row.tags ?? []) {
        try { nodeIds.push(await resolveTag(supabase, t)); } catch (e) { console.warn("tag fail", t, e); }
      }
      if (nodeIds.length) {
        await supabase.from("audio_source_tags").upsert(
          nodeIds.map(nid => ({ audio_source_id: audioSourceId, node_id: nid, weight: 1.0 })),
          { onConflict: "audio_source_id,node_id" }
        );
      }

      // 4. Build taxonomy context block
      const taxonomy_context = await buildTaxonomyContext(supabase, nodeIds);

      // 5. Invoke analyze-audio
      const { data: ana, error: anaErr } = await supabase.functions.invoke("analyze-audio", {
        body: {
          sources: [{
            name: row.name, type: "file",
            audio_source_id: audioSourceId,
            taxonomy_context,
          }],
          user_id: targetUserId,
          save_results: true,
        },
        headers: { Authorization: authHeader },
      });
      if (anaErr) throw anaErr;
      const sourceOut = ana?.sources?.[0];
      if (!sourceOut) throw new Error("analyze-audio returned no source");

      // 6. Update calibration with the freshly produced scores
      const scoreMap = {} as Record<Category, number>;
      for (const c of sourceOut.categories ?? []) {
        scoreMap[(c.name ?? "").toLowerCase() as Category] = Number(c.score) || 0;
      }
      await updateCalibration(supabase, nodeIds, scoreMap);

      // 7. Generate profile_embedding for kNN warm-start
      const profileText =
        `name: ${row.name}; tags: ${(row.tags ?? []).map(t => t.code).join(",")}; ` +
        `scores: ${CATEGORIES.map(c => `${c}=${scoreMap[c] ?? "?"}`).join(",")}`;
      const profileEmbedding = await embed(profileText);
      if (profileEmbedding) {
        await supabase.from("audio_sources")
          .update({ profile_embedding: profileEmbedding })
          .eq("id", audioSourceId);
      }

      success++;
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${row.name}: ${msg}`);
      console.error("CTV row failed:", row.name, msg);
    }
  }

  await supabase.from("ctv_ingest_batches").update({
    success_rows: success,
    failed_rows: failed,
    status: failed === 0 ? "completed" : (success === 0 ? "failed" : "partial"),
    error_message: errors.slice(0, 10).join("\n") || null,
    updated_at: new Date().toISOString(),
  }).eq("id", batch.id);

  return new Response(JSON.stringify({
    batch_id: batch.id, success, failed, errors: errors.slice(0, 20),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
