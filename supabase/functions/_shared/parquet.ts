// Parquet reader for the Intuizi ingest path.
//
// Intuizi activation deliveries arrive as .parquet (usually snappy-compressed).
// hyparquet is a dependency-free reader; hyparquet-compressors adds gzip/zstd/brotli
// codecs so we accept whichever codec the delivery uses.
//
// Reads are range-based against the signed S3 URL, so only the footer plus the
// column chunks we actually need are transferred — a bounded row read does not
// pull the whole object into the function's memory.

import {
  asyncBufferFromUrl,
  parquetMetadataAsync,
  parquetReadObjects,
} from "https://esm.sh/hyparquet@1.29.1";
import { compressors } from "https://esm.sh/hyparquet-compressors@1.1.1";


/**
 * Objects larger than this are only readable when the host honours HTTP Range
 * requests (S3 does). Range reads mean we transfer the footer plus the first
 * row group(s) only, so a multi-GB delivery still ingests a bounded sample.
 */
const RANGE_REQUIRED_BYTES = 512 * 1024 * 1024;

/** Probe whether the URL serves partial content, so huge objects stay bounded. */
async function supportsRangeRequests(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
    // Consume the body so the connection is released.
    await res.arrayBuffer().catch(() => undefined);
    return res.status === 206;
  } catch {
    return false;
  }
}


function scalar(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return new TextDecoder().decode(v);
  if (Array.isArray(v)) return v.map(scalar);
  return v;
}

/** Candidate columns that identify a user/device across Intuizi deliveries. */
const USER_KEY_COLUMNS = [
  "maid",
  "device_id",
  "deviceid",
  "idfa",
  "gaid",
  "user_id",
  "userid",
  "hem",
  "hashed_email",
  "ip",
];

