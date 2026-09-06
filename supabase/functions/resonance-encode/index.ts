/**
 * resonance-encode — backend for the on-device audio encoder (Batch E, item 3).
 *
 * The browser decodes and measures the file locally, then posts only the
 * measured features here. This function is the authority for what those numbers
 * mean: it clamps the measurements, re-derives the six category scores and the
 * confidence, loads the active, versioned Resonance definition from
 * `public.resonance_definitions`, computes the match, and optionally stores the
 * run in `public.resonance_runs` (as a private run or a public worked example).
 *
 * No model calls, no AI credits, no audio upload — pure arithmetic on measured
 * signal features, so every published number can be recomputed later.
 *
 * Admin-only until `nextlevel.on_device_enabled` is flipped in the Control Room;
 * after that any signed-in user may score their own measurements.
 *
 * Actions: score | list
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { AuthzError, requireAdmin } from "../_shared/admin.ts";
import { controlBoolean } from "../_shared/control.ts";
import {
  AXES,
  DEFAULT_DEFINITION,
  axesFromFeatures,
  featureConfidence,
  resonancePoint,
  sanitizeFeatures,
  type ResonanceDefinition,
} from "../_shared/audioFingerprint.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const BodySchema = z.object({
  action: z.enum(["score", "list"]).default("score"),
  features: z.record(z.string(), z.number()).optional(),
  audience: z.record(z.string(), z.number()).optional(),
  label: z.string().max(200).optional(),
  persist: z.boolean().optional(),
  public_example: z.boolean().optional(),
  definition_version: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/** Resolve the caller: admin always, any signed-in user once the flag is on. */
async function resolveCaller(
  req: Request,
  admin: ReturnType<typeof createClient>,
): Promise<{ userId: string | null; isAdmin: boolean }> {
  try {
    const caller = await requireAdmin(req, admin);
    return { userId: caller.userId, isAdmin: true };
  } catch (e) {
    const open = await controlBoolean(admin, "nextlevel.on_device_enabled", false);
    if (!open) throw e;

    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) throw new AuthzError("Please sign in to run a match.", 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${bearer}` } } },
    );
    const { data, error } = await userClient.auth.getUser();
    if (error || !data.user) throw new AuthzError("Your session has expired.", 401);
    return { userId: data.user.id, isAdmin: false };
  }
}

async function loadDefinition(
  admin: ReturnType<typeof createClient>,
  version?: string,
): Promise<ResonanceDefinition> {
  let q = admin
    .from("resonance_definitions")
    .select("version, weights, distance_shape")
    .limit(1);
  q = version ? q.eq("version", version) : q.eq("is_active", true);
  const { data, error } = await q.maybeSingle();
  if (error || !data) return DEFAULT_DEFINITION;
  const weights =
    data.weights && typeof data.weights === "object"
      ? (data.weights as Record<string, number>)
      : DEFAULT_DEFINITION.weights;
  return {
    version: String(data.version ?? DEFAULT_DEFINITION.version),
    weights,
    distance_shape: String(data.distance_shape ?? "euclidean"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return json({ success: false, error: parsed.error.flatten().fieldErrors }, 400);
    }
    const body = parsed.data;
    const caller = await resolveCaller(req, admin);

    if (body.action === "list") {
      let q = admin
        .from("resonance_runs")
        .select(
          "id, label, engine, scores, audience, resonance_score, weakest_axis, confidence, definition_version, is_public_example, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(body.limit ?? 20);
      if (!caller.isAdmin) q = q.eq("created_by", caller.userId);
      const { data, error } = await q;
      if (error) throw error;
      return json({ success: true, runs: data ?? [] });
    }

    if (!body.features) {
      return json({ success: false, error: "No measurements were sent." }, 400);
    }

    const features = sanitizeFeatures(body.features);
    if (features.activity <= 0 || features.durationSec <= 0) {
      return json(
        { success: false, error: "That file measured as silent, so there is nothing to match." },
        422,
      );
    }

    const scores = axesFromFeatures(features);
    const confidence = featureConfidence(features);
    const definition = await loadDefinition(admin, body.definition_version);

    const audience = {} as Record<string, number>;
    for (const axis of AXES) {
      const n = Number(body.audience?.[axis]);
      audience[axis] = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50;
    }

    const match = resonancePoint(scores, audience, definition);

    let runId: string | null = null;
    if (body.persist) {
      const isPublic = Boolean(body.public_example) && caller.isAdmin;
      const { data, error } = await admin
        .from("resonance_runs")
        .insert({
          created_by: caller.userId,
          label: body.label?.trim() || null,
          engine: "on-device-audio",
          features,
          scores,
          audience,
          resonance_score: match.score,
          weakest_axis: match.weakestAxis,
          confidence,
          definition_version: definition.version,
          is_public_example: isPublic,
        })
        .select("id")
        .single();
      if (error) {
        // A storage failure must not silently look like a successful save.
        return json(
          {
            success: true,
            saved: false,
            save_error: "The match ran, but we couldn't save it as an example.",
            scores,
            confidence,
            features,
            match,
            definition_version: definition.version,
          },
          200,
        );
      }
      runId = data.id as string;
    }

    return json({
      success: true,
      saved: Boolean(runId),
      run_id: runId,
      scores,
      confidence,
      features,
      match,
      definition_version: definition.version,
    });
  } catch (e) {
    if (e instanceof AuthzError) return json({ success: false, error: e.message }, e.status);
    console.error("resonance-encode failed:", e);
    return json({ success: false, error: "Something went wrong running the match." }, 500);
  }
});
