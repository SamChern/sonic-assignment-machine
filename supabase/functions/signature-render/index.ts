/**
 * signature-render — Step 15.
 *
 * Takes a six-axis vector (+ optional tags), derives a stable subject hash,
 * and returns the cached signature if one exists. Otherwise it maps the vector
 * to synthesis parameters, renders a 3.5s WAV, stores it, assigns the nearest
 * of the twelve Ensemble archetypes, and caches the row.
 *
 * Idempotent by hash: same vector + tags => same audio bytes, same archetype.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import {
  archetypeDistance,
  encodeWav,
  renderSignature,
  SIGNATURE_AXES,
  subjectHash,
  vectorToParams,
  type SignatureVector,
} from "../_shared/signature.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const BodySchema = z.object({
  vector: z.object({
    emotional: z.number(),
    cognitive: z.number(),
    social: z.number(),
    communication: z.number(),
    contextual: z.number(),
    artistic: z.number(),
  }),
  tags: z.array(z.string()).max(64).optional(),
  subject_ref: z.string().max(200).optional(),
  force: z.boolean().optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Signatures are deterministic, public artifacts (same vector => same audio),
    // so anonymous callers are allowed. A token, when present, is still validated
    // so a bad/expired session is reported instead of silently ignored.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader) {
      const asUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      await asUser.auth.getUser();
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({ success: false, error: parsed.error.flatten().fieldErrors }, 400);
    }
    const { vector, tags = [], subject_ref, force } = parsed.data;
    const vec = vector as SignatureVector;

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const hash = await subjectHash(vec, tags);

    if (!force) {
      const { data: cached } = await admin
        .from("sonic_signatures")
        .select("*")
        .eq("subject_hash", hash)
        .maybeSingle();
      if (cached?.audio_path) {
        const { data: signed } = await admin.storage
          .from("signatures")
          .createSignedUrl(cached.audio_path, 60 * 60);
        return json({
          success: true,
          cached: true,
          signature: { ...cached, audio_url: signed?.signedUrl ?? null },
        });
      }
    }

    // Render deterministically.
    const params = vectorToParams(vec, tags);
    const samples = renderSignature(params, hash);
    const wav = encodeWav(samples);

    const path = `v1/${hash}.wav`;
    const { error: upErr } = await admin.storage
      .from("signatures")
      .upload(path, wav, { contentType: "audio/wav", upsert: true });
    if (upErr) return json({ success: false, error: `storage: ${upErr.message}` }, 500);

    // Nearest archetype centroid.
    const { data: archetypes, error: archErr } = await admin
      .from("sonic_archetypes")
      .select("slug, centroid");
    if (archErr) return json({ success: false, error: archErr.message }, 500);

    let bestSlug: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const a of archetypes ?? []) {
      const d = archetypeDistance(vec, (a.centroid ?? {}) as Partial<SignatureVector>);
      if (d < bestDistance) {
        bestDistance = d;
        bestSlug = a.slug;
      }
    }

    const row = {
      subject_hash: hash,
      subject_ref: subject_ref ?? null,
      vector: Object.fromEntries(SIGNATURE_AXES.map((a) => [a, Number(vec[a]) || 0])),
      params,
      tags,
      audio_path: path,
      audio_bytes: wav.byteLength,
      archetype_slug: bestSlug,
      distance: Number.isFinite(bestDistance) ? Number(bestDistance.toFixed(3)) : null,
    };

    const { data: saved, error: saveErr } = await admin
      .from("sonic_signatures")
      .upsert(row, { onConflict: "subject_hash" })
      .select("*")
      .single();
    if (saveErr) return json({ success: false, error: saveErr.message }, 500);

    const { data: signed } = await admin.storage
      .from("signatures")
      .createSignedUrl(path, 60 * 60);

    return json({
      success: true,
      cached: false,
      signature: { ...saved, audio_url: signed?.signedUrl ?? null },
    });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
