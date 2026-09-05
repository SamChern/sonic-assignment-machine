-- ============ C1 · share_cards: no more bulk anonymous reads ============
DROP POLICY IF EXISTS "Share cards are readable by link" ON public.share_cards;
REVOKE SELECT ON public.share_cards FROM anon;

DROP POLICY IF EXISTS "Users read their own share cards" ON public.share_cards;
CREATE POLICY "Users read their own share cards"
  ON public.share_cards FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Single-row lookup for a public share link. Security definer so anonymous
-- visitors can resolve exactly one token and nothing else.
CREATE OR REPLACE FUNCTION public.get_share_card(p_token text)
RETURNS TABLE (
  token text,
  source_name text,
  vector jsonb,
  archetype_slug text,
  tags jsonb,
  narration text,
  grounding_level text,
  view_count integer,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 8 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.token, s.source_name, s.vector, s.archetype_slug, s.tags,
         s.narration, s.grounding_level, s.view_count, s.created_at
  FROM public.share_cards s
  WHERE s.token = p_token
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_share_card(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_share_card(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bump_share_card_views(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.share_cards
     SET view_count = view_count + 1, updated_at = now()
   WHERE token = p_token;
$$;

REVOKE ALL ON FUNCTION public.bump_share_card_views(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_share_card_views(text) TO anon, authenticated, service_role;

-- ============ RLS · internal tables were open to every signed-in user ======
DROP POLICY IF EXISTS "Signed-in users can read source cache" ON public.source_cache;
DROP POLICY IF EXISTS "Admins read source cache" ON public.source_cache;
CREATE POLICY "Admins read source cache"
  ON public.source_cache FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Signed-in users can read worker state" ON public.job_worker_state;
DROP POLICY IF EXISTS "Admins read worker state" ON public.job_worker_state;
CREATE POLICY "Admins read worker state"
  ON public.job_worker_state FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============ H9 · cohorts belong to an organization ============
ALTER TABLE public.sonic_cohorts
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS sonic_cohorts_org_idx ON public.sonic_cohorts(organization_id);

DROP POLICY IF EXISTS "Admins can view sonic cohorts" ON public.sonic_cohorts;
DROP POLICY IF EXISTS "Admins and org members view sonic cohorts" ON public.sonic_cohorts;
CREATE POLICY "Admins and org members view sonic cohorts"
  ON public.sonic_cohorts FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (organization_id IS NOT NULL AND public.has_org_access(organization_id))
  );

-- ============ H2 · atomic, batched calibration upsert ============
CREATE OR REPLACE FUNCTION public.upsert_category_calibration(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  WITH incoming AS (
    SELECT (r->>'node_id')::uuid       AS node_id,
           r->>'category'              AS category,
           (r->>'value')::numeric      AS value,
           COALESCE((r->>'weight')::numeric, 1) AS weight
    FROM jsonb_array_elements(p_rows) AS r
    WHERE r->>'node_id' IS NOT NULL AND r->>'category' IS NOT NULL
  ), agg AS (
    SELECT node_id, category,
           SUM(weight)              AS n,
           SUM(value * weight)      AS sum_v,
           SUM(value * value * weight) AS sum_sq
    FROM incoming
    GROUP BY node_id, category
  ), merged AS (
    INSERT INTO public.category_calibration AS cc (node_id, category, samples, mean, m2, updated_at)
    SELECT a.node_id, a.category, a.n, a.sum_v / NULLIF(a.n, 0),
           GREATEST(a.sum_sq - (a.sum_v * a.sum_v) / NULLIF(a.n, 0), 0), now()
    FROM agg a
    ON CONFLICT (node_id, category) DO UPDATE
      SET samples = cc.samples + EXCLUDED.samples,
          -- pooled mean
          mean = ((cc.mean * cc.samples) + (EXCLUDED.mean * EXCLUDED.samples))
                 / NULLIF(cc.samples + EXCLUDED.samples, 0),
          -- Chan et al. parallel variance merge
          m2 = cc.m2 + EXCLUDED.m2
               + ((EXCLUDED.mean - cc.mean) ^ 2)
                 * cc.samples * EXCLUDED.samples
                 / NULLIF(cc.samples + EXCLUDED.samples, 0),
          updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM merged;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_category_calibration(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_category_calibration(jsonb) TO service_role;

-- ============ Housekeeping: indexes, retention coverage, cache metadata =====
ALTER TABLE public.embedding_cache
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS embedding_cache_last_used_idx
  ON public.embedding_cache(last_used_at);

CREATE INDEX IF NOT EXISTS ingest_rollups_created_idx
  ON public.ingest_rollups(created_at);

CREATE INDEX IF NOT EXISTS ingest_rollups_day_idx
  ON public.ingest_rollups(day);

CREATE INDEX IF NOT EXISTS sonic_cohorts_centroid_hnsw
  ON public.sonic_cohorts USING hnsw (centroid vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.prune_embedding_cache(p_idle_days integer DEFAULT 120)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.embedding_cache
   WHERE last_used_at < now() - make_interval(days => GREATEST(p_idle_days, 7));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_embedding_cache(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_embedding_cache(integer) TO service_role;