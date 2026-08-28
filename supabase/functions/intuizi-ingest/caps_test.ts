// CI coverage for the dynamic per-invocation DISPATCH caps (Step 2.5).
//
// The control plane no longer decodes Parquet, so these caps bound the row slice
// one SQS message hands to the EC2 worker (`rows`) and how many files a run
// dispatches (`files`). The worker reports its own compute pressure back through
// `ingest-worker-callback`, and shrinking the slice is the correct response.
//
// These tests prove the caps shrink under reported pressure, stay above the
// progress floors, and recover once runs are clean again.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planWorkCaps, type BudgetHistoryEntry } from "./index.ts";

const DEFAULT_ROWS = 250_000;
const DEFAULT_FILES = 25;
const ROWS_FLOOR = 25_000;

const entry = (over: Partial<BudgetHistoryEntry> = {}): BudgetHistoryEntry => ({
  at: new Date().toISOString(),
  budget_ms: 30_000,
  elapsed_ms: 4_000,
  timed_out: false,
  ...over,
});

Deno.test("clean history uses the default dispatch caps", () => {
  const caps = planWorkCaps([entry(), entry()]);
  assertEquals(caps.rows, DEFAULT_ROWS);
  assertEquals(caps.files, DEFAULT_FILES);
  assertEquals(caps.shrink, 1);
});

Deno.test("a reported compute kill halves the dispatched workload", () => {
  const caps = planWorkCaps([entry()], { afterResourceLimit: true });
  assert(caps.rows < DEFAULT_ROWS, `rows=${caps.rows}`);
  assert(caps.files < DEFAULT_FILES, `files=${caps.files}`);
  assert(caps.reason.includes("compute kill"), caps.reason);
});

Deno.test("repeated kills keep shrinking but never below the floors", () => {
  const history = [
    entry({ resource_kill: true }),
    entry({ resource_kill: true }),
    entry({ resource_kill: true }),
  ];
  const caps = planWorkCaps(history, { afterResourceLimit: true, shrink: 0.25 });
  assert(caps.rows >= ROWS_FLOOR, `rows floor: ${caps.rows}`);
  assert(caps.files >= 1, `files floor: ${caps.files}`);
  assert(caps.rows < DEFAULT_ROWS / 2, `still shrinking: ${caps.rows}`);
});

Deno.test("memory pressure in history reduces the caps", () => {
  const caps = planWorkCaps([entry({ mem_peak_mb: 260 })]);
  assert(caps.rows < DEFAULT_ROWS);
  assert(caps.reason.includes("heap"), caps.reason);
});

Deno.test("budget overruns shrink less aggressively than kills", () => {
  const overrun = planWorkCaps([entry({ timed_out: true })]);
  const killed = planWorkCaps([entry({ resource_kill: true })]);
  assert(overrun.rows > killed.rows);
});

Deno.test("explicit caller caps clamp the plan", () => {
  const caps = planWorkCaps([entry()], { maxRows: 60_000, maxFiles: 3 });
  assertEquals(caps.rows, 60_000);
  assertEquals(caps.files, 3);
});

Deno.test("a caller cap below the row floor still keeps forward progress", () => {
  const caps = planWorkCaps([entry()], { maxRows: 10 });
  assertEquals(caps.rows, ROWS_FLOOR);
});

Deno.test("caps recover after the pressure leaves the recent window", () => {
  const history = [
    entry({ resource_kill: true }),
    entry(),
    entry(),
    entry(),
  ];
  const caps = planWorkCaps(history);
  assertEquals(caps.rows, DEFAULT_ROWS);
  assertEquals(caps.files, DEFAULT_FILES);
});
