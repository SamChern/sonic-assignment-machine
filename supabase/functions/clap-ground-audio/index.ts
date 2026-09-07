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
  getSemanticSvcConfig,
  semanticSvcBreakerOpen,
  semanticSvcHealth,
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

    const { data, error } = await admin
      .from("audio_sources")
      .select("id, name, file_url, preview_url")
      .is("profile_embedding", null)
      .or("file_url.not.is.null,preview_url.not.is.null")
      .order("created_at", { ascending: false })
      .limit(limit);
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
