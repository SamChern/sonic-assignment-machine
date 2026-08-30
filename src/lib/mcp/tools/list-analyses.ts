import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_analyses",
  title: "List my analyses",
  description:
    "List the signed-in user's most recent SonicSIM semantic analyses with their six category scores (emotional, cognitive, social, communication, contextual, artistic), confidence and grounding level.",
  inputSchema: {
    limit: z.number().int().describe("How many analyses to return (1-50, default 10)").optional(),
    search: z.string().describe("Optional case-insensitive filter on the source name.").optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, search }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const take = Math.min(Math.max(Math.round(limit ?? 10), 1), 50);
    const supabase = supabaseForUser(ctx);

    let query = supabase
      .from("source_analyses")
      .select(
        "id, source_name, category, grounding_level, confidence, created_at, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
      )
      .eq("user_id", ctx.getUserId())
      .order("created_at", { ascending: false })
      .limit(take);
    if (search && search.trim()) query = query.ilike("source_name", `%${search.trim()}%`);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = data ?? [];
    const text = rows.length
      ? rows
          .map(
            (r) =>
              `${r.source_name} — ${r.category ?? "uncategorized"} (${r.grounding_level ?? "text-only"}, confidence ${r.confidence}) — ` +
              `emotional ${r.emotional_score}, cognitive ${r.cognitive_score}, social ${r.social_score}, ` +
              `communication ${r.communication_score}, contextual ${r.contextual_score}, artistic ${r.artistic_score}`,
          )
          .join("\n")
      : "No analyses yet.";

    return { content: [{ type: "text", text }], structuredContent: { analyses: rows } };
  },
});
