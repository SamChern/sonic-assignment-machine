// Pure verdict logic for the inference configuration validator.
//
// Extracted so it can be unit tested without env vars or network probes.
// Rule of the house: routing scoring to the Lovable AI Gateway is an
// INTENTIONAL configuration, never a blocker. Semantic processing is blocked
// only when EC2_INFERENCE_REQUIRED=true and a hard failure leaves no working
// route.

export type Verdict = "ok" | "warn" | "blocked";

export interface Check {
  id: string;
  label: string;
  state: "ok" | "warn" | "fail" | "skipped";
  detail: string;
}

export interface InferenceConfig {
  ec2Url: string;
  ec2Key: string;
  chatModel: string;
  embedModel: string;
  embedDims: number;
  ec2Required: boolean;
  lovableApiKey: string;
}

export interface ProbeResult {
  /** null when no probe ran (no endpoint configured). */
  reachable: boolean | null;
  reachableDetail: string;
  servedModels: string[];
  /** null when the health endpoint reported nothing useful. */
  gpu: boolean | null;
}

export interface VerdictResult {
  verdict: Verdict;
  blocked: boolean;
  ec2_required: boolean;
  gpu: boolean | null;
  chat_provider: "ec2" | "gateway" | "none";
  selected_chat_model: string | null;
  selected_embedding_model: string | null;
  served_models: string[];
  checks: Check[];
  summary: string;
}

