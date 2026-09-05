import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

/**
 * hear() — Batch E, item 4.
 *
 * SONICSIM as a tool other models can call: give it a stored audio source id,
 * a URL already in the library, or free text / tags, and get back the six-axis
 * fingerprint, the nearest Ensemble archetype and the :03 signature reference.
 *
 * Gated on `nextlevel.hear_api_enabled` (admin-readable knob). While the flag is
 * off — the default — the tool answers with a short "not enabled" note, so the
 * surface exists without being exposed.
 */
export default defineTool({
  name: "hear",
  title: "Hear a sound (fingerprint, archetype, signature)",
  description:
    "Score a sound with SONICSIM. Pass `source_id` (an analysed audio source) or `url` (a source already in the library), or `text` describing the sound. Returns the six-category fingerprint, the nearest Ensemble archetype and the sonic signature reference. Disabled until an administrator enables the hear API.",
  inputSchema: {
    source_id: z.string().describe("UUID of an analysed audio source.").optional(),
    url: z.string().describe("URL of an audio source already in the library.").optional(),
    text: z.string().describe("Text or comma-separated tags describing the sound.").optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const { data: flag } = await supabase
      .from("control_registry")
      .select("value")
      .eq("key", "nextlevel.hear_api_enabled")
      .maybeSingle();
    if (flag?.value !== true) {
      return {
        content: [
          {
            type: "text",
            text: "hear() is not enabled for this workspace yet. An administrator can turn it on in the Control Room (nextlevel.hear_api_enabled).",
          },
        ],
      };
    }

    const args = (input ?? {}) as { source_id?: string; url?: string; text?: string };

    let query = supabase
      .from("source_analyses")
      .select(
        "id, audio_source_id, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score, confidence_score, grounding_level, created_at, audio_sources!inner(id, name, source_url)",
      )
      .order("created_at", { ascending: false })
      .limit(1);

    if (args.source_id) query = query.eq("audio_source_id", args.source_id);
    else if (args.url) query = query.eq("audio_sources.source_url", args.url);
    else if (args.text) query = query.ilike("audio_sources.name", `%${args.text.slice(0, 60)}%`);

    const { data, error } = await query.maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) {
      return {
        content: [
          {
            type: "text",
            text: "No scored source matched. Analyse the sound in SonicSIM first, then call hear() with its source id.",
          },
        ],
      };
    }

    const vector = {
      emotional: data.emotional_score,
      cognitive: data.cognitive_score,
      social: data.social_score,
      communication: data.communication_score,
      contextual: data.contextual_score,
      artistic: data.artistic_score,
    };

    const { data: signature } = await supabase
      .from("sonic_signatures")
      .select("subject_hash, archetype_slug, distance, audio_path")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const text = [
      `Fingerprint — emotional ${vector.emotional}, cognitive ${vector.cognitive}, social ${vector.social}, communication ${vector.communication}, contextual ${vector.contextual}, artistic ${vector.artistic}`,
      `Confidence ${data.confidence_score ?? "n/a"} · grounding ${data.grounding_level ?? "text-only"}`,
      signature
        ? `Archetype ${signature.archetype_slug} (distance ${signature.distance}) · signature ${signature.subject_hash}`
        : "No signature rendered yet.",
    ].join("\n");

    return {
      content: [{ type: "text", text }],
      structuredContent: { fingerprint: vector, analysis: data, signature: signature ?? null },
    };
  },
});
