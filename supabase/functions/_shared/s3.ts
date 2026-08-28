// Read-only S3 access for the Intuizi ingest.
//
// Two interchangeable backends behind one interface:
//
//   1. "connector_gateway" (default, current)
//      Lovable connector gateway. Listing + HEAD go through the gateway proxy;
//      object bytes are fetched with a short-lived signed URL (direct object GET
//      through the proxy is blocked).
//
//   2. "enterprise" (PLACEHOLDER — not wired to a live endpoint yet)
//      Reserved for the scaled/enterprise ingestion path. Set S3_BACKEND=enterprise
//      plus S3_ENTERPRISE_BASE_URL / S3_ENTERPRISE_API_KEY (and optionally
//      S3_ENTERPRISE_BUCKET) and fill in the marked TODOs. The rest of the codebase
//      only ever calls listObjects() / signReadUrl() / headObject(), so switching
//      backends requires no changes outside this file.

const GATEWAY_BASE = "https://connector-gateway.lovable.dev";
const CONNECTOR = "aws_s3";

export type S3Backend = "connector_gateway" | "direct" | "enterprise";

/**
 * Which backend is active.
 *
 * Defaults to "direct" (IAM user access key + SigV4, no connector) whenever
 * S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are present; otherwise falls back to
 * the connector gateway. S3_BACKEND can force a specific driver.
 */
export function s3Backend(): S3Backend {
  const forced = (Deno.env.get("S3_BACKEND") ?? "").trim().toLowerCase();
  if (forced === "enterprise") return "enterprise";
  if (forced === "direct") return "direct";
  if (forced === "connector_gateway") return "connector_gateway";
  return Deno.env.get("S3_ACCESS_KEY_ID") && Deno.env.get("S3_SECRET_ACCESS_KEY")
    ? "direct"
    : "connector_gateway";
}

export interface S3Object {
  key: string;
  size: number;
  etag: string | null;
  lastModified: string | null;
}

export interface S3ObjectHead {
  size: number;
  contentType: string;
  lastModified: string | null;
  etag: string | null;
}

interface S3Driver {
  readonly name: S3Backend;
  configured(): boolean;
  listObjects(prefix: string, maxKeys: number): Promise<S3Object[]>;
  signReadUrl(objectKey: string): Promise<string>;
  headObject(objectKey: string): Promise<S3ObjectHead>;
  putObject(objectKey: string, body: Uint8Array, opts?: PutObjectOptions): Promise<void>;
}

export interface PutObjectOptions {
  contentType?: string;
  contentEncoding?: string;
}


// ---------------------------------------------------------------------------
// Backend 1: Lovable connector gateway (temporary path)
// ---------------------------------------------------------------------------

function gatewayKeys() {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const connectionKey = Deno.env.get("AWS_S3_API_KEY");
  if (!lovableKey) throw new Error("LOVABLE_API_KEY is not configured");
  if (!connectionKey) {
    throw new Error(
      "AWS_S3_API_KEY is not configured — link the Amazon S3 connection to this project first",
    );
  }
  return { lovableKey, connectionKey };
}

function gatewayHeaders() {
  const { lovableKey, connectionKey } = gatewayKeys();
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connectionKey,
  };
}

function parseListXml(xml: string, out: S3Object[], maxKeys: number): boolean {
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = m[1];
    const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
    if (!key) continue;
    out.push({
      key,
      size: Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
      etag: block.match(/<ETag>([\s\S]*?)<\/ETag>/)?.[1]?.replace(/&quot;|"/g, "") ?? null,
      lastModified: block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] ?? null,
    });
    if (out.length >= maxKeys) return true;
  }
  return false;
}