export function buildVerdict(cfg: InferenceConfig, probe: ProbeResult): VerdictResult {
  const checks: Check[] = [];
  const localScoring = !!cfg.chatModel;

  // 1. Endpoint + credentials. Only hard failures when EC2 must be in the path.
  checks.push({
    id: "url",
    label: "EC2 inference endpoint",
    state: cfg.ec2Url ? "ok" : cfg.ec2Required ? "fail" : "skipped",
    detail: cfg.ec2Url
      ? "EC2_INFERENCE_URL is set"
      : cfg.ec2Required
        ? "EC2_INFERENCE_URL is not set but EC2_INFERENCE_REQUIRED=true"
        : "No EC2 endpoint configured — not required",
  });
  checks.push({
    id: "key",
    label: "EC2 API key",
    state: cfg.ec2Key ? "ok" : cfg.ec2Url || cfg.ec2Required ? "fail" : "skipped",
    detail: cfg.ec2Key
      ? "Credential present"
      : cfg.ec2Url || cfg.ec2Required
        ? "EC2_INFERENCE_API_KEY (or AWS_API_KEY) is not set"
        : "Not needed — no EC2 endpoint configured",
  });

  // 2. Scoring model. No local model = intentional Lovable AI routing.
  checks.push({
    id: "chat_model",
    label: "Scoring model",
    state: localScoring ? "ok" : cfg.ec2Required ? "fail" : "ok",
    detail: localScoring
      ? `EC2_INFERENCE_MODEL = ${cfg.chatModel}`
      : cfg.ec2Required
        ? "EC2_INFERENCE_REQUIRED=true but EC2_INFERENCE_MODEL is not set"
        : "By design: semantic scoring runs on Lovable AI (no local scoring model configured)",
  });

  // 3. Embedding model. Dims without a model means the embedding route is
  //    half-configured, which is worth flagging (never blocking).
  const dimsOnly = !cfg.embedModel && cfg.embedDims > 0;
  checks.push({
    id: "embed_model",
    label: "Embedding model",
    state: cfg.embedModel ? (cfg.embedDims ? "ok" : "warn") : dimsOnly ? "warn" : "skipped",
    detail: cfg.embedModel
      ? cfg.embedDims
        ? `EC2_EMBEDDING_MODEL = ${cfg.embedModel} (${cfg.embedDims} dims, padded to 1536)`
        : `EC2_EMBEDDING_MODEL = ${cfg.embedModel} but EC2_EMBEDDING_DIMS is unset — vectors may be stored at the wrong width`
      : dimsOnly
        ? `EC2_EMBEDDING_DIMS = ${cfg.embedDims} but EC2_EMBEDDING_MODEL is not set — embeddings fall back to Lovable AI`
        : "Embeddings run on Lovable AI — no local embedding model configured",
  });


  // 4. Live probe results (only meaningful when an endpoint is configured).
  if (cfg.ec2Url) {
    checks.push({
      id: "reachable",
      label: "EC2 server reachable",
      state: probe.reachable === true ? "ok" : localScoring || cfg.ec2Required ? "fail" : "warn",
      detail: probe.reachableDetail,
    });
    if (localScoring && probe.reachable === true) {
      const hit = probe.servedModels.some(
        (m) => m === cfg.chatModel || m.startsWith(cfg.chatModel),
      );
      checks.push({
        id: "model_served",
        label: "Selected model is loaded",
        state: hit ? "ok" : "fail",
        detail: hit
          ? `${cfg.chatModel} is loaded on the EC2 server`
          : `${cfg.chatModel} is NOT served by the EC2 endpoint${
              probe.servedModels.length
                ? ` (available: ${probe.servedModels.slice(0, 8).join(", ")})`
                : ""
            }`,
      });
    }
    checks.push({
      id: "gpu",
      label: "GPU acceleration",
      state: probe.gpu === true ? "ok" : localScoring ? "fail" : "skipped",
      detail: probe.gpu === true
        ? "Health endpoint reports GPU/CUDA acceleration"
        : localScoring
          ? "Health endpoint reports no GPU/CUDA device (CPU-only instance)"
          : "Not checked: no local scoring model, so no GPU is needed",
    });
  }

  // 5. Fallback availability.
  checks.push({
    id: "fallback",
    label: "Lovable AI route",
    state: cfg.lovableApiKey ? (cfg.ec2Required ? "warn" : "ok") : cfg.ec2Required ? "ok" : "fail",
    detail: cfg.lovableApiKey
      ? cfg.ec2Required
        ? "Available but disabled by EC2_INFERENCE_REQUIRED=true"
        : localScoring
          ? "Available as a fallback if EC2 inference is unavailable"
          : "Primary scoring route — LOVABLE_API_KEY is configured"
      : cfg.ec2Required
        ? "Not configured, and not needed while EC2 inference is required"
        : "LOVABLE_API_KEY is not set — there is no scoring route at all",
  });

  const hasFail = checks.some((c) => c.state === "fail");
  const hasWarn = checks.some((c) => c.state === "warn");
  const gatewayUsable = !!cfg.lovableApiKey && !cfg.ec2Required;

  const verdict: Verdict = hasFail && !gatewayUsable ? "blocked" : hasFail || hasWarn ? "warn" : "ok";
  const ec2ScoringHealthy =
    localScoring &&
    !checks.some((c) => ["reachable", "model_served", "gpu"].includes(c.id) && c.state === "fail");
  const chatProvider: VerdictResult["chat_provider"] = ec2ScoringHealthy
    ? "ec2"
    : gatewayUsable
      ? "gateway"
      : "none";

  const summary = verdict === "blocked"
    ? "Semantic processing is blocked: EC2 inference is required but not correctly configured, and the Lovable AI route is disabled."
    : chatProvider === "gateway" && !localScoring
      ? "Semantic processing will run: scoring on Lovable AI by design, embeddings and audio DSP on EC2 where configured."
      : verdict === "warn"
        ? "Semantic processing will run, but some inference is not on EC2."
        : "EC2 inference is correctly configured for the selected model.";

  return {
    verdict,
    blocked: verdict === "blocked",
    ec2_required: cfg.ec2Required,
    gpu: probe.gpu,
    chat_provider: chatProvider,
    selected_chat_model: cfg.chatModel || null,
    selected_embedding_model: cfg.embedModel || null,
    served_models: probe.servedModels.slice(0, 20),
    checks,
    summary,
  };
}
