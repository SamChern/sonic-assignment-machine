import { defineTool } from "@lovable.dev/mcp-js";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_fingerprint",
  title: "Get my sonic fingerprint",
  description:
    "Return the signed-in user's aggregate sonic fingerprint: all-time and last-30-day averages across the six SonicSIM categories, how many sources it is based on, and its confidence.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("user_fingerprints")
      .select("*")
      .eq("user_id", ctx.getUserId())
      .maybeSingle();

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) {
      return {
        content: [
          { type: "text", text: "No fingerprint yet — analyze at least one audio source first." },
        ],
      };
    }

    const text = [
      `Fingerprint from ${data.total_sources_analyzed} sources (confidence ${data.fingerprint_confidence}).`,
      `All-time — emotional ${data.emotional_avg}, cognitive ${data.cognitive_avg}, social ${data.social_avg}, communication ${data.communication_avg}, contextual ${data.contextual_avg}, artistic ${data.artistic_avg}`,
      `Last 30 days (${data.recent_sources_analyzed} sources) — emotional ${data.emotional_avg_recent}, cognitive ${data.cognitive_avg_recent}, social ${data.social_avg_recent}, communication ${data.communication_avg_recent}, contextual ${data.contextual_avg_recent}, artistic ${data.artistic_avg_recent}`,
    ].join("\n");

    return { content: [{ type: "text", text }], structuredContent: { fingerprint: data } };
  },
});
