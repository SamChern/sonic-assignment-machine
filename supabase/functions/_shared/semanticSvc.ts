// Client for the EC2 semantic-svc (LAION-CLAP text + audio embeddings).
//
// The service lives behind nginx on the Librosa box (see deploy/semantic-svc/)
// and is authenticated with a Bearer token. Credentials are stored by the admin
// UI in `public.integration_credentials` under integration_id = 'semantic_svc'
// (SEMANTIC_SVC_URL / SEMANTIC_SVC_TOKEN); env vars of the same name win when
// present, so the service can also be configured as a function secret.
//
// CLAP returns 512-d vectors. pgvector columns in this project are vector(1536),
// so vectors are projected with the SAME deterministic tiling the service's
// /bridge identity stub uses (tile 3x + L2). Cosine similarity is preserved, so
// kNN behaviour is identical — and no extra round trip is needed.

const TEXT_DIM = 512;
const TARGET_DIM = 1536;
const TIMEOUT_MS = 30_000;
const AUDIO_TIMEOUT_MS = 120_000;
const CONFIG_TTL_MS = 300_000;

export interface SemanticSvcConfig {
  url: string;
  token: string;
  /** Embedding-space identifier used to key every cache row. */
  space: string;
}

let cached: { at: number; cfg: SemanticSvcConfig | null } | null = null;

/** Short-lived breaker so a dead box does not slow every later call. */
let failures = 0;
let openUntil = 0;
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

function noteFailure(err: unknown) {
  failures++;
  if (failures >= BREAKER_THRESHOLD) {
    openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    failures = 0;
    console.warn("semantic-svc breaker opened for 60s");
  }
  console.warn("semantic-svc call failed:", err instanceof Error ? err.message : err);
}

export function semanticSvcBreakerOpen(): boolean {
  return Date.now() < openUntil;
}

/**
 * Resolve the semantic service config. Env first, then the admin credentials
 * table. Cached in module memory for 5 minutes; returns null when unconfigured.
 */
export async function getSemanticSvcConfig(
  // deno-lint-disable-next-line no-explicit-any
  supabase: any | null,
): Promise<SemanticSvcConfig | null> {
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.cfg;

  let url = (Deno.env.get("SEMANTIC_SVC_URL") ?? "").trim().replace(/\/+$/, "");
  let token = (Deno.env.get("SEMANTIC_SVC_TOKEN") ?? "").trim();

  if ((!url || !token) && supabase) {
    try {
      const { data } = await supabase
        .from("integration_credentials")
        .select("field_key, field_value")
        .eq("integration_id", "semantic_svc");
      for (const r of data ?? []) {
        if (r.field_key === "SEMANTIC_SVC_URL" && !url) {
          url = String(r.field_value ?? "").trim().replace(/\/+$/, "");
        }
        if (r.field_key === "SEMANTIC_SVC_TOKEN" && !token) {
          token = String(r.field_value ?? "").trim();
        }
      }
    } catch (e) {
      console.warn(
        "semantic-svc credential read failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  const cfg: SemanticSvcConfig | null = url && token
    ? { url, token, space: "clap:630k-audioset-best/identity1536" }
    : null;
  cached = { at: Date.now(), cfg };
  return cfg;
}

/** Test seam: drop the memoized config (also used after credential updates). */
export function resetSemanticSvcConfigCache() {
  cached = null;
}

function l2(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.max(Math.sqrt(n), 1e-9);
  return v.map((x) => x / n);
}

/**
 * Deterministic 512 -> 1536 projection, byte-for-byte equivalent to the
 * service's `_project_identity`: tile to width, then L2-normalize.
 */
export function projectTo1536(v: number[]): number[] {
  if (v.length === TARGET_DIM) return l2(v);
  const out = new Array<number>(TARGET_DIM);
  for (let i = 0; i < TARGET_DIM; i++) out[i] = v[i % v.length];
  return l2(out);
}

async function post(
  cfg: SemanticSvcConfig,
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  return await fetch(`${cfg.url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** 1536-d CLAP text embedding, or null on any failure (embeddings are enrichment). */
export async function clapEmbedText(
  cfg: SemanticSvcConfig,
  text: string,
): Promise<number[] | null> {
  if (semanticSvcBreakerOpen()) return null;
  try {
    const r = await post(cfg, "/embed_text", { texts: [text] }, TIMEOUT_MS);
    if (!r.ok) throw new Error(`semantic-svc ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const v = j?.vectors?.[0];
    if (!Array.isArray(v) || v.length !== TEXT_DIM) {
      throw new Error(`unexpected text embedding dims ${Array.isArray(v) ? v.length : "none"}`);
    }
    failures = 0;
    return projectTo1536(v as number[]);
  } catch (e) {
    noteFailure(e);
    return null;
  }
}

/**
 * 1536-d CLAP embedding of the audio itself, fetched by the service from a
 * public/signed http(s) URL. Null on any failure.
 */
export async function clapEmbedAudio(
  cfg: SemanticSvcConfig,
  url: string,
): Promise<number[] | null> {
  if (semanticSvcBreakerOpen()) return null;
  try {
    const r = await post(cfg, "/embed_audio", { url }, AUDIO_TIMEOUT_MS);
    if (!r.ok) throw new Error(`semantic-svc ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const v = j?.vector;
    if (!Array.isArray(v) || v.length !== TEXT_DIM) {
      throw new Error(`unexpected audio embedding dims ${Array.isArray(v) ? v.length : "none"}`);
    }
    failures = 0;
    return projectTo1536(v as number[]);
  } catch (e) {
    noteFailure(e);
    return null;
  }
}
