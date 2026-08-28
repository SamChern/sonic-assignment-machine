// Intuizi Activation-file identifier normalization.
//
// The Activation file format is one uppercase 32-hex EID per row, no header.
// Intuizi subject keys arrive in several shapes, so every key is mapped onto a
// stable 32-hex form:
//
//   * already 32 hex chars      -> uppercased as-is
//   * UUID                      -> dashes stripped, uppercased
//   * base64 hash (>= 16 bytes) -> first 16 bytes hex-encoded, uppercased
//   * anything else             -> SHA-256, first 16 bytes hex, uppercased
//
// Aggregate rows (e.g. "activation:5498") are not subjects and are dropped.

const HEX32 = /^[0-9a-f]{32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64 = /^[A-Za-z0-9+/]{16,}={0,2}$/;

function hex16(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** True for keys that describe a group, not an individual subject. */
export function isAggregateKey(raw: string): boolean {
  return raw.includes(":");
}

/**
 * Map one subject key onto an Activation-file EID, or null when the key is not
 * an individual subject.
 */
export async function toActivationEid(raw: string): Promise<string | null> {
  const key = (raw ?? "").trim();
  if (!key || isAggregateKey(key)) return null;

  if (HEX32.test(key)) return key.toUpperCase();
  if (UUID.test(key)) return key.replace(/-/g, "").toUpperCase();

  if (BASE64.test(key)) {
    try {
      const bin = atob(key);
      if (bin.length >= 16) {
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return hex16(bytes);
      }
    } catch {
      // fall through to the hash path
    }
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return hex16(new Uint8Array(digest));
}

/** Well-formed check used by the export path and its tests. */
export function isActivationEid(value: string): boolean {
  return /^[0-9A-F]{32}$/.test(value);
}
