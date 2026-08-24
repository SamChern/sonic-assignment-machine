// Client helpers for the admin-only Intuizi MCP bridge (`intuizi-mcp` function).
// Keeps envelope unwrapping in one place so panels deal in plain objects.
import { supabase } from "@/integrations/supabase/client";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface ToolListResult {
  tools: McpTool[];
  capabilities: Record<string, boolean>;
  classification: { read: string[]; write: string[]; destructive: string[] };
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("intuizi-mcp", { body });
  if (error) {
    const detail =
      "context" in error && error.context
        ? await (error.context as Response).text().catch(() => error.message)
        : error.message;
    // The function returns a JSON envelope even on non-2xx; prefer its message.
    try {
      const parsed = JSON.parse(detail) as { error?: string };
      throw new Error(parsed.error ?? detail);
    } catch {
      throw new Error(detail);
    }
  }
  const payload = data as { success?: boolean; error?: string } & Record<string, unknown>;
  if (payload?.success === false) throw new Error(payload.error ?? "Intuizi MCP call failed");
  return payload;
}

export async function listTools(): Promise<ToolListResult> {
  const d = await invoke({ action: "list_tools" });
  return {
    tools: (d.tools ?? []) as McpTool[],
    capabilities: (d.capabilities ?? {}) as Record<string, boolean>,
    classification: (d.classification ?? { read: [], write: [], destructive: [] }) as ToolListResult["classification"],
  };
}

/** Unwrap an MCP tool result into the Intuizi API envelope, when it is JSON. */
export function unwrap<T = unknown>(result: unknown): T | null {
  const structured = (result as { structuredContent?: unknown })?.structuredContent;
  if (structured && typeof structured === "object") return structured as T;
  const content = (result as { content?: Array<{ text?: string }> })?.content ?? [];
  for (const c of content) {
    if (typeof c.text !== "string") continue;
    try {
      return JSON.parse(c.text) as T;
    } catch {
      /* not JSON — fall through */
    }
  }
  return null;
}

/** Raw text of a tool result, for the debug console and error surfaces. */
export function asText(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> })?.content ?? [];
  const joined = content.map((c) => c.text ?? "").filter(Boolean).join("\n");
  return joined || JSON.stringify(result, null, 2);
}

export interface CallOptions {
  confirm?: boolean;
  idempotencyKey?: string;
}

export async function callTool(
  toolName: string,
  args: Record<string, unknown> = {},
  opts: CallOptions = {},
) {
  const d = await invoke({
    action: "call",
    tool_name: toolName,
    arguments: args,
    confirm: opts.confirm === true,
    ...(opts.idempotencyKey ? { idempotency_key: opts.idempotencyKey } : {}),
  });
  return {
    result: d.result,
    resourceId: (d.resource_id ?? null) as string | null,
    latencyMs: Number(d.latency_ms ?? 0),
  };
}

export const newIdempotencyKey = () =>
  `sonicsim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Intuizi audience status 104 = Completed. */
export const AUDIENCE_COMPLETED = 104;

export interface EnvelopeRow {
  id?: string | number;
  name?: string;
  status?: { id?: number; name?: string } | string;
  created_at?: string;
  [k: string]: unknown;
}

export function rows(result: unknown): EnvelopeRow[] {
  const env = unwrap<{ data?: unknown }>(result);
  const data = env?.data;
  if (Array.isArray(data)) return data as EnvelopeRow[];
  if (data && typeof data === "object") return [data as EnvelopeRow];
  return [];
}

export function statusLabel(row: EnvelopeRow): string {
  const s = row.status;
  if (typeof s === "string") return s;
  if (s && typeof s === "object") return s.name ?? (s.id != null ? `status ${s.id}` : "—");
  return "—";
}

export function statusId(row: EnvelopeRow): number | null {
  const s = row.status;
  if (s && typeof s === "object" && typeof s.id === "number") return s.id;
  return null;
}

/** Pull plausible S3 object keys out of an activation payload. */
export function deliveredKeys(result: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      const m = v.trim();
      if (/^s3:\/\/\S+/i.test(m) || /\.(parquet|csv|csv\.gz|json|jsonl|gz)$/i.test(m)) {
        found.add(m);
      }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(unwrap(result) ?? result);
  return Array.from(found);
}
