// Step 13 — the Resolver's inbox.
//
// Ingest never calls a model. When a delivered signal references a symbol the
// ontology does not know (no node, or a node with no approved crosswalk), the
// control plane drops a row into public.resolution_queue and carries on. The
// nightly `signal-resolver` run drains that queue, so each unknown symbol is
// paid for exactly once, ever.

export type SymbolType =
  | "ctv_genre"
  | "channel"
  | "app_category"
  | "domain"
  | "poi_brand"
  | "other";

/** Best-effort symbol classification from a taxonomy code prefix. */
export function symbolTypeFromCode(code: string): SymbolType {
  const c = code.toLowerCase();
  if (c.startsWith("ctv.genre") || c.includes(".genre.")) return "ctv_genre";
  if (c.startsWith("ctv.channel") || c.includes(".channel.")) return "channel";
  if (c.startsWith("app.")) return "app_category";
  if (c.startsWith("web.") || c.includes(".domain.")) return "domain";
  if (c.startsWith("poi.")) return "poi_brand";
  return "other";
}

export interface EnqueueInput {
  symbol: string;
  symbol_type?: SymbolType;
  context?: Record<string, unknown>;
}

/**
 * Record an unknown symbol for later resolution. Idempotent: a repeat sighting
 * bumps `sightings` / `last_seen_at` instead of adding a row. Never throws —
 * the ingest path must not fail because bookkeeping failed.
 */
export async function enqueueUnknownSymbol(
  // deno-lint-ignore no-explicit-any
  admin: any,
  input: EnqueueInput,
): Promise<void> {
  const symbol = input.symbol?.trim();
  if (!symbol) return;
  const symbol_type = input.symbol_type ?? symbolTypeFromCode(symbol);
  try {
    const { data: existing } = await admin
      .from("resolution_queue")
      .select("id, sightings, status")
      .eq("symbol_type", symbol_type)
      .ilike("symbol", symbol)
      .maybeSingle();

    if (existing) {
      await admin
        .from("resolution_queue")
        .update({
          sightings: (existing.sightings ?? 0) + 1,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      return;
    }

    await admin.from("resolution_queue").insert({
      symbol,
      symbol_type,
      context: input.context ?? {},
      status: "pending",
    });
  } catch (e) {
    console.error("resolution_queue enqueue failed", symbol, e);
  }
}
