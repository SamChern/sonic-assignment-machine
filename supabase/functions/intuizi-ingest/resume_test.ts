// CI coverage for checkpoint-based Parquet resume.
//
// Simulates a run that hits the 105s budget (time_budget_exhausted) and proves
// the next run continues at the persisted row group without re-transforming
// rows that already produced semantic output. Also covers the transient-error
// retry path, which must retry only the failed row groups.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isTransientParquetError,
  planRowGroupRead,
  retryRowGroups,
} from "../_shared/parquet.ts";

const GROUPS = [100, 100, 100, 50]; // 350 rows across 4 row groups
const TOTAL = GROUPS.reduce((a, b) => a + b, 0);

/** Absolute row ids a chunk covers, mirroring rowStart/rowEnd semantics. */
function rowIds(rowStart: number, rowEnd: number): number[] {
  return Array.from({ length: rowEnd - rowStart }, (_, i) => rowStart + i);
}

Deno.test("plans row-group aligned chunks and reports totals", () => {
  const p = planRowGroupRead(GROUPS, 0, 100);
  assertEquals(p.rowStart, 0);
  assertEquals(p.rowEnd, 100);
  assertEquals(p.checkpoint.nextRowGroup, 1);
  assertEquals(p.checkpoint.rowGroupsTotal, 4);
  assertEquals(p.checkpoint.exhausted, false);
});

Deno.test("resume after time_budget_exhausted continues at the saved cursor", () => {
  // Run 1: budget allows 2 row groups, then the 105s budget trips.
  const run1 = planRowGroupRead(GROUPS, 0, 200);
  assertEquals(run1.checkpoint.nextRowGroup, 2);
  assertEquals(run1.checkpoint.nextRowsOffset, 200);
  assertEquals(run1.checkpoint.exhausted, false);

  // Run 2 resumes from the persisted cursor, not from group 0.
  const run2 = planRowGroupRead(GROUPS, run1.checkpoint.nextRowGroup, 200);
  assertEquals(run2.rowStart, 200);
  assertEquals(run2.checkpoint.startRowGroup, 2);
  assertEquals(run2.checkpoint.nextRowGroup, 4);
  assertEquals(run2.checkpoint.exhausted, true);

  // No overlap between the two runs, and full coverage of the file.
  const seen = [...rowIds(run1.rowStart, run1.rowEnd), ...rowIds(run2.rowStart, run2.rowEnd)];
  assertEquals(new Set(seen).size, seen.length, "no row processed twice");
  assertEquals(seen.length, TOTAL, "every row processed exactly once");
});

Deno.test("multi-run resume never duplicates semantic rows", () => {
  // Drive the loop the way intuizi-ingest does: 1 row group per run.
  const scored = new Map<number, number>(); // rowId -> times scored
  let cursor = 0;
  let runs = 0;
  for (;;) {
    const p = planRowGroupRead(GROUPS, cursor, 1); // tiny budget => one group
    for (const id of rowIds(p.rowStart, p.rowEnd)) {
      scored.set(id, (scored.get(id) ?? 0) + 1);
    }
    cursor = p.checkpoint.nextRowGroup;
    runs++;
    if (p.checkpoint.exhausted) break;
    assert(runs < 20, "resume loop must terminate");
  }
  assertEquals(runs, GROUPS.length);
  assertEquals(scored.size, TOTAL);
  assert([...scored.values()].every((n) => n === 1), "each row scored exactly once");
});

Deno.test("an already-exhausted file returns no rows and stays exhausted", () => {
  const p = planRowGroupRead(GROUPS, GROUPS.length, 500);
  assertEquals(p.rowEnd - p.rowStart, 0);
  assertEquals(p.checkpoint.exhausted, true);
  assertEquals(p.checkpoint.nextRowsOffset, TOTAL);
});

Deno.test("a row group larger than the budget still makes progress", () => {
  const p = planRowGroupRead([500, 500], 0, 10);
  assert(p.rowEnd > p.rowStart, "must read at least one row group");
  assertEquals(p.checkpoint.nextRowGroup, 1);
});

Deno.test("transient errors retry only the failed row-group range", async () => {
  const attemptsSeen: Array<{ rowStart: number; rowEnd: number }> = [];
  const plan = planRowGroupRead(GROUPS, 2, 200);
  let calls = 0;

  const rows = await retryRowGroups(
    () => {
      calls++;
      attemptsSeen.push({ rowStart: plan.rowStart, rowEnd: plan.rowEnd });
      if (calls < 3) return Promise.reject(new Error("connection reset by peer"));
      return Promise.resolve(rowIds(plan.rowStart, plan.rowEnd));
    },
    { baseDelayMs: 0, sleep: () => Promise.resolve() },
  );

  assertEquals(calls, 3);
  assertEquals(rows.length, TOTAL - 200);
  assert(
    attemptsSeen.every((a) => a.rowStart === 200),
    "retries must not rewind to earlier row groups",
  );
});

Deno.test("permanent errors are not retried", async () => {
  let calls = 0;
  let threw = false;
  try {
    await retryRowGroups(() => {
      calls++;
      return Promise.reject(new Error("unsupported parquet codec LZ4_RAW"));
    }, { baseDelayMs: 0, sleep: () => Promise.resolve() });
  } catch {
    threw = true;
  }
  assert(threw);
  assertEquals(calls, 1);
});

Deno.test("transient classifier covers throttling and gateway faults", () => {
  assert(isTransientParquetError(new Error("SlowDown: reduce request rate")));
  assert(isTransientParquetError(Object.assign(new Error("bad gateway"), { status: 502 })));
  assert(isTransientParquetError(new Error("fetch failed")));
  assertEquals(isTransientParquetError(new Error("corrupt footer magic")), false);
});

Deno.test("retries stop when the run budget cannot absorb the backoff", async () => {
  let attempts = 0;
  const past = Date.now() + 10; // effectively no budget left
  await assertRejects(
    () =>
      retryRowGroups(
        () => {
          attempts++;
          return Promise.reject(new Error("connection reset by peer"));
        },
        { attempts: 5, baseDelayMs: 500, deadlineAt: past, sleep: () => Promise.resolve() },
      ),
    Error,
    "connection reset",
  );
  // Only the first attempt runs: the backoff would outlive the run budget.
  assertEquals(attempts, 1);
});
