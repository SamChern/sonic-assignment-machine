// Inference configuration validator.
//
// Answers one question for the UI: is it safe to start semantic analysis right
// now, given how EC2 GPU inference is configured for the selected model?
//
// Returns a verdict ("ok" | "warn" | "blocked") plus per-check detail. The UI
// blocks "run semantic analysis" on "blocked" and shows an inline warning on
// "warn". No secret values are ever returned — only whether they are present.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

type Verdict = "ok" | "warn" | "blocked";

interface Check {
  id: string;
  label: string;
  state: "ok" | "warn" | "fail";
  detail: string;
}

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
    if (bearer !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      const { data, error } = await admin.auth.getUser(bearer);
      if (error || !data?.user) return json({ success: false, error: "Unauthorized" }, 401);
    }

    const checks: Check[] = [];

    // 1. Endpoint + credential presence.
    checks.push(
      EC2_URL
        ? { id: "url", label: "EC2 inference endpoint", state: "ok", detail: "EC2_INFERENCE_URL is set" }
        : {
            id: "url",
            label: "EC2 inference endpoint",
            state: "fail",
            detail: "EC2_INFERENCE_URL is not set — no EC2 inference server is configured",
          },
    );
    checks.push(
      EC2_KEY
        ? { id: "key", label: "EC2 API key", state: "ok", detail: "Credential present" }
        : {
            id: "key",
            label: "EC2 API key",
            state: "fail",
            detail: "EC2_INFERENCE_API_KEY (or AWS_API_KEY) is not set",
          },
    );

    // 2. Selected models.
    checks.push(
      EC2_CHAT_MODEL
        ? {
            id: "chat_model",
            label: "Selected scoring model",
            state: "ok",
            detail: `EC2_INFERENCE_MODEL = ${EC2_CHAT_MODEL}`,
          }
        : {
            id: "chat_model",
            label: "Selected scoring model",
            state: EC2_REQUIRED ? "fail" : "ok",
            detail: EC2_REQUIRED
              ? "EC2_INFERENCE_REQUIRED=true but EC2_INFERENCE_MODEL is not set"
              : "By design: semantic scoring runs on the Lovable AI Gateway (no local scoring model configured)",
          },

    );
    checks.push(
      EC2_EMBED_MODEL
        ? {
            id: "embed_model",
            label: "Selected embedding model",
            state: EC2_EMBED_DIMS ? "ok" : "warn",
            detail: EC2_EMBED_DIMS
              ? `EC2_EMBEDDING_MODEL = ${EC2_EMBED_MODEL} (${EC2_EMBED_DIMS} dims, padded to 1536)`
              : `EC2_EMBEDDING_MODEL = ${EC2_EMBED_MODEL} but EC2_EMBEDDING_DIMS is unset — vectors may be stored at the wrong width`,
          }
        : {
            id: "embed_model",
            label: "Selected embedding model",
            state: "warn",
            detail: "EC2_EMBEDDING_MODEL is not set — embeddings run on the Lovable AI Gateway",
          },
    );

    // 3. Live probe: is the server reachable and does it actually serve the
    //    selected models on GPU?
    let served: string[] = [];
    let gpu: boolean | null = null;
    let gpuDetail = "";

    if (EC2_URL) {
      const models = await probe("/v1/models");
      if ("error" in models) {
        checks.push({
          id: "reachable",
          label: "EC2 server reachable",
          state: "fail",
          detail: `Probe failed: ${models.error}`,
        });
      } else if (models.status >= 400) {
        checks.push({
          id: "reachable",
          label: "EC2 server reachable",
          state: "fail",
          detail: `GET /v1/models returned ${models.status}`,
        });
      } else {
        const list = (models.body as { data?: { id?: string }[] })?.data ?? [];
        served = list.map((m) => String(m?.id ?? "")).filter(Boolean);
        checks.push({
          id: "reachable",
          label: "EC2 server reachable",
          state: "ok",
          detail: served.length ? `Serving ${served.length} model(s)` : "Reachable, model list empty",
        });

        if (EC2_CHAT_MODEL) {
          const hit = served.some((m) => m === EC2_CHAT_MODEL || m.startsWith(EC2_CHAT_MODEL));
          checks.push({
            id: "model_served",
            label: "Selected model is loaded",
            state: hit ? "ok" : "fail",
            detail: hit
              ? `${EC2_CHAT_MODEL} is loaded on the EC2 server`
              : `${EC2_CHAT_MODEL} is NOT served by the EC2 endpoint${
                  served.length ? ` (available: ${served.slice(0, 8).join(", ")})` : ""
                }`,
          });
        }
      }

      // GPU presence: /health is expected to report accelerator info. A CPU-only
      // box is a hard failure whenever a local scoring model is selected.
      const health = await probe("/health");
      if (!("error" in health) && health.status < 400) {
        const h = health.body as Record<string, unknown>;
        const raw = JSON.stringify(h ?? {});
        const flag = h?.gpu ?? h?.cuda ?? h?.nvidia ?? null;
        gpu = typeof flag === "boolean"
          ? flag
          : /"(gpu|cuda|nvidia)"\s*:\s*(true|"[^"]+")/i.test(raw)
            ? true
            : /cuda|nvidia|gpu/i.test(raw)
              ? true
              : false;
        gpuDetail = gpu
          ? "Health endpoint reports GPU/CUDA acceleration"
          : EC2_CHAT_MODEL
            ? "Health endpoint reports no GPU/CUDA device (CPU-only instance)"
            : "No GPU needed: no local scoring model is configured";
      } else {
        gpuDetail = EC2_CHAT_MODEL
          ? "Health endpoint did not report accelerator info"
          : "No GPU needed: no local scoring model is configured";
      }

      checks.push({
        id: "gpu",
        label: "GPU acceleration",
        state: gpu === true ? "ok" : EC2_CHAT_MODEL ? "fail" : "ok",
        detail: gpuDetail,
      });
    }


    // 4. Fallback availability.
    checks.push(
      LOVABLE_API_KEY
        ? {
            id: "fallback",
            label: "Lovable AI fallback",
            state: EC2_REQUIRED ? "warn" : "ok",
            detail: EC2_REQUIRED
              ? "Fallback is available but disabled by EC2_INFERENCE_REQUIRED=true"
              : "Available if EC2 inference is unavailable",
          }
        : {
            id: "fallback",
            label: "Lovable AI fallback",
            state: "warn",
            detail: "LOVABLE_API_KEY is not set — there is no fallback if EC2 inference fails",
          },
    );

    const hasFail = checks.some((c) => c.state === "fail");
    const hasWarn = checks.some((c) => c.state === "warn");

    // Blocked when a hard failure would leave analysis with no working route:
    // either EC2 is required, or EC2 is configured but broken and there is no
    // fallback key.
    const fallbackUsable = !!LOVABLE_API_KEY && !EC2_REQUIRED;
    const verdict: Verdict = hasFail && !fallbackUsable ? "blocked" : hasFail || hasWarn ? "warn" : "ok";

    const chatProvider = EC2_CHAT_MODEL && !hasFail ? "ec2" : fallbackUsable ? "gateway" : "none";

    return json({
      success: true,
      verdict,
      blocked: verdict === "blocked",
      ec2_required: EC2_REQUIRED,
      gpu,
      chat_provider: chatProvider,
      selected_chat_model: EC2_CHAT_MODEL || null,
      selected_embedding_model: EC2_EMBED_MODEL || null,
      served_models: served.slice(0, 20),
      checks,
      summary:
        verdict === "blocked"
          ? "Semantic analysis is blocked: EC2 GPU inference is not correctly configured for the selected model and no fallback is available."
          : verdict === "warn"
            ? "Semantic analysis can run. Some inference does not run on EC2."
            : EC2_CHAT_MODEL
              ? "EC2 GPU inference is correctly configured for the selected model."
              : "Inference routing is as configured: scoring on Lovable AI, embeddings/DSP on EC2.",

    });
  } catch (e) {
    console.error("inference-config-validate failed:", (e as Error).message);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});
