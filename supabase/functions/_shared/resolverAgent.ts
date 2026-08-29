// Step 13 — the Resolver's model call.
//
// One symbol in, one row's worth of meaning out: a two-sentence semantic
// description, 6-axis tendencies and up to three crosswalk anchors with
// confidence. The model id is a control_registry value, so swapping models in
// five years is a registry edit and nothing else.
//
// Runs through the Lovable AI Gateway Responses API. Responses models are
// reasoning models, so the call always streams — a buffered call would sit on a
// silent socket until a platform timeout kills work that still bills.

import { CATEGORIES, type Category } from "./ontology.ts";
import { searchWeb, snippetBlock, type WebSnippet } from "./resolverWeb.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";

/** Rough blended USD per 1k tokens, used only for budget bookkeeping. */
const USD_PER_1K_IN = 0.00125;
const USD_PER_1K_OUT = 0.01;

export class ResolverGatewayError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

export interface CrosswalkAnchor {
  code: string;
  label: string;
  confidence: number;
}

export interface Resolution {
  description: string;
  tendencies: Record<Category, number>;
  anchors: CrosswalkAnchor[];
  confidence: number;
  snippets: WebSnippet[];
  usd: number;
  model: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description", "tendencies", "anchors", "confidence"],
  properties: {
    description: { type: "string" },
    tendencies: {
      type: "object",
      additionalProperties: false,
      required: [...CATEGORIES],
      properties: Object.fromEntries(
        CATEGORIES.map((c) => [c, { type: "number" }]),
      ),
    },
    anchors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "label", "confidence"],
        properties: {
          code: { type: "string" },
          label: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
    confidence: { type: "number" },
  },
} as const;

const SYSTEM = [
  "You are the SonicSIM Resolver. You are handed a symbol delivered by an audience",
  "data feed (a CTV genre, TV channel, app category, web domain, or POI brand) that the",
  "sonic-semantic ontology does not know yet, plus open-web metadata about it.",
  "Decide what the symbol MEANS in sonic-semantic terms — what the sound world of the",
  "people or content behind it is like.",
  "Return JSON only:",
  "- description: exactly two sentences, factual, no marketing language.",
  "- tendencies: 0-100 for each of emotional, cognitive, social, communication, contextual,",
  "  artistic. Centre near 50; reserve <30 and >70 for genuinely distinctive tendencies.",
  "- anchors: up to 3 AudioSet or IAB codes that best anchor this symbol, each with a",
  "  0-1 confidence. Prefer codes from the candidate list when they fit; never invent a",
  "  code that looks like a real taxonomy code but is not in the candidates unless it is a",
  "  standard AudioSet/IAB label you are confident about.",
  "- confidence: 0-1, your overall confidence in this resolution.",
  "Never reference or request audio recordings; you reason about meaning only.",
].join(" ");

/** Read a streamed /v1/responses body and return the joined output text. */
async function readStream(res: Response): Promise<{ text: string; usd: number }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usd = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          response?: {
            output_text?: string;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
        };
        if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
          text += evt.delta;
        } else if (evt.type === "response.completed") {
          if (!text && evt.response?.output_text) text = evt.response.output_text;
          const u = evt.response?.usage;
          if (u) {
            usd = ((u.input_tokens ?? 0) / 1000) * USD_PER_1K_IN +
              ((u.output_tokens ?? 0) / 1000) * USD_PER_1K_OUT;
          }
        }
      } catch {
        // Partial or non-JSON keep-alive frame — ignore.
      }
    }
  }
  return { text, usd };
}

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

export interface ResolveOptions {
  model: string;
  symbol: string;
  symbolType: string;
  context?: Record<string, unknown>;
  /** Existing taxonomy codes offered to the model as crosswalk candidates. */
  candidates?: { code: string; label: string }[];
}

/**
 * Resolve one symbol. Throws ResolverGatewayError on a gateway failure so the
 * caller can apply the gateway status contract (402/403 pause, 429/5xx park).
 */
export async function resolveSymbol(opts: ResolveOptions): Promise<Resolution> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new ResolverGatewayError("LOVABLE_API_KEY is not configured", 401);

  const snippets = await searchWeb(opts.symbol, opts.symbolType.replace(/_/g, " "));
  const candidateBlock = (opts.candidates ?? [])
    .slice(0, 24)
    .map((c) => `${c.code} :: ${c.label}`)
    .join("\n") || "(no candidates)";

  const input = [
    `Symbol: ${opts.symbol}`,
    `Symbol type: ${opts.symbolType}`,
    `Feed context: ${JSON.stringify(opts.context ?? {}).slice(0, 800)}`,
    "",
    "Open-web metadata:",
    snippetBlock(snippets),
    "",
    "Crosswalk candidates:",
    candidateBlock,
  ].join("\n");

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: opts.model,
      instructions: SYSTEM,
      input,
      stream: true,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "symbol_resolution",
          strict: true,
          schema: SCHEMA,
        },
      },
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new ResolverGatewayError(
      `gateway ${res.status}: ${body.slice(0, 400)}`,
      res.status,
    );
  }

  const { text, usd } = await readStream(res);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ResolverGatewayError(
      `unparseable resolution payload: ${text.slice(0, 200)}`,
      422,
    );
  }

  const rawTend = (parsed.tendencies ?? {}) as Record<string, unknown>;
  const tendencies = Object.fromEntries(
    CATEGORIES.map((c) => [c, Math.round(clamp(rawTend[c], 0, 100, 50))]),
  ) as Record<Category, number>;

  const anchors: CrosswalkAnchor[] = Array.isArray(parsed.anchors)
    ? (parsed.anchors as Record<string, unknown>[])
      .filter((a) => typeof a?.code === "string" && a.code)
      .slice(0, 3)
      .map((a) => ({
        code: String(a.code),
        label: String(a.label ?? a.code),
        confidence: clamp(a.confidence, 0, 1, 0.4),
      }))
    : [];

  const description = String(parsed.description ?? "").trim();
  if (!description) {
    throw new ResolverGatewayError("resolution returned an empty description", 422);
  }

  return {
    description,
    tendencies,
    anchors,
    confidence: clamp(parsed.confidence, 0, 1, 0.4),
    snippets,
    usd,
    model: opts.model,
  };
}
