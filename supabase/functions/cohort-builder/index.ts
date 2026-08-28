// Step 6 — nightly sonic cohort builder.
//
// Clusters Intuizi subject embeddings (1536-d profile vectors) with k-means and
// upserts public.sonic_cohorts + public.sonic_cohort_members. Uses the same
// single-flight worker-lease pattern as intuizi-score-worker
// (acquire_intuizi_lease / release_intuizi_lease) so a scheduled tick can never
// overlap a manual run or a live ingest.
//
// Subject keys (raw Intuizi identifiers) are written to sonic_cohort_members,
// which has no SELECT policy — only service-role code can read them. The
// browser only ever sees cohort-level aggregates.
//
// Callable by an admin JWT or a service-role token (scheduled tick).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthzError, requireAdmin } from "../_shared/admin.ts";
import { cosine, kmeans, suggestK } from "../_shared/kmeans.ts";
import { isAggregateKey } from "../_shared/activationEid.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LEASE_SECONDS = 240;
/** Subjects pulled per run; keeps memory and CPU inside the worker limits. */
const DEFAULT_MAX_SUBJECTS = 4000;
const PAGE = 1000;
const MEMBER_CHUNK = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function letter(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    try {
      await requireAdmin(req, admin);
    } catch (e) {
      if (e instanceof AuthzError) return json({ success: false, error: e.message }, e.status);
      throw e;
    }

    const body = await req.json().catch(() => ({})) as {
      k?: number;
      max_subjects?: number;
      dry_run?: boolean;
      source?: string;
    };
    const maxSubjects = Math.max(
      50,
      Math.min(20_000, Number(body.max_subjects ?? DEFAULT_MAX_SUBJECTS) || DEFAULT_MAX_SUBJECTS),
    );

    // ---- single-flight lease -------------------------------------------------
    const leaseOwner = `cohort-builder:${crypto.randomUUID()}`;
    const { data: acquired, error: leaseErr } = await admin.rpc("acquire_intuizi_lease", {
      p_owner: leaseOwner,
      p_seconds: LEASE_SECONDS,
    });
    if (leaseErr) return json({ success: false, error: `lease error: ${leaseErr.message}` }, 500);
    if (!acquired) return json({ success: true, skipped: "another run holds the lease" });

    try {
      // ---- gather Intuizi subjects with embeddings --------------------------
      const subjects: { key: string; audioSourceId: string }[] = [];
      for (let offset = 0; offset < maxSubjects; offset += PAGE) {
        const { data, error } = await admin
          .from("intuizi_identifiers")
          .select("primary_identifier, audio_source_id")
          .not("audio_source_id", "is", null)
          .order("last_seen_at", { ascending: false, nullsFirst: false })
          .range(offset, Math.min(offset + PAGE, maxSubjects) - 1);
        if (error) throw new Error(`identifier read failed: ${error.message}`);
        const rows = (data ?? []) as { primary_identifier: string; audio_source_id: string }[];
        for (const r of rows) {
          if (isAggregateKey(r.primary_identifier)) continue;
          subjects.push({ key: r.primary_identifier, audioSourceId: r.audio_source_id });
        }
        if (rows.length < PAGE) break;
      }

      // Vectors come from the shared embedding cache first (cheap, already
      // deduped per audio profile) and fall back to the source's own profile
      // embedding.
      const vectorByKey = new Map<string, number[]>();

      const cacheKeys = subjects.map((s) => s.key);
      for (let i = 0; i < cacheKeys.length; i += PAGE) {
        const slice = cacheKeys.slice(i, i + PAGE);
        const { data } = await admin
          .from("audio_profile_embeddings")
          .select("cache_key, embedding")
          .in("cache_key", slice);
        for (const row of (data ?? []) as { cache_key: string; embedding: unknown }[]) {
          const vec = parseVector(row.embedding);
          if (vec) vectorByKey.set(row.cache_key, vec);
        }
      }

      const pending = subjects.filter((s) => !vectorByKey.has(s.key));
      const srcIds = Array.from(new Set(pending.map((s) => s.audioSourceId)));
      const vectorBySource = new Map<string, number[]>();
      for (let i = 0; i < srcIds.length; i += PAGE) {
        const slice = srcIds.slice(i, i + PAGE);
        const { data } = await admin
          .from("audio_sources")
          .select("id, profile_embedding")
          .in("id", slice)
          .not("profile_embedding", "is", null);
        for (const row of (data ?? []) as { id: string; profile_embedding: unknown }[]) {
          const vec = parseVector(row.profile_embedding);
          if (vec) vectorBySource.set(row.id, vec);
        }
      }
      for (const s of pending) {
        const vec = vectorBySource.get(s.audioSourceId);
        if (vec) vectorByKey.set(s.key, vec);
      }

      const clusterable = subjects.filter((s) => vectorByKey.has(s.key));
      if (clusterable.length < 4) {
        return json({
          success: true,
          skipped: "not enough embedded Intuizi subjects to cluster",
          subjects: subjects.length,
          embedded: clusterable.length,
        });
      }

      const dims = vectorByKey.get(clusterable[0].key)!.length;
      const vectors = clusterable.map((s) => {
        const v = vectorByKey.get(s.key)!;
        return v.length === dims ? v : v.slice(0, dims);
      });

      const k = Math.max(
        1,
        Math.min(12, Number(body.k ?? suggestK(clusterable.length)) || suggestK(clusterable.length)),
      );
      const { assignments, centroids } = kmeans(vectors, k);

      if (body.dry_run) {
        const sizes = centroids.map((_, c) => assignments.filter((a) => a === c).length);
        return json({
          success: true,
          dry_run: true,
          subjects: subjects.length,
          embedded: clusterable.length,
          k: centroids.length,
          cohort_sizes: sizes,
          elapsed_ms: Date.now() - startedAt,
        });
      }

      // ---- upsert cohorts + members ---------------------------------------
      const cohorts: {
        slug: string;
        name: string;
        member_count: number;
        export_eligible: boolean;
      }[] = [];

      for (let c = 0; c < centroids.length; c++) {
        const memberIdx: number[] = [];
        for (let i = 0; i < assignments.length; i++) if (assignments[i] === c) memberIdx.push(i);
        if (memberIdx.length === 0) continue;

        const slug = `sonic-cohort-${letter(c).toLowerCase()}`;
        const name = `Sonic Cohort ${letter(c)}`;
        const centroid = centroids[c];
        const cohesion =
          memberIdx.reduce((sum, i) => sum + cosine(vectors[i], centroid), 0) / memberIdx.length;

        const { data: upserted, error: upErr } = await admin
          .from("sonic_cohorts")
          .upsert({
            slug,
            name,
            description:
              `k-means cluster ${c + 1} of ${centroids.length} over ${dims}-d Intuizi subject embeddings`,
            centroid: JSON.stringify(centroid),
            member_count: memberIdx.length,
            narrative:
              `${memberIdx.length.toLocaleString()} Intuizi subjects, mean cohesion ${
                (cohesion * 100).toFixed(1)
              }%`,
            updated_at: new Date().toISOString(),
          }, { onConflict: "slug" })
          .select("id, slug, name, member_count, export_eligible")
          .single();
        if (upErr) throw new Error(`cohort upsert failed: ${upErr.message}`);

        const cohortId = (upserted as { id: string }).id;
        await admin.from("sonic_cohort_members").delete().eq("cohort_id", cohortId);

        for (let i = 0; i < memberIdx.length; i += MEMBER_CHUNK) {
          const rows = memberIdx.slice(i, i + MEMBER_CHUNK).map((idx) => ({
            cohort_id: cohortId,
            subject_key: clusterable[idx].key,
            similarity: Number(cosine(vectors[idx], centroid).toFixed(4)),
          }));
          const { error: memErr } = await admin
            .from("sonic_cohort_members")
            .upsert(rows, { onConflict: "cohort_id,subject_key" });
          if (memErr) throw new Error(`member insert failed: ${memErr.message}`);
        }

        cohorts.push({
          slug,
          name,
          member_count: memberIdx.length,
          export_eligible: memberIdx.length >= 1000,
        });
      }

      const out = {
        success: true,
        subjects: subjects.length,
        embedded: clusterable.length,
        dims,
        k: centroids.length,
        cohorts,
        elapsed_ms: Date.now() - startedAt,
      };
      console.log(JSON.stringify({ evt: "cohort_builder_run", source: body.source ?? "manual", ...out }));
      return json(out);
    } finally {
      await admin.rpc("release_intuizi_lease", { p_owner: leaseOwner }).catch(() => {});
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("cohort-builder failed", msg);
    return json({ success: false, error: msg }, 500);
  }
});
