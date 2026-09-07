CREATE OR REPLACE FUNCTION public.admin_category_score_trend(p_days integer DEFAULT 60, p_bucket text DEFAULT 'auto')
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout TO '25s'
AS $$
DECLARE
  v_days integer := greatest(7, least(coalesce(p_days, 60), 365));
  v_bucket text;
  v_points jsonb;
  v_first timestamptz;
  v_last timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  v_bucket := CASE
    WHEN coalesce(p_bucket, 'auto') IN ('day', 'week', 'month') THEN p_bucket
    WHEN v_days <= 45 THEN 'day'
    WHEN v_days <= 180 THEN 'week'
    ELSE 'month'
  END;

  SELECT min(created_at), max(created_at) INTO v_first, v_last FROM public.source_analyses;

  WITH agg AS (
    SELECT date_trunc(v_bucket, created_at) AS b,
           count(*) AS n,
           round(coalesce(avg(confidence), 0)::numeric, 3) AS cf,
           round(coalesce(avg(emotional_score), 0)::numeric, 1) AS e,
           round(coalesce(avg(cognitive_score), 0)::numeric, 1) AS c,
           round(coalesce(avg(social_score), 0)::numeric, 1) AS s,
           round(coalesce(avg(communication_score), 0)::numeric, 1) AS m,
           round(coalesce(avg(contextual_score), 0)::numeric, 1) AS x,
           round(coalesce(avg(artistic_score), 0)::numeric, 1) AS a
    FROM public.source_analyses
    WHERE created_at >= now() - make_interval(days => v_days)
    GROUP BY 1
  ), buckets AS (
    SELECT g AS b
    FROM generate_series(
      date_trunc(v_bucket, now() - make_interval(days => v_days)),
      date_trunc(v_bucket, now()),
      ('1 ' || v_bucket)::interval
    ) AS g
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'bucket', b.b::date,
           'count', coalesce(agg.n, 0),
           'confidence', agg.cf,
           'scores', CASE WHEN agg.n IS NULL THEN NULL ELSE jsonb_build_object(
             'emotional', agg.e, 'cognitive', agg.c, 'social', agg.s,
             'communication', agg.m, 'contextual', agg.x, 'artistic', agg.a) END
         ) ORDER BY b.b), '[]'::jsonb)
  INTO v_points
  FROM buckets b
  LEFT JOIN agg ON agg.b = b.b;

  RETURN jsonb_build_object(
    'points', v_points,
    'bucket', v_bucket,
    'window_days', v_days,
    'first_analysis_at', v_first,
    'last_analysis_at', v_last,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_category_score_trend(integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_category_score_trend(integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_category_score_trend(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_category_score_trend(integer, text) TO service_role;