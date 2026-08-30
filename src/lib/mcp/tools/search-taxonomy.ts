import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_taxonomy",
  title: "Search the ontology taxonomy",
  description:
    "Search SonicSIM's semantic taxonomy (CTV, IAB, web and AudioSet branches) by label or dotted code, and report how well each node is grounded in real audio.",
  inputSchema: {
    query: z.string().describe("Text to match against the node label or code, e.g. 'news' or 'ctv.genre'."),
    limit: z.number().int().describe("How many nodes to return (1-50, default 15)").optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const term = query.trim();
    if (!term) return { content: [{ type: "text", text: "query must not be empty." }], isError: true };
    const take = Math.min(Math.max(Math.round(limit ?? 15), 1), 50);
    const supabase = supabaseForUser(ctx);

    const { data, error } = await supabase
      .from("taxonomy_nodes")
      .select("code, label, parent_code, grounding_count, reviewed")
      .eq("suppressed", false)
      .or(`label.ilike.%${term}%,code.ilike.%${term}%`)
      .order("grounding_count", { ascending: false })
      .limit(take);

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = data ?? [];
    const text = rows.length
      ? rows
          .map(
            (r) =>
              `${r.code} — ${r.label ?? "(no label)"} — grounded in ${r.grounding_count} audio source(s)` +
              (r.reviewed ? " — reviewed" : ""),
          )
          .join("\n")
      : `No taxonomy nodes matched "${term}".`;

    return { content: [{ type: "text", text }], structuredContent: { nodes: rows } };
  },
});
