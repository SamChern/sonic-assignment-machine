/**
 * Control Room registry reader.
 *
 * Every tunable knob of the semantic core lives in `public.control_registry`
 * so an admin can change it from the Control Room UI without a redeploy.
 * Values are cached in-memory for `TTL_MS` (60s), so a change takes effect
 * everywhere within a minute. Reads never throw: any failure falls back to the
 * hard-coded default supplied by the caller.
 */

export const CONTROL_TTL_MS = 60_000;

type Row = { key: string; value: unknown };
// deno-lint-ignore no-explicit-any
type Client = { from: (t: string) => any };

let cache: Map<string, unknown> | null = null;
let cachedAt = 0;
let inflight: Promise<Map<string, unknown>> | null = null;

/** Test/ops helper — drops the in-memory cache. */
export function resetControlCache() {
  cache = null;
  cachedAt = 0;
  inflight = null;
}

async function load(client: Client): Promise<Map<string, unknown>> {
  const now = Date.now();
  if (cache && now - cachedAt < CONTROL_TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await client.from('control_registry').select('key, value');
      if (error) throw error;
      const next = new Map<string, unknown>();
      for (const r of (data ?? []) as Row[]) next.set(r.key, r.value);
      cache = next;
      cachedAt = Date.now();
    } catch (e) {
      console.error('control_registry read failed, using defaults:', e);
      // Keep any previous snapshot rather than hammering the DB each call.
      cache = cache ?? new Map<string, unknown>();
      cachedAt = Date.now();
    } finally {
      inflight = null;
    }
    return cache!;
  })();

  return inflight;
}

/** Numeric knob, clamped to the supplied sane range. */
export async function controlNumber(
  client: Client | null,
  key: string,
  fallback: number,
  opts: { min?: number; max?: number } = {},
): Promise<number> {
  let value = fallback;
  if (client) {
    const map = await load(client);
    const raw = map.get(key);
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n)) value = n;
  }
  if (opts.min !== undefined) value = Math.max(opts.min, value);
  if (opts.max !== undefined) value = Math.min(opts.max, value);
  return value;
}

export async function controlBoolean(
  client: Client | null,
  key: string,
  fallback: boolean,
): Promise<boolean> {
  if (!client) return fallback;
  const map = await load(client);
  const raw = map.get(key);
  return typeof raw === 'boolean' ? raw : fallback;
}

export async function controlString(
  client: Client | null,
  key: string,
  fallback = '',
): Promise<string> {
  if (!client) return fallback;
  const map = await load(client);
  const raw = map.get(key);
  return typeof raw === 'string' && raw.length > 0 ? raw : fallback;
}
