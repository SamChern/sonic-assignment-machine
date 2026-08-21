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
  parquetReadObjects,
} from "https://esm.sh/hyparquet@1.29.1";
import { compressors } from "https://esm.sh/hyparquet-compressors@1.1.1";

/** Anything larger than this is refused rather than buffered. */
const MAX_OBJECT_BYTES = 512 * 1024 * 1024;

function scalar(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return new TextDecoder().decode(v);
  if (Array.isArray(v)) return v.map(scalar);
  return v;
}

/**
 * Read up to `maxRows` rows from a Parquet object as plain records.
 * Values are flattened to JSON-safe scalars so `normalizeRow` can treat the
 * rows exactly like CSV rows.
 */
export async function readParquetRows(
  url: string,
  maxRows: number,
): Promise<Record<string, unknown>[]> {
  const file = await asyncBufferFromUrl({ url });

  if (typeof file.byteLength === "number" && file.byteLength > MAX_OBJECT_BYTES) {
    throw new Error(
      `parquet object is ${(file.byteLength / 1e6).toFixed(0)} MB — over the ` +
        `${MAX_OBJECT_BYTES / 1e6} MB ingest limit; ask Intuizi to partition the delivery`,
    );
  }

  const rows = await parquetReadObjects({
    file,
    compressors,
    rowStart: 0,
    rowEnd: maxRows,
  });

  return (rows as Record<string, unknown>[]).map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = scalar(v);
    return out;
  });
}
