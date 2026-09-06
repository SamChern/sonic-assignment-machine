CREATE TABLE IF NOT EXISTS public.intuizi_cost_estimate_cache (
  activation_id text PRIMARY KEY,
  total_rows integer NOT NULL DEFAULT 0,
  done_rows integer NOT NULL DEFAULT 0,
  pending_rows integer NOT NULL DEFAULT 0,
  sampled_rows integer NOT NULL DEFAULT 0,
  sampled_cached_rows integer NOT NULL DEFAULT 0,
  distinct_signatures integer NOT NULL DEFAULT 0,
  billable_signatures integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.intuizi_cost_estimate_cache TO service_role;
ALTER TABLE public.intuizi_cost_estimate_cache ENABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS public.intuizi_activation_cost_estimate(integer);

CREATE OR REPLACE FUNCTION public.intuizi_activation_cost_estimate(
  p_sample integer DEFAULT 1000,
  p_force boolean DEFAULT false,
  p_max_age_seconds integer DEFAULT 900
)
RETURNS TABLE(
  activation_id text,
  total_rows integer,
  done_rows integer,
  pending_rows integer,
  sampled_rows integer,
  sampled_cached_rows integer,
  distinct_signatures integer,
  billable_signatures integer,
  computed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sample integer := greatest(200, least(coalesce(p_sample, 1000), 5000));
  v_age integer := greatest(60, least(coalesce(p_max_age_seconds, 900), 86400));
  v_fresh boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.intuizi_cost_estimate_cache c
     WHERE c.computed_at > now() - make_interval(secs => v_age)
  ) INTO v_fresh;

  -- Serve the cached snapshot unless the operator explicitly recomputes.
  IF v_fresh AND NOT coalesce(p_force, false) THEN
    RETURN QUERY
      SELECT c.activation_id, c.total_rows, c.done_rows, c.pending_rows,
             c.sampled_rows, c.sampled_cached_rows, c.distinct_signatures,
             c.billable_signatures, c.computed_at
        FROM public.intuizi_cost_estimate_cache c
       ORDER BY c.total_rows DESC;
    RETURN;
  END IF;

  -- Recompute: the queue holds >1M rows, so the aggregate is the expensive part.
  -- Give it room, then persist the snapshot so the panel stays instant.
  PERFORM set_config('statement_timeout', '50000', true);

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
  ), computed AS (
    SELECT a.act, a.total, a.done, a.pending,
           coalesce(s.sampled, 0) AS sampled,
           coalesce(s.cached, 0) AS cached,
           coalesce(s.sigs, 0) AS sigs,
           coalesce(s.billable, 0) AS billable
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
  )
  INSERT INTO public.intuizi_cost_estimate_cache AS t (
    activation_id, total_rows, done_rows, pending_rows, sampled_rows,
    sampled_cached_rows, distinct_signatures, billable_signatures, computed_at
  )
  SELECT c.act, c.total, c.done, c.pending, c.sampled, c.cached, c.sigs,
         c.billable, now()
    FROM computed c
  ON CONFLICT (activation_id) DO UPDATE
    SET total_rows = EXCLUDED.total_rows,
        done_rows = EXCLUDED.done_rows,
        pending_rows = EXCLUDED.pending_rows,
        sampled_rows = EXCLUDED.sampled_rows,
        sampled_cached_rows = EXCLUDED.sampled_cached_rows,
        distinct_signatures = EXCLUDED.distinct_signatures,
        billable_signatures = EXCLUDED.billable_signatures,
        computed_at = EXCLUDED.computed_at;

  RETURN QUERY
    SELECT c.activation_id, c.total_rows, c.done_rows, c.pending_rows,
           c.sampled_rows, c.sampled_cached_rows, c.distinct_signatures,
           c.billable_signatures, c.computed_at
      FROM public.intuizi_cost_estimate_cache c
     ORDER BY c.total_rows DESC;
END;
$function$;