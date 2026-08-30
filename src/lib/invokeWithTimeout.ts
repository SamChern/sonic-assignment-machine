/**
 * `supabase.functions.invoke` with a hard ceiling.
 *
 * Edge functions that stall (a hung upstream, a cold start behind a slow
 * provider) otherwise leave the calling UI spinning forever with no error to
 * show. Every user-facing invoke should go through here so a stall becomes a
 * normal, surfaceable error instead of a permanent loading state.
 */
import { supabase } from "@/integrations/supabase/client";

export const DEFAULT_INVOKE_TIMEOUT_MS = 90_000;

export class InvokeTimeoutError extends Error {
  constructor(fn: string, ms: number) {
    super(`${fn} took longer than ${Math.round(ms / 1000)}s to respond. Please try again.`);
    this.name = "InvokeTimeoutError";
  }
}

export async function invokeWithTimeout<T = unknown>(
  fn: string,
  options: { body?: unknown; timeoutMs?: number } = {},
): Promise<{ data: T | null; error: Error | null }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      supabase.functions.invoke(fn, { body: options.body as never }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new InvokeTimeoutError(fn, timeoutMs)), timeoutMs);
      }),
    ]);
    return {
      data: (result.data ?? null) as T | null,
      error: result.error ? new Error(result.error.message) : null,
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(`${fn} failed`),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
