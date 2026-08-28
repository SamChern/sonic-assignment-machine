// Inference routing layer.
//
// Goal: keep LLM/embedding compute on the EC2 box (vLLM / Ollama / any
// OpenAI-compatible server) whenever it is configured and healthy, and only
// fall back to the Lovable AI Gateway when it is not. Every caller in this
// project should go through `chatCompletion()` / `embedText()` instead of
// fetching a provider URL directly, so the routing decision lives in one file.
//
// Configuration (server-side secrets, all optional):
//   EC2_INFERENCE_URL        e.g. https://api.example.com/ec2-llm  (no trailing /v1)
//   EC2_INFERENCE_API_KEY    bearer/x-api-key for that server (defaults to AWS_API_KEY)
//   EC2_INFERENCE_MODEL      chat model id served locally (e.g. qwen2.5:14b-instruct)
//   EC2_EMBEDDING_MODEL      embedding model id served locally (must be 1536-dim)
//   EC2_INFERENCE_REQUIRED   "true" => never fall back to the Lovable gateway
//
// When EC2_INFERENCE_URL is unset the behaviour is byte-for-byte the previous
// gateway behaviour.

import {
  clapEmbedAudio,
  clapEmbedText,
  getSemanticSvcConfig,
  semanticSvcBreakerOpen,
} from "./semanticSvc.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const EC2_URL = (Deno.env.get("EC2_INFERENCE_URL") ?? "").replace(/\/+$/, "");
const EC2_KEY = Deno.env.get("EC2_INFERENCE_API_KEY") ?? Deno.env.get("AWS_API_KEY") ?? "";
const EC2_CHAT_MODEL = Deno.env.get("EC2_INFERENCE_MODEL") ?? "";
const EC2_EMBED_MODEL = Deno.env.get("EC2_EMBEDDING_MODEL") ?? "";
/**
 * Native dimensionality of EC2_EMBEDDING_MODEL. Most CPU-friendly local
 * embedders are 768/1024-dim; vectors are zero-padded up to EMBEDDING_DIMS so
 * they fit the pgvector columns. Padding is distance-preserving, but vectors
 * from different models are NOT comparable — that is why cache rows and any
 * re-embedding are keyed by model id.
 */
const EC2_EMBED_DIMS = Number(Deno.env.get("EC2_EMBEDDING_DIMS") ?? "0") || 0;
const EC2_REQUIRED = (Deno.env.get("EC2_INFERENCE_REQUIRED") ?? "").toLowerCase() === "true";


const GATEWAY = "https://ai.gateway.lovable.dev/v1";
export const GATEWAY_CHAT_MODEL = "google/gemini-2.5-flash";
export const GATEWAY_EMBED_MODEL = "openai/text-embedding-3-small";
/** pgvector columns in this project are vector(1536). */
export const EMBEDDING_DIMS = 1536;

const CHAT_TIMEOUT_MS = 120_000;
const EMBED_TIMEOUT_MS = 20_000;

/** Short-lived breaker so one dead EC2 box does not slow every later call. */
let ec2Failures = 0;
let ec2OpenUntil = 0;
const EC2_BREAKER_THRESHOLD = 3;
const EC2_BREAKER_COOLDOWN_MS = 60_000;

function ec2Available(model: string): boolean {
  if (!EC2_URL || !model) return false;
  if (Date.now() < ec2OpenUntil) return false;
  return true;
}

function noteEc2Failure(err: unknown) {
  ec2Failures++;
  if (ec2Failures >= EC2_BREAKER_THRESHOLD) {
    ec2OpenUntil = Date.now() + EC2_BREAKER_COOLDOWN_MS;
    ec2Failures = 0;
    console.warn("EC2 inference breaker opened for 60s");
  }
  console.warn("EC2 inference call failed:", err instanceof Error ? err.message : err);
}

function noteEc2Success() {
  ec2Failures = 0;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Force the Lovable gateway (used by callers that need a specific model). */
  gatewayOnly?: boolean;
}

export interface ChatResult {
  text: string;
  provider: "ec2" | "gateway";
  model: string;
}

