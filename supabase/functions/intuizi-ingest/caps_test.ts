// CI coverage for the dynamic per-invocation work caps.
//
// A WORKER_RESOURCE_LIMIT kill never writes a summary, so the caller reports it
// on the retry. These tests prove the caps shrink under compute pressure, stay
// above the progress floors, and recover once runs are clean again.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planWorkCaps, type BudgetHistoryEntry } from "./index.ts";

const entry = (over: Partial<BudgetHistoryEntry> = {}): BudgetHistoryEntry => ({
  at: new Date().toISOString(),
  budget_ms: 70_000,
  elapsed_ms: 40_000,
  timed_out: false,
  ...over,
});

Deno.test("clean history uses the default caps", () => {
  const caps = planWorkCaps([entry(), entry()]);
  assertEquals(caps.rows, 2500);
  assertEquals(caps.identifiers, 20);
  assertEquals(caps.shrink, 1);
});

Deno.test("a reported compute kill halves the workload", () => {
  const caps = planWorkCaps([entry()], { afterResourceLimit: true });
  assert(caps.rows < 2500 && caps.rows >= 1200, `rows=${caps.rows}`);
  assertEquals(caps.identifiers, 10);
  assert(caps.reason.includes("compute kill"));
});

Deno.test("repeated kills keep shrinking but never below the floors", () => {
  const history = [
    entry({ resource_kill: true }),
    entry({ resource_kill: true }),
    entry({ resource_kill: true }),
  ];
  const caps = planWorkCaps(history, { afterResourceLimit: true, shrink: 0.25 });
  assert(caps.rows >= 250, `rows floor: ${caps.rows}`);
  assert(caps.identifiers >= 4, `identifier floor: ${caps.identifiers}`);
  assert(caps.rows < 1000);
});

Deno.test("memory pressure in history reduces the caps", () => {
  const caps = planWorkCaps([entry({ mem_peak_mb: 260 })]);
  assert(caps.rows < 2500);
  assert(caps.reason.includes("heap"));
});

Deno.test("budget overruns shrink less aggressively than kills", () => {
  const overrun = planWorkCaps([entry({ timed_out: true })]);
  const killed = planWorkCaps([entry({ resource_kill: true })]);
  assert(overrun.rows > killed.rows);
});

Deno.test("explicit caller caps clamp the plan", () => {
  const caps = planWorkCaps([entry()], { maxRows: 600, maxIdentifiers: 5 });
  assertEquals(caps.rows, 600);
  assertEquals(caps.identifiers, 5);
});

Deno.test("caps recover after the pressure leaves the recent window", () => {
  const history = [
    entry({ resource_kill: true }),
    entry(),
    entry(),
    entry(),
  ];
  const caps = planWorkCaps(history);
  assertEquals(caps.rows, 2500);
  assertEquals(caps.identifiers, 20);
});
