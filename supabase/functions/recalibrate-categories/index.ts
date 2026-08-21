// Applies pending category_feedback rows to category_calibration.bias and
// marks them processed. Idempotent. Admin-only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LEARNING_RATE = 0.25; // damp per-feedback nudges

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Uniform authorization: admin role or internal service-role invocation.
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const authz = await requireAdmin(req, supabase).catch((e) => e as AuthzError);
  if (authz instanceof AuthzError) {
    return new Response(JSON.stringify({ error: authz.message }), { status: authz.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Pull pending feedback joined with the tags of the underlying audio_source
  const { data: feedback, error } = await supabase
    .from("category_feedback")
    .select("id, audio_source_id, category, predicted_score, corrected_score")
    .eq("processed", false)
    .limit(500);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (!feedback?.length) return new Response(JSON.stringify({ processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Map audio_source_id -> node_ids
  const sourceIds = [...new Set(feedback.map(f => f.audio_source_id).filter(Boolean))];
  const { data: tags } = await supabase
    .from("audio_source_tags").select("audio_source_id,node_id").in("audio_source_id", sourceIds);
  const nodesBySource = new Map<string, string[]>();
  for (const t of tags ?? []) {
    const arr = nodesBySource.get(t.audio_source_id) ?? [];
    arr.push(t.node_id);
    nodesBySource.set(t.audio_source_id, arr);
  }

  let applied = 0;
  for (const fb of feedback) {
    const nodes = nodesBySource.get(fb.audio_source_id) ?? [];
    const delta = (Number(fb.corrected_score) - Number(fb.predicted_score)) * LEARNING_RATE;
    if (!nodes.length || !isFinite(delta) || delta === 0) {
      await supabase.from("category_feedback").update({ processed: true }).eq("id", fb.id);
      continue;
    }
    const perNode = delta / nodes.length;
    for (const nid of nodes) {
      const { data: row } = await supabase
        .from("category_calibration")
        .select("id,bias").eq("taxonomy_node_id", nid).eq("category", fb.category).maybeSingle();
      if (row) {
        await supabase.from("category_calibration")
          .update({ bias: Number(row.bias) + perNode, updated_at: new Date().toISOString() })
          .eq("id", row.id);
      } else {
        await supabase.from("category_calibration").insert({
          taxonomy_node_id: nid, category: fb.category, n: 0, mean_score: 50, m2: 0, bias: perNode,
        });
      }
    }
    await supabase.from("category_feedback").update({ processed: true }).eq("id", fb.id);
    applied++;
  }

  return new Response(JSON.stringify({ processed: applied }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
