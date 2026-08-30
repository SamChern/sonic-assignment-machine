CREATE OR REPLACE FUNCTION public.grounding_coverage()
RETURNS TABLE(
  branch text,
  observed_tags integer,
  observed_weight numeric,
  grounded_tags integer,
  grounded_weight numeric,
  coverage_pct numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_manifest jsonb;
BEGIN
  -- Signed-in callers must be admins; the service role (no auth.uid()) is the
  -- Sound Library function itself, which already authorized its caller.
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.require_admin();
  END IF;

  SELECT COALESCE(manifest, '{}'::jsonb) INTO v_manifest
  FROM public.embedding_bridges
  WHERE is_active = true
  ORDER BY activated_at DESC NULLS LAST
  LIMIT 1;
  v_manifest := COALESCE(v_manifest, '{}'::jsonb);

  RETURN QUERY
  WITH observed AS (
    SELECT n.id,
           n.code,
           split_part(n.code, '.', 1) AS branch,
           SUM(a.weight) AS weight,
           n.grounding_count
    FROM public.audio_source_tags a
    JOIN public.taxonomy_nodes n ON n.id = a.node_id
    GROUP BY n.id, n.code, n.grounding_count
  ), flagged AS (
    SELECT o.*,
           (o.grounding_count > 0
            OR v_manifest ? o.code
            OR EXISTS (
              SELECT 1 FROM public.grounding_assets g
              WHERE g.taxonomy_code = o.code AND g.status = 'active'
            )) AS grounded
    FROM observed o
  )
  SELECT f.branch,
         COUNT(*)::integer,
         ROUND(SUM(f.weight)::numeric, 3),
         COUNT(*) FILTER (WHERE f.grounded)::integer,
         ROUND(COALESCE(SUM(f.weight) FILTER (WHERE f.grounded), 0)::numeric, 3),
         ROUND(
           100 * COALESCE(SUM(f.weight) FILTER (WHERE f.grounded), 0)::numeric
             / NULLIF(SUM(f.weight)::numeric, 0), 1)
  FROM flagged f
  GROUP BY f.branch
  ORDER BY SUM(f.weight) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.grounding_gaps(p_limit integer DEFAULT 40, p_branch text DEFAULT NULL)
RETURNS TABLE(
  node_id uuid,
  code text,
  label text,
  branch text,
  observed_sources integer,
  observed_weight numeric,
  queued boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_manifest jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.require_admin();
  END IF;

  SELECT COALESCE(manifest, '{}'::jsonb) INTO v_manifest
  FROM public.embedding_bridges
  WHERE is_active = true
  ORDER BY activated_at DESC NULLS LAST
  LIMIT 1;
  v_manifest := COALESCE(v_manifest, '{}'::jsonb);

  RETURN QUERY
  SELECT n.id,
         n.code,
         n.label,
         split_part(n.code, '.', 1),
         COUNT(DISTINCT a.audio_source_id)::integer,
         ROUND(SUM(a.weight)::numeric, 3),
         EXISTS (
           SELECT 1 FROM public.grounding_queue q
           WHERE q.taxonomy_code = n.code AND q.status IN ('pending','proposed')
         )
  FROM public.audio_source_tags a
  JOIN public.taxonomy_nodes n ON n.id = a.node_id
  WHERE n.suppressed = false
    AND n.grounding_count = 0
    AND NOT (v_manifest ? n.code)
    AND NOT EXISTS (
      SELECT 1 FROM public.grounding_assets g
      WHERE g.taxonomy_code = n.code AND g.status = 'active'
    )
    AND (p_branch IS NULL OR split_part(n.code, '.', 1) = p_branch)
  GROUP BY n.id, n.code, n.label
  ORDER BY SUM(a.weight) DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 200);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grounding_coverage() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grounding_gaps(integer, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.grounding_coverage() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grounding_gaps(integer, text) TO authenticated, service_role;