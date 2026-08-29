// Step 11a/11b — Predict SonicSIM-Users, closed loop.
//
// One org-scoped entry point with four actions:
//
//   brief       : free-text brand brief -> 1536-d vector in the shared space,
//                 a proposed bounded 6-axis target and the top contributing
//                 taxonomy tags (the CLAP dividend, made visible).
//   seed        : 3-10 exemplar records / analyses -> centroid target + vector.
//   match       : kNN over the embedding store (match_audio_profiles) seeded
//                 with the profile vector; the six sliders re-weight the ranked
//                 neighbours rather than replacing the ranking. Also returns the
//                 reach-resonance curve with a confidence band from the Welford
//                 priors in category_calibration.
//   save_cohort : persists the selected threshold point as a sonic_cohorts row
//                 (+ members, with the Step 11c holdout slice carved) so Predict
//                 Users is the front door to the Step 6 activation lane.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthzError, requireOrgMember } from "../_shared/org.ts";
import { embedCached } from "../_shared/inference.ts";
import { controlNumber } from "../_shared/control.ts";
import { holdoutPct, isHoldout } from "../_shared/holdout.ts";

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
type Category = typeof CATEGORIES[number];

/** Canonical axis descriptors — embedded once and served from embedding_cache. */
const DESCRIPTORS: Record<Category, string> = {
  emotional:
    "emotional audio: mood, feeling, intensity, catharsis, tenderness, sadness, elation, arousal",
  cognitive:
    "cognitive audio: attention, complexity, focus, information density, learning, analysis, reasoning",
  social:
    "social audio: shared listening, group belonging, community, crowds, conversation between people, togetherness",
  communication:
    "communication audio: spoken word, narration, dialogue, hosts talking, interviews, clarity of speech, language",
  contextual:
    "contextual audio: place and situation, background environment, commuting, workout, kitchen, night driving, ambience",
  artistic:
    "artistic audio: craft, production aesthetics, timbre, originality, composition, sonic artistry",
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.max(Math.sqrt(na) * Math.sqrt(nb), 1e-9);
}

function parseVector(v: unknown): number[] | null {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === "string") {
    try {
      const arr = JSON.parse(v);
      return Array.isArray(arr) ? arr.map(Number) : null;
    } catch {
      return null;
    }
  }
  return null;
}


type Scores = Record<Category, number>;

const emptyScores = (v = 0): Scores =>
  Object.fromEntries(CATEGORIES.map((c) => [c, v])) as Scores;

/**
 * Bounded axis profile from a free-text brief: rank the brief against the six
 * canonical descriptors, then spread the ranks into 20..90. A nonsense brief
 * lands near the middle instead of producing extreme confident numbers.
 */
