// Step 3 — semantic-embed: single entry point to the EC2 semantic service.
//
// Admin-only (or internal service-role) proxy so the CLAP box is never reached
// from the browser and the token never leaves the server.
//
// Body: { action: "health" | "embed_text" | "embed_audio" | "bridge", ... }
//   embed_text : { texts: string[] }            -> 1536-d vectors
//   embed_audio: { url: string }                -> 1536-d vector
//   bridge     : { vectors: number[][], bridge_id?, weights_url? }
//
// Every call is recorded in public.semantic_call_log.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";
import {
  clapBridge,
  clapEmbedAudio,
  clapEmbedTexts,
  getSemanticSvcConfig,
  logSemanticCall,
  semanticSvcBreakerOpen,
  semanticSvcHealth,
} from "../_shared/semanticSvc.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_TEXTS = 256;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "health");

    const cfg = await getSemanticSvcConfig(admin);
    if (!cfg) {
      return json({
        success: false,
        configured: false,
        error: "Semantic service not configured (Admin -> APIs & MCPs -> Semantic Service)",
      }, 503);
    }

    if (action === "health") {
      const h = await semanticSvcHealth(cfg);
      await logSemanticCall(admin, {
        action,
        outcome: h.ok ? "ok" : "error",
        duration_ms: h.duration_ms,
        http_status: h.status,
        error_message: h.ok ? null : (h.error ?? `HTTP ${h.status}`),
      });
      return json({
        success: h.ok,
        configured: true,
        space: cfg.space,
        breaker_open: semanticSvcBreakerOpen(),
        latency_ms: h.duration_ms,
        health: h.body,
        error: h.ok ? undefined : (h.error ?? `HTTP ${h.status}`),
      }, h.ok ? 200 : 502);
    }

    if (action === "embed_text") {
      const raw = body.texts;
      const texts = Array.isArray(raw)
        ? raw.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        : [];
      if (texts.length === 0 || texts.length > MAX_TEXTS) {
        return json({ success: false, error: `texts must hold 1..${MAX_TEXTS} strings` }, 400);
      }
      const vectors = await clapEmbedTexts(cfg, texts);
      const ok = Array.isArray(vectors);
      await logSemanticCall(admin, {
        action,
        outcome: ok ? "ok" : "error",
        duration_ms: Date.now() - startedAt,
        dims: ok ? (vectors?.[0]?.length ?? null) : null,
        subject_ref: `${texts.length} texts`,
        error_message: ok ? null : "embed_text failed (see function logs)",
      });
      if (!ok) return json({ success: false, error: "Semantic service embed_text failed" }, 502);
      return json({ success: true, space: cfg.space, vectors });
    }

    if (action === "embed_audio") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!/^https?:\/\//i.test(url)) {
        return json({ success: false, error: "url must be an http(s) URL" }, 400);
      }
      const vector = await clapEmbedAudio(cfg, url);
      await logSemanticCall(admin, {
        action,
        outcome: vector ? "ok" : "error",
        duration_ms: Date.now() - startedAt,
        dims: vector?.length ?? null,
        subject_ref: url.slice(0, 200),
        error_message: vector ? null : "embed_audio failed (see function logs)",
      });
      if (!vector) return json({ success: false, error: "Semantic service embed_audio failed" }, 502);
      return json({ success: true, space: cfg.space, vector, dims: vector.length });
    }

    if (action === "bridge") {
      const rows = body.vectors;
      if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_TEXTS) {
        return json({ success: false, error: `vectors must hold 1..${MAX_TEXTS} rows` }, 400);
      }
      const clean = rows.filter((v): v is number[] =>
        Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n))
      );
      if (clean.length !== rows.length) {
        return json({ success: false, error: "vectors must be finite number arrays" }, 400);
      }
      const out = await clapBridge(
        cfg,
        clean,
        typeof body.bridge_id === "string" ? body.bridge_id : null,
        typeof body.weights_url === "string" ? body.weights_url : null,
      );
      await logSemanticCall(admin, {
        action,
        outcome: out ? "ok" : "error",
        duration_ms: Date.now() - startedAt,
        dims: out?.vectors?.[0]?.length ?? null,
        subject_ref: `${clean.length} vectors`,
        error_message: out ? null : "bridge failed (see function logs)",
      });
      if (!out) return json({ success: false, error: "Semantic service bridge failed" }, 502);
      return json({ success: true, mode: out.mode, vectors: out.vectors });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return json({ success: false, error: msg }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
