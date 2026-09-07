CREATE OR REPLACE FUNCTION public.match_listener_profiles(
  p_target jsonb,
  p_weights jsonb DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_audio_source_ids uuid[] DEFAULT NULL,
  p_audio_boost numeric DEFAULT 0.15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_result jsonb;
  we numeric := GREATEST(COALESCE((p_weights->>'emotional')::numeric, 1), 0);
  wc numeric := GREATEST(COALESCE((p_weights->>'cognitive')::numeric, 1), 0);
  ws numeric := GREATEST(COALESCE((p_weights->>'social')::numeric, 1), 0);
  wm numeric := GREATEST(COALESCE((p_weights->>'communication')::numeric, 1), 0);
  wx numeric := GREATEST(COALESCE((p_weights->>'contextual')::numeric, 1), 0);
  wa numeric := GREATEST(COALESCE((p_weights->>'artistic')::numeric, 1), 0);
  wsum numeric;
  te numeric := COALESCE((p_target->>'emotional')::numeric, 50);
  tc numeric := COALESCE((p_target->>'cognitive')::numeric, 50);
  ts numeric := COALESCE((p_target->>'social')::numeric, 50);
  tm numeric := COALESCE((p_target->>'communication')::numeric, 50);
  tx numeric := COALESCE((p_target->>'contextual')::numeric, 50);
  ta numeric := COALESCE((p_target->>'artistic')::numeric, 50);
  boost numeric := LEAST(GREATEST(COALESCE(p_audio_boost, 0.15), 0), 0.5);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role only';
  END IF;

  wsum := GREATEST(we + wc + ws + wm + wx + wa, 0.000001);

  WITH scored AS (
    SELECT lp.audio_source_id,
           lp.source_name,
           lp.grounding_level,
           lp.has_audio_embedding,
           lp.identifier_count,
           lp.observation_count,
           lp.confidence,
           lp.emotional, lp.cognitive, lp.social,
           lp.communication, lp.contextual, lp.artistic,
           LEAST(1, GREATEST(0,
             (1 - (
               we * abs(lp.emotional - te) +
               wc * abs(lp.cognitive - tc) +
               ws * abs(lp.social - ts) +
               wm * abs(lp.communication - tm) +
               wx * abs(lp.contextual - tx) +
               wa * abs(lp.artistic - ta)
             ) / (wsum * 100))
             + CASE
                 WHEN p_audio_source_ids IS NOT NULL
                      AND lp.audio_source_id = ANY (p_audio_source_ids) THEN boost
                 ELSE 0
               END
           )) AS fit
    FROM public.listener_profiles lp
  ), hist AS (
    SELECT width_bucket(fit, 0, 1, 100) AS bucket, count(*)::bigint AS n
    FROM scored GROUP BY 1
  ), top AS (
    SELECT * FROM scored ORDER BY fit DESC LIMIT v_limit
  )
  SELECT jsonb_build_object(
    'population', (SELECT count(*) FROM scored),
    'audio_grounded', (SELECT count(*) FROM scored WHERE has_audio_embedding),
    'buckets', 100,
    'histogram', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('bucket', bucket, 'count', n) ORDER BY bucket) FROM hist
    ), '[]'::jsonb),
    'matches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'audio_source_id', audio_source_id,
        'label', source_name,
        'fit', round(fit, 4),
        'grounding_level', grounding_level,
        'audio_grounded', has_audio_embedding,
        'identifier_count', identifier_count,
        'observation_count', observation_count,
        'confidence', confidence,
        'scores', jsonb_build_object(
          'emotional', emotional, 'cognitive', cognitive, 'social', social,
          'communication', communication, 'contextual', contextual, 'artistic', artistic
        )
      ) ORDER BY fit DESC) FROM top
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.match_listener_profiles(jsonb, jsonb, integer, uuid[], numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_listener_profiles(jsonb, jsonb, integer, uuid[], numeric) FROM anon;
REVOKE ALL ON FUNCTION public.match_listener_profiles(jsonb, jsonb, integer, uuid[], numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.match_listener_profiles(jsonb, jsonb, integer, uuid[], numeric) TO service_role;