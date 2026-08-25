// Predict SonicSIM-Outcomes: fits a ridge regression from the 6 semantic
// category scores to a chosen KPI, using either KPI values uploaded with the
// dataset or KPI values captured by the organization's tracking tag.
//
// Returns per-category coefficients (which category moves the KPI), model fit,
// and a ranked list of the records the model predicts will perform best.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthzError, requireOrgMember } from "../_shared/org.ts";

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

const RIDGE = 1e-3;

/** Solves (XᵗX + λI)β = Xᵗy by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i][i]);
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
    if (training.length < 12) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            `Not enough matched rows to fit a model — found ${training.length}, need at least 12 records that have both semantic scores and a ${kpi} value.`,
          matched_rows: training.length,
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
    const p = 7;

    const xtx = Array.from({ length: p }, (_, i) =>
      Array.from({ length: p }, (_, j) =>
        X.reduce((s, row) => s + row[i] * row[j], 0) + (i === j && i > 0 ? RIDGE * X.length : 0),
      ),
    );
    const xty = Array.from({ length: p }, (_, i) => X.reduce((s, row, k) => s + row[i] * y[k], 0));

    const beta = solve(xtx, xty);
    if (!beta) throw new Error("Model could not be fitted — the score columns are collinear.");

    const predict = (row: number[]) => row.reduce((s, v, i) => s + v * beta[i], 0);
    const meanY = y.reduce((a, b) => a + b, 0) / y.length;
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < y.length; i++) {
      const pred = predict(X[i]);
      ssRes += (y[i] - pred) ** 2;
      ssTot += (y[i] - meanY) ** 2;
    }
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    const drivers = CATEGORIES.map((c, i) => ({
      category: c,
      coefficient: beta[i + 1],
      /** Predicted KPI change for a +10 point move in this category. */
      per_10_points: beta[i + 1] * 0.1,
    })).sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient));

    const ranked = (records ?? [])
      .map((r) => ({
        record_id: r.id,
        label: r.source_name ?? r.external_user_id ?? r.id.slice(0, 8),
        predicted: predict([1, ...CATEGORIES.map((c) => Number(r[`${c}_score`] ?? 0) / 100)]),
        actual: targets.get(r.id) ?? null,
      }))
      .sort((a, b) => b.predicted - a.predicted)
      .slice(0, 25);

    const result = {
      kpi,
      kpi_source: kpiSource,
      matched_rows: training.length,
      intercept: beta[0],
      r2,
      mean_actual: meanY,
      drivers,
      top_predicted: ranked,
    };

    await admin.from("prediction_runs").insert({
      organization_id: organizationId,
      kind: "outcomes",
      kpi,
      params: { dataset_id: datasetId, kpi_source: kpiSource },
      weights: Object.fromEntries(drivers.map((d) => [d.category, d.coefficient])),
      result,
      status: "complete",
      created_by: caller.userId,
    });

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const status = e instanceof AuthzError ? e.status : 500;
    console.error("predict-outcomes failed:", (e as Error).message);
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
