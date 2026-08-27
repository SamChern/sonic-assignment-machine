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

/**
 * Read up to `maxRows` rows from a Parquet object as plain records.
 * Values are flattened to JSON-safe scalars so `normalizeRow` can treat the
 * rows exactly like CSV rows.
 */
export async function readParquetRows(
  url: string,
  maxRows: number,
  expectedRowsPerUser?: number,
): Promise<Record<string, unknown>[]> {
  const file = await asyncBufferFromUrl({ url });
  const byteLength = typeof file.byteLength === "number" ? file.byteLength : null;

  if (byteLength !== null && byteLength > MAX_OBJECT_BYTES) {
    throw new Error(
      `parquet object is ${(byteLength / 1e6).toFixed(0)} MB — over the ` +
        `${MAX_OBJECT_BYTES / 1e6} MB ingest limit; ask Intuizi to partition the delivery`,
    );
  }

  // Footer first: gives the column list and row count without decoding pages,
  // so an empty or mis-shaped delivery fails with a readable message.
  const metadata = await parquetMetadataAsync(file);
  const columns = (metadata.schema ?? [])
    .filter((s: { num_children?: number; name: string }) => !s.num_children)
    .map((s: { name: string }) => s.name);
  const numRows = Number(metadata.num_rows ?? 0);
  console.log(`parquet footer: rows=${numRows} columns=[${columns.join(", ")}]`);

  if (numRows === 0) {
    validateParquetRows(metadata as unknown as Record<string, unknown>, [], byteLength);
    throw new Error(
      `parquet has a schema but 0 rows — columns: ${columns.join(", ") || "none"}`,
    );
  }

  const raw = await parquetReadObjects({
    file,
    metadata,
    compressors,
    rowStart: 0,
    rowEnd: Math.min(maxRows, numRows),
  });

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

  return rows;
}