export interface ParquetValidation {
  numRowsFooter: number;
  numRowsRowGroups: number;
  rowGroups: number;
  columns: string[];
  codecs: string[];
  createdBy: string | null;
  byteLength: number | null;
  rowsRead: number;
  userKeyColumn: string | null;
  uniqueUsers: number;
  rowsPerUser: { min: number; median: number; mean: number; max: number } | null;
  warnings: string[];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Validation step run before rows are handed to the ingest normalizer.
 * Logs the Parquet footer (row groups, declared vs. summed row counts, codecs,
 * writer) and the computed rows-per-user distribution of the rows actually read,
 * so an operator can confirm a delivery really carries ~N rows per user.
 */
export function validateParquetRows(
  metadata: Record<string, unknown>,
  rows: Record<string, unknown>[],
  byteLength: number | null,
  expectedRowsPerUser?: number,
): ParquetValidation {
  const schema = (metadata.schema ?? []) as { num_children?: number; name: string }[];
  const columns = schema.filter((s) => !s.num_children).map((s) => s.name);

  const rowGroups = (metadata.row_groups ?? []) as {
    num_rows?: number | bigint;
    columns?: { meta_data?: { codec?: string | number } }[];
  }[];
  const numRowsRowGroups = rowGroups.reduce((sum, rg) => sum + Number(rg.num_rows ?? 0), 0);
  const codecs = [...new Set(
    rowGroups.flatMap((rg) =>
      (rg.columns ?? []).map((c) => String(c.meta_data?.codec ?? "unknown"))
    ),
  )];
  const numRowsFooter = Number(metadata.num_rows ?? 0);
  const createdBy = metadata.created_by ? String(metadata.created_by) : null;

  const warnings: string[] = [];
  if (numRowsRowGroups !== numRowsFooter) {
    warnings.push(
      `footer num_rows=${numRowsFooter} but row groups sum to ${numRowsRowGroups}`,
    );
  }

  // rows-per-user distribution over the rows we actually decoded
  const userKeyColumn = USER_KEY_COLUMNS
    .map((c) => columns.find((col) => col.toLowerCase() === c))
    .find((c): c is string => Boolean(c)) ?? null;

  let uniqueUsers = 0;
  let rowsPerUser: ParquetValidation["rowsPerUser"] = null;

  if (userKeyColumn && rows.length > 0) {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = String(row[userKeyColumn] ?? "");
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    uniqueUsers = counts.size;
    if (uniqueUsers > 0) {
      const vals = [...counts.values()].sort((a, b) => a - b);
      rowsPerUser = {
        min: vals[0],
        median: quantile(vals, 0.5),
        mean: vals.reduce((a, b) => a + b, 0) / vals.length,
        max: vals[vals.length - 1],
      };
    }
  } else if (!userKeyColumn) {
    warnings.push(
      `no user/device key column found (looked for ${USER_KEY_COLUMNS.join(", ")}) — ` +
        `cannot compute rows per user`,
    );
  }

  if (expectedRowsPerUser && rowsPerUser) {
    const drift = Math.abs(rowsPerUser.median - expectedRowsPerUser) / expectedRowsPerUser;
    if (drift > 0.25) {
      warnings.push(
        `median rows/user ${rowsPerUser.median.toFixed(1)} deviates >25% from expected ${expectedRowsPerUser}`,
      );
    }
  }

  const report: ParquetValidation = {
    numRowsFooter,
    numRowsRowGroups,
    rowGroups: rowGroups.length,
    columns,
    codecs,
    createdBy,
    byteLength,
    rowsRead: rows.length,
    userKeyColumn,
    uniqueUsers,
    rowsPerUser,
    warnings,
  };

  console.log(
    "parquet validation: " + JSON.stringify({
      bytes: byteLength,
      created_by: createdBy,
      row_groups: report.rowGroups,
      num_rows_footer: numRowsFooter,
      num_rows_row_groups: numRowsRowGroups,
      codecs,
      column_count: columns.length,
      columns,
      rows_read: rows.length,
      user_key_column: userKeyColumn,
      unique_users: uniqueUsers,
      rows_per_user: rowsPerUser,
    }),
  );
  for (const w of warnings) console.warn(`parquet validation warning: ${w}`);

  return report;
}

/** Checkpoint describing how far through a Parquet object a read got. */
export interface ParquetCheckpoint {
  /** Row group the read started at (0-based). */
  startRowGroup: number;
  /** Row group the next read should start at. */
  nextRowGroup: number;
  /** Total row groups in the object. */
  rowGroupsTotal: number;
  /** Absolute row offset the read started at. */
  rowsOffset: number;
  /** Absolute row offset the next read should start at. */
  nextRowsOffset: number;
  /** True when every row group has been consumed. */
  exhausted: boolean;
}

export interface ParquetChunk {
  rows: Record<string, unknown>[];
  checkpoint: ParquetCheckpoint;
}

/**
 * Pure row-group read planner. Given the per-row-group row counts, a resume
 * cursor and a row budget, decide which absolute row range to read and what
 * checkpoint to persist. Kept side-effect free so resume behaviour is testable
 * without a real Parquet object.
 */
export function planRowGroupRead(
  groupRows: number[],
  startRowGroup: number,
  maxRows: number,
): { rowStart: number; rowEnd: number; checkpoint: ParquetCheckpoint } {
  const numRows = groupRows.reduce((a, b) => a + b, 0);
  const from = Math.max(0, Math.min(startRowGroup, groupRows.length));
  const rowsOffset = groupRows.slice(0, from).reduce((a, b) => a + b, 0);

  if (from >= groupRows.length || rowsOffset >= numRows) {
    return {
      rowStart: rowsOffset,
      rowEnd: rowsOffset,
      checkpoint: {
        startRowGroup: from,
        nextRowGroup: groupRows.length,
        rowGroupsTotal: groupRows.length,
        rowsOffset,
        nextRowsOffset: numRows,
        exhausted: true,
      },
    };
  }

  // Consume whole row groups until the row budget is met (at least one group).
  let nextRowGroup = from;
  let take = 0;
  while (
    nextRowGroup < groupRows.length &&
    (take === 0 || take + groupRows[nextRowGroup] <= maxRows)
  ) {
    take += groupRows[nextRowGroup];
    nextRowGroup++;
  }

  // Reads are row-group aligned: `maxRows` is a soft budget, so a group is never
  // half-read (which would silently skip rows when the cursor advances).
  const rowEnd = Math.min(rowsOffset + take, numRows);

  return {
    rowStart: rowsOffset,
    rowEnd,
    checkpoint: {
      startRowGroup: from,
      nextRowGroup,
      rowGroupsTotal: groupRows.length,
      rowsOffset,
      nextRowsOffset: rowEnd,
      exhausted: nextRowGroup >= groupRows.length || rowEnd >= numRows,
    },
  };
}

/**
 * Transient = worth retrying the same row groups (network blip, throttling,
 * gateway error, truncated range response). Anything else (bad codec, corrupt
 * footer, schema error) is permanent and must fail fast.
 */
export function isTransientParquetError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
  const status = Number(
    (e as { status?: number; statusCode?: number } | null)?.status ??
      (e as { statusCode?: number } | null)?.statusCode ??
      NaN,
  );
  if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return true;
  return [
    "timeout",
    "timed out",
    "econnreset",
    "connection reset",
    "connection closed",
    "socket hang up",
    "network",
    "fetch failed",
    "temporarily",
    "throttl",
    "slow down",
    "slowdown",
    "rate limit",
    "503",
    "502",
    "500",
    "unexpected end",
    "incomplete",
  ].some((needle) => msg.includes(needle));
}

/**
 * Retry a single row-group range read on transient errors with exponential
 * backoff. Only the failed range is retried — the file's checkpoint is never
 * rewound, so already-transformed row groups are not re-processed.
 */
export async function retryRowGroups<T>(
  read: (attempt: number) => Promise<T>,
  opts: {
    attempts?: number;
    baseDelayMs?: number;
    label?: string;
    isTransient?: (e: unknown) => boolean;
    sleep?: (ms: number) => Promise<void>;
    /** Wall-clock ms after which no further retry is attempted. */
    deadlineAt?: number;
  } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 400;
  const transient = opts.isTransient ?? isTransientParquetError;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await read(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt >= attempts || !transient(e)) throw e;
      const delay = base * 2 ** (attempt - 1);
      // Never burn the caller's remaining budget on a retry that cannot finish
      // before the gateway's idle timeout — let the run checkpoint and resume.
      if (opts.deadlineAt != null && Date.now() + delay >= opts.deadlineAt) throw e;
      console.log(JSON.stringify({
        evt: "parquet_row_group_retry",
        label: opts.label ?? null,
        attempt,
        attempts,
        delay_ms: delay,
        error: e instanceof Error ? e.message : String(e),
      }));
      await sleep(delay);
    }
  }
  throw lastErr;
}




/**
 * Read a bounded chunk of rows from a Parquet object, starting at a row-group
 * checkpoint. Reads are aligned to row-group boundaries so the returned
 * checkpoint can be persisted and a later run resumes exactly where this one
 * stopped, without re-transforming rows that were already processed.
 */
