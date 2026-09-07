CREATE OR REPLACE FUNCTION public.admin_listener_population_stats(p_days integer DEFAULT 30, p_tag_sample integer DEFAULT 40000)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := greatest(7, least(coalesce(p_days, 30), 180));
  v_sample integer := greatest(1000, least(coalesce(p_tag_sample, 40000), 100000));
  v_totals jsonb;
  v_axes jsonb;
  v_trend jsonb;
  v_grounding jsonb;
  v_reach jsonb;
  v_tags jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT jsonb_build_object(
    'profiles', count(*),
    'identifiers', coalesce(sum(identifier_count), 0),
    'observations', coalesce(sum(observation_count), 0),
    'audio_grounded', count(*) FILTER (WHERE has_audio_embedding),
    'avg_confidence', round(coalesce(avg(confidence), 0)::numeric, 3),
    'last_seen_at', max(last_seen_at),
    'updated_at', max(updated_at)
  ) INTO v_totals FROM public.listener_profiles;

  WITH axes AS (
    SELECT a.axis, a.val
    FROM public.listener_profiles p
    CROSS JOIN LATERAL (VALUES
      ('emotional', p.emotional), ('cognitive', p.cognitive), ('social', p.social),
      ('communication', p.communication), ('contextual', p.contextual), ('artistic', p.artistic)
    ) AS a(axis, val)
  ), b AS (
    SELECT axis, least(9, greatest(0, floor(coalesce(val, 0) / 10)))::int AS bucket, count(*) AS n
    FROM axes GROUP BY 1, 2
  ), s AS (
    SELECT axis,
           round(avg(coalesce(val, 0))::numeric, 1) AS mean,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY coalesce(val, 0)))::numeric, 1) AS median,
           round((percentile_cont(0.9) WITHIN GROUP (ORDER BY coalesce(val, 0)))::numeric, 1) AS p90,
           round(coalesce(stddev_pop(coalesce(val, 0)), 0)::numeric, 1) AS spread
    FROM axes GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
           'axis', s.axis, 'mean', s.mean, 'median', s.median, 'p90', s.p90, 'spread', s.spread,
           'histogram', (SELECT jsonb_agg(jsonb_build_object('bucket', b.bucket * 10, 'count', b.n) ORDER BY b.bucket)
                         FROM b WHERE b.axis = s.axis)
         ) ORDER BY s.axis)
  INTO v_axes FROM s;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'day', d, 'count', n, 'avg_confidence', c, 'audio_grounded', g) ORDER BY d), '[]'::jsonb)
  INTO v_trend
  FROM (
    SELECT date_trunc('day', last_seen_at)::date AS d,
           count(*) AS n,
           round(coalesce(avg(confidence), 0)::numeric, 3) AS c,
           count(*) FILTER (WHERE has_audio_embedding) AS g
    FROM public.listener_profiles
    WHERE last_seen_at >= now() - make_interval(days => v_days)
    GROUP BY 1
  ) t;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'level', lvl, 'count', n, 'avg_confidence', c, 'audio_grounded', g) ORDER BY n DESC), '[]'::jsonb)
  INTO v_grounding
  FROM (
    SELECT coalesce(grounding_level, 'unknown') AS lvl, count(*) AS n,
           round(coalesce(avg(confidence), 0)::numeric, 3) AS c,
           count(*) FILTER (WHERE has_audio_embedding) AS g
    FROM public.listener_profiles GROUP BY 1
  ) t;

  SELECT coalesce(jsonb_agg(jsonb_build_object('band', band, 'count', n) ORDER BY sort), '[]'::jsonb)
  INTO v_reach
  FROM (
    SELECT CASE
             WHEN identifier_count <= 1 THEN '1 identifier'
             WHEN identifier_count <= 5 THEN '2-5'
             WHEN identifier_count <= 20 THEN '6-20'
             WHEN identifier_count <= 100 THEN '21-100'
             ELSE '100+'
           END AS band,
           CASE
             WHEN identifier_count <= 1 THEN 1 WHEN identifier_count <= 5 THEN 2
             WHEN identifier_count <= 20 THEN 3 WHEN identifier_count <= 100 THEN 4 ELSE 5
           END AS sort,
           count(*) AS n
    FROM public.listener_profiles GROUP BY 1, 2
  ) t;

  SELECT coalesce(jsonb_agg(jsonb_build_object('code', code, 'count', n) ORDER BY n DESC), '[]'::jsonb)
  INTO v_tags
  FROM (
    SELECT tag AS code, count(*) AS n
    FROM (SELECT tag_codes FROM public.listener_profiles WHERE tag_codes IS NOT NULL LIMIT v_sample) s
    CROSS JOIN LATERAL unnest(s.tag_codes) AS tag
    GROUP BY 1 ORDER BY 2 DESC LIMIT 25
  ) t;

  RETURN jsonb_build_object(
    'totals', v_totals,
    'axes', coalesce(v_axes, '[]'::jsonb),
    'trend', v_trend,
    'grounding', v_grounding,
    'reach', v_reach,
    'top_tags', v_tags,
    'tag_sample', v_sample,
    'window_days', v_days,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listener_population_stats(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_listener_population_stats(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_listener_population_stats(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listener_population_stats(integer, integer) TO service_role;