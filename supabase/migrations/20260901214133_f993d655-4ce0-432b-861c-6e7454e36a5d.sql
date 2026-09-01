CREATE OR REPLACE FUNCTION public.intuizi_activation_coverage(p_activation text DEFAULT NULL)
RETURNS TABLE(activation_id text, identifiers bigint, tagged bigint, scored bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(s.act, 'unassigned') AS activation_id,
         count(*) AS identifiers,
         count(*) FILTER (WHERE i.tag_codes <> '{}') AS tagged,
         count(*) FILTER (WHERE s.has_scores) AS scored
    FROM public.intuizi_identifiers i
    CROSS JOIN LATERAL (
      SELECT v->>'activation_id' AS act, (v ? 'scores') AS has_scores
        FROM (VALUES (i.ctv_signals), (i.apps_signals), (i.visitation_signals),
                     (i.demographics_signals), (i.origin_signals)) t(v)
       WHERE v IS NOT NULL AND v::text <> '{}'
    ) s
   WHERE p_activation IS NULL
      OR coalesce(s.act, 'unassigned') = p_activation
   GROUP BY 1
   ORDER BY 2 DESC
$$;

REVOKE ALL ON FUNCTION public.intuizi_activation_coverage(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intuizi_activation_coverage(text) TO service_role;