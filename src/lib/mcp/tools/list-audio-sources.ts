import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_audio_sources",
  title: "List my audio sources",
  description:
    "List the signed-in user's audio sources (Spotify/Apple tracks, uploads and ingested signals) with their analysis status, so the caller can see what is analyzed, pending or failed.",
  inputSchema: {
    limit: z.number().int().describe("How many sources to return (1-50, default 15)").optional(),
    status: z
      .enum(["pending", "processing", "complete", "failed"])
      .describe("Optional analysis-status filter.")
      .optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const take = Math.min(Math.max(Math.round(limit ?? 15), 1), 50);
    const supabase = supabaseForUser(ctx);

    let query = supabase
      .from("audio_sources")
      .select("id, name, source_type, album_name, artists, analysis_status, analysis_error, created_at")
      .eq("user_id", ctx.getUserId())
      .order("created_at", { ascending: false })
      .limit(take);
    if (status) query = query.eq("analysis_status", status);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = data ?? [];
    const text = rows.length
      ? rows
          .map(
            (r) =>
              `${r.name} — ${r.source_type} — ${r.analysis_status}` +
              (r.artists?.length ? ` — ${r.artists.join(", ")}` : "") +
              (r.analysis_error ? ` — error: ${r.analysis_error}` : ""),
          )
          .join("\n")
      : "No audio sources yet.";

    return { content: [{ type: "text", text }], structuredContent: { sources: rows } };
  },
});