const gatewayDriver: S3Driver = {
  name: "connector_gateway",

  configured() {
    return !!Deno.env.get("AWS_S3_API_KEY") && !!Deno.env.get("LOVABLE_API_KEY");
  },

  async listObjects(prefix, maxKeys) {
    const out: S3Object[] = [];
    let token: string | null = null;

    do {
      const params = new URLSearchParams({
        "list-type": "2",
        prefix,
        "max-keys": String(Math.min(1000, maxKeys)),
      });
      if (token) params.set("continuation-token", token);

      const res = await fetch(`${GATEWAY_BASE}/${CONNECTOR}/?${params}`, {
        method: "GET",
        headers: gatewayHeaders(),
      });
      if (!res.ok) {
        const body = await res.text();
        throw Object.assign(new Error(`S3 list failed [${res.status}]: ${body}`), {
          status: res.status,
        });
      }
      const xml = await res.text();
      if (parseListXml(xml, out, maxKeys)) return out;

      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      token = truncated
        ? xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? null
        : null;
    } while (token);

    return out;
  },

  async signReadUrl(objectKey) {
    const res = await fetch(
      `${GATEWAY_BASE}/api/v1/sign_storage_url?provider=${CONNECTOR}&mode=read`,
      {
        method: "POST",
        headers: { ...gatewayHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ object_path: objectKey }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(new Error(`S3 sign failed [${res.status}]: ${body}`), {
        status: res.status,
      });
    }
    const { url } = await res.json();
    if (!url) throw new Error("S3 sign returned no url");
    return url as string;
  },

  async headObject(objectKey) {
    // Encode each segment so keys with spaces or reserved characters resolve.
    const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${GATEWAY_BASE}/${CONNECTOR}/${encodedKey}`, {
      method: "HEAD",
      headers: gatewayHeaders(),
    });

    if (!res.ok) {
      throw Object.assign(new Error(`S3 head failed [${res.status}] for ${objectKey}`), {
        status: res.status,
      });
    }
    return {
      size: Number(res.headers.get("Content-Length") ?? 0),
      contentType: res.headers.get("Content-Type") ?? "application/octet-stream",
      lastModified: res.headers.get("Last-Modified"),
      etag: res.headers.get("ETag")?.replace(/"/g, "") ?? null,
    };
  },
};

// ---------------------------------------------------------------------------
// Backend 2: direct AWS S3 with an IAM user access key (SigV4)
//
// Needs S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET and S3_REGION.
// No connector, no gateway — the function talks to S3 itself.
// ---------------------------------------------------------------------------

function directConfig() {
  const accessKeyId = Deno.env.get("S3_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("S3_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("S3_BUCKET");
  const region = Deno.env.get("S3_REGION") ?? "us-west-2";
  if (!accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "Direct S3 access needs S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_BUCKET",
    );
  }
  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    region,
    host: `${bucket}.s3.${region}.amazonaws.com`,
  };
}

// SigV4 primitives. Exported because `sqs.ts` signs against the `sqs` service
// with exactly the same algorithm — one implementation, two AWS services.
const enc = new TextEncoder();

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data);
  return hex(new Uint8Array(buf));
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

/** Derive the SigV4 signing key for a given AWS service (defaults to s3). */
export async function signingKey(
  secret: string,
  date: string,
  region: string,
  service = "s3",
): Promise<Uint8Array> {
  let k = await hmac(enc.encode(`AWS4${secret}`), date);
  k = await hmac(k, region);
  k = await hmac(k, service);
  return await hmac(k, "aws4_request");
}

/** RFC3986-encode a key path, keeping slashes as separators. */
function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

export function amzDates() {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/** Sign a request with SigV4 in the Authorization header. */
async function signedFetch(
  method: "GET" | "HEAD",
  path: string,
  query: Record<string, string> = {},
): Promise<Response> {
  const cfg = directConfig();
  const { amzDate, dateStamp } = amzDates();
  const payloadHash = await sha256Hex("");

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");

  const canonicalHeaders =
    `host:${cfg.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest =
    `${method}\n${path}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
  const signature = hex(await hmac(await signingKey(cfg.secretAccessKey, dateStamp, cfg.region), stringToSign));

  const url = `https://${cfg.host}${path}${canonicalQuery ? `?${canonicalQuery}` : ""}`;
  return await fetch(url, {
    method,
    headers: {
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
  });
}

/** Build a presigned GET URL (query-string SigV4) valid for expiresIn seconds. */
async function presignGet(objectKey: string, expiresIn = 900): Promise<string> {
  const cfg = directConfig();
  const { amzDate, dateStamp } = amzDates();
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const path = `/${encodeKeyPath(objectKey)}`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");

  const canonicalRequest =
    `GET\n${path}\n${canonicalQuery}\nhost:${cfg.host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
  const signature = hex(await hmac(await signingKey(cfg.secretAccessKey, dateStamp, cfg.region), stringToSign));

  return `https://${cfg.host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

const directDriver: S3Driver = {
  name: "direct",

  configured() {
    return !!Deno.env.get("S3_ACCESS_KEY_ID") && !!Deno.env.get("S3_SECRET_ACCESS_KEY") &&
      !!Deno.env.get("S3_BUCKET");
  },

  async listObjects(prefix, maxKeys) {
    const out: S3Object[] = [];
    let token: string | null = null;

    do {
      const query: Record<string, string> = {
        "list-type": "2",
        prefix,
        "max-keys": String(Math.min(1000, maxKeys)),
      };
      if (token) query["continuation-token"] = token;

      const res = await signedFetch("GET", "/", query);
      if (!res.ok) {
        const body = await res.text();
        throw Object.assign(new Error(`S3 list failed [${res.status}]: ${body}`), {
          status: res.status,
        });
      }
      const xml = await res.text();
      if (parseListXml(xml, out, maxKeys)) return out;

      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      token = truncated
        ? xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? null
        : null;
    } while (token);

    return out;
  },

  signReadUrl(objectKey) {
    return presignGet(objectKey);
  },

  async headObject(objectKey) {
    const res = await signedFetch("HEAD", `/${encodeKeyPath(objectKey)}`);
    if (!res.ok) {
      throw Object.assign(new Error(`S3 head failed [${res.status}] for ${objectKey}`), {
        status: res.status,
      });
    }
    return {
      size: Number(res.headers.get("Content-Length") ?? 0),
      contentType: res.headers.get("Content-Type") ?? "application/octet-stream",
      lastModified: res.headers.get("Last-Modified"),
      etag: res.headers.get("ETag")?.replace(/"/g, "") ?? null,
    };
  },
};

// ---------------------------------------------------------------------------
// Backend 3: enterprise ingestion path (PLACEHOLDER)
// ---------------------------------------------------------------------------

function enterpriseConfig() {
  const baseUrl = Deno.env.get("S3_ENTERPRISE_BASE_URL");
  const apiKey = Deno.env.get("S3_ENTERPRISE_API_KEY");
  if (!baseUrl || !apiKey) {
    throw new Error(
      "S3_BACKEND=enterprise but S3_ENTERPRISE_BASE_URL / S3_ENTERPRISE_API_KEY are not configured",
    );
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    bucket: Deno.env.get("S3_ENTERPRISE_BUCKET") ?? "",
  };
}

function notImplemented(op: string): never {
  throw Object.assign(
    new Error(
      `Enterprise S3 backend is a placeholder — ${op} is not implemented yet. ` +
        `Implement it in supabase/functions/_shared/s3.ts (enterpriseDriver) or unset S3_BACKEND ` +
        `to keep using the connector gateway.`,
    ),
    { status: 501 },
  );
}

const enterpriseDriver: S3Driver = {
  name: "enterprise",

  configured() {
    return !!Deno.env.get("S3_ENTERPRISE_BASE_URL") && !!Deno.env.get("S3_ENTERPRISE_API_KEY");
  },

  listObjects(_prefix, _maxKeys) {
    // TODO(enterprise): call the enterprise endpoint's list API, map the response
    // onto S3Object[], and reuse parseListXml() if it speaks ListObjectsV2 XML.
    enterpriseConfig();
    return notImplemented("listObjects");
  },

  signReadUrl(_objectKey) {
    // TODO(enterprise): exchange the object key for a short-lived download URL.
    enterpriseConfig();
    return notImplemented("signReadUrl");
  },

  headObject(_objectKey) {
    // TODO(enterprise): HEAD/metadata lookup for size + content type.
    enterpriseConfig();
    return notImplemented("headObject");
  },
};

// ---------------------------------------------------------------------------
// Public interface — callers never touch a driver directly
// ---------------------------------------------------------------------------

function driver(): S3Driver {
  switch (s3Backend()) {
    case "enterprise":
      return enterpriseDriver;
    case "direct":
      return directDriver;
    default:
      return gatewayDriver;
  }
}

export function s3Configured(): boolean {
  return driver().configured();
}

/** Human-readable backend info for status endpoints and the admin UI. */
export function s3BackendInfo() {
  const d = driver();
  return {
    backend: d.name,
    configured: d.configured(),
    placeholder: d.name === "enterprise",
  };
}

// ---------------------------------------------------------------------------
// Isolate-local caches
//
// A single ingest run lists the same prefixes and signs/heads the same keys
// repeatedly (discovery -> candidate selection -> read). Caching per isolate
// with short TTLs plus in-flight de-duplication cuts redundant gateway calls
// (and therefore latency, tokens/keys usage and S3 request cost) without ever
// serving data older than the TTL. Signed URLs are cached well inside their
// 900s validity window.
// ---------------------------------------------------------------------------

const LIST_TTL_MS = 30_000;
const SIGN_TTL_MS = 10 * 60 * 1000; // signed URLs are valid 15 min
const HEAD_TTL_MS = 60_000;

interface CacheEntry<T> {
  expires: number;
  value: Promise<T>;
}

const listCache = new Map<string, CacheEntry<S3Object[]>>();
const signCache = new Map<string, CacheEntry<string>>();
const headCache = new Map<string, CacheEntry<S3ObjectHead>>();

function memo<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  ttlMs: number,
  produce: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value;

  // Keep the promise (not the resolved value) so concurrent callers share one
  // upstream request; drop it on failure so errors are never cached.
  const value = produce().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { expires: now + ttlMs, value });

  if (cache.size > 200) {
    for (const [k, v] of cache) {
      if (v.expires <= now) cache.delete(k);
    }
  }
  return value;
}

/** Drop all cached S3 metadata (use when a run must see freshly landed files). */
export function clearS3Cache() {
  listCache.clear();
  signCache.clear();
  headCache.clear();
}

/** ListObjectsV2 under a prefix. Follows continuation tokens up to maxKeys. */
export function listObjects(prefix: string, maxKeys = 200): Promise<S3Object[]> {
  const d = driver();
  return memo(listCache, `${d.name}|${prefix}|${maxKeys}`, LIST_TTL_MS, () =>
    d.listObjects(prefix, maxKeys),
  );
}

/** Time-limited direct download URL for one object. */
export function signReadUrl(objectKey: string): Promise<string> {
  const d = driver();
  return memo(signCache, `${d.name}|${objectKey}`, SIGN_TTL_MS, () => d.signReadUrl(objectKey));
}

/** Object metadata without downloading the body. */
export function headObject(objectKey: string): Promise<S3ObjectHead> {
  const d = driver();
  return memo(headCache, `${d.name}|${objectKey}`, HEAD_TTL_MS, () => d.headObject(objectKey));
}