function axesFromSimilarity(sims: Scores): Scores {
  const values = CATEGORIES.map((c) => sims[c]);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(values.length - 1, 1),
  );
  const out = emptyScores();
  for (const c of CATEGORIES) {
    const z = sd > 1e-6 ? (sims[c] - mean) / sd : 0;
    out[c] = Math.round(clamp(55 + 16 * z, 20, 90));
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const organizationId = String(body.organization_id ?? "");
    const action = String(body.action ?? "brief");
    const needsWrite = action === "save_cohort";
    const caller = await requireOrgMember(req, admin, organizationId, needsWrite);

    /* ------------------------------------------------------------------ brief */
    if (action === "brief") {
      const brief = String(body.brief ?? "").trim().slice(0, 2000);
      if (brief.length < 8) {
        return json({ success: false, error: "Describe the audience in a sentence or two." }, 400);
      }

      const vector = await embedCached(admin, `audience brief: ${brief}`);
      if (!vector) {
        return json({
          success: false,
          error: "Embedding service unavailable — try again, or set the sliders manually.",
        }, 503);
      }

      // Descriptor similarities -> bounded 6-axis proposal.
      const sims = emptyScores();
      for (const c of CATEGORIES) {
        const d = await embedCached(admin, DESCRIPTORS[c]);
        sims[c] = d ? cosine(vector, d) : 0;
      }
      const descriptorAxes = axesFromSimilarity(sims);

      // Nearest taxonomy tags + their calibration priors.
      const tagCount = await controlNumber(admin, "knn.k", 12, { min: 4, max: 40 });
      const { data: tagRows } = await admin.rpc("match_taxonomy_nodes", {
        query_embedding: vector as unknown as string,
        match_count: Math.round(tagCount),
        code_prefix: null,
      });
      const tags = ((tagRows ?? []) as {
        id: string;
        code: string;
        label: string;
        similarity: number;
      }[]).filter((t) => Number(t.similarity) > 0.05);

      const priorSum = emptyScores();
      const priorWeight = emptyScores();
      if (tags.length) {
        const { data: cal } = await admin
          .from("category_calibration")
          .select("taxonomy_node_id, category, mean_score, n")
          .in("taxonomy_node_id", tags.map((t) => t.id));
        const simById = new Map(tags.map((t) => [t.id, Number(t.similarity)]));
        for (const row of (cal ?? []) as {
          taxonomy_node_id: string;
          category: string;
          mean_score: number;
          n: number;
        }[]) {
          const c = row.category as Category;
          if (!CATEGORIES.includes(c)) continue;
          const w = (simById.get(row.taxonomy_node_id) ?? 0) * Math.min(Number(row.n) || 0, 25);
          if (w <= 0) continue;
          priorSum[c] += Number(row.mean_score) * w;
          priorWeight[c] += w;
        }
      }

      const target = emptyScores();
      for (const c of CATEGORIES) {
        const prior = priorWeight[c] > 0 ? priorSum[c] / priorWeight[c] : null;
        target[c] = Math.round(
          clamp(prior === null ? descriptorAxes[c] : 0.5 * descriptorAxes[c] + 0.5 * prior, 20, 90),
        );
      }

      return json({
        success: true,
        action,
        target,
        vector,
        tags: tags.slice(0, 12).map((t) => ({
          id: t.id,
          code: t.code,
          label: t.label,
          similarity: Number(t.similarity),
        })),
        evidence: {
          descriptor_axes: descriptorAxes,
          tags_with_priors: CATEGORIES.filter((c) => priorWeight[c] > 0).length,
        },
      });
    }

    /* ------------------------------------------------------------------- seed */
    if (action === "seed") {
      const ids = Array.isArray(body.record_ids)
        ? (body.record_ids as unknown[]).map(String).slice(0, 10)
        : [];
      if (ids.length < 3) {
        return json({ success: false, error: "Pick at least 3 exemplar records." }, 400);
      }

      const { data: recs, error } = await admin
        .from("enterprise_records")
        .select(
          "id, source_name, external_user_id, audio_url, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
        )
        .eq("organization_id", organizationId)
        .in("id", ids);
      if (error) throw new Error(error.message);
      const rows = (recs ?? []) as Record<string, unknown>[];
      if (rows.length < 3) {
        return json({ success: false, error: "Fewer than 3 of those records are readable." }, 400);
      }

      const target = emptyScores();
      for (const c of CATEGORIES) {
        const vals = rows
          .map((r) => Number(r[`${c}_score`] ?? Number.NaN))
          .filter((n) => Number.isFinite(n));
        target[c] = vals.length
          ? Math.round(clamp(vals.reduce((a, b) => a + b, 0) / vals.length, 0, 100))
          : 50;
      }

      // Centroid vector: reuse the audio profile embeddings of matching sources.
      const names = rows.map((r) => String(r.source_name ?? "")).filter(Boolean);
      let vector: number[] | null = null;
      if (names.length) {
        const { data: srcs } = await admin
          .from("audio_sources")
          .select("profile_embedding")
          .in("name", names)
          .not("profile_embedding", "is", null)
          .limit(10);
        const vecs = ((srcs ?? []) as { profile_embedding: unknown }[])
          .map((s) => parseVector(s.profile_embedding))
          .filter((v): v is number[] => !!v && v.length > 0);
        if (vecs.length) {
          const dim = vecs[0].length;
          const acc = new Array(dim).fill(0);
          for (const v of vecs) for (let i = 0; i < dim; i++) acc[i] += v[i] ?? 0;
          const norm = Math.sqrt(acc.reduce((s, x) => s + x * x, 0)) || 1;
          vector = acc.map((x) => x / norm);
        }
      }
      if (!vector) {
        // Fall back to a descriptor of the centroid profile so matching still
        // runs in the full space rather than on six numbers.
        vector = await embedCached(
          admin,
          `audience centroid profile: ${
            CATEGORIES.map((c) => `${c}=${target[c]}`).join(" ")
          }`,
        );
      }

      return json({ success: true, action, target, vector, seeded_from: rows.length });
    }

    /* ------------------------------------------------------------------ match */
    if (action === "match") {
      const vector = parseVector(body.vector);
      const target = { ...emptyScores(50), ...(body.target as Partial<Scores> ?? {}) } as Scores;
      const weights = { ...emptyScores(1), ...(body.weights as Partial<Scores> ?? {}) } as Scores;

      const k = Math.round(await controlNumber(admin, "predict.knn_k", 300, { min: 25, max: 2000 }));
      const defaultFloor = await controlNumber(admin, "predict.min_similarity", 0.55, {
        min: 0,
        max: 1,
      });

      let neighbours: {
        key: string;
        label: string;
        knn_similarity: number;
        scores: Scores;
      }[] = [];

      if (vector && vector.length) {
        const { data, error } = await admin.rpc("match_audio_profiles", {
          query_embedding: vector as unknown as string,
          match_count: k,
          exclude_id: null,
        });
        if (error) throw new Error(`kNN failed: ${error.message}`);
        neighbours = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
          key: String(r.id),
          label: String(r.name ?? "").slice(0, 160) || String(r.id).slice(0, 8),
          knn_similarity: Number(r.similarity ?? 0),
          scores: Object.fromEntries(
            CATEGORIES.map((c) => [c, Number(r[`${c}_score`] ?? 0)]),
          ) as Scores,
        }));
      }

      // Slider re-weighting: constrain the kNN ranking, never replace it.
      const wSum = CATEGORIES.reduce((s, c) => s + Math.max(0, weights[c]), 0) || 1;
      const ranked = neighbours
        .map((n) => {
          let dist = 0;
          for (const c of CATEGORIES) {
            dist += (Math.max(0, weights[c]) / wSum) * Math.abs(n.scores[c] - target[c]) / 100;
          }
          const axisFit = clamp(1 - dist, 0, 1);
          return {
            ...n,
            axis_fit: axisFit,
            score: 0.65 * clamp(n.knn_similarity, 0, 1) + 0.35 * axisFit,
          };
        })
        .sort((a, b) => b.score - a.score);

      // Confidence band from the Welford priors' std.
      const { data: calRows } = await admin
        .from("category_calibration")
        .select("category, n, m2")
        .limit(5000);
      const stdByCat = emptyScores();
      const stdAcc = new Map<string, { s: number; n: number }>();
      for (const r of (calRows ?? []) as { category: string; n: number; m2: number }[]) {
        if (!CATEGORIES.includes(r.category as Category)) continue;
        const n = Number(r.n) || 0;
        if (n < 2) continue;
        const sd = Math.sqrt(Math.max(Number(r.m2), 0) / (n - 1));
        const cur = stdAcc.get(r.category) ?? { s: 0, n: 0 };
        cur.s += sd;
        cur.n += 1;
        stdAcc.set(r.category, cur);
      }
      for (const c of CATEGORIES) {
        const a = stdAcc.get(c);
        stdByCat[c] = a && a.n ? a.s / a.n : 0;
      }
      const meanStd = CATEGORIES.reduce((s, c) => s + stdByCat[c], 0) / CATEGORIES.length;
      /** Band width as a share of matched count: priors' std / 100, capped. */
      const bandShare = clamp(meanStd / 100, 0.03, 0.4);

      const curve: {
        threshold: number;
        matched: number;
        low: number;
        high: number;
        mean_similarity: number;
      }[] = [];
      for (let t = 0.4; t <= 0.951; t += 0.05) {
        const threshold = Math.round(t * 100) / 100;
        const hits = ranked.filter((r) => r.knn_similarity >= threshold);
        const meanSim = hits.length
          ? hits.reduce((s, r) => s + r.knn_similarity, 0) / hits.length
          : 0;
        curve.push({
          threshold,
          matched: hits.length,
          low: Math.max(0, Math.round(hits.length * (1 - bandShare))),
          high: Math.round(hits.length * (1 + bandShare)),
          mean_similarity: Number(meanSim.toFixed(4)),
        });
      }

      return json({
        success: true,
        action,
        knn_k: k,
        default_threshold: defaultFloor,
        retrieved: neighbours.length,
        band_share: bandShare,
        category_std: stdByCat,
        curve,
        matches: ranked.slice(0, 100).map((r) => ({
          key: r.key,
          label: r.label,
          knn_similarity: Number(r.knn_similarity.toFixed(4)),
          axis_fit: Number(r.axis_fit.toFixed(4)),
          score: Number(r.score.toFixed(4)),
          scores: r.scores,
        })),
      });
    }

    /* ------------------------------------------------------------- save_cohort */
    if (action === "save_cohort") {
      const vector = parseVector(body.vector);
      const threshold = clamp(Number(body.threshold ?? 0.6), 0, 1);
      const name = String(body.name ?? "").trim().slice(0, 120) || "Predicted look-alikes";
      const keys = Array.isArray(body.member_keys)
        ? (body.member_keys as unknown[]).map(String).slice(0, 50_000)
        : [];
      const target = { ...emptyScores(50), ...(body.target as Partial<Scores> ?? {}) } as Scores;
      const weights = { ...emptyScores(1), ...(body.weights as Partial<Scores> ?? {}) } as Scores;

      if (!keys.length) {
        return json({ success: false, error: "No matches at this threshold to save." }, 400);
      }

      const pctHoldout = await holdoutPct(admin);

      const slug = `predict-${organizationId.slice(0, 8)}-${Date.now().toString(36)}`;
      const narrative = `Seeded from ${
        body.brief ? "a brand brief" : "exemplar records"
      }; kNN in the shared embedding space, sliders re-weighted; similarity floor ${
        threshold.toFixed(2)
      }.`;

      const { data: cohort, error: cohortErr } = await admin
        .from("sonic_cohorts")
        .insert({
          slug,
          name,
          description: `Predict-Users run · threshold ${threshold.toFixed(2)}`,
          centroid: vector && vector.length ? (vector as unknown as string) : null,
          member_count: keys.length,
          narrative,
          export_eligible: keys.length >= 1000,
        })
        .select("id, slug, member_count, export_eligible")
        .single();
      if (cohortErr) throw new Error(`cohort insert failed: ${cohortErr.message}`);

      const cohortId = (cohort as { id: string }).id;
      let holdout = 0;
      const CHUNK = 500;
      for (let i = 0; i < keys.length; i += CHUNK) {
        const rows = keys.slice(i, i + CHUNK).map((key) => {
          const inHoldout = isHoldout(slug, key, pctHoldout);
          if (inHoldout) holdout++;
          return { cohort_id: cohortId, subject_key: key, similarity: null, holdout: inHoldout };
        });
        const { error } = await admin.from("sonic_cohort_members").upsert(rows, {
          onConflict: "cohort_id,subject_key",
        });
        if (error) throw new Error(`member write failed: ${error.message}`);
      }

      await admin.from("prediction_runs").insert({
        organization_id: organizationId,
        kind: "users",
        params: {
          threshold,
          target,
          brief: body.brief ? String(body.brief).slice(0, 500) : null,
          cohort_slug: slug,
          seeded: body.brief ? "brief" : "records",
        },
        weights,
        result: {
          matched: keys.length,
          holdout,
          exposed: keys.length - holdout,
          cohort_slug: slug,
          export_eligible: keys.length >= 1000,
        },
        status: "complete",
        created_by: caller.userId,
      });

      return json({
        success: true,
        action,
        cohort_slug: slug,
        member_count: keys.length,
        holdout,
        exposed: keys.length - holdout,
        holdout_pct: holdoutPct,
        export_eligible: keys.length >= 1000,
      });
    }

    return json({ success: false, error: `unknown action "${action}"` }, 400);
  } catch (e) {
    const status = e instanceof AuthzError ? e.status : 500;
    console.error("predict-users failed:", (e as Error).message);
    return json({ success: false, error: (e as Error).message }, status);
  }
});
