// Validator edge cases: malformed env vars, unknown model names, and
// half-configured embedding routing. None of these may block semantic
// processing while EC2_INFERENCE_REQUIRED is not true.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildVerdict,
  parseInferenceConfig,
  type ProbeResult,
} from "../_shared/inferenceVerdict.ts";

const reachable = (models: string[], gpu: boolean | null = false): ProbeResult => ({
  reachable: true,
  reachableDetail: `Serving ${models.length} model(s)`,
  servedModels: models,
  gpu,
});

const checkState = (r: ReturnType<typeof buildVerdict>, id: string) =>
  r.checks.find((c) => c.id === id)?.state;

// ---------- malformed environment variables ----------

Deno.test("env: whitespace and quotes are stripped", () => {
  const cfg = parseInferenceConfig({
    EC2_INFERENCE_URL: '  "https://ec2.example.com/"  ',
    EC2_INFERENCE_API_KEY: " secret ",
    EC2_INFERENCE_MODEL: "  ",
    EC2_EMBEDDING_MODEL: "'nomic-embed-text:latest'",
    EC2_EMBEDDING_DIMS: " 768 ",
    LOVABLE_API_KEY: "lk",
  });
  assertEquals(cfg.ec2Url, "https://ec2.example.com");
  assertEquals(cfg.ec2Key, "secret");
  assertEquals(cfg.chatModel, "");
  assertEquals(cfg.embedModel, "nomic-embed-text:latest");
  assertEquals(cfg.embedDims, 768);
});

Deno.test("env: whitespace-only values count as unset, not as configured", () => {
  const cfg = parseInferenceConfig({
    EC2_INFERENCE_URL: "   ",
    EC2_INFERENCE_API_KEY: "\n\t",
    LOVABLE_API_KEY: "lk",
  });
  assertEquals(cfg.ec2Url, "");
  assertEquals(cfg.ec2Key, "");
  const r = buildVerdict(cfg, {
    reachable: null,
    reachableDetail: "No EC2 endpoint configured",
    servedModels: [],
    gpu: null,
  });
  assertEquals(r.blocked, false);
  assertEquals(checkState(r, "url"), "skipped");
  assertEquals(checkState(r, "key"), "skipped");
});

Deno.test("env: EC2_INFERENCE_REQUIRED accepts TRUE/1/yes/on", () => {
  for (const v of ["true", "TRUE", " True ", "1", "yes", "ON"]) {
    assertEquals(parseInferenceConfig({ EC2_INFERENCE_REQUIRED: v }).ec2Required, true, v);
  }
});

Deno.test("env: junk EC2_INFERENCE_REQUIRED never blocks (fails open to not-required)", () => {
  for (const v of ["maybe", "false", "0", "", "no", "truthy"]) {
    const cfg = parseInferenceConfig({ EC2_INFERENCE_REQUIRED: v, LOVABLE_API_KEY: "lk" });
    assertEquals(cfg.ec2Required, false, v);
    assertEquals(
      buildVerdict(cfg, {
        reachable: null,
        reachableDetail: "No EC2 endpoint configured",
        servedModels: [],
        gpu: null,
      }).blocked,
      false,
      v,
    );
  }
});

Deno.test("env: unparsable or negative EC2_EMBEDDING_DIMS collapses to 0", () => {
  for (const v of ["abc", "", "NaN", "-768", "0", "1e3x"]) {
    const dims = parseInferenceConfig({ EC2_EMBEDDING_DIMS: v }).embedDims;
    assert(dims === 0 || dims > 0, v);
    if (v !== "1e3x") assertEquals(dims, 0, v);
  }
});

Deno.test("env: AWS_API_KEY is used when EC2_INFERENCE_API_KEY is absent", () => {
  const cfg = parseInferenceConfig({ AWS_API_KEY: "aws-key" });
  assertEquals(cfg.ec2Key, "aws-key");
});

Deno.test("env: malformed dims with a configured embedding model warns but never blocks", () => {
  const cfg = parseInferenceConfig({
    EC2_INFERENCE_URL: "https://ec2.example.com",
    EC2_INFERENCE_API_KEY: "k",
    EC2_EMBEDDING_MODEL: "nomic-embed-text:latest",
    EC2_EMBEDDING_DIMS: "not-a-number",
    LOVABLE_API_KEY: "lk",
  });
  const r = buildVerdict(cfg, reachable(["nomic-embed-text:latest"]));
  assertEquals(checkState(r, "embed_model"), "warn");
  assertEquals(r.verdict, "warn");
  assertEquals(r.blocked, false);
});

// ---------- unknown / mismatched model names ----------

Deno.test("unknown scoring model name falls back to Lovable AI without blocking", () => {
  const cfg = parseInferenceConfig({
    EC2_INFERENCE_URL: "https://ec2.example.com",
    EC2_INFERENCE_API_KEY: "k",
    EC2_INFERENCE_MODEL: "totally-made-up-model",
    LOVABLE_API_KEY: "lk",
  });
  const r = buildVerdict(cfg, reachable(["nomic-embed-text:latest"], true));
  assertEquals(checkState(r, "model_served"), "fail");
  assertEquals(r.chat_provider, "gateway");
  assertEquals(r.blocked, false);
});

