// Step 14c — sound-curator: the Sound Library's back end.
//
// Admin-only (or internal service-role). Actions:
//   status       -> coverage, gap count, queue counts, active pack
//   gaps         -> { limit?, branch? } the most-observed ungrounded tags
//   autocurate   -> propose licensed clips for the top gaps (AI, budget capped)
//   approve      -> { queue_id } embed the clip, ground the node, record the asset
//   reject       -> { queue_id, notes? }
//   publish_pack -> { version?, notes? } snapshot grounded codes as a pack
//   activate_pack-> { pack_id }
//
// Nothing here ever grounds a node without a license and an attribution.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";
import { chatCompletion, GatewayError } from "../_shared/inference.ts";
import { controlBoolean, controlNumber } from "../_shared/control.ts";
import {
  clapEmbedAudio,
  getSemanticSvcConfig,
  logSemanticCall,
} from "../_shared/semanticSvc.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Rough per-proposal cost used only to enforce the daily cap. */
const USD_PER_CALL = 0.02;

/** Hosts we accept a clip URL from: openly licensed catalogs only. */
const ALLOWED_HOSTS = [
  "freesound.org",
  "cdn.freesound.org",
  "upload.wikimedia.org",
  "commons.wikimedia.org",
  "archive.org",
  "ia800000.us.archive.org",
  "opengameart.org",
];

// deno-lint-ignore no-explicit-any
type Admin = any;

