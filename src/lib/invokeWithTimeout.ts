/**
 * `supabase.functions.invoke` with a hard ceiling, a live session and readable
 * server errors.
 *
 * Three failure modes used to reach the UI as useless spinners or bare
 * "Edge function returned a non-2xx status code" toasts:
 *
 *  1. A stalled function left the caller loading forever → hard timeout.
 *  2. An access token that expired while the tab sat open made every
 *     admin-only function answer 401 → the token is refreshed before the call
 *     and once more on a 401/403, so a long-lived admin tab keeps working.
 *  3. The function's own JSON `{ error }` body was thrown away → it is read
 *     back and used as the message.
 *
 * Every user-facing invoke should go through here.
 */
import { supabase } from "@/integrations/supabase/client";

export const DEFAULT_INVOKE_TIMEOUT_MS = 90_000;

export class InvokeTimeoutError extends Error {
  constructor(fn: string, ms: number) {
    super(`${fn} took longer than ${Math.round(ms / 1000)}s to respond. Please try again.`);
    this.name = "InvokeTimeoutError";
  }
}

/** Refresh the access token when it is missing, expired or about to expire. */
async function ensureFreshSession(force = false): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) return false;
    const expiresAt = (session.expires_at ?? 0) * 1000;
    const stale = force || !expiresAt || expiresAt - Date.now() < 120_000;
    if (!stale) return true;
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (error) return false;
    return Boolean(refreshed.session);
  } catch {
    return false;
  }
}

/** Pull `{ error }` out of a non-2xx function response when there is one. */
async function readServerError(err: unknown): Promise<string | null> {
  const res = (err as { context?: unknown })?.context;
  if (!(res instanceof Response)) return null;
  try {
    const body = await res.clone().json();
    const msg = (body as { error?: unknown })?.error;
    return typeof msg === "string" && msg ? msg : null;
  } catch {
    return null;
  }
}

const statusOf = (err: unknown): number =>
  Number(
    (err as { status?: number })?.status ??
      ((err as { context?: Response })?.context instanceof Response
        ? (err as { context: Response }).context.status
        : 0),
  );

export async function invokeWithTimeout<T = unknown>(
  fn: string,
  options: { body?: unknown; timeoutMs?: number } = {},
): Promise<{ data: T | null; error: Error | null }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;

  const once = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        supabase.functions.invoke(fn, { body: options.body as never }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new InvokeTimeoutError(fn, timeoutMs)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    await ensureFreshSession();
    let result = await once();

    if (result.error) {
      const status = statusOf(result.error);
      if (status === 401 || status === 403) {
        // Token rejected: force one refresh and replay the call before failing.
        const ok = await ensureFreshSession(true);
        if (ok) result = await once();
      }
    }

    if (result.error) {
      const status = statusOf(result.error);
      const detail = await readServerError(result.error);
      const message = detail ??
        (status === 401 || status === 403
          ? "Your session expired. Please sign in again and retry."
          : result.error.message);
      return { data: (result.data ?? null) as T | null, error: new Error(message) };
    }

    return { data: (result.data ?? null) as T | null, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error(`${fn} failed`),
    };
  }
}
