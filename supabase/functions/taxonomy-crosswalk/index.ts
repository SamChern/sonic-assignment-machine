// Step 5 — crosswalk proposal + review endpoint.
//
// Admin-only. Actions:
//   propose : for each `iab.* | ctv.genre.* | app.cat.* | poi.brand.*` node with
//             an audio_embedding, store the top-N cosine `aset.*` matches into
//             taxonomy_nodes.crosswalk -> { audioset: { matches: [...] } }.
//   list    : read proposals (+approval state) for review in the admin UI.
//   decide  : approve / reject / clear specific proposals on one node.
//   auto_approve : bulk-approve the best proposal per node when its cosine
//             similarity clears a threshold; weaker nodes stay in manual review.
//   backfill : embed + propose sweep — re-labels placeholder nodes, CLAP-embeds
//             anything missing an audio-space vector, then proposes for every
//             eligible node that has no proposals yet. Idempotent and resumable.
//   status  : coverage — how many crosswalk-eligible nodes have >=1 approval,
//             broken out by prefix (the Step 5 verification gate).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";
import {
  applyDecision,
  autoApproveTargets,
  AUDIOSET_PREFIX,
  AUDIOSET_VERSION,
  CROSSWALK_PREFIXES,
  hasApproved,
  readCrosswalk,
  centroid,
  familyKey,
  foldTo512,
  type CrosswalkMatch,
} from "../_shared/audioset.ts";
import { crosswalkText, enrichNodeLabel } from "../_shared/iabLabels.ts";
import { clapEmbedTexts, getSemanticSvcConfig } from "../_shared/semanticSvc.ts";

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
  embedding?: string | number[] | null;
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
      const embeddedCodes = await codesWithAudioEmbedding(admin, prefixFilter);
      return json({
        success: true,
        nodes: rows.map((n) => ({
          id: n.id,
          code: n.code,
          label: n.label,
          has_audio_embedding: embeddedCodes.has(n.code),
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

    if (action === "auto_approve") {
      const threshold = Number(body.threshold ?? 0.7);
      if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
        return json({ success: false, error: "threshold must be between 0 and 1" }, 400);
      }
      const limit = clamp(Number(body.limit ?? 1000), 1, 1000);
      const maxPerNode = clamp(Number(body.max_per_node ?? 1), 1, 3);
      // pending_only: never revisit nodes that already carry an approval.
      const rows = await eligibleNodes(admin, prefixFilter, limit, true);

      let approved = 0;
      let below_threshold = 0;
      let failed = 0;
      const skipped: string[] = [];

      for (const n of rows) {
        const targets = autoApproveTargets(n.crosswalk, threshold, maxPerNode);
        if (targets.length === 0) {
          below_threshold++;
          if (skipped.length < 50) skipped.push(n.code);
          continue;
        }
        const next = applyDecision(n.crosswalk, targets, "approve", actor);
        const { error: upErr } = await admin
          .from("taxonomy_nodes")
          .update({ crosswalk: next, updated_at: new Date().toISOString() })
          .eq("id", n.id);
        if (upErr) failed++;
        else approved++;
      }

      return json({
        success: failed === 0,
        threshold,
        max_per_node: maxPerNode,
        candidates: rows.length,
        approved,
        below_threshold,
        failed,
        needs_manual_review: skipped,
        duration_ms: Date.now() - startedAt,
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

      const rows = await eligibleNodes(admin, prefixFilter, limit, !recompute, true);
      const res = await proposeForNodes(admin, rows, topK);

      return json({
        success: res.failed === 0,
        candidates: rows.length,
        ...res,
        top_k: topK,
        duration_ms: Date.now() - startedAt,
        ...(await coverage(admin)),
      });
    }

    if (action === "backfill") {
      const topK = clamp(Number(body.top_k ?? 3), 1, 10);
      const limit = clamp(Number(body.limit ?? 400), 1, 1000);
      const recompute = body.recompute === true;

      const rows = await eligibleNodes(admin, prefixFilter, limit, false, true);
      const cfg = await getSemanticSvcConfig(admin);

      // 1) Re-label placeholders and CLAP-embed anything missing an audio vector.
      const needsWork = rows.filter((n) =>
        parseVector(n.audio_embedding ?? null) === null ||
        enrichNodeLabel(n.code, n.label) !== (n.label ?? "").trim()
      );
      const clapVia = new Set<string>();
      let relabeled = 0;
      let embedded = 0;
      let embed_failed = 0;

      for (let i = 0; i < needsWork.length; i += 48) {
        const slice = needsWork.slice(i, i + 48);
        const texts = slice.map((n) => crosswalkText(n.code, n.label));
        const vectors = cfg ? await clapEmbedTexts(cfg, texts, true) : null;
        for (let k = 0; k < slice.length; k++) {
          const n = slice[k];
          const nextLabel = enrichNodeLabel(n.code, n.label);
          const vec = vectors?.[k] ?? null;
          const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (nextLabel && nextLabel !== (n.label ?? "").trim()) {
            patch.label = nextLabel;
            n.label = nextLabel;
          }
          if (vec && parseVector(n.audio_embedding ?? null) === null) {
            patch.audio_embedding = JSON.stringify(vec);
            n.audio_embedding = vec;
            clapVia.add(n.code);
          } else if (!vec && parseVector(n.audio_embedding ?? null) === null) {
            embed_failed++;
          }
          if (Object.keys(patch).length === 1) continue;
          const { error } = await admin
            .from("taxonomy_nodes")
            .update(patch)
            .eq("id", n.id);
          if (error) {
            embed_failed++;
            continue;
          }
          if (patch.label) relabeled++;
          if (patch.audio_embedding) embedded++;
        }
      }

      // 2) Propose for everything without proposals (or everything on recompute).
      // `recompute_via` re-runs only nodes whose stored proposals came from a
      // given evidence type — e.g. replace weak `text_bridge` guesses once a
      // better vector source (CLAP or a family centroid) is available.
      const recomputeVia = typeof body.recompute_via === "string" ? body.recompute_via : null;
      const targets = recompute
        ? rows
        : rows.filter((n) => {
          const matches = readCrosswalk(n.crosswalk)?.matches ?? [];
          if (matches.length === 0) return true;
          return recomputeVia ? matches.some((m) => m.via === recomputeVia) : false;
        });
      // Nodes still lacking a sonic vector borrow their family centroid (same
      // IAB tier-1 / parent path). A subtopic sits near its parent topic, so this
      // beats folding a foreign text space into the AudioSet one.
      const familyVectors = await buildFamilyVectors(
        admin,
        targets.filter((n) => parseVector(n.audio_embedding ?? null) === null),
      );
      const res = await proposeForNodes(admin, targets, topK, clapVia, familyVectors);

      return json({
        success: res.failed === 0 && embed_failed === 0,
        semantic_svc: cfg ? "configured" : "unavailable",
        candidates: rows.length,
        relabeled,
        embedded,
        embed_failed,
        proposal_candidates: targets.length,
        ...res,
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

/**
 * Stores top-K `aset.*` cosine matches on each node. Vector preference:
 * the node's own 512-d audio-space embedding, else the 1536-d catalog text
 * embedding folded into 512-d (weaker, tagged `via: "text_bridge"`).
 * Existing approve/reject decisions are always preserved.
 */
async function proposeForNodes(
  // deno-lint-disable-next-line no-explicit-any
  admin: any,
  rows: NodeRow[],
  topK: number,
  clapEmbedded = new Set<string>(),
  /** family key -> borrowed 512-d centroid, used when a node has no vector. */
  familyVectors = new Map<string, number[]>(),
): Promise<{
  proposed: number;
  skipped_no_embedding: number;
  failed: number;
  via_counts: Record<string, number>;
}> {
  let proposed = 0;
  let skipped_no_embedding = 0;
  let failed = 0;
  const via_counts: Record<string, number> = {};

  for (const n of rows) {
    let via: CrosswalkMatch["via"] = clapEmbedded.has(n.code) ? "clap_text" : "audio";
    let vec = parseVector(n.audio_embedding ?? null);
    if (!vec) {
      const fam = familyVectors.get(familyKey(n.code) ?? "");
      if (fam) {
        vec = fam;
        via = "family";
      }
    }
    if (!vec) {
      vec = foldTo512(parseVector(n.embedding ?? null) ?? []);
      via = "text_bridge";
    }
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
    const decided = new Map((existing?.matches ?? []).map((m) => [m.code, m] as const));
    const nextMatches: CrosswalkMatch[] = ((matches ?? []) as Array<
      { code: string; label: string | null; similarity: number }
    >)
      .filter((m) => m.code !== n.code)
      .map((m) => {
        const prev = decided.get(m.code);
        return {
          code: m.code,
          label: m.label,
          similarity: Number(Number(m.similarity).toFixed(4)),
          approved: prev?.approved === true,
          rejected: prev?.rejected === true,
          via,
        };
      });

    const base = (n.crosswalk && typeof n.crosswalk === "object")
      ? { ...(n.crosswalk as Record<string, unknown>) }
      : {};
    const anyApproved = nextMatches.some((m) => m.approved);
    base.audioset = {
      version: AUDIOSET_VERSION,
      proposed_at: new Date().toISOString(),
      matches: nextMatches,
      approved_at: anyApproved ? existing?.approved_at ?? null : null,
      approved_by: anyApproved ? existing?.approved_by ?? null : null,
    };

    const { error: upErr } = await admin
      .from("taxonomy_nodes")
      .update({ crosswalk: base, updated_at: new Date().toISOString() })
      .eq("id", n.id);
    if (upErr) failed++;
    else {
      proposed++;
      via_counts[via ?? "audio"] = (via_counts[via ?? "audio"] ?? 0) + 1;
    }
  }

  return { proposed, skipped_no_embedding, failed, via_counts };
}

async function eligibleNodes(
  // deno-lint-disable-next-line no-explicit-any
  admin: any,
  prefixFilter: string | null,
  limit: number,
  pendingOnly: boolean,
  /** Vectors are large; only the proposal paths need them. */
  withVectors = false,
): Promise<NodeRow[]> {
  const prefixes = prefixFilter ? [prefixFilter] : [...CROSSWALK_PREFIXES];
  const out: NodeRow[] = [];
  const columns = withVectors
    ? "id, code, label, crosswalk, audio_embedding, embedding"
    : "id, code, label, crosswalk";
  for (const p of prefixes) {
    const { data } = await admin
      .from("taxonomy_nodes")
      .select(columns)
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

/**
 * Averages the audio-space vectors of each requested node's family siblings.
 * Only families that actually have embedded members appear in the result.
 */
async function buildFamilyVectors(
  // deno-lint-disable-next-line no-explicit-any
  admin: any,
  nodes: NodeRow[],
): Promise<Map<string, number[]>> {
  const keys = new Set<string>();
  for (const n of nodes) {
    const k = familyKey(n.code);
    if (k) keys.add(k);
  }
  const out = new Map<string, number[]>();
  for (const key of keys) {
    const { data } = await admin
      .from("taxonomy_nodes")
      .select("code, audio_embedding")
      .like("code", `${key}%`)
      .not("audio_embedding", "is", null)
      .limit(40);
    const vectors: number[][] = [];
    for (const r of (data ?? []) as Array<{ audio_embedding: string | number[] }>) {
      const v = parseVector(r.audio_embedding);
      if (v) vectors.push(v);
    }
    const c = centroid(vectors);
    if (c) out.set(key, c);
  }
  return out;
}

/** Codes (cheap projection) that already carry a 512-d audio-space vector. */
async function codesWithAudioEmbedding(
  // deno-lint-disable-next-line no-explicit-any
  admin: any,
  prefixFilter: string | null,
): Promise<Set<string>> {
  const prefixes = prefixFilter ? [prefixFilter] : [...CROSSWALK_PREFIXES];
  const out = new Set<string>();
  for (const p of prefixes) {
    const { data } = await admin
      .from("taxonomy_nodes")
      .select("code")
      .like("code", `${p}%`)
      .not("audio_embedding", "is", null)
      .limit(2000);
    for (const r of (data ?? []) as Array<{ code: string }>) out.add(r.code);
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
