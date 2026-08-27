import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildVerdict,
  type InferenceConfig,
  type ProbeResult,
} from "../_shared/inferenceVerdict.ts";

const baseCfg: InferenceConfig = {
  ec2Url: "https://ec2.example.com",
  ec2Key: "key",
  chatModel: "",
  embedModel: "nomic-embed-text:latest",
  embedDims: 768,
  ec2Required: false,
  lovableApiKey: "lovable-key",
};

const reachableCpuProbe: ProbeResult = {
  reachable: true,
  reachableDetail: "Serving 1 model(s)",
  servedModels: ["nomic-embed-text:latest"],
  gpu: false,
};

Deno.test("scoring on Lovable AI by design is never blocked", () => {
  const r = buildVerdict(baseCfg, reachableCpuProbe);
  assertEquals(r.blocked, false);
  assertEquals(r.verdict, "ok");
  assertEquals(r.chat_provider, "gateway");
});

Deno.test("CPU-only EC2 does not block when no local scoring model is selected", () => {
  const r = buildVerdict(baseCfg, { ...reachableCpuProbe, gpu: null });
  assertEquals(r.blocked, false);
  assertEquals(r.checks.find((c) => c.id === "gpu")?.state, "skipped");
});

Deno.test("unreachable EC2 does not block scoring that runs on Lovable AI", () => {
  const r = buildVerdict(baseCfg, {
    reachable: false,
    reachableDetail: "Probe failed: connection refused",
    servedModels: [],
    gpu: null,
  });
  assertEquals(r.blocked, false);
  assertEquals(r.verdict, "warn");
  assertEquals(r.chat_provider, "gateway");
});

Deno.test("no EC2 endpoint at all does not block", () => {
  const r = buildVerdict(
    { ...baseCfg, ec2Url: "", ec2Key: "", embedModel: "", embedDims: 0 },
    { reachable: null, reachableDetail: "No EC2 endpoint configured", servedModels: [], gpu: null },
  );
  assertEquals(r.blocked, false);
  assertEquals(r.chat_provider, "gateway");
});

Deno.test("EC2 required with a missing scoring model blocks", () => {
  const r = buildVerdict({ ...baseCfg, ec2Required: true }, reachableCpuProbe);
  assertEquals(r.blocked, true);
  assertEquals(r.verdict, "blocked");
  assertEquals(r.chat_provider, "none");
});

Deno.test("EC2 required with a CPU-only box blocks", () => {
  const r = buildVerdict(
    { ...baseCfg, ec2Required: true, chatModel: "qwen2.5:7b" },
    { ...reachableCpuProbe, servedModels: ["qwen2.5:7b"], gpu: false },
  );
  assertEquals(r.blocked, true);
  assertEquals(r.checks.find((c) => c.id === "gpu")?.state, "fail");
});

Deno.test("EC2 required and fully configured on GPU is ok", () => {
  const r = buildVerdict(
    { ...baseCfg, ec2Required: true, chatModel: "qwen2.5:7b" },
    { reachable: true, reachableDetail: "ok", servedModels: ["qwen2.5:7b"], gpu: true },
  );
  assertEquals(r.blocked, false);
  assertEquals(r.chat_provider, "ec2");
});

Deno.test("local model missing from the served list does not block while Lovable AI is usable", () => {
  const r = buildVerdict(
    { ...baseCfg, chatModel: "qwen2.5:7b" },
    { reachable: true, reachableDetail: "ok", servedModels: ["other-model"], gpu: true },
  );
  assertEquals(r.blocked, false);
  assertEquals(r.chat_provider, "gateway");
  assertEquals(r.checks.find((c) => c.id === "model_served")?.state, "fail");
});

Deno.test("no scoring route at all blocks", () => {
  const r = buildVerdict(
    { ...baseCfg, lovableApiKey: "" },
    reachableCpuProbe,
  );
  assertEquals(r.blocked, true);
  assertEquals(r.chat_provider, "none");
});
