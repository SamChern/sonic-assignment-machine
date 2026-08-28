// Predict SonicSIM-Outcomes — Step 11c: honest outcomes.
//
// Fits the chosen KPI against the 6 semantic categories with ridge regression
// and bootstrap confidence intervals. Three rules:
//   1. the fit runs on the EC2 semantic worker when it exposes /fit_ridge,
//      otherwise in-process with the identical estimator;
//   2. a sample-sufficiency gate (control_registry `predict.min_kpi_rows`)
//      refuses category-level claims below the threshold;
//   3. any effect whose CI includes zero is returned flagged as "not yet
//      distinguishable" so the UI can grey it out rather than invent a claim.
//
// Also returns per-axis counterfactual deltas (predicted KPI change for +10
// points on one axis, with its interval) so the regression becomes a planning
// instrument, and any measured activation lift priors for the same KPI.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthzError, requireOrgMember } from "../_shared/org.ts";
import { controlNumber } from "../_shared/control.ts";
import { crossesZero, fitRidgeWithBootstrap, type RidgeFit } from "../_shared/ridge.ts";
import { getSemanticSvcConfig } from "../_shared/semanticSvc.ts";

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

const LAMBDA = 1e-2;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Try the EC2 worker first; fall back to the in-process estimator. */
async function fitRemoteOrLocal(
  // deno-lint-ignore no-explicit-any
  admin: any,
  X: number[][],
  y: number[],
  iters: number,
): Promise<{ fit: RidgeFit; engine: "ec2" | "edge" }> {
  const cfg = await getSemanticSvcConfig(admin);
  if (cfg) {
    try {
      const res = await fetch(`${cfg.url}/fit_ridge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.token}`,
        },
        body: JSON.stringify({ X, y, lambda: LAMBDA, bootstrap_iters: iters }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const b = await res.json();
        if (Array.isArray(b?.beta) && Array.isArray(b?.ci)) {
          return {
            fit: {
              beta: b.beta.map(Number),
              ci: b.ci.map((c: number[]) => [Number(c[0]), Number(c[1])] as [number, number]),
              r2: Number(b.r2 ?? 0),
              n: X.length,
              lambda: LAMBDA,
              bootstrap_iters: Number(b.bootstrap_iters ?? iters),
            },
            engine: "ec2",
          };
        }
      }
    } catch (e) {
      console.warn("ridge fit on EC2 unavailable:", e instanceof Error ? e.message : e);
    }
  }
  const fit = fitRidgeWithBootstrap(X, y, { lambda: LAMBDA, iters });
  if (!fit) throw new Error("Model could not be fitted — the score columns are collinear.");
  return { fit, engine: "edge" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const organizationId = String(body.organization_id ?? "");
    const caller = await requireOrgMember(req, admin, organizationId, true);

    const kpi = String(body.kpi ?? "");
    if (!kpi) throw new AuthzError("kpi is required", 400);
    const datasetId = body.dataset_id ? String(body.dataset_id) : null;
    const kpiSource = body.kpi_source === "pixel" ? "pixel" : "upload";

    const minRows = Math.round(
      await controlNumber(admin, "predict.min_kpi_rows", 24, { min: 8, max: 500 }),
    );
    const iters = Math.round(
      await controlNumber(admin, "predict.bootstrap_iters", 200, { min: 50, max: 2000 }),
    );

    let recQuery = admin
      .from("enterprise_records")
      .select(
        "id, external_user_id, source_name, kpi, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
      )
      .eq("organization_id", organizationId)
      .eq("analysis_status", "scored")
      .limit(5000);
    if (datasetId) recQuery = recQuery.eq("dataset_id", datasetId);

    const { data: records, error: recErr } = await recQuery;
    if (recErr) throw new Error(recErr.message);

    // KPI value per record.
    const targets = new Map<string, number>();
    if (kpiSource === "pixel") {
      const { data: events, error: evErr } = await admin
        .from("pixel_events")
        .select("external_user_id, kpi_value")
        .eq("organization_id", organizationId)
        .eq("kpi_metric", kpi)
        .not("kpi_value", "is", null)
        .limit(20000);
      if (evErr) throw new Error(evErr.message);
      const sums = new Map<string, { total: number; n: number }>();
      for (const ev of events ?? []) {
        const key = (ev.external_user_id ?? "").trim();
        if (!key) continue;
        const cur = sums.get(key) ?? { total: 0, n: 0 };
        cur.total += Number(ev.kpi_value);
        cur.n += 1;
        sums.set(key, cur);
      }
      for (const rec of records ?? []) {
        const key = (rec.external_user_id ?? "").trim();
        const agg = key ? sums.get(key) : undefined;
        if (agg && agg.n) targets.set(rec.id, agg.total / agg.n);
      }
    } else {
      for (const rec of records ?? []) {
        const raw = (rec.kpi as Record<string, unknown> | null)?.[kpi];
        const n = Number(raw);
        if (Number.isFinite(n)) targets.set(rec.id, n);
      }
    }

    const training = (records ?? []).filter((r) => targets.has(r.id));

    // ---- sample-sufficiency gate -------------------------------------------
    if (training.length < minRows) {
      return new Response(
        JSON.stringify({
          success: false,
          gated: true,
          matched_rows: training.length,
          min_rows: minRows,
          error:
            `Not enough evidence for category-level claims — ${training.length} of the ${minRows} scored rows with a ${kpi} value required. Attach more KPI values, or capture live events with the tracking tag.`,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Design matrix: intercept + 6 categories scaled to 0-1.
    const X = training.map((r) => [
      1,
      ...CATEGORIES.map((c) => Number(r[`${c}_score`] ?? 0) / 100),
    ]);
    const y = training.map((r) => targets.get(r.id)!);

    const { fit, engine } = await fitRemoteOrLocal(admin, X, y, iters);
    const beta = fit.beta;

    const predict = (row: number[]) => row.reduce((s, v, i) => s + v * beta[i], 0);
    const meanY = y.reduce((a, b) => a + b, 0) / y.length;

    const drivers = CATEGORIES.map((c, i) => {
      const ci = fit.ci[i + 1] ?? [Number.NaN, Number.NaN];
      const inconclusive = crossesZero(ci);
      return {
        category: c,
        coefficient: beta[i + 1],
        per_10_points: beta[i + 1] * 0.1,
        /** +10 point counterfactual interval on the same scale. */
        per_10_ci: [ci[0] * 0.1, ci[1] * 0.1] as [number, number],
        ci_low: ci[0],
        ci_high: ci[1],
        inconclusive,
      };
    }).sort((a, b) => {
      if (a.inconclusive !== b.inconclusive) return a.inconclusive ? 1 : -1;
      return Math.abs(b.coefficient) - Math.abs(a.coefficient);
    });

    const ranked = (records ?? [])
      .map((r) => ({
        record_id: r.id,
        label: r.source_name ?? r.external_user_id ?? r.id.slice(0, 8),
        predicted: predict([1, ...CATEGORIES.map((c) => Number(r[`${c}_score`] ?? 0) / 100)]),
        actual: targets.get(r.id) ?? null,
      }))
      .sort((a, b) => b.predicted - a.predicted)
      .slice(0, 25);

    // Measured activation lift priors for this KPI, when the loop has closed.
    const { data: priors } = await admin
      .from("category_outcome_priors")
      .select("category, lift, ci_low, ci_high, exposed_n, holdout_n, cohort_slug, updated_at")
      .eq("organization_id", organizationId)
      .eq("kpi", kpi)
      .order("updated_at", { ascending: false })
      .limit(24);

    const mean_scores = Object.fromEntries(
      CATEGORIES.map((c) => [
        c,
        training.reduce((s, r) => s + Number(r[`${c}_score`] ?? 0), 0) / training.length,
      ]),
    );

    const result = {
      kpi,
      kpi_source: kpiSource,
      engine,
      matched_rows: training.length,
      min_rows: minRows,
      bootstrap_iters: fit.bootstrap_iters,
      intercept: beta[0],
      r2: fit.r2,
      mean_actual: meanY,
      mean_scores,
      drivers,
      conclusive_count: drivers.filter((d) => !d.inconclusive).length,
      lift_priors: priors ?? [],
      top_predicted: ranked,
    };

    await admin.from("prediction_runs").insert({
      organization_id: organizationId,
      kind: "outcomes",
      kpi,
      params: { dataset_id: datasetId, kpi_source: kpiSource, engine, min_rows: minRows },
      weights: Object.fromEntries(drivers.map((d) => [d.category, d.coefficient])),
      result,
      status: "complete",
      created_by: caller.userId,
    });

    return json({ success: true, ...result });
  } catch (e) {
    const status = e instanceof AuthzError ? e.status : 500;
    console.error("predict-outcomes failed:", (e as Error).message);
    return json({ success: false, error: (e as Error).message }, status);
  }
});
