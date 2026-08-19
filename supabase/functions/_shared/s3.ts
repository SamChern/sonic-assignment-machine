// Read-only S3 access through the Lovable connector gateway.
// Listing + HEAD go through the gateway proxy; object bytes are fetched with a
// short-lived signed URL (direct object GET through the proxy is blocked).

const GATEWAY_BASE = "https://connector-gateway.lovable.dev";
const CONNECTOR = "aws_s3";

function keys() {
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

function authHeaders() {
  const { lovableKey, connectionKey } = keys();
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connectionKey,
  };
}

export function s3Configured(): boolean {
  return !!Deno.env.get("AWS_S3_API_KEY") && !!Deno.env.get("LOVABLE_API_KEY");
}

export interface S3Object {
  key: string;
  size: number;
  etag: string | null;
  lastModified: string | null;
}

/** ListObjectsV2 under a prefix. Follows continuation tokens up to maxKeys. */
export async function listObjects(prefix: string, maxKeys = 200): Promise<S3Object[]> {
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
      headers: authHeaders(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(new Error(`S3 list failed [${res.status}]: ${body}`), {
        status: res.status,
      });
    }
    const xml = await res.text();

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
      if (out.length >= maxKeys) return out;
    }

    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    token = truncated
      ? xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? null
      : null;
  } while (token);

  return out;
}

/** Time-limited direct download URL for one object. */
export async function signReadUrl(objectKey: string): Promise<string> {
  const res = await fetch(
    `${GATEWAY_BASE}/api/v1/sign_storage_url?provider=${CONNECTOR}&mode=read`,
    {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
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
}
