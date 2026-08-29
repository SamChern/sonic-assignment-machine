// Step 11c — activation lift: exposed vs. holdout, then recalibrate.
//
// Every activation export withholds a deterministic ~10% holdout slice
// (`sonic_cohort_members.holdout`). Pixel events flowing into public.pixel_events
// therefore split into exposed vs. holdout, so this endpoint reports *lift*
// rather than correlation, and writes per-axis lift back into
// public.category_outcome_priors — closing the loop
// score -> activate -> measure -> recalibrate.
//
// Subject keys never leave the server: only counts, means and lift are returned.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthzError, requireOrgMember } from "../_shared/org.ts";
import { toActivationEid } from "../_shared/activationEid.ts";
import { crossesZero } from "../_shared/ridge.ts";
import { fitRemoteOrLocal } from "../_shared/ridgeRemote.ts";

import { controlNumber } from "../_shared/control.ts";

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

const PAGE = 1000;
const MAX_MEMBERS = 20_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Welch two-sample 95% interval for the difference of means. */
function diffCI(a: number[], b: number[]): [number, number] {
  if (a.length < 2 || b.length < 2) return [Number.NaN, Number.NaN];
  const va = a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1);
  const vb = b.reduce((s, x) => s + (x - mean(b)) ** 2, 0) / (b.length - 1);
  const se = Math.sqrt(va / a.length + vb / b.length);
  const d = mean(a) - mean(b);
  return [d - 1.96 * se, d + 1.96 * se];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const organizationId = String(body.organization_id ?? "");
    await requireOrgMember(req, admin, organizationId, true);

    const cohortSlug = String(body.cohort_slug ?? "").trim();
    const kpi = String(body.kpi ?? "").trim();
    if (!cohortSlug || !kpi) {
      return json({ success: false, error: "cohort_slug and kpi are required" }, 400);
    }

    const { data: cohort } = await admin
      .from("sonic_cohorts")
      .select("id, slug, name, member_count")
      .eq("slug", cohortSlug)
      .maybeSingle();
    if (!cohort) return json({ success: false, error: "cohort not found" }, 404);
    const c = cohort as { id: string; slug: string; name: string; member_count: number };

    // ---- members, split by holdout flag (keys stay server-side) -------------
    const exposedEids = new Map<string, string>();
    const holdoutEids = new Map<string, string>();
    for (let offset = 0; offset < MAX_MEMBERS; offset += PAGE) {
      const { data, error } = await admin
        .from("sonic_cohort_members")
        .select("subject_key, holdout")
        .eq("cohort_id", c.id)
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`member read failed: ${error.message}`);
      const rows = (data ?? []) as { subject_key: string; holdout: boolean }[];
      for (const r of rows) {
        const eid = await toActivationEid(r.subject_key);
        if (!eid) continue;
        (r.holdout ? holdoutEids : exposedEids).set(eid, r.subject_key);
      }
      if (rows.length < PAGE) break;
    }

    if (!holdoutEids.size) {
      return json({
        success: false,
        error:
          "This cohort has no holdout slice yet — rebuild or save a run with a holdout percentage above zero to measure lift.",
        exposed: exposedEids.size,
        holdout: 0,
      }, 409);
    }

    // ---- pixel events, matched to a slice ----------------------------------
    const { data: events, error: evErr } = await admin
      .from("pixel_events")
      .select("external_user_id, kpi_value, gclid, utm_campaign")
      .eq("organization_id", organizationId)
      .eq("kpi_metric", kpi)
      .not("kpi_value", "is", null)
      .limit(50_000);
    if (evErr) throw new Error(evErr.message);

    const exposedVals: number[] = [];
    const holdoutVals: number[] = [];
    const matchedKeys: { key: string; value: number; exposed: boolean }[] = [];
    for (const ev of (events ?? []) as {
      external_user_id: string | null;
      kpi_value: number;
    }[]) {
      const raw = (ev.external_user_id ?? "").trim();
      if (!raw) continue;
      const eid = await toActivationEid(raw);
      if (!eid) continue;
      const value = Number(ev.kpi_value);
      if (!Number.isFinite(value)) continue;
      if (exposedEids.has(eid)) {
        exposedVals.push(value);
        matchedKeys.push({ key: exposedEids.get(eid)!, value, exposed: true });
      } else if (holdoutEids.has(eid)) {
        holdoutVals.push(value);
        matchedKeys.push({ key: holdoutEids.get(eid)!, value, exposed: false });
      }
    }

    const exposedMean = mean(exposedVals);
    const holdoutMean = mean(holdoutVals);
    const absLift = exposedMean - holdoutMean;
    const relLift = holdoutMean !== 0 ? absLift / Math.abs(holdoutMean) : null;
    const [ciLow, ciHigh] = diffCI(exposedVals, holdoutVals);

    const measurable = exposedVals.length >= 5 && holdoutVals.length >= 5;

    // ---- per-axis lift: ridge of KPI on the subjects' six axes --------------
    const perAxis: {
      category: string;
      lift: number;
      ci_low: number;
      ci_high: number;
      inconclusive: boolean;
    }[] = [];
    let fitEngine: "ec2" | "edge" | null = null;


    if (measurable && matchedKeys.length >= 12) {
      const keys = matchedKeys.map((m) => m.key).slice(0, 5000);
      const scoresByKey = new Map<string, Record<string, number>>();
      for (let i = 0; i < keys.length; i += 500) {
        const slice = keys.slice(i, i + 500);
        const { data: ids } = await admin
          .from("intuizi_identifiers")
          .select("primary_identifier, audio_source_id")
          .in("primary_identifier", slice)
          .not("audio_source_id", "is", null);
        const rows = (ids ?? []) as { primary_identifier: string; audio_source_id: string }[];
        if (!rows.length) continue;
        const { data: analyses } = await admin
          .from("source_analyses")
          .select(
            "audio_source_id, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
          )
          .in("audio_source_id", rows.map((r) => r.audio_source_id));
        const byAudio = new Map(
          ((analyses ?? []) as Record<string, unknown>[]).map((a) => [
            String(a.audio_source_id),
            a as Record<string, number>,
          ]),
        );
        for (const r of rows) {
          const a = byAudio.get(r.audio_source_id);
          if (a) scoresByKey.set(r.primary_identifier, a);
        }
      }

      const X: number[][] = [];
      const yv: number[] = [];
      for (const m of matchedKeys) {
        const s = scoresByKey.get(m.key);
        if (!s) continue;
        X.push([
          1,
          m.exposed ? 1 : 0,
          ...CATEGORIES.map((cat) => Number(s[`${cat}_score`] ?? 0) / 100),
        ]);
        yv.push(m.value);
      }

      if (X.length >= 12) {
        const iters = Math.round(
          await controlNumber(admin, "predict.bootstrap_iters", 200, { min: 50, max: 2000 }),
        );
        // Step 11c: the per-axis fits run on the EC2 semantic worker when it is
        // reachable, with the identical in-process estimator as the fallback.
        const remote = await fitRemoteOrLocal(admin, X, yv, iters);
        const fit = remote?.fit ?? null;
        fitEngine = remote?.engine ?? null;

        if (fit) {
          CATEGORIES.forEach((cat, i) => {
            const ci = fit.ci[i + 2] ?? [Number.NaN, Number.NaN];
            perAxis.push({
              category: cat,
              lift: fit.beta[i + 2] * (absLift >= 0 ? 1 : 1),
              ci_low: ci[0],
              ci_high: ci[1],
              inconclusive: crossesZero(ci),
            });
          });
        }
      }
    }

    // ---- write outcome priors back (only conclusive axes) -------------------
    let written = 0;
    for (const a of perAxis) {
      if (a.inconclusive) continue;
      const { error } = await admin.from("category_outcome_priors").upsert(
        {
          organization_id: organizationId,
          cohort_slug: c.slug,
          kpi,
          category: a.category,
          lift: a.lift,
          ci_low: a.ci_low,
          ci_high: a.ci_high,
          exposed_n: exposedVals.length,
          holdout_n: holdoutVals.length,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,cohort_slug,kpi,category" },
      );
      if (!error) written++;
    }

    const out = {
      success: true,
      cohort: { slug: c.slug, name: c.name, member_count: c.member_count },
      kpi,
      exposed_members: exposedEids.size,
      holdout_members: holdoutEids.size,
      exposed_events: exposedVals.length,
      holdout_events: holdoutVals.length,
      exposed_mean: exposedMean,
      holdout_mean: holdoutMean,
      absolute_lift: absLift,
      relative_lift: relLift,
      lift_ci: [ciLow, ciHigh],
      measurable,
      per_axis: perAxis,
      priors_written: written,
      note: measurable
        ? undefined
        : "Needs at least 5 KPI events in each slice before lift is reportable.",
    };
    console.log(
      JSON.stringify({
        evt: "activation_lift",
        cohort: c.slug,
        kpi,
        exposed: exposedVals.length,
        holdout: holdoutVals.length,
        measurable,
      }),
    );
    return json(out);
  } catch (e) {
    const status = e instanceof AuthzError ? e.status : 500;
    console.error("activation-lift failed:", (e as Error).message);
    return json({ success: false, error: (e as Error).message }, status);
  }
});
