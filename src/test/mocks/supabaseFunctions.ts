// Shared mock for `supabase.functions.invoke` used by admin integration tests.
// Register per-function handlers, then assert on the recorded calls.
import { vi } from "vitest";

export interface InvokeCall {
  fn: string;
  body: Record<string, unknown> | undefined;
}

type Handler = (
  body: Record<string, unknown> | undefined,
) => { data?: unknown; error?: { message: string } | null };

export const invokeCalls: InvokeCall[] = [];
const handlers = new Map<string, Handler>();

export const onInvoke = (fn: string, handler: Handler) => handlers.set(fn, handler);

export const resetSupabaseMock = () => {
  invokeCalls.length = 0;
  handlers.clear();
};

export const functionsInvoke = vi.fn(
  async (fn: string, opts?: { body?: Record<string, unknown> }) => {
    invokeCalls.push({ fn, body: opts?.body });
    const handler = handlers.get(fn);
    const result = handler ? handler(opts?.body) : { data: { success: true } };
    return { data: result.data ?? null, error: result.error ?? null };
  },
);

export const supabaseMock = {
  functions: { invoke: functionsInvoke },
};
