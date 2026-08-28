// Step 5 — crosswalk proposal + review endpoint.
//
// Admin-only. Actions:
//   propose : for each `iab.* | ctv.genre.* | app.cat.* | poi.brand.*` node with
//             an audio_embedding, store the top-N cosine `aset.*` matches into
//             taxonomy_nodes.crosswalk -> { audioset: { matches: [...] } }.
//   list    : read proposals (+approval state) for review in the admin UI.
//   decide  : approve / reject / clear specific proposals on one node.
//   status  : coverage — how many crosswalk-eligible nodes have >=1 approval,
//             broken out by prefix (the Step 5 verification gate).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";
import {
  applyDecision,
  AUDIOSET_PREFIX,
  AUDIOSET_VERSION,
  CROSSWALK_PREFIXES,
  hasApproved,
  readCrosswalk,
  type CrosswalkMatch,
} from "../_shared/audioset.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface NodeRow {
  id: string;
  code: string;
  label: string | null;
  crosswalk: unknown;
  audio_embedding: string | number[] | null;
}

function parseVector(v: string | number[] | null): number[] | null {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.map(Number) : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }
    const actor = authz.userId;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "status");
    const prefixFilter = typeof body.prefix === "string" && body.prefix.length > 0
      ? body.prefix
      : null;

    if (action === "status") {
      return json({ success: true, ...(await coverage(admin)) });
    }

    if (action === "list") {
      const limit = clamp(Number(body.limit ?? 200), 1, 500);
      const rows = await eligibleNodes(admin, prefixFilter, limit, body.pending_only === true);
      return json({
        success: true,
        nodes: rows.map((n) => ({
          id: n.id,
          code: n.code,
          label: n.label,
          has_audio_embedding: n.audio_embedding != null,
          approved: hasApproved(n.crosswalk),
          matches: readCrosswalk(n.crosswalk)?.matches ?? [],
        })),
        ...(await coverage(admin)),
      });
    }

    if (action === "decide") {
      const code = String(body.code ?? "");
      const decision = String(body.decision ?? "");
      const targets = Array.isArray(body.targets)
        ? (body.targets as unknown[]).map(String).filter((t) => t.startsWith(AUDIOSET_PREFIX))
        : [];
      if (!code || !["approve", "reject", "clear"].includes(decision) || targets.length === 0) {
        return json({
          success: false,
          error: "decide requires { code, decision: approve|reject|clear, targets: ['aset.…'] }",
        }, 400);
      }

      const { data, error } = await admin
        .from("taxonomy_nodes")
        .select("id, code, crosswalk")
        .eq("code", code)
        .maybeSingle();
      if (error) return json({ success: false, error: error.message }, 500);
      if (!data) return json({ success: false, error: `Unknown node ${code}` }, 404);

      const next = applyDecision((data as { crosswalk: unknown }).crosswalk, targets, decision as "approve", actor);
      const { error: upErr } = await admin
        .from("taxonomy_nodes")
        .update({ crosswalk: next, updated_at: new Date().toISOString() })
        .eq("code", code);
      if (upErr) return json({ success: false, error: upErr.message }, 500);

      return json({
        success: true,
        code,
        decision,
        matches: readCrosswalk(next)?.matches ?? [],
        approved: hasApproved(next),
        ...(await coverage(admin)),
      });
    }

    if (action === "propose") {
      const topK = clamp(Number(body.top_k ?? 3), 1, 10);
      const limit = clamp(Number(body.limit ?? 200), 1, 1000);
      const recompute = body.recompute === true;

      const asetReady = await admin
        .from("taxonomy_nodes")
        .select("id", { count: "exact", head: true })
        .like("code", `${AUDIOSET_PREFIX}%`)
        .not("audio_embedding", "is", null);
      if ((asetReady?.count ?? 0) === 0) {
        return json({
          success: false,
          error:
            "No embedded aset.* nodes yet — import the AudioSet ontology, then run the semantic backfill.",
        }, 409);
      }

      const rows = await eligibleNodes(admin, prefixFilter, limit, !recompute);
      let proposed = 0;
      let skipped_no_embedding = 0;
      let failed = 0;

      for (const n of rows) {
        const vec = parseVector(n.audio_embedding);
        if (!vec) {
          skipped_no_embedding++;
          continue;
        }
        const { data: matches, error } = await admin.rpc("match_audioset_nodes", {
          query_embedding: JSON.stringify(vec),
          match_count: topK,
        });
        if (error) {
          failed++;
          continue;
        }

        const existing = readCrosswalk(n.crosswalk);
        const decided = new Map(
          (existing?.matches ?? []).map((m) => [m.code, m] as const),
        );
        const nextMatches: CrosswalkMatch[] = ((matches ?? []) as Array<
          { code: string; label: string | null; similarity: number }
        >)
          .filter((m) => m.code !== n.code)
          .map((m) => {
            const prev = decided.get(m.code);
            return {
              code: m.code,
              label: m.label,
              similarity: Number(m.similarity.toFixed(4)),
              approved: prev?.approved === true,
              rejected: prev?.rejected === true,
            };
          });

        const base = (n.crosswalk && typeof n.crosswalk === "object")
          ? { ...(n.crosswalk as Record<string, unknown>) }
          : {};
        base.audioset = {
          version: AUDIOSET_VERSION,
          proposed_at: new Date().toISOString(),
          matches: nextMatches,
          approved_at: nextMatches.some((m) => m.approved) ? existing?.approved_at ?? null : null,
          approved_by: nextMatches.some((m) => m.approved) ? existing?.approved_by ?? null : null,
        };

        const { error: upErr } = await admin
          .from("taxonomy_nodes")
          .update({ crosswalk: base, updated_at: new Date().toISOString() })
          .eq("id", n.id);
        if (upErr) failed++;
        else proposed++;
      }

      return json({
        success: failed === 0,
        candidates: rows.length,
        proposed,
        skipped_no_embedding,
        failed,
        top_k: topK,
        duration_ms: Date.now() - startedAt,
        ...(await coverage(admin)),
      });
    }

    return json({ success: false, error: `Unknown action ${action}` }, 400);
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});

