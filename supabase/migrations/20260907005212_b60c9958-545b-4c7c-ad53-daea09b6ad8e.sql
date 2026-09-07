CREATE OR REPLACE FUNCTION public.admin_listener_audience_insights(p_sample integer DEFAULT 40000, p_per_family integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sample integer := greatest(1000, least(coalesce(p_sample, 40000), 100000));
  v_per integer := greatest(3, least(coalesce(p_per_family, 12), 30));
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  WITH s AS (
    SELECT tag_codes, emotional, cognitive, social, communication, contextual, artistic, confidence
    FROM public.listener_profiles
    WHERE tag_codes IS NOT NULL AND array_length(tag_codes, 1) > 0
    LIMIT v_sample
  ), exploded AS (
    SELECT tag,
           CASE
             WHEN tag LIKE 'demo.age.%' THEN 'age'
             WHEN tag LIKE 'demo.%' THEN 'other demographics'
             WHEN tag LIKE 'ctv.genre.%' THEN 'viewing genre'
             WHEN tag LIKE 'ctv.channel.%' THEN 'channel'
             WHEN tag LIKE 'iab%' THEN 'interest category'
             ELSE 'other signals'
           END AS family,
           s.emotional, s.cognitive, s.social, s.communication, s.contextual, s.artistic, s.confidence
    FROM s CROSS JOIN LATERAL unnest(s.tag_codes) AS tag
  ), totals AS (
    SELECT count(*) AS sampled FROM s
  ), per_tag AS (
    SELECT family, tag, count(*) AS n,
           round(avg(coalesce(emotional,0))::numeric,1) AS emotional,
           round(avg(coalesce(cognitive,0))::numeric,1) AS cognitive,
           round(avg(coalesce(social,0))::numeric,1) AS social,
           round(avg(coalesce(communication,0))::numeric,1) AS communication,
           round(avg(coalesce(contextual,0))::numeric,1) AS contextual,
           round(avg(coalesce(artistic,0))::numeric,1) AS artistic,
           round(coalesce(avg(confidence),0)::numeric,3) AS confidence
    FROM exploded GROUP BY 1, 2
  ), ranked AS (
    SELECT *, row_number() OVER (PARTITION BY family ORDER BY n DESC) AS rn,
           sum(n) OVER (PARTITION BY family) AS family_total
    FROM per_tag
  )
  SELECT jsonb_build_object(
    'sampled_profiles', (SELECT sampled FROM totals),
    'families', coalesce((
      SELECT jsonb_agg(f ORDER BY (f->>'total_mentions')::bigint DESC) FROM (
        SELECT jsonb_build_object(
                 'family', family,
                 'distinct_tags', count(*),
                 'total_mentions', max(family_total),
                 'tags', jsonb_agg(jsonb_build_object(
                     'code', tag, 'count', n,
                     'share', round((n::numeric / greatest(1, (SELECT sampled FROM totals))) * 100, 1),
                     'scores', jsonb_build_object(
                       'emotional', emotional, 'cognitive', cognitive, 'social', social,
                       'communication', communication, 'contextual', contextual, 'artistic', artistic),
                     'confidence', confidence
                   ) ORDER BY n DESC) FILTER (WHERE rn <= v_per)
               ) AS f
        FROM ranked GROUP BY family
      ) x
    ), '[]'::jsonb),
    'sample_size', v_sample,
    'computed_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listener_audience_insights(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_listener_audience_insights(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_listener_audience_insights(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listener_audience_insights(integer, integer) TO service_role;