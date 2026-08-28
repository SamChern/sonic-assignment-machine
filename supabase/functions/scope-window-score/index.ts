// Step 10 — scope-window-score: the Semantic Scope's "meaning lens".
//
// Any signed-in user may ask "what does the model hear in this window?". The
// browser never touches the CLAP box or the taxonomy vectors: it sends a
// compact Meyda feature summary (energy, brightness, chroma) plus the current
// six-axis estimate, and gets back the nearest taxonomy tags with similarity.
//
// Guarantees:
//   * one scoring call per window — the server enforces it too, keyed by user,
//     using `scope.window_seconds` from control_registry (Step 9).
//   * knobs come from the registry, never from the request.
//   * admins additionally receive the debug payload (neighbors, prior blend
//     weight, active bridge id) that powers the debug lens.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { controlNumber, controlString } from "../_shared/control.ts";
import {
  clapEmbedText,
  getSemanticSvcConfig,
  logSemanticCall,
} from "../_shared/semanticSvc.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

/** Per-user throttle: last accepted window score. */
const lastCall = new Map<string, number>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const PITCHES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Turns the window's numbers into the kind of sentence CLAP's text tower was
 * trained on. Deterministic, so identical windows embed identically.
 */
function describeWindow(
  features: { rms: number; centroidHz: number; chroma: number[] },
  axes: Record<string, number>,
): string {
  const energy = features.rms > 0.55 ? "loud" : features.rms > 0.22 ? "moderate" : "quiet";
  const bright =
    features.centroidHz > 3200
      ? "very bright, sibilant"
      : features.centroidHz > 1800
      ? "bright"
      : features.centroidHz > 900
      ? "warm"
      : "dark, bass-heavy";
  const top = CATEGORIES
    .map((c) => ({ c, v: num(axes[c]) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 2)
    .map((r) => r.c);
  const chroma = features.chroma ?? [];
  let key = "";
  if (chroma.length === 12) {
    let bi = 0;
    for (let i = 1; i < 12; i++) if (chroma[i] > chroma[bi]) bi = i;
    key = ` with ${PITCHES[bi]} as the dominant pitch class`;
  }
  const speechy = num(axes.communication) >= 55 ? "speech-forward" : "music-forward";
  return `A ${energy}, ${bright} ${speechy} audio segment${key}, strongest on ${top.join(" and ")} semantics.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return json({ success: false, error: "Unauthorized" }, 401);

    let userId: string | null = null;
    let isAdmin = false;
    if (bearer === SERVICE_KEY) {
      userId = "internal";
      isAdmin = true;
    } else {
      const { data: userData, error: userErr } = await createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      }).auth.getUser();
      if (userErr || !userData.user) return json({ success: false, error: "Unauthorized" }, 401);
      userId = userData.user.id;
      const { data: adminFlag } = await admin.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      isAdmin = Boolean(adminFlag);
    }

    const windowSeconds = await controlNumber(admin, "scope.window_seconds", 5, { min: 1, max: 60 });
    const k = await controlNumber(admin, "knn.k", 5, { min: 1, max: 32 });
    const priorWeight = await controlNumber(admin, "prior.blend_weight", 0.35, { min: 0, max: 1 });
    const bridgeId = await controlString(admin, "bridge.active_id", "");

    // Never score more than once per window, whatever the client does.
    const now = Date.now();
    const prev = lastCall.get(userId!) ?? 0;
    const minGapMs = windowSeconds * 1000 * 0.8;
    if (now - prev < minGapMs) {
      return json({
        success: true,
        throttled: true,
        window_seconds: windowSeconds,
        retry_in_ms: Math.round(minGapMs - (now - prev)),
        tags: [],
      });
    }
    lastCall.set(userId!, now);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const f = (body.features ?? {}) as Record<string, unknown>;
    const features = {
      rms: Math.max(0, Math.min(1, num(f.rms))),
      centroidHz: Math.max(0, Math.min(22050, num(f.centroidHz))),
      chroma: Array.isArray(f.chroma) ? (f.chroma as unknown[]).map((v) => num(v)) : [],
    };
    const axesIn = (body.axes ?? {}) as Record<string, unknown>;
    const axes: Record<string, number> = {};
    for (const c of CATEGORIES) axes[c] = Math.max(0, Math.min(100, num(axesIn[c])));

    const descriptor = describeWindow(features, axes);

    const cfg = await getSemanticSvcConfig(admin);
    if (!cfg) {
      return json({
        success: false,
        configured: false,
        window_seconds: windowSeconds,
        error: "Semantic service not configured",
        tags: [],
      }, 503);
    }

    const vector = await clapEmbedText(cfg, descriptor);
    if (!vector) {
      await logSemanticCall(admin, {
        action: "scope_window",
        outcome: "error",
        duration_ms: Date.now() - startedAt,
        error_message: "embed_text failed",
      });
      return json({
        success: false,
        window_seconds: windowSeconds,
        error: "Embedding unavailable",
        tags: [],
      }, 502);
    }

    const { data: neighbors, error: knnErr } = await admin.rpc("match_audioset_nodes", {
      query_embedding: vector as unknown as string,
      match_count: Math.round(k),
    });
    if (knnErr) throw new Error(knnErr.message);

    const rows = ((neighbors ?? []) as { id: string; code: string; label: string; similarity: number }[])
      .filter((n) => Number.isFinite(Number(n.similarity)))
      .map((n) => ({
        id: n.id,
        code: n.code,
        label: n.label,
        similarity: Math.round(Number(n.similarity) * 1000) / 1000,
      }));

    await logSemanticCall(admin, {
      action: "scope_window",
      outcome: "ok",
      duration_ms: Date.now() - startedAt,
      dims: vector.length,
      subject_ref: String(body.subject_ref ?? "scope"),
    });

    return json({
      success: true,
      throttled: false,
      window_seconds: windowSeconds,
      descriptor,
      tags: rows,
      // Debug lens is admin-only: neighbor internals, prior contribution and
      // the active bridge version never reach consumer or enterprise clients.
      debug: isAdmin
        ? {
            knn_k: Math.round(k),
            prior_blend_weight: priorWeight,
            bridge_active_id: bridgeId || null,
            neighbors: rows,
            axes_in: axes,
            features,
          }
        : undefined,
    });
  } catch (e) {
    console.error("scope-window-score failed", e);
    return json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error", tags: [] },
      500,
    );
  }
});
