// Audio grounding catch-up: listens to every audio source that still has no
// CLAP embedding and writes back its vector + AudioSet tags.
//
// Uploads are grounded inline by `analyze-audio`, but grounding is enrichment —
// when the EC2 semantic service is down the upload still succeeds with no
// embedding. This function is the repair path: run it once the service answers
// and every ungrounded source catches up. Safe to run repeatedly.
//
// Admin (or internal service-role). Body:
//   { status_only?: boolean, limit?: number (1..200, def 25) }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";
import { groundSourceWithClap } from "../_shared/clapAudio.ts";
import {
  tuneActivationProfileScores,
  type ProfileTuning,
} from "../_shared/profileTuning.ts";
import {
  clapEmbedText,
  getSemanticSvcConfig,
  logSemanticCall,
  semanticSvcBreakerOpen,
  semanticSvcHealth,
  type SemanticSvcConfig,
} from "../_shared/semanticSvc.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Private bucket holding listener/creator uploads. */
const UPLOAD_BUCKET = "user-audio";
const SIGNED_URL_TTL = 900;

interface SourceRow {
  id: string;
  name: string | null;
  file_url: string | null;
  preview_url: string | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Counts of what still needs grounding, cheap enough to poll. */
// deno-lint-disable-next-line no-explicit-any
async function readCoverage(admin: any) {
  const groundable = await admin
    .from("audio_sources")
    .select("id", { count: "exact", head: true })
    .is("profile_embedding", null)
    .or("file_url.not.is.null,preview_url.not.is.null");
  const grounded = await admin
    .from("audio_sources")
    .select("id", { count: "exact", head: true })
    .not("profile_embedding", "is", null);
  return {
    ungrounded_sources: groundable.count ?? 0,
    grounded_sources: grounded.count ?? 0,
  };
}

/**
 * A playable http(s) URL for one source. Storage object keys (uploads) are
 * signed on the fly; provider previews are already absolute URLs.
 */
// deno-lint-disable-next-line no-explicit-any
async function playableUrl(admin: any, row: SourceRow): Promise<string | null> {
  const candidate = (row.file_url ?? row.preview_url ?? "").trim();
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) return candidate;

  const { data, error } = await admin.storage
    .from(UPLOAD_BUCKET)
    .createSignedUrl(candidate.replace(/^\/+/, ""), SIGNED_URL_TTL);
  if (error || !data?.signedUrl) {
    console.warn(`sign failed for ${row.id}:`, error?.message ?? "no url");
    return null;
  }
  return data.signedUrl;
}

/**
 * The activation profile row has no audio file of its own — it is an audience
 * aggregate. Ground it in the SAME CLAP space as real audio by embedding what
 * the taxonomy says about it, so profile <-> track kNN stays comparable.
 */
async function groundActivationProfile(
  // deno-lint-disable-next-line no-explicit-any
  admin: any,
  cfg: SemanticSvcConfig,
  sourceId: string,
  name: string,
): Promise<{ grounded: boolean; tags: number; error?: string }> {
  const { data: tagRows } = await admin
    .from("audio_source_tags")
    .select("weight, taxonomy_nodes(code, label)")
    .eq("audio_source_id", sourceId)
    .order("weight", { ascending: false })
    .limit(40);
  // deno-lint-disable-next-line no-explicit-any
  const labels = ((tagRows ?? []) as any[])
    .map((r) => (r.taxonomy_nodes?.label ?? r.taxonomy_nodes?.code ?? "").toString().trim())
    .filter(Boolean);
  if (labels.length === 0) {
    return { grounded: false, tags: 0, error: "no resolved taxonomy tags to embed yet" };
  }

  const text = `Audience listening profile "${name}": ${labels.join(", ")}.`;
  const started = Date.now();
  const vector = await clapEmbedText(cfg, text);
  await logSemanticCall(admin, {
    action: "embed_text",
    outcome: vector ? "ok" : "error",
    duration_ms: Date.now() - started,
    dims: vector?.length ?? null,
    subject_ref: `activation-profile :: ${name}`.slice(0, 200),
    error_message: vector ? null : "embed_text failed (see function logs)",
  });
  if (!vector) return { grounded: false, tags: labels.length, error: "embedding service returned nothing" };

  const { error } = await admin
    .from("audio_sources")
    .update({ profile_embedding: JSON.stringify(vector) })
    .eq("id", sourceId);
  if (error) return { grounded: false, tags: labels.length, error: error.message };
  return { grounded: true, tags: labels.length };
}

/** Audio source ids belonging to one activation, via its queued identifiers. */
async function activationSourceIds(
  // deno-lint-disable-next-line no-explicit-any
  admin: any,
  activationId: string,
  limit: number,
): Promise<string[]> {
  const ids = new Set<string>();
  const { data: profile } = await admin
    .from("intuizi_identifiers")
    .select("audio_source_id")
    .eq("primary_identifier", `activation:${activationId}`)
    .maybeSingle();
  if (profile?.audio_source_id) ids.add(profile.audio_source_id as string);

  const { data: queued } = await admin
    .from("intuizi_score_queue")
    .select("identifier")
    .eq("activation_id", activationId)
    .limit(Math.min(2000, limit * 20));
  // deno-lint-disable-next-line no-explicit-any
  const identifiers = [...new Set(((queued ?? []) as any[]).map((r) => String(r.identifier)))].slice(
    0,
    2000,
  );
  if (identifiers.length > 0) {
    const { data: linked } = await admin
      .from("intuizi_identifiers")
      .select("audio_source_id")
      .in("primary_identifier", identifiers)
      .not("audio_source_id", "is", null)
      .limit(limit * 4);
    // deno-lint-disable-next-line no-explicit-any
    for (const r of (linked ?? []) as any[]) {
      if (r.audio_source_id) ids.add(String(r.audio_source_id));
    }
  }
  return [...ids];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawLimit = Number(body.limit ?? 25);
    const limit = Math.max(1, Math.min(200, Number.isFinite(rawLimit) ? Math.round(rawLimit) : 25));
    const activationId = typeof body.activation_id === "string" && body.activation_id.trim()
      ? body.activation_id.trim()
      : null;

    const coverage = await readCoverage(admin);
    const cfg = await getSemanticSvcConfig(admin);

    if (body.status_only === true) {
      const health = cfg ? await semanticSvcHealth(cfg) : null;
      return json({
        success: true,
        configured: Boolean(cfg),
        service_ok: health?.ok ?? false,
        service_error: health?.error ?? null,
        breaker_open: semanticSvcBreakerOpen(),
        ...coverage,
      });
    }

    if (!cfg) {
      return json({
        success: false,
        configured: false,
        error: "Audio grounding service is not configured.",
        ...coverage,
      }, 503);
    }

    // Fail fast and loudly when the box is down, rather than burning the whole
    // request budget on calls that will each time out.
    const health = await semanticSvcHealth(cfg);
    if (!health.ok) {
      return json({
        success: false,
        configured: true,
        service_ok: false,
        error: `Audio grounding service is not answering (${health.error ?? `HTTP ${health.status}`}). Start it, then run this again.`,
        ...coverage,
      }, 503);
    }

    // Activation-scoped run (the ingest wizard): ground this activation's own
    // rows first, and text-ground the audience profile itself.
    const profileNotes: string[] = [];
    let profileGrounded = false;
    let profileTuning: ProfileTuning | null = null;
    let scopedIds: string[] | null = null;
    if (activationId) {
      scopedIds = await activationSourceIds(admin, activationId, limit);
      const { data: profileRow } = await admin
        .from("intuizi_identifiers")
        .select("audio_source_id")
        .eq("primary_identifier", `activation:${activationId}`)
        .maybeSingle();
      const profileSourceId = profileRow?.audio_source_id as string | null | undefined;
      if (profileSourceId) {
        const { data: srcRow } = await admin
          .from("audio_sources")
          .select("id, name, file_url, preview_url, profile_embedding")
          .eq("id", profileSourceId)
          .maybeSingle();
        if (srcRow && !srcRow.profile_embedding && !srcRow.file_url && !srcRow.preview_url) {
          const res = await groundActivationProfile(
            admin,
            cfg,
            profileSourceId,
            srcRow.name ?? `Activation ${activationId}`,
          );
          profileGrounded = res.grounded;
          if (res.error) profileNotes.push(res.error);
        } else if (srcRow?.profile_embedding) {
          profileGrounded = true;
        }
        // With a vector in hand, move the six scores off the text-only average
        // and toward the audio we have actually listened to.
        if (profileGrounded) {
          profileTuning = await tuneActivationProfileScores(
            admin,
            profileSourceId,
            activationId,
          );
          if (!profileTuning.tuned && profileTuning.reason) {
            profileNotes.push(`Score tuning: ${profileTuning.reason}`);
          }
        }
      } else {
        profileNotes.push("no activation profile row exists yet");
      }
    }

    let query = admin
      .from("audio_sources")
      .select("id, name, file_url, preview_url")
      .is("profile_embedding", null)
      .or("file_url.not.is.null,preview_url.not.is.null")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (scopedIds) {
      if (scopedIds.length === 0) {
        return json({
          success: true,
          configured: true,
          service_ok: true,
          activation_id: activationId,
          profile_grounded: profileGrounded,
          considered: 0,
          grounded: 0,
          skipped: 0,
          failed: 0,
          notes: profileNotes,
          ...(await readCoverage(admin)),
        });
      }
      query = query.in("id", scopedIds);
    }
    const { data, error } = await query;
    if (error) return json({ success: false, error: error.message }, 500);

    const rows = (data ?? []) as SourceRow[];
    let grounded = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      if (semanticSvcBreakerOpen()) break;
      const url = await playableUrl(admin, row);
      if (!url) {
        skipped++;
        continue;
      }
      const result = await groundSourceWithClap(admin, {
        url,
        name: row.name ?? "untitled",
        audioSourceId: row.id,
        cfg,
      });
      result ? grounded++ : failed++;
    }

    return json({
      success: true,
      configured: true,
      service_ok: true,
      ...(activationId
        ? {
          activation_id: activationId,
          profile_grounded: profileGrounded,
          profile_tuning: profileTuning,
          notes: profileNotes,
        }
        : {}),
      considered: rows.length,
      grounded,
      skipped,
      failed,
      breaker_open: semanticSvcBreakerOpen(),
      ...(await readCoverage(admin)),
    });
  } catch (e) {
    console.error("clap-ground-audio failed:", e);
    return json({ success: false, error: "Audio grounding catch-up failed." }, 500);
  }
});
