CREATE OR REPLACE FUNCTION public.select_listener_cohort(
  p_target jsonb,
  p_weights jsonb DEFAULT NULL,
  p_threshold numeric DEFAULT 0.6,
  p_audio_source_ids uuid[] DEFAULT NULL,
  p_audio_boost numeric DEFAULT 0.15,
  p_limit integer DEFAULT 50000
)
RETURNS TABLE(subject_key text, fit numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50000), 1), 200000);
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
  thr numeric := LEAST(GREATEST(COALESCE(p_threshold, 0.6), 0), 1);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role only';
  END IF;

  wsum := GREATEST(we + wc + ws + wm + wx + wa, 0.000001);

  RETURN QUERY
  WITH matched AS (
    SELECT lp.audio_source_id, f.fit
    FROM public.listener_profiles lp
    CROSS JOIN LATERAL (
      SELECT LEAST(1, GREATEST(0,
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
    ) f
    WHERE f.fit >= thr
  )
  SELECT ii.primary_identifier::text, round(m.fit, 4)
  FROM matched m
  JOIN public.intuizi_identifiers ii ON ii.audio_source_id = m.audio_source_id
  WHERE ii.primary_identifier IS NOT NULL
  ORDER BY m.fit DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.select_listener_cohort(jsonb, jsonb, numeric, uuid[], numeric, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.select_listener_cohort(jsonb, jsonb, numeric, uuid[], numeric, integer) FROM anon;
REVOKE ALL ON FUNCTION public.select_listener_cohort(jsonb, jsonb, numeric, uuid[], numeric, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.select_listener_cohort(jsonb, jsonb, numeric, uuid[], numeric, integer) TO service_role;