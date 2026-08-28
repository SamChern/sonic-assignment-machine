// SQS dispatch for the ingest control plane (Step 2.5).
//
// The edge function no longer parses Parquet — it discovers objects, writes the
// ledger row and hands the actual decode work to the DuckDB worker on EC2 by
// putting one message per file on an SQS queue. That is the whole reason
// WORKER_RESOURCE_LIMIT / IDLE_TIMEOUT stop being possible: the edge side does
// bounded metadata work only.
//
// `aws-proxy` is an HTTP proxy to the EC2 box, not an AWS SDK proxy, so it
// cannot speak SQS. We sign SendMessage ourselves with the SigV4 primitives
// already implemented for the direct S3 driver.
//
// Config (same IAM user as direct S3 access, plus sqs:SendMessage on the queue):
//   SQS_QUEUE_URL   e.g. https://sqs.us-west-2.amazonaws.com/1234/sonicsim-ingest
//   SQS_REGION      optional, inferred from the queue URL, falls back to S3_REGION
//   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY

import { amzDates, hex, hmac, sha256Hex, signingKey } from "./s3.ts";

export interface SqsConfig {
  queueUrl: string;
  region: string;
  host: string;
  path: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Region embedded in a standard queue URL: sqs.<region>.amazonaws.com */
function regionFromQueueUrl(queueUrl: string): string | null {
  return /sqs\.([a-z0-9-]+)\.amazonaws\.com/.exec(queueUrl)?.[1] ?? null;
}

export function sqsConfigured(): boolean {
  return !!Deno.env.get("SQS_QUEUE_URL") &&
    !!Deno.env.get("S3_ACCESS_KEY_ID") &&
    !!Deno.env.get("S3_SECRET_ACCESS_KEY");
}

export function sqsConfig(): SqsConfig {
  const queueUrl = Deno.env.get("SQS_QUEUE_URL");
  const accessKeyId = Deno.env.get("S3_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("S3_SECRET_ACCESS_KEY");
  if (!queueUrl || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "SQS dispatch needs SQS_QUEUE_URL, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY",
    );
  }
  const region = Deno.env.get("SQS_REGION") ?? regionFromQueueUrl(queueUrl) ??
    Deno.env.get("S3_REGION") ?? "us-west-2";
  const url = new URL(queueUrl);
  return {
    queueUrl,
    region,
    host: url.host,
    path: url.pathname,
    accessKeyId,
    secretAccessKey,
  };
}

export function sqsInfo() {
  if (!sqsConfigured()) {
    return { configured: false as const, reason: "SQS_QUEUE_URL not set" };
  }
  const cfg = sqsConfig();
  return {
    configured: true as const,
    region: cfg.region,
    // Queue name only — never echo the account ID back to a client.
    queue: cfg.path.split("/").filter(Boolean).pop() ?? null,
  };
}

/** POST a form-encoded, SigV4-signed SQS action (Query protocol). */
async function sqsAction(params: Record<string, string>): Promise<string> {
  const cfg = sqsConfig();
  const { amzDate, dateStamp } = amzDates();

  const body = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");
  const payloadHash = await sha256Hex(body);
  const contentType = "application/x-www-form-urlencoded; charset=utf-8";

  const canonicalHeaders = `content-type:${contentType}\nhost:${cfg.host}\n` +
    `x-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest =
    `POST\n${cfg.path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const scope = `${dateStamp}/${cfg.region}/sqs/aws4_request`;
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
  const signature = hex(
    await hmac(
      await signingKey(cfg.secretAccessKey, dateStamp, cfg.region, "sqs"),
      stringToSign,
    ),
  );

  const res = await fetch(`https://${cfg.host}${cfg.path}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? String(res.status);
    const msg = /<Message>([^<]+)<\/Message>/.exec(text)?.[1] ?? text.slice(0, 300);
    const err = new Error(`SQS ${params.Action} failed (${code}): ${msg}`);
    // deno-lint-ignore no-explicit-any
    (err as any).status = res.status;
    throw err;
  }
  return text;
}

/** One unit of work for the EC2 DuckDB worker: decode + normalize one object. */
export interface IngestMessage {
  object_key: string;
  report_type: string;
  file_id: string;
  activation_id?: string | null;
  owner_id?: string | null;
  /** Correlates ledger row, queue message and worker logs. */
  trace_id: string;
  /** Mid-file resume point so a redelivery never re-normalizes finished rows. */
  row_group_cursor?: number;
  rows_offset?: number;
}

export interface SendResult {
  message_id: string | null;
  /** SQS-side dedup: identical content within 5 min collapses to one message. */
  deduplicated: boolean;
}

/**
 * Enqueue one file for the EC2 worker.
 *
 * `file_id` doubles as the dedup token, so a re-run of discovery over the same
 * ledger row does not queue the same file twice (FIFO queues enforce this
 * server-side; on a standard queue the worker's ledger check is the backstop).
 */
export async function sendIngestMessage(
  msg: IngestMessage,
  opts: { delaySeconds?: number } = {},
): Promise<SendResult> {
  const params: Record<string, string> = {
    Action: "SendMessage",
    Version: "2012-11-05",
    MessageBody: JSON.stringify(msg),
  };
  if (opts.delaySeconds) params.DelaySeconds = String(Math.min(900, opts.delaySeconds));
  if (sqsConfig().queueUrl.endsWith(".fifo")) {
    params.MessageGroupId = msg.report_type || "default";
    params.MessageDeduplicationId = `${msg.file_id}:${msg.row_group_cursor ?? 0}:${msg.rows_offset ?? 0}`;
  }

  const xml = await sqsAction(params);
  return {
    message_id: /<MessageId>([^<]+)<\/MessageId>/.exec(xml)?.[1] ?? null,
    deduplicated: false,
  };
}

/** Queue depth, for the admin health panel. */
export async function queueAttributes(): Promise<{
  visible: number;
  in_flight: number;
  delayed: number;
}> {
  const xml = await sqsAction({
    Action: "GetQueueAttributes",
    Version: "2012-11-05",
    "AttributeName.1": "ApproximateNumberOfMessages",
    "AttributeName.2": "ApproximateNumberOfMessagesNotVisible",
    "AttributeName.3": "ApproximateNumberOfMessagesDelayed",
  });
  const read = (name: string) => {
    const re = new RegExp(`<Name>${name}</Name>\\s*<Value>([^<]+)</Value>`);
    return Number(re.exec(xml)?.[1] ?? 0) || 0;
  };
  return {
    visible: read("ApproximateNumberOfMessages"),
    in_flight: read("ApproximateNumberOfMessagesNotVisible"),
    delayed: read("ApproximateNumberOfMessagesDelayed"),
  };
}
