// Scores pending enterprise records against the SonicSIM semantic layer.
//
// Resolution order per record:
//   1. Exact/ILIKE match on an existing analysis for the same source name.
//   2. Match in the shared source_cache (same 6-category scoring).
// Records with no resolvable audio evidence stay pending and are reported back
// so the workspace can tell the user what to attach.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthzError, requireOrgMember } from "../_shared/org.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

type ScoreSet = Record<string, number>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const organizationId = String(body.organization_id ?? "");
    const datasetId = String(body.dataset_id ?? "");
    await requireOrgMember(req, admin, organizationId, true);
    if (!datasetId) throw new AuthzError("dataset_id is required", 400);

    const limit = Math.min(Number(body.limit ?? 500), 2000);

    const { data: pending, error: pendErr } = await admin
      .from("enterprise_records")
      .select("id, source_name, audio_url")
      .eq("dataset_id", datasetId)
      .eq("organization_id", organizationId)
      .eq("analysis_status", "pending")
      .limit(limit);
    if (pendErr) throw new Error(pendErr.message);

    let scored = 0;
    let unresolved = 0;

    for (const rec of pending ?? []) {
      const name = (rec.source_name ?? "").trim();
      let scores: ScoreSet | null = null;
      let confidence = 0.6;

      if (name) {
        const { data: prior } = await admin
          .from("source_analyses")
          .select(
            "emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score, confidence",
          )
          .ilike("source_name", name)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (prior) {
          scores = {};
          for (const c of CATEGORIES) scores[c] = Number(prior[`${c}_score`]);
          confidence = Number(prior.confidence ?? 0.6);
        } else {
          const { data: cached } = await admin
            .from("source_cache")
            .select(
              "emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
            )
            .ilike("source_name", name)
            .limit(1)
            .maybeSingle();
          if (cached) {
            scores = {};
            for (const c of CATEGORIES) scores[c] = Number(cached[`${c}_score`]);
            confidence = 0.5;
          }
        }
      }

      if (!scores) {
        unresolved += 1;
        await admin
          .from("enterprise_records")
          .update({
            analysis_status: "unresolved",
            analysis_error: rec.audio_url
              ? "Audio link present but not yet analyzed — run the audio pipeline for this source"
              : "No matching analyzed source. Add a source_name that exists in SonicSIM, or an audio link.",
          })
          .eq("id", rec.id);
        continue;
      }

      const update: Record<string, unknown> = {
        analysis_status: "scored",
        analysis_error: null,
        score_confidence: confidence,
      };
      for (const c of CATEGORIES) update[`${c}_score`] = scores[c];
      await admin.from("enterprise_records").update(update).eq("id", rec.id);
      scored += 1;
    }

    // Recompute dataset roll-up from all scored records.
    const { data: allScored } = await admin
      .from("enterprise_records")
      .select(
        "emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
      )
      .eq("dataset_id", datasetId)
      .eq("analysis_status", "scored");

    const rows = allScored ?? [];
    const averages: Record<string, number | null> = {};
    for (const c of CATEGORIES) {
      averages[`${c}_avg`] = rows.length
        ? rows.reduce((s, r) => s + Number(r[`${c}_score`] ?? 0), 0) / rows.length
        : null;
    }

    const { count } = await admin
      .from("enterprise_records")
      .select("id", { count: "exact", head: true })
      .eq("dataset_id", datasetId);

    await admin
      .from("enterprise_datasets")
      .update({
        scored_count: rows.length,
        row_count: count ?? rows.length,
        status: "ready",
        ...averages,
      })
      .eq("id", datasetId);

    return new Response(
      JSON.stringify({
        success: true,
        processed: pending?.length ?? 0,
        scored,
        unresolved,
        dataset_scored_total: rows.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const status = e instanceof AuthzError ? e.status : 500;
    console.error("enterprise-score-dataset failed:", (e as Error).message);
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