async function eligibleNodes(
  // deno-lint-disable-next-line no-explicit-any
  admin: any,
  prefixFilter: string | null,
  limit: number,
  pendingOnly: boolean,
): Promise<NodeRow[]> {
  const prefixes = prefixFilter ? [prefixFilter] : [...CROSSWALK_PREFIXES];
  const out: NodeRow[] = [];
  for (const p of prefixes) {
    const { data } = await admin
      .from("taxonomy_nodes")
      .select("id, code, label, crosswalk, audio_embedding")
      .like("code", `${p}%`)
      .order("code", { ascending: true })
      .limit(limit);
    for (const r of (data ?? []) as NodeRow[]) {
      if (pendingOnly && hasApproved(r.crosswalk)) continue;
      out.push(r);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// deno-lint-disable-next-line no-explicit-any
async function coverage(admin: any) {
  const byPrefix: Record<string, { total: number; proposed: number; approved: number }> = {};
  let total = 0;
  let proposedCount = 0;
  let approvedCount = 0;

  for (const p of CROSSWALK_PREFIXES) {
    const rows = await eligibleNodes(admin, p, 1000, false);
    const proposed = rows.filter((r) => (readCrosswalk(r.crosswalk)?.matches ?? []).length > 0).length;
    const approved = rows.filter((r) => hasApproved(r.crosswalk)).length;
    byPrefix[p] = { total: rows.length, proposed, approved };
    total += rows.length;
    proposedCount += proposed;
    approvedCount += approved;
  }

  const iab = byPrefix["iab."] ?? { total: 0, proposed: 0, approved: 0 };
  return {
    eligible_total: total,
    proposed_total: proposedCount,
    approved_total: approvedCount,
    by_prefix: byPrefix,
    /** Step 5 gate: every iab.* node carries >=1 approved crosswalk entry. */
    iab_fully_approved: iab.total > 0 && iab.approved === iab.total,
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? Math.round(n) : lo));
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
