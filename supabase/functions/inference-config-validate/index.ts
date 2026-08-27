// Inference configuration validator.
//
// Answers one question for the UI: is it safe to start semantic processing
// right now? Routing scoring to Lovable AI is intentional and never blocks;
// only EC2_INFERENCE_REQUIRED=true plus a hard failure blocks.
//
// Verdict logic lives in _shared/inferenceVerdict.ts (unit tested). No secret
// values are ever returned — only whether they are present.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { buildVerdict, type ProbeResult } from "../_shared/inferenceVerdict.ts";

const EC2_URL = (Deno.env.get("EC2_INFERENCE_URL") ?? "").replace(/\/+$/, "");
const EC2_KEY = Deno.env.get("EC2_INFERENCE_API_KEY") ?? Deno.env.get("AWS_API_KEY") ?? "";
const EC2_CHAT_MODEL = Deno.env.get("EC2_INFERENCE_MODEL") ?? "";
const EC2_EMBED_MODEL = Deno.env.get("EC2_EMBEDDING_MODEL") ?? "";
const EC2_EMBED_DIMS = Number(Deno.env.get("EC2_EMBEDDING_DIMS") ?? "0") || 0;
const EC2_REQUIRED = (Deno.env.get("EC2_INFERENCE_REQUIRED") ?? "").toLowerCase() === "true";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

const PROBE_TIMEOUT_MS = 8_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function probe(path: string): Promise<{ status: number; body: unknown } | { error: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(`${EC2_URL}${path}`, {
      headers: { Authorization: `Bearer ${EC2_KEY}`, "x-api-key": EC2_KEY },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let body: unknown = text.slice(0, 2000);
    try {
      body = JSON.parse(text);
    } catch { /* keep raw text */ }
    return { status: r.status, body };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    // Any signed-in user may read the verdict (enterprise workspaces need it to
    // gate their own "run semantic analysis" button); no secrets are exposed.
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return json({ success: false, error: "Unauthorized" }, 401);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    let actor = "service_role";
    if (bearer !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      const { data, error } = await admin.auth.getUser(bearer);
      if (error || !data?.user) return json({ success: false, error: "Unauthorized" }, 401);
      actor = data.user.id;
    }

    // Live probes (only when an endpoint is configured).
    const probeResult: ProbeResult = {
      reachable: null,
      reachableDetail: "No EC2 endpoint configured",
      servedModels: [],
      gpu: null,
    };

    if (EC2_URL) {
      const models = await probe("/v1/models");
      if ("error" in models) {
        probeResult.reachable = false;
        probeResult.reachableDetail = `Probe failed: ${models.error}`;
      } else if (models.status >= 400) {
        probeResult.reachable = false;
        probeResult.reachableDetail = `GET /v1/models returned ${models.status}`;
      } else {
        const list = (models.body as { data?: { id?: string }[] })?.data ?? [];
        probeResult.servedModels = list.map((m) => String(m?.id ?? "")).filter(Boolean);
        probeResult.reachable = true;
        probeResult.reachableDetail = probeResult.servedModels.length
          ? `Serving ${probeResult.servedModels.length} model(s)`
          : "Reachable, model list empty";
      }

      const health = await probe("/health");
      if (!("error" in health) && health.status < 400) {
        const h = health.body as Record<string, unknown>;
        const raw = JSON.stringify(h ?? {});
        const flag = h?.gpu ?? h?.cuda ?? h?.nvidia ?? null;
        probeResult.gpu = typeof flag === "boolean" ? flag : /cuda|nvidia|gpu/i.test(raw);
      }
    }

    const result = buildVerdict(
      {
        ec2Url: EC2_URL,
        ec2Key: EC2_KEY,
        chatModel: EC2_CHAT_MODEL,
        embedModel: EC2_EMBED_MODEL,
        embedDims: EC2_EMBED_DIMS,
        ec2Required: EC2_REQUIRED,
        lovableApiKey: LOVABLE_API_KEY,
      },
      probeResult,
    );

    // Structured metrics: one JSON line per validation so verdicts and the
    // chosen scoring route can be counted over time from edge function logs.
    console.log(JSON.stringify({
      metric: "inference_route_verdict",
      at: new Date().toISOString(),
      actor,
      verdict: result.verdict,
      blocked: result.blocked,
      scoring_route: result.chat_provider,
      embedding_route: EC2_EMBED_MODEL ? "ec2" : "gateway",
      ec2_required: result.ec2_required,
      gpu: result.gpu,
      chat_model: result.selected_chat_model,
      embedding_model: result.selected_embedding_model,
      served_model_count: result.served_models.length,
      failed_checks: result.checks.filter((c) => c.state === "fail").map((c) => c.id),
      warn_checks: result.checks.filter((c) => c.state === "warn").map((c) => c.id),
      skipped_checks: result.checks.filter((c) => c.state === "skipped").map((c) => c.id),
      duration_ms: Date.now() - startedAt,
    }));

    return json({ success: true, ...result });
  } catch (e) {
    console.log(JSON.stringify({
      metric: "inference_route_verdict",
      at: new Date().toISOString(),
      verdict: "error",
      error: (e as Error).message,
      duration_ms: Date.now() - startedAt,
    }));
    console.error("inference-config-validate failed:", (e as Error).message);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});
