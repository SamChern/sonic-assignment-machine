// Enrichment — predicted impact of each audio row on the account's own site tags.
//
// The account's tracking tag writes measured events into public.pixel_events
// (kpi_metric / kpi_value per device). Device rows in public.enterprise_records
// already carry the six semantic scores. Fitting one against the other with the
// shared ridge + bootstrap estimator gives an honest per-axis relationship for
// that single tag; applying the fit to each of the account's saved audio
// analyses turns it into a predicted impact per audio row.
//
// Rules kept from Step 11c: the sample-sufficiency gate refuses claims below
// `predict.min_kpi_rows`, and any axis whose interval crosses zero is returned
// flagged rather than presented as a driver. Nothing is invented when there is
// no measured data — the response says so instead.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthzError, requireOrgMember } from "../_shared/org.ts";
import { controlNumber } from "../_shared/control.ts";
import { crossesZero } from "../_shared/ridge.ts";
import { fitRemoteOrLocal, RIDGE_LAMBDA } from "../_shared/ridgeRemote.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

const EVENT_SAMPLE = 20_000;
const RECORD_SAMPLE = 5_000;
const WINDOW_DAYS = 90;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface TagStat {
  kpi_metric: string;
  events: number;
  devices: number;
  avg_value: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const organizationId = String(body.organization_id ?? "");
    await requireOrgMember(req, admin, organizationId, false);

    const requested = body.kpi_metric ? String(body.kpi_metric) : null;
    const rowLimit = Math.min(50, Math.max(5, Number(body.limit ?? 20) || 20));

    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    // ---- 1. which site tags actually carry measured values ------------------
    const { data: events, error: evErr } = await admin
      .from("pixel_events")
      .select("kpi_metric, kpi_value, external_user_id")
      .eq("organization_id", organizationId)
      .not("kpi_metric", "is", null)
      .not("kpi_value", "is", null)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(EVENT_SAMPLE);
    if (evErr) throw new Error(evErr.message);

    const byMetric = new Map<
      string,
      { events: number; total: number; devices: Map<string, { total: number; n: number }> }
    >();
    for (const ev of events ?? []) {
      const metric = String(ev.kpi_metric ?? "").trim();
      if (!metric) continue;
      const value = Number(ev.kpi_value);
      if (!Number.isFinite(value)) continue;
      const bucket = byMetric.get(metric) ?? { events: 0, total: 0, devices: new Map() };
      bucket.events += 1;
      bucket.total += value;
      const device = String(ev.external_user_id ?? "").trim();
      if (device) {
        const cur = bucket.devices.get(device) ?? { total: 0, n: 0 };
        cur.total += value;
        cur.n += 1;
        bucket.devices.set(device, cur);
      }
      byMetric.set(metric, bucket);
    }

    const tags: TagStat[] = [...byMetric.entries()]
      .map(([kpi_metric, b]) => ({
        kpi_metric,
        events: b.events,
        devices: b.devices.size,
        avg_value: b.events ? b.total / b.events : 0,
      }))
      .sort((a, b) => b.devices - a.devices || b.events - a.events);

    // ---- 2. the account's own saved audio rows ------------------------------
    // Analyses saved under the account come first. Older accounts loaded their
    // audio through data rows instead, so when nothing is tagged to the account
    // we fall back to the analyses those rows actually name — never to the
    // shared pool.
    const AUDIO_COLUMNS =
      "id, source_name, confidence, created_at, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score";

    const { data: audio, error: audioErr } = await admin
      .from("source_analyses")
      .select(AUDIO_COLUMNS)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(rowLimit);
    if (audioErr) throw new Error(audioErr.message);

    let audioRows = (audio ?? []) as Record<string, unknown>[];
    let audioSource: "account_analyses" | "account_data_rows" = "account_analyses";

    if (!audioRows.length) {
      const { data: named, error: namedErr } = await admin
        .from("enterprise_records")
        .select("source_name")
        .eq("organization_id", organizationId)
        .not("source_name", "is", null)
        .limit(RECORD_SAMPLE);
      if (namedErr) throw new Error(namedErr.message);

      const names = [
        ...new Set((named ?? []).map((r) => String(r.source_name ?? "").trim()).filter(Boolean)),
      ].slice(0, 200);

      if (names.length) {
        const { data: linked, error: linkedErr } = await admin
          .from("source_analyses")
          .select(AUDIO_COLUMNS)
          .in("source_name", names)
          .order("created_at", { ascending: false })
          .limit(rowLimit);
        if (linkedErr) throw new Error(linkedErr.message);
        if (linked?.length) {
          audioRows = linked as Record<string, unknown>[];
          audioSource = "account_data_rows";
        }
      }
    }

    if (!tags.length) {
      return json({
        success: true,
        fitted: false,
        reason: "no_tags",
        tags: [],
        audio_rows: audioRows.length,
        computed_at: new Date().toISOString(),
      });
    }

    const metric = requested && byMetric.has(requested) ? requested : tags[0].kpi_metric;
    const chosen = byMetric.get(metric)!;

    // ---- 3. fit the six scores against that one tag -------------------------
    const minRows = Math.round(
      await controlNumber(admin, "predict.min_kpi_rows", 24, { min: 8, max: 500 }),
    );
    const iters = Math.round(
      await controlNumber(admin, "predict.bootstrap_iters", 200, { min: 50, max: 2000 }),
    );

    const { data: records, error: recErr } = await admin
      .from("enterprise_records")
      .select(
        "id, external_user_id, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
      )
      .eq("organization_id", organizationId)
      .eq("analysis_status", "scored")
      .not("external_user_id", "is", null)
      .limit(RECORD_SAMPLE);
    if (recErr) throw new Error(recErr.message);

    const X: number[][] = [];
    const y: number[] = [];
    for (const rec of records ?? []) {
      const device = String(rec.external_user_id ?? "").trim();
      const agg = device ? chosen.devices.get(device) : undefined;
      if (!agg || !agg.n) continue;
      X.push([1, ...CATEGORIES.map((c) => Number(rec[`${c}_score`] ?? 0) / 100)]);
      y.push(agg.total / agg.n);
    }

    const shared = {
      success: true,
      tags,
      kpi_metric: metric,
      matched_rows: y.length,
      min_rows: minRows,
      audio_rows: audioRows.length,
      computed_at: new Date().toISOString(),
    };

    if (y.length < minRows) {
      return json({ ...shared, fitted: false, reason: "not_enough_matches" });
    }

    const out = await fitRemoteOrLocal(admin, X, y, iters, { lambda: RIDGE_LAMBDA });
    if (!out) return json({ ...shared, fitted: false, reason: "not_fittable" });

    const { fit, engine } = out;
    const beta = fit.beta;
    const baseline = y.reduce((a, b) => a + b, 0) / y.length;

    const drivers = CATEGORIES.map((c, i) => {
      const ci = fit.ci[i + 1] ?? [Number.NaN, Number.NaN];
      return {
        category: c,
        per_10_points: beta[i + 1] * 0.1,
        per_10_ci: [ci[0] * 0.1, ci[1] * 0.1] as [number, number],
        inconclusive: crossesZero(ci),
      };
    }).sort((a, b) => {
      if (a.inconclusive !== b.inconclusive) return a.inconclusive ? 1 : -1;
      return Math.abs(b.per_10_points) - Math.abs(a.per_10_points);
    });

    const conclusive = drivers.filter((d) => !d.inconclusive);

    // Mean score per axis across the training rows — computed once.
    const meanScore = CATEGORIES.map(
      (_c, i) => X.reduce((s, row) => s + row[i + 1] * 100, 0) / X.length,
    );

    const rows = audioRows.map((r) => {
      const scores = CATEGORIES.map((c) => Number(r[`${c}_score`] ?? 0));
      const predicted = [1, ...scores.map((s) => s / 100)].reduce(
        (s, v, i) => s + v * beta[i],
        0,
      );
      // Which conclusive axis contributes most to the gap from the baseline mix.
      const lead = conclusive
        .map((d) => {
          const idx = CATEGORIES.indexOf(d.category);
          return {
            category: d.category,
            contribution: (d.per_10_points / 10) * (scores[idx] - meanScore[idx]),
          };
        })
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0] ?? null;

      return {
        analysis_id: String(r.id),
        source_name: String(r.source_name ?? "Untitled"),
        created_at: String(r.created_at ?? ""),
        confidence: r.confidence === null ? null : Number(r.confidence),
        predicted,
        delta: predicted - baseline,
        delta_pct: baseline !== 0 ? ((predicted - baseline) / Math.abs(baseline)) * 100 : null,
        lead_category: lead?.category ?? null,
      };
    });

    return json({
      ...shared,
      fitted: true,
      engine,
      r2: fit.r2,
      baseline,
      drivers,
      conclusive_axes: conclusive.length,
      rows: rows.sort((a, b) => b.predicted - a.predicted),
    });
  } catch (e) {
    const status = e instanceof AuthzError ? e.status : 500;
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, status);
  }
});