interface Proposal {
  taxonomy_code: string;
  source_url: string;
  title?: string;
  license: string;
  attribution: string;
  notes?: string;
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
    const actorId = authz.userId;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "status");

    if (action === "status") return json({ success: true, ...(await readStatus(admin)) });

    if (action === "gaps") {
      const { data, error } = await admin.rpc("grounding_gaps", {
        p_limit: clampInt(body.limit, 40, 1, 200),
        p_branch: typeof body.branch === "string" && body.branch ? body.branch : null,
      });
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, gaps: data ?? [] });
    }

    if (action === "autocurate") {
      return await autocurate(admin, body, actorId, startedAt);
    }

    if (action === "approve") {
      return await approve(admin, body, actorId, startedAt);
    }

    if (action === "reject") {
      const id = String(body.queue_id ?? "");
      if (!id) return json({ success: false, error: "queue_id is required" }, 400);
      const { error } = await admin
        .from("grounding_queue")
        .update({
          status: "rejected",
          notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : null,
          reviewed_by: actorId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    if (action === "publish_pack") return await publishPack(admin, body);

    if (action === "activate_pack") {
      const id = String(body.pack_id ?? "");
      if (!id) return json({ success: false, error: "pack_id is required" }, 400);
      await admin.from("embedding_bridges").update({ is_active: false }).neq("id", id);
      const { error } = await admin
        .from("embedding_bridges")
        .update({ is_active: true, activated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, ...(await readStatus(admin)) });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    const status = e instanceof GatewayError ? e.status : 500;
    return json({ success: false, error: msg }, status);
  }
});

/* -------------------------------------------------------------------------- */

async function readStatus(admin: Admin) {
  const [coverage, packs, queue] = await Promise.all([
    admin.rpc("grounding_coverage"),
    admin
      .from("embedding_bridges")
      .select("id,name,version,kind,is_active,activated_at,manifest,license_ledger,created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    admin.from("grounding_queue").select("status"),
  ]);

  const rows = (coverage?.data ?? []) as Array<Record<string, number | string>>;
  const observed = rows.reduce((s, r) => s + Number(r.observed_weight ?? 0), 0);
  const grounded = rows.reduce((s, r) => s + Number(r.grounded_weight ?? 0), 0);

  const counts: Record<string, number> = {};
  for (const r of (queue?.data ?? []) as Array<{ status: string }>) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }

  const packRows = (packs?.data ?? []) as Array<Record<string, unknown>>;
  return {
    coverage: rows,
    coverage_pct: observed > 0 ? Math.round((grounded / observed) * 1000) / 10 : 0,
    queue_counts: counts,
    packs: packRows.map((p) => ({
      ...p,
      code_count: Object.keys((p.manifest ?? {}) as Record<string, unknown>).length,
      manifest: undefined,
    })),
    active_pack: packRows.find((p) => p.is_active === true) ?? null,
  };
}

async function autocurate(
  admin: Admin,
  body: Record<string, unknown>,
  actorId: string | null,
  startedAt: number,
) {
  const enabled = await controlBoolean(admin, "grounding.autocurate_enabled", true);
  if (!enabled) {
    return json({ success: false, error: "Auto-curation is switched off in the Control Room" }, 409);
  }

  const cap = await controlNumber(admin, "grounding.curator_daily_usd_cap", 2.5, { min: 0, max: 50 });
  const batch = Math.min(
    clampInt(body.limit, await controlNumber(admin, "grounding.curator_batch_size", 8, { min: 1, max: 40 }), 1, 40),
    40,
  );

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: spentCalls } = await admin
    .from("semantic_call_log")
    .select("id", { count: "exact", head: true })
    .eq("service", "sound_curator")
    .eq("action", "autocurate")
    .gte("created_at", since);
  const spent = (spentCalls ?? 0) * USD_PER_CALL;
  if (spent + USD_PER_CALL > cap) {
    return json(
      { success: false, error: `Daily auto-curation cap reached ($${cap}). Raise it in the Control Room.` },
      429,
    );
  }

  const { data: gapRows, error: gapErr } = await admin.rpc("grounding_gaps", {
    p_limit: batch,
    p_branch: typeof body.branch === "string" && body.branch ? body.branch : null,
  });
  if (gapErr) return json({ success: false, error: gapErr.message }, 500);
  const gaps = (gapRows ?? []) as Array<{ code: string; label: string | null; observed_weight: number }>;
  const open = gaps.filter((g) => g.code);
  if (open.length === 0) return json({ success: true, proposed: 0, gaps: 0 });

  const prompt = [
    "For each taxonomy tag below, propose ONE openly licensed audio clip that a listener would agree is a fair acoustic example of that tag.",
    `Only use these hosts: ${ALLOWED_HOSTS.join(", ")}.`,
    "License must be an explicit open license (CC0, CC-BY, CC-BY-SA, or Public Domain) and attribution must name the creator and the source page.",
    "If you cannot name a real, specific clip with a real license, omit that tag entirely. Never invent a URL.",
    'Reply with JSON only: {"proposals":[{"taxonomy_code":"","source_url":"","title":"","license":"","attribution":"","notes":""}]}',
    "",
    ...open.map((g) => `- ${g.code} — ${g.label ?? ""} (observed weight ${g.observed_weight})`),
  ].join("\n");

  let text = "";
  let outcome: "ok" | "error" = "ok";
  try {
    const res = await chatCompletion(
      [
        { role: "system", content: "You curate licensed reference audio. You never fabricate URLs or licenses." },
        { role: "user", content: prompt },
      ],
      { temperature: 0.1, maxTokens: 1600 },
    );
    text = res.text;
  } catch (e) {
    outcome = "error";
    await logSemanticCall(admin, {
      service: "sound_curator",
      action: "autocurate",
      outcome,
      duration_ms: Date.now() - startedAt,
      subject_ref: `${open.length} gaps`,
      error_message: e instanceof Error ? e.message : "chat failed",
    });
    const status = e instanceof GatewayError ? e.status : 502;
    return json({ success: false, error: e instanceof Error ? e.message : "curation call failed" }, status);
  }

  const proposals = parseProposals(text).filter((p) => hostAllowed(p.source_url));
  const codes = new Set(open.map((g) => g.code));
  const rows = proposals
    .filter((p) => codes.has(p.taxonomy_code) && p.license && p.attribution)
    .map((p) => ({
      taxonomy_code: p.taxonomy_code,
      source_url: p.source_url,
      title: p.title?.slice(0, 200) ?? null,
      license: p.license.slice(0, 120),
      attribution: p.attribution.slice(0, 400),
      origin: "auto",
      proposed_by: actorId,
      status: "proposed",
      notes: p.notes?.slice(0, 500) ?? null,
    }));

  let inserted = 0;
  if (rows.length > 0) {
    const { data, error } = await admin.from("grounding_queue").insert(rows).select("id");
    if (error) return json({ success: false, error: error.message }, 500);
    inserted = (data ?? []).length;
  }

  await logSemanticCall(admin, {
    service: "sound_curator",
    action: "autocurate",
    outcome,
    duration_ms: Date.now() - startedAt,
    subject_ref: `${open.length} gaps -> ${inserted} proposals`,
  });

  return json({
    success: true,
    gaps: open.length,
    proposed: inserted,
    rejected_candidates: proposals.length - rows.length,
    spend_today_usd: Math.round((spent + USD_PER_CALL) * 100) / 100,
    daily_cap_usd: cap,
  });
}

