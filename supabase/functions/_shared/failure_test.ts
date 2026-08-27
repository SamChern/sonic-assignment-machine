import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { backoffFor, classifyFailure, newTraceId, stageOf, tagStage } from "./failure.ts";

Deno.test("compute kills retry with a smaller workload", () => {
  const v = classifyFailure({ status: 546, message: "WORKER_RESOURCE_LIMIT" });
  assertEquals(v.kind, "resource");
  assertEquals(v.retryable, true);
  assertEquals(v.shrink, true);
});

Deno.test("idle timeouts are treated as resource pressure", () => {
  const v = classifyFailure({ code: "IDLE_TIMEOUT", message: "Request idle timeout limit reached" });
  assertEquals(v.kind, "resource");
  assertEquals(v.shrink, true);
});

Deno.test("schema errors fail fast with a clear reason", () => {
  for (const e of [
    { code: "PGRST204", message: "Could not find the 'foo' column of 'bar' in the schema cache" },
    { code: "42703", message: 'column "trace_id" does not exist' },
    { status: 400, message: "invalid body" },
  ]) {
    const v = classifyFailure(e);
    assertEquals(v.kind, "schema");
    assertEquals(v.retryable, false);
    assertEquals(v.shrink, false);
    assertEquals(v.backoffMs, 0);
  }
});

Deno.test("credits and policy denials never retry", () => {
  assertEquals(classifyFailure({ status: 402, message: "InsufficientCredits" }).kind, "credits");
  assertEquals(classifyFailure({ status: 403, message: "blocked" }).retryable, false);
  assertEquals(classifyFailure({ status: 401, message: "no key" }).kind, "auth");
});

Deno.test("rate limits honour the gateway hint and back off", () => {
  const v = classifyFailure({ status: 429, message: '{"retryAfterMs":42000}' });
  assertEquals(v.kind, "rate_limit");
  assertEquals(v.backoffMs >= 42000, true);
  assertEquals(backoffFor(v, 2) > v.backoffMs, true);
});

Deno.test("stage tagging and trace ids survive rethrow", () => {
  const e = new Error("boom");
  tagStage(e, "analyze");
  tagStage(e, "persist"); // first stage wins — the real failure point
  assertEquals(stageOf(e), "analyze");
  assertEquals(newTraceId("run").startsWith("run_"), true);
});
