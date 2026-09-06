CREATE OR REPLACE FUNCTION public.intuizi_activation_cost_estimate(p_sample integer DEFAULT 2000)
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
  v_sample integer := greatest(200, least(coalesce(p_sample, 2000), 5000));
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  PERFORM set_config('statement_timeout', '25000', true);

  RETURN QUERY
  WITH acts AS (
    SELECT q.activation_id AS act,
           count(*)::integer AS total,
           count(*) FILTER (WHERE q.status = 'done')::integer AS done,
           count(*) FILTER (WHERE q.status = 'pending')::integer AS pending
      FROM public.intuizi_score_queue q
     WHERE q.activation_id IS NOT NULL
     GROUP BY q.activation_id
     ORDER BY count(*) DESC
     LIMIT 10
  )
  SELECT a.act, a.total, a.done, a.pending,
         coalesce(s.sampled, 0),
         coalesce(s.cached, 0),
         coalesce(s.sigs, 0),
         coalesce(s.billable, 0)
    FROM acts a
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS sampled,
             count(*) FILTER (WHERE j.cached)::integer AS cached,
             count(DISTINCT j.sig)::integer AS sigs,
             count(DISTINCT j.sig) FILTER (WHERE NOT j.cached)::integer AS billable
        FROM (
          SELECT sp.sig,
                 EXISTS (
                   SELECT 1 FROM public.intuizi_tag_score_cache c
                    WHERE c.tag_signature = sp.sig
                 ) AS cached
            FROM (
              SELECT public.intuizi_tag_signature(q2.report_type, q2.tags) AS sig
                FROM public.intuizi_score_queue q2
               WHERE q2.activation_id = a.act AND q2.status = 'pending'
               LIMIT v_sample
            ) sp
        ) j
    ) s ON true
   ORDER BY a.total DESC;
END;
$$;