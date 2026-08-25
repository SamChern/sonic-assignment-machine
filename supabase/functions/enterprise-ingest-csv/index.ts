// Authoritative insert path for enterprise CSV uploads.
//
// The browser parses and previews the CSV, then posts normalized rows here.
// This function re-validates every row, creates the dataset, inserts records
// with the service role, and recomputes the dataset's semantic averages.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthzError, requireOrgMember } from "../_shared/org.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_ROWS = 20000;
const CHUNK = 500;
const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

interface IncomingRow {
  external_user_id?: string | null;
  source_name?: string | null;
  audio_url?: string | null;
  attributes?: Record<string, unknown>;
  kpi?: Record<string, unknown>;
  scores?: Record<string, unknown>;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const clampScore = (v: unknown): number | null => {
  const n = num(v);
  if (n === null) return null;
  return Math.max(0, Math.min(100, n));
};

const text = (v: unknown, max = 512): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const organizationId = String(body.organization_id ?? "");
    const caller = await requireOrgMember(req, admin, organizationId, true);

    const rows: IncomingRow[] = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) throw new AuthzError("No rows supplied", 400);
    if (rows.length > MAX_ROWS) {
      throw new AuthzError(`Too many rows — the limit is ${MAX_ROWS} per upload`, 400);
    }

    const datasetName = text(body.dataset_name, 160) ?? "Untitled dataset";
    const description = text(body.description, 1000);

    const { data: dataset, error: dsErr } = await admin
      .from("enterprise_datasets")
      .insert({
        organization_id: organizationId,
        name: datasetName,
        description,
        source_kind: "csv",
        status: "ingesting",
        created_by: caller.userId,
      })
      .select("id")
      .single();
    if (dsErr) throw new Error(`Could not create dataset: ${dsErr.message}`);

    const prepared = rows.map((r) => {
      const scores = r.scores ?? {};
      const record: Record<string, unknown> = {
        organization_id: organizationId,
        dataset_id: dataset.id,
        external_user_id: text(r.external_user_id, 200),
        source_name: text(r.source_name, 300),
        audio_url: text(r.audio_url, 1000),
        attributes: r.attributes && typeof r.attributes === "object" ? r.attributes : {},
        kpi: r.kpi && typeof r.kpi === "object" ? r.kpi : {},
      };
      let scored = 0;
      for (const c of CATEGORIES) {
        const v = clampScore((scores as Record<string, unknown>)[c]);
        record[`${c}_score`] = v;
        if (v !== null) scored += 1;
      }
      record.analysis_status = scored === CATEGORIES.length ? "scored" : "pending";
      if (scored === CATEGORIES.length) record.score_confidence = 1;
      return record;
    });

    let inserted = 0;
    const failures: string[] = [];
    for (let i = 0; i < prepared.length; i += CHUNK) {
      const slice = prepared.slice(i, i + CHUNK);
      const { error } = await admin.from("enterprise_records").insert(slice);
      if (error) {
        failures.push(`rows ${i + 1}-${i + slice.length}: ${error.message}`);
      } else {
        inserted += slice.length;
      }
    }

    const scoredRows = prepared.filter((r) => r.analysis_status === "scored");
    const averages: Record<string, number | null> = {};
    for (const c of CATEGORIES) {
      averages[`${c}_avg`] = scoredRows.length
        ? scoredRows.reduce((s, r) => s + Number(r[`${c}_score`] ?? 0), 0) / scoredRows.length
        : null;
    }

    await admin
      .from("enterprise_datasets")
      .update({
        row_count: inserted,
        scored_count: scoredRows.length,
        status: failures.length ? "partial" : "ready",
        ...averages,
      })
      .eq("id", dataset.id);

    return new Response(
      JSON.stringify({
        success: true,
        dataset_id: dataset.id,
        rows_inserted: inserted,
        rows_scored: scoredRows.length,
        failures,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const status = e instanceof AuthzError ? e.status : 500;
    console.error("enterprise-ingest-csv failed:", (e as Error).message);
    return new Response(
      JSON.stringify({ success: false, error: (e as Error).message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