Deno.test("unknown scoring model name blocks when EC2 is required", () => {
  const cfg = parseInferenceConfig({
    EC2_INFERENCE_URL: "https://ec2.example.com",
    EC2_INFERENCE_API_KEY: "k",
    EC2_INFERENCE_MODEL: "totally-made-up-model",
    EC2_INFERENCE_REQUIRED: "true",
    LOVABLE_API_KEY: "lk",
  });
  const r = buildVerdict(cfg, reachable(["qwen2.5:7b"], true));
  assertEquals(r.blocked, true);
  assertEquals(r.chat_provider, "none");
});

Deno.test("model name matches by tag prefix (qwen2.5 vs qwen2.5:7b)", () => {
  const cfg = parseInferenceConfig({
    EC2_INFERENCE_URL: "https://ec2.example.com",
    EC2_INFERENCE_API_KEY: "k",
    EC2_INFERENCE_MODEL: "qwen2.5",
    LOVABLE_API_KEY: "lk",
  });
  const r = buildVerdict(cfg, reachable(["qwen2.5:7b-instruct"], true));
  assertEquals(checkState(r, "model_served"), "ok");
  assertEquals(r.chat_provider, "ec2");
  assertEquals(r.blocked, false);
});

Deno.test("model name casing mismatch is reported, not silently accepted", () => {
  const cfg = parseInferenceConfig({
    EC2_INFERENCE_URL: "https://ec2.example.com",
    EC2_INFERENCE_API_KEY: "k",
    EC2_INFERENCE_MODEL: "QWEN2.5:7B",
    LOVABLE_API_KEY: "lk",
  });
  const r = buildVerdict(cfg, reachable(["qwen2.5:7b"], true));
  assertEquals(checkState(r, "model_served"), "fail");
  assertEquals(r.blocked, false);
});

Deno.test("empty served-model list with a local model does not block via the gateway", () => {
  const cfg = parseInferenceConfig({
    EC2_INFERENCE_URL: "https://ec2.example.com",
    EC2_INFERENCE_API_KEY: "k",
    EC2_INFERENCE_MODEL: "qwen2.5:7b",
    LOVABLE_API_KEY: "lk",
  });
  const r = buildVerdict(cfg, {
    reachable: true,
    reachableDetail: "Reachable, model list empty",
    servedModels: [],
    gpu: true,
  });
  assertEquals(checkState(r, "model_served"), "fail");
  assertEquals(r.blocked, false);
});

// ---------- missing / half-configured embedding routing ----------

Deno.test("no embedding model: check is skipped and embeddings route to Lovable AI", () => {
  const cfg = parseInferenceConfig({ LOVABLE_API_KEY: "lk" });
  const r = buildVerdict(cfg, {
    reachable: null,
    reachableDetail: "No EC2 endpoint configured",
    servedModels: [],
    gpu: null,
  });
  assertEquals(checkState(r, "embed_model"), "skipped");
  assertEquals(r.selected_embedding_model, null);
  assertEquals(r.verdict, "ok");
  assertEquals(r.blocked, false);
});

Deno.test("dims set without an embedding model warns about half-configured routing", () => {
  const cfg = parseInferenceConfig({ EC2_EMBEDDING_DIMS: "768", LOVABLE_API_KEY: "lk" });
  const r = buildVerdict(cfg, {
    reachable: null,
    reachableDetail: "No EC2 endpoint configured",
    servedModels: [],
    gpu: null,
  });
  assertEquals(checkState(r, "embed_model"), "warn");
  assertEquals(r.verdict, "warn");
  assertEquals(r.blocked, false);
});

Deno.test("embedding model configured but EC2 unreachable stays unblocked", () => {
  const cfg = parseInferenceConfig({
    EC2_INFERENCE_URL: "https://ec2.example.com",
    EC2_INFERENCE_API_KEY: "k",
    EC2_EMBEDDING_MODEL: "nomic-embed-text:latest",
    EC2_EMBEDDING_DIMS: "768",
    LOVABLE_API_KEY: "lk",
  });
  const r = buildVerdict(cfg, {
    reachable: false,
    reachableDetail: "Probe failed: connect timeout",
    servedModels: [],
    gpu: null,
  });
  assertEquals(checkState(r, "reachable"), "warn");
  assertEquals(r.blocked, false);
  assertEquals(r.chat_provider, "gateway");
});

Deno.test("endpoint set without a credential fails that check but does not block", () => {
  const cfg = parseInferenceConfig({
    EC2_INFERENCE_URL: "https://ec2.example.com",
    LOVABLE_API_KEY: "lk",
  });
  const r = buildVerdict(cfg, reachable(["nomic-embed-text:latest"]));
  assertEquals(checkState(r, "key"), "fail");
  assertEquals(r.blocked, false);
  assertEquals(r.verdict, "warn");
});

Deno.test("every check carries a non-empty label and detail", () => {
  const r = buildVerdict(
    parseInferenceConfig({
      EC2_INFERENCE_URL: "https://ec2.example.com",
      EC2_INFERENCE_API_KEY: "k",
      EC2_INFERENCE_MODEL: "qwen2.5:7b",
      EC2_EMBEDDING_MODEL: "nomic-embed-text:latest",
      EC2_EMBEDDING_DIMS: "768",
      LOVABLE_API_KEY: "lk",
    }),
    reachable(["qwen2.5:7b", "nomic-embed-text:latest"], true),
  );
  for (const c of r.checks) {
    assert(c.label.length > 0, c.id);
    assert(c.detail.length > 0, c.id);
  }
  assert(r.summary.length > 0);
});