/** Terminal/retryable gateway error surfaced to callers (see gateway semantics). */
export class GatewayError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Chat completion. Prefers the EC2 inference server; falls back to the Lovable
 * AI Gateway unless EC2_INFERENCE_REQUIRED is set.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatResult> {
  const temperature = opts.temperature ?? 0.2;
  const maxTokens = opts.maxTokens ?? 4000;

  if (!opts.gatewayOnly && ec2Available(EC2_CHAT_MODEL)) {
    try {
      const r = await postJson(
        `${EC2_URL}/v1/chat/completions`,
        { Authorization: `Bearer ${EC2_KEY}`, "x-api-key": EC2_KEY },
        { model: EC2_CHAT_MODEL, messages, temperature, max_tokens: maxTokens, stream: false },
        CHAT_TIMEOUT_MS,
      );
      if (!r.ok) throw new Error(`ec2 ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const j = await r.json();
      const text = j?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.length === 0) throw new Error("empty ec2 completion");
      noteEc2Success();
      return { text, provider: "ec2", model: EC2_CHAT_MODEL };
    } catch (e) {
      noteEc2Failure(e);
      if (EC2_REQUIRED) throw e;
    }
  } else if (EC2_REQUIRED) {
    throw new Error("EC2 inference required but unavailable");
  }

  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  const r = await postJson(
    `${GATEWAY}/chat/completions`,
    { Authorization: `Bearer ${LOVABLE_API_KEY}` },
    {
      model: GATEWAY_CHAT_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
    },
    CHAT_TIMEOUT_MS,
  );
  if (!r.ok) {
    throw new GatewayError(r.status, (await r.text()).slice(0, 500));
  }
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content ?? "";
  return { text, provider: "gateway", model: GATEWAY_CHAT_MODEL };
}

/** Stable SHA-256 hex digest of any JSON-serializable value. */
export async function stableHash(value: unknown): Promise<string> {
  const canonical = typeof value === "string" ? value : canonicalJson(value);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * Identifier of the embedding space currently in use. Cache rows are keyed by
 * this so vectors produced by different models are never mixed or compared.
 */
export function activeEmbeddingSpace(): string {
  if (EC2_URL && EC2_EMBED_MODEL) return `ec2:${EC2_EMBED_MODEL}`;
  return `gateway:${GATEWAY_EMBED_MODEL}`;
}

/**
 * Async form of `activeEmbeddingSpace()` that also accounts for the EC2
 * semantic service (CLAP), whose credentials live in the admin credentials
 * table rather than in env. Every cache read/write goes through this so a CLAP
 * vector is never compared with a gateway vector.
 */
export async function resolveEmbeddingSpace(
  // deno-lint-disable-next-line no-explicit-any
  supabase: any | null,
): Promise<string> {
  const cfg = await getSemanticSvcConfig(supabase);
  if (cfg) return cfg.space;
  return activeEmbeddingSpace();
}


/** Zero-pad a shorter vector up to the pgvector column width. */
function padTo(v: number[], dims: number): number[] {
  if (v.length === dims) return v;
  const out = new Array<number>(dims).fill(0);
  for (let i = 0; i < Math.min(v.length, dims); i++) out[i] = v[i];
  return out;
}

/**
 * Embed a text string. Order: EC2 semantic-svc (CLAP) -> EC2 OpenAI-compatible
 * server -> Lovable gateway.
 * Returns null on non-terminal failure (embeddings are enrichment, never fatal).
 * Terminal gateway denials (402/403/429) are thrown so callers can trip a breaker.
 */
export async function embedText(
  text: string,
  // deno-lint-disable-next-line no-explicit-any
  supabase: any | null = null,
): Promise<number[] | null> {
  const svc = await getSemanticSvcConfig(supabase);
  if (svc && !semanticSvcBreakerOpen()) {
    const v = await clapEmbedText(svc, text);
    if (v) return v;
  }

  if (ec2Available(EC2_EMBED_MODEL)) {
    try {
      const r = await postJson(
        `${EC2_URL}/v1/embeddings`,
        { Authorization: `Bearer ${EC2_KEY}`, "x-api-key": EC2_KEY },
        { model: EC2_EMBED_MODEL, input: text },
        EMBED_TIMEOUT_MS,
      );
      if (!r.ok) throw new Error(`ec2 ${r.status}`);
      const j = await r.json();
      const v = j?.data?.[0]?.embedding;
      if (!Array.isArray(v) || v.length === 0) throw new Error("empty ec2 embedding");
      const expected = EC2_EMBED_DIMS || v.length;
      if (v.length !== expected) {
        throw new Error(`ec2 embedding dim ${v.length} != declared ${expected}`);
      }
      if (v.length > EMBEDDING_DIMS) {
        throw new Error(
          `ec2 embedding dim ${v.length} exceeds column width ${EMBEDDING_DIMS}`,
        );
      }
      noteEc2Success();
      return padTo(v as number[], EMBEDDING_DIMS);
    } catch (e) {
      noteEc2Failure(e);
      if (EC2_REQUIRED) return null;
    }
  }


  if (!LOVABLE_API_KEY) return null;
  try {
    const r = await postJson(
      `${GATEWAY}/embeddings`,
      { Authorization: `Bearer ${LOVABLE_API_KEY}` },
      { model: GATEWAY_EMBED_MODEL, input: text },
      EMBED_TIMEOUT_MS,
    );
    if (!r.ok) {
      if (r.status === 402 || r.status === 403 || r.status === 429) {
        throw Object.assign(new Error(`gateway ${r.status}: ${await r.text()}`), {
          status: r.status,
        });
      }
      return null;
    }
    const j = await r.json();
    return j?.data?.[0]?.embedding ?? null;
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 402 || status === 403 || status === 429) throw e;
    return null;
  }
}

/**
 * Embed with a persistent cache in `public.embedding_cache`, keyed by the hash
 * of the input text *and* the embedding model. Identical taxonomy labels /
 * profile strings never pay for a second embedding call, and switching models
 * simply misses the cache instead of returning vectors from another space.
 */
export async function embedCached(
  // deno-lint-disable-next-line no-explicit-any
  supabase: any | null,
  text: string,
): Promise<number[] | null> {
  if (!supabase) return await embedText(text);
  const hash = await stableHash(text);
  const model = await resolveEmbeddingSpace(supabase);
  try {
    const { data } = await supabase
      .from("embedding_cache")
      .select("embedding")
      .eq("text_hash", hash)
      .eq("model", model)
      .maybeSingle();
    if (data?.embedding) {
      const v = typeof data.embedding === "string" ? JSON.parse(data.embedding) : data.embedding;
      if (Array.isArray(v) && v.length === EMBEDDING_DIMS) return v as number[];
    }
  } catch (e) {
    console.warn("embedding_cache read failed:", e instanceof Error ? e.message : e);
  }

  const vec = await embedText(text, supabase);
  if (vec) {
    try {
      await supabase
        .from("embedding_cache")
        .upsert({ text_hash: hash, model, embedding: vec }, { onConflict: "text_hash,model" });
    } catch (e) {
      console.warn("embedding_cache write failed:", e instanceof Error ? e.message : e);
    }
  }
  return vec;
}

/**
 * Content-addressed embedding cache for audio profiles.
 *
 * Keyed by the Librosa cache key (a hash of the audio content + analysis
 * params) and the active embedding space, so re-uploading the *same* audio —
 * by any user, under any audio_source row — never calls the EC2 inference
 * server again. Falls back to the text-hash cache (`embedding_cache`) before
 * paying for a fresh embedding, which also collapses different files whose
 * acoustic profile string is identical.
 *
 * Returns `{ vector, source }` where source is "audio_cache" | "text_cache" |
 * "computed" so callers can log/report cache effectiveness.
 */
export async function embedAudioProfileCached(
  // deno-lint-disable-next-line no-explicit-any
  supabase: any | null,
  cacheKey: string | null,
  profileText: string,
): Promise<{ vector: number[] | null; source: "audio_cache" | "text_cache" | "computed" }> {
  const model = await resolveEmbeddingSpace(supabase);

  if (supabase && cacheKey) {
    try {
      const { data } = await supabase
        .from("audio_profile_embeddings")
        .select("embedding")
        .eq("cache_key", cacheKey)
        .eq("model", model)
        .maybeSingle();
      const raw = data?.embedding;
      if (raw) {
        const v = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(v) && v.length === EMBEDDING_DIMS) {
          // Fire-and-forget usage counter; never blocks the caller.
          supabase.rpc("touch_audio_profile_embedding", {
            p_cache_key: cacheKey,
            p_model: model,
          }).then(() => {}, () => {});
          return { vector: v as number[], source: "audio_cache" };
        }
      }
    } catch (e) {
      console.warn(
        "audio_profile_embeddings read failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  // Second tier: identical profile text already embedded for another key.
  let source: "text_cache" | "computed" = "computed";
  let vec: number[] | null = null;
  if (supabase) {
    const hash = await stableHash(profileText);
    try {
      const { data } = await supabase
        .from("embedding_cache")
        .select("embedding")
        .eq("text_hash", hash)
        .eq("model", model)
        .maybeSingle();
      const raw = data?.embedding;
      if (raw) {
        const v = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(v) && v.length === EMBEDDING_DIMS) {
          vec = v as number[];
          source = "text_cache";
        }
      }
    } catch (e) {
      console.warn("embedding_cache read failed:", e instanceof Error ? e.message : e);
    }
  }

  if (!vec) vec = await embedCached(supabase, profileText);
  if (!vec) return { vector: null, source: "computed" };

  if (supabase && cacheKey) {
    try {
      await supabase
        .from("audio_profile_embeddings")
        .upsert(
          { cache_key: cacheKey, model, embedding: vec, dims: vec.length },
          { onConflict: "cache_key,model" },
        );
    } catch (e) {
      console.warn(
        "audio_profile_embeddings write failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return { vector: vec, source };
}




/**
 * Embed the audio itself with CLAP (semantic-svc), given a public/signed
 * http(s) URL. Returns null when the service is not configured or fails —
 * callers fall back to profile-text embeddings.
 */
export async function embedAudioUrl(
  // deno-lint-disable-next-line no-explicit-any
  supabase: any | null,
  url: string,
): Promise<{ vector: number[] | null; space: string | null }> {
  const cfg = await getSemanticSvcConfig(supabase);
  if (!cfg) return { vector: null, space: null };
  const vector = await clapEmbedAudio(cfg, url);
  return { vector, space: vector ? cfg.space : null };
}

/** Describes the active routing, for admin diagnostics. */
export function inferenceStatus() {
  return {
    ec2_configured: Boolean(EC2_URL),
    ec2_chat_model: EC2_CHAT_MODEL || null,
    ec2_embedding_model: EC2_EMBED_MODEL || null,
    ec2_embedding_dims: EC2_EMBED_DIMS || null,
    embedding_space: activeEmbeddingSpace(),
    ec2_required: EC2_REQUIRED,
    ec2_breaker_open: Date.now() < ec2OpenUntil,
    gateway_fallback: !EC2_REQUIRED,
    semantic_svc_breaker_open: semanticSvcBreakerOpen(),
  };
}
