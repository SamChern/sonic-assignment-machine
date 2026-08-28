// Public KPI pixel collector. Called by the ss-pixel.js snippet on the
// enterprise customer's own site — no auth, so every request is validated
// against an active tag id and (when configured) its allowed origins.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const KPIS = [
  "site_traffic",
  "cpc",
  "ctr",
  "page_views",
  "vcr",
  "time_on_site",
] as const;

const trim = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

const GIF = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const url = new URL(req.url);
  const isBeacon = req.method === "GET";

  const respond = (status: number, payload: Record<string, unknown>) =>
    isBeacon
      ? new Response(GIF, {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "image/gif", "Cache-Control": "no-store" },
        })
      : new Response(JSON.stringify(payload), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

  try {
    const body = isBeacon
      ? Object.fromEntries(url.searchParams.entries())
      : await req.json().catch(() => ({}));

    const tagId = trim(body.tag_id ?? body.t, 64);
    if (!tagId) return respond(400, { success: false, error: "tag_id is required" });

    const { data: tag } = await admin
      .from("pixel_tags")
      .select("organization_id, allowed_origins, active")
      .eq("tag_id", tagId)
      .maybeSingle();

    if (!tag || !tag.active) {
      return respond(404, { success: false, error: "Unknown or inactive tag" });
    }

    const origin = req.headers.get("Origin") ?? req.headers.get("Referer") ?? "";
    const allowed: string[] = Array.isArray(tag.allowed_origins) ? tag.allowed_origins : [];
    if (allowed.length && origin) {
      const host = (() => {
        try {
          return new URL(origin).host;
        } catch {
          return "";
        }
      })();
      const ok = allowed.some((a) => {
        const clean = a.replace(/^https?:\/\//, "").replace(/\/$/, "");
        return host === clean || host.endsWith(`.${clean}`);
      });
      if (!ok) return respond(403, { success: false, error: "Origin not allowed for this tag" });
    }

    const kpiMetric = trim(body.kpi_metric ?? body.k, 40);
    const kpiValueRaw = body.kpi_value ?? body.v;
    const kpiValue = kpiValueRaw === undefined || kpiValueRaw === null || kpiValueRaw === ""
      ? null
      : Number(kpiValueRaw);

    if (kpiMetric && !KPIS.includes(kpiMetric as typeof KPIS[number])) {
      return respond(400, {
        success: false,
        error: `kpi_metric must be one of ${KPIS.join(", ")}`,
      });
    }
    if (kpiValue !== null && !Number.isFinite(kpiValue)) {
      return respond(400, { success: false, error: "kpi_value must be numeric" });
    }

    let props: Record<string, unknown> = {};
    const rawProps = body.props ?? body.p;
    if (rawProps) {
      try {
        props = typeof rawProps === "string" ? JSON.parse(rawProps) : (rawProps as Record<string, unknown>);
      } catch {
        props = {};
      }
    }

    // Step 11 — capture click identifiers and campaign params alongside the hit
    // so KPI joins never depend on platform reporting.
    const pageUrl = trim(body.page_url ?? body.url, 1000);
    const fromUrl = (name: string): string | null => {
      if (!pageUrl) return null;
      try {
        return trim(new URL(pageUrl).searchParams.get(name), 400);
      } catch {
        return null;
      }
    };
    const param = (snake: string, short: string) =>
      trim((body as Record<string, unknown>)[snake] ?? (body as Record<string, unknown>)[short], 400) ??
      fromUrl(snake);

    const gclid = param("gclid", "gid");
    const utm = {
      utm_source: param("utm_source", "us"),
      utm_medium: param("utm_medium", "um"),
      utm_campaign: param("utm_campaign", "uc"),
      utm_term: param("utm_term", "ut"),
      utm_content: param("utm_content", "uo"),
    };

    let consent: Record<string, unknown> = {};
    const rawConsent = body.consent ?? body.c;
    if (rawConsent) {
      try {
        consent = typeof rawConsent === "string"
          ? JSON.parse(rawConsent)
          : (rawConsent as Record<string, unknown>);
      } catch {
        consent = {};
      }
    }

    const { error } = await admin.from("pixel_events").insert({
      gclid,
      ...utm,
      consent,
      organization_id: tag.organization_id,
      tag_id: tagId,
      event_name: trim(body.event_name ?? body.e, 80) ?? "page_view",
      external_user_id: trim(body.external_user_id ?? body.u, 200),
      page_url: pageUrl,
      referrer: trim(body.referrer ?? body.r, 1000),
      kpi_metric: kpiMetric,
      kpi_value: kpiValue,
      props,
    });
    if (error) throw new Error(error.message);

    return respond(200, { success: true });
  } catch (e) {
    console.error("pixel-collect failed:", (e as Error).message);
    return respond(500, { success: false, error: (e as Error).message });
  }
});