async function approve(
  admin: Admin,
  body: Record<string, unknown>,
  actorId: string | null,
  startedAt: number,
) {
  const id = String(body.queue_id ?? "");
  if (!id) return json({ success: false, error: "queue_id is required" }, 400);

  const { data: row, error } = await admin
    .from("grounding_queue")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return json({ success: false, error: error.message }, 500);
  if (!row) return json({ success: false, error: "Queue item not found" }, 404);
  if (!row.license || !row.attribution) {
    return json({ success: false, error: "License and attribution are required before approval" }, 400);
  }

  const cfg = await getSemanticSvcConfig(admin);
  if (!cfg) {
    return json(
      { success: false, error: "Semantic service not configured (Admin -> APIs & MCPs -> Semantic Service)" },
      503,
    );
  }

  // Resolve a URL the semantic service can fetch: a stored upload gets a short
  // signed link; a pasted link must be on an openly licensed host.
  let url: string | null = row.source_url ?? null;
  if (row.storage_path) {
    const { data: signed } = await admin.storage
      .from("grounding")
      .createSignedUrl(row.storage_path, 600);
    url = signed?.signedUrl ?? null;
  } else if (!url || !hostAllowed(url)) {
    return json({ success: false, error: "source_url host is not an accepted open-license catalog" }, 400);
  }
  if (!url) return json({ success: false, error: "No fetchable audio for this item" }, 400);

  // taxonomy_nodes.audio_embedding is vector(512) — CLAP's native width.
  const vector = await clapEmbedAudio(cfg, url, true);
  await logSemanticCall(admin, {
    service: "sound_curator",
    action: "approve_embed",
    outcome: vector ? "ok" : "error",
    duration_ms: Date.now() - startedAt,
    dims: vector?.length ?? null,
    subject_ref: row.taxonomy_code,
    error_message: vector ? null : "embed_audio failed",
  });
  if (!vector) return json({ success: false, error: "Could not listen to that clip (semantic service)" }, 502);

  const { data: node } = await admin
    .from("taxonomy_nodes")
    .select("id,grounding_count")
    .eq("code", row.taxonomy_code)
    .maybeSingle();
  if (!node) return json({ success: false, error: `Unknown taxonomy code ${row.taxonomy_code}` }, 400);

  const { error: nodeErr } = await admin
    .from("taxonomy_nodes")
    .update({
      audio_embedding: JSON.stringify(vector),
      grounding_count: Number(node.grounding_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", node.id);
  if (nodeErr) return json({ success: false, error: nodeErr.message }, 500);

  const { data: asset, error: assetErr } = await admin
    .from("grounding_assets")
    .insert({
      taxonomy_code: row.taxonomy_code,
      taxonomy_node_id: node.id,
      source_url: row.source_url,
      storage_path: row.storage_path,
      title: row.title,
      license: row.license,
      attribution: row.attribution,
      status: "active",
      embedded_at: new Date().toISOString(),
      created_by: actorId,
    })
    .select("id")
    .maybeSingle();
  if (assetErr) return json({ success: false, error: assetErr.message }, 500);

  await admin
    .from("grounding_queue")
    .update({
      status: "approved",
      reviewed_by: actorId,
      reviewed_at: new Date().toISOString(),
      asset_id: asset?.id ?? null,
    })
    .eq("id", id);

  return json({ success: true, taxonomy_code: row.taxonomy_code, asset_id: asset?.id ?? null });
}

async function publishPack(admin: Admin, body: Record<string, unknown>) {
  const { data: assets, error } = await admin
    .from("grounding_assets")
    .select("taxonomy_code,license,attribution,title,embedded_at")
    .eq("status", "active");
  if (error) return json({ success: false, error: error.message }, 500);

  const rows = (assets ?? []) as Array<Record<string, string | null>>;
  if (rows.length === 0) {
    return json({ success: false, error: "Nothing grounded yet — approve at least one clip first" }, 409);
  }

  const manifest: Record<string, { clips: number; licenses: string[] }> = {};
  const ledger: Array<Record<string, string | null>> = [];
  for (const a of rows) {
    const code = a.taxonomy_code ?? "";
    if (!code) continue;
    const entry = manifest[code] ?? { clips: 0, licenses: [] };
    entry.clips += 1;
    if (a.license && !entry.licenses.includes(a.license)) entry.licenses.push(a.license);
    manifest[code] = entry;
    ledger.push({
      taxonomy_code: code,
      title: a.title ?? null,
      license: a.license ?? null,
      attribution: a.attribution ?? null,
    });
  }

  const { count } = await admin
    .from("embedding_bridges")
    .select("id", { count: "exact", head: true })
    .eq("kind", "pack");
  const version = typeof body.version === "string" && body.version.trim()
    ? body.version.trim().slice(0, 40)
    : `v${(count ?? 0) + 1}`;

  await admin.from("embedding_bridges").update({ is_active: false }).neq("id", "00000000-0000-0000-0000-000000000000");
  const { data: pack, error: insErr } = await admin
    .from("embedding_bridges")
    .insert({
      name: `SONICSIM Grounding Pack ${version}`,
      version,
      kind: "pack",
      from_dim: 512,
      to_dim: 1536,
      manifest,
      license_ledger: ledger,
      is_active: true,
      activated_at: new Date().toISOString(),
    })
    .select("id,name,version")
    .maybeSingle();
  if (insErr) return json({ success: false, error: insErr.message }, 500);

  return json({
    success: true,
    pack,
    codes: Object.keys(manifest).length,
    clips: rows.length,
  });
}

/* -------------------------------------------------------------------------- */

function parseProposals(text: string): Proposal[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { proposals?: unknown };
    const list = Array.isArray(parsed.proposals) ? parsed.proposals : [];
    return list
      .filter((p): p is Proposal =>
        !!p && typeof p === "object" &&
        typeof (p as Proposal).taxonomy_code === "string" &&
        typeof (p as Proposal).source_url === "string" &&
        typeof (p as Proposal).license === "string" &&
        typeof (p as Proposal).attribution === "string"
      )
      .slice(0, 40);
  } catch {
    return [];
  }
}

function hostAllowed(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