export async function readParquetChunk(
  url: string,
  maxRows: number,
  startRowGroup = 0,
  expectedRowsPerUser?: number,
  deadlineAt?: number,
): Promise<ParquetChunk> {
  /** Minimum time a row-group read is given; below this we checkpoint instead. */
  const MIN_READ_MS = 25_000;
  const timeLeft = () => (deadlineAt == null ? Infinity : deadlineAt - Date.now());
  if (timeLeft() <= MIN_READ_MS) {
    return {
      rows: [],
      checkpoint: {
        startRowGroup,
        nextRowGroup: startRowGroup,
        rowGroupsTotal: null,
        rowsOffset: 0,
        nextRowsOffset: 0,
        exhausted: false,
      },
      deadlineExceeded: true,
    };
  }
  const file = await asyncBufferFromUrl({ url });
  const byteLength = typeof file.byteLength === "number" ? file.byteLength : null;

  if (byteLength !== null && byteLength > RANGE_REQUIRED_BYTES) {
    const ranged = await supportsRangeRequests(url);
    if (!ranged) {
      throw new Error(
        `parquet object is ${(byteLength / 1e6).toFixed(0)} MB and the storage host ` +
          `does not honour Range requests, so it cannot be read in bounded chunks; ` +
          `ask Intuizi to partition the delivery`,
      );
    }
    console.log(
      `parquet object is ${(byteLength / 1e6).toFixed(0)} MB — reading a bounded ` +
        `sample of up to ${maxRows} rows via Range requests`,
    );
  }

  // Footer first: gives the column list and row count without decoding pages,
  // so an empty or mis-shaped delivery fails with a readable message.
  const metadata = await parquetMetadataAsync(file);
  const columns = (metadata.schema ?? [])
    .filter((s: { num_children?: number; name: string }) => !s.num_children)
    .map((s: { name: string }) => s.name);
  const numRows = Number(metadata.num_rows ?? 0);
  const groupRows = ((metadata.row_groups ?? []) as { num_rows?: number | bigint }[])
    .map((rg) => Number(rg.num_rows ?? 0));
  console.log(
    `parquet footer: rows=${numRows} row_groups=${groupRows.length} ` +
      `resume_at_group=${startRowGroup} columns=[${columns.join(", ")}]`,
  );

  if (numRows === 0) {
    validateParquetRows(metadata as unknown as Record<string, unknown>, [], byteLength);
    throw new Error(
      `parquet has a schema but 0 rows — columns: ${columns.join(", ") || "none"}`,
    );
  }

  const plan = planRowGroupRead(groupRows, startRowGroup, maxRows);

  // Footer/metadata reads can be slow on multi-GB deliveries. If decoding pages
  // can no longer finish inside the run budget, stop here with the UNCHANGED
  // cursor so the next run re-reads exactly this range (no rows are skipped).
  if (timeLeft() <= MIN_READ_MS) {
    return {
      rows: [],
      checkpoint: {
        ...plan.checkpoint,
        nextRowGroup: plan.checkpoint.startRowGroup,
        nextRowsOffset: plan.checkpoint.rowsOffset,
        exhausted: false,
      },
      deadlineExceeded: true,
    };
  }

  if (plan.checkpoint.exhausted && plan.rowEnd <= plan.rowStart) {
    return { rows: [], checkpoint: plan.checkpoint };
  }

  // Transient S3/network faults are retried for THIS row-group range only, so a
  // blip never forces the whole file to be re-transformed from group 0.
  const raw = await retryRowGroups(
    () =>
      parquetReadObjects({
        file,
        metadata,
        compressors,
        rowStart: plan.rowStart,
        rowEnd: plan.rowEnd,
      }),
    {
      label: `row groups ${plan.checkpoint.startRowGroup}..${plan.checkpoint.nextRowGroup - 1}`,
      deadlineAt,
    },
  );

  const rows = (raw as Record<string, unknown>[]).map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = scalar(v);
    return out;
  });

  // Validation / observability pass before the rows reach the normalizer.
  validateParquetRows(
    metadata as unknown as Record<string, unknown>,
    rows,
    byteLength,
    expectedRowsPerUser,
  );

  return { rows, checkpoint: plan.checkpoint };
}

/**
 * Read up to `maxRows` rows from a Parquet object as plain records.
 * Values are flattened to JSON-safe scalars so `normalizeRow` can treat the
 * rows exactly like CSV rows.
 */
export async function readParquetRows(
  url: string,
  maxRows: number,
  expectedRowsPerUser?: number,
  deadlineAt?: number,
): Promise<Record<string, unknown>[]> {
  const { rows } = await readParquetChunk(url, maxRows, 0, expectedRowsPerUser, deadlineAt);
  return rows;
}

