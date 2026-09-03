CREATE OR REPLACE FUNCTION public.intuizi_activation_cost_estimate(p_sample integer DEFAULT 20000)
RETURNS TABLE(
  activation_id text,
  total_rows integer,
  done_rows integer,
  pending_rows integer,
  sampled_rows integer,
  sampled_cached_rows integer,
  distinct_signatures integer,
  billable_signatures integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sample integer := greatest(500, least(coalesce(p_sample, 20000), 50000));
  a record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  FOR a IN
    SELECT q.activation_id AS act,
           count(*)::integer AS total,
           count(*) FILTER (WHERE q.status = 'done')::integer AS done,
           count(*) FILTER (WHERE q.status = 'pending')::integer AS pending
      FROM public.intuizi_score_queue q
     WHERE q.activation_id IS NOT NULL
     GROUP BY q.activation_id
     ORDER BY count(*) DESC
     LIMIT 25
  LOOP
    RETURN QUERY
    WITH sample AS (
      SELECT public.intuizi_tag_signature(report_type, tags) AS sig
        FROM public.intuizi_score_queue
       WHERE activation_id = a.act AND status = 'pending'
       LIMIT v_sample
    ), joined AS (
      SELECT s.sig, (c.tag_signature IS NOT NULL) AS cached
        FROM sample s
        LEFT JOIN public.intuizi_tag_score_cache c ON c.tag_signature = s.sig
    )
    SELECT a.act, a.total, a.done, a.pending,
           (SELECT count(*)::integer FROM joined),
           (SELECT count(*)::integer FROM joined WHERE cached),
           (SELECT count(DISTINCT sig)::integer FROM joined),
           (SELECT count(DISTINCT sig)::integer FROM joined WHERE NOT cached);
  END LOOP;
END;
$$;