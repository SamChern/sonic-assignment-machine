CREATE OR REPLACE FUNCTION public.refresh_taxonomy_grounding()
RETURNS TABLE(nodes_updated integer, grounded_nodes integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
  v_grounded integer := 0;
BEGIN
  WITH counts AS (
    SELECT t.node_id, COUNT(DISTINCT t.audio_source_id)::integer AS c
    FROM public.audio_source_tags t
    JOIN public.audio_sources s ON s.id = t.audio_source_id
    WHERE s.analysis_status = 'complete'
      AND (s.profile_embedding IS NOT NULL OR s.librosa_features IS NOT NULL)
    GROUP BY t.node_id
  ), upd AS (
    UPDATE public.taxonomy_nodes n
    SET grounding_count = COALESCE(c.c, 0),
        updated_at = now()
    FROM (
      SELECT n2.id, counts.c
      FROM public.taxonomy_nodes n2
      LEFT JOIN counts ON counts.node_id = n2.id
    ) c
    WHERE c.id = n.id
      AND n.grounding_count IS DISTINCT FROM COALESCE(c.c, 0)
    RETURNING n.id
  )
  SELECT COUNT(*)::integer INTO v_updated FROM upd;

  SELECT COUNT(*)::integer INTO v_grounded
  FROM public.taxonomy_nodes
  WHERE grounding_count > 0;

  RETURN QUERY SELECT v_updated, v_grounded;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_taxonomy_grounding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_taxonomy_grounding() TO service_role;