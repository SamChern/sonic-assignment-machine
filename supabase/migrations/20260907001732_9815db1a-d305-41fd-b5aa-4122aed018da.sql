CREATE TABLE public.listener_profiles (
  audio_source_id uuid PRIMARY KEY,
  identifier_count integer NOT NULL DEFAULT 1,
  observation_count integer NOT NULL DEFAULT 1,
  emotional numeric NOT NULL DEFAULT 0,
  cognitive numeric NOT NULL DEFAULT 0,
  social numeric NOT NULL DEFAULT 0,
  communication numeric NOT NULL DEFAULT 0,
  contextual numeric NOT NULL DEFAULT 0,
  artistic numeric NOT NULL DEFAULT 0,
  confidence numeric,
  grounding_level text,
  has_audio_embedding boolean NOT NULL DEFAULT false,
  tag_codes text[],
  source_name text,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.listener_profiles TO service_role;

ALTER TABLE public.listener_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages listener profiles"
  ON public.listener_profiles FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX idx_listener_profiles_axes
  ON public.listener_profiles (emotional, cognitive, social, communication, contextual, artistic);
CREATE INDEX idx_listener_profiles_grounded
  ON public.listener_profiles (has_audio_embedding) WHERE has_audio_embedding;

CREATE OR REPLACE FUNCTION public.refresh_listener_profiles(p_limit integer DEFAULT 250000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_written integer := 0;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 250000), 1000), 1000000);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role only';
  END IF;

  WITH src AS (
    SELECT i.audio_source_id,
           count(*)::int AS identifier_count,
           GREATEST(sum(COALESCE(i.observation_count, 1))::int, 1) AS observation_count,
           max(i.last_seen_at) AS last_seen_at,
           (array_agg(i.tag_codes ORDER BY i.updated_at DESC))[1] AS tag_codes
    FROM public.intuizi_identifiers i
    WHERE i.audio_source_id IS NOT NULL
    GROUP BY i.audio_source_id
    LIMIT v_limit
  ), latest AS (
    SELECT DISTINCT ON (sa.audio_source_id)
           sa.audio_source_id,
           sa.emotional_score, sa.cognitive_score, sa.social_score,
           sa.communication_score, sa.contextual_score, sa.artistic_score,
           sa.confidence, sa.grounding_level, sa.source_name
    FROM public.source_analyses sa
    JOIN src ON src.audio_source_id = sa.audio_source_id
    ORDER BY sa.audio_source_id, sa.created_at DESC
  )
  INSERT INTO public.listener_profiles AS lp (
    audio_source_id, identifier_count, observation_count,
    emotional, cognitive, social, communication, contextual, artistic,
    confidence, grounding_level, has_audio_embedding, tag_codes, source_name, last_seen_at, updated_at
  )
  SELECT src.audio_source_id,
         src.identifier_count,
         src.observation_count,
         COALESCE(latest.emotional_score, 0),
         COALESCE(latest.cognitive_score, 0),
         COALESCE(latest.social_score, 0),
         COALESCE(latest.communication_score, 0),
         COALESCE(latest.contextual_score, 0),
         COALESCE(latest.artistic_score, 0),
         latest.confidence,
         latest.grounding_level,
         s.profile_embedding IS NOT NULL,
         src.tag_codes,
         COALESCE(latest.source_name, s.name),
         src.last_seen_at,
         now()
  FROM src
  JOIN latest ON latest.audio_source_id = src.audio_source_id
  LEFT JOIN public.audio_sources s ON s.id = src.audio_source_id
  ON CONFLICT (audio_source_id) DO UPDATE SET
    identifier_count = EXCLUDED.identifier_count,
    observation_count = EXCLUDED.observation_count,
    emotional = EXCLUDED.emotional,
    cognitive = EXCLUDED.cognitive,
    social = EXCLUDED.social,
    communication = EXCLUDED.communication,
    contextual = EXCLUDED.contextual,
    artistic = EXCLUDED.artistic,
    confidence = EXCLUDED.confidence,
    grounding_level = EXCLUDED.grounding_level,
    has_audio_embedding = EXCLUDED.has_audio_embedding,
    tag_codes = EXCLUDED.tag_codes,
    source_name = EXCLUDED.source_name,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = now();

  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_listener_profiles(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_listener_profiles(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_listener_profiles(integer) TO service_role;

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
    SELECT width_bucket(fit, 0, 1, 20) AS bucket, count(*)::bigint AS n
    FROM scored GROUP BY 1
  ), top AS (
    SELECT * FROM scored ORDER BY fit DESC LIMIT v_limit
  )
  SELECT jsonb_build_object(
    'population', (SELECT count(*) FROM scored),
    'audio_grounded', (SELECT count(*) FROM scored WHERE has_audio_embedding),
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
REVOKE ALL ON FUNCTION public.match_listener_profiles(jsonb, jsonb, integer, uuid[], numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.match_listener_profiles(jsonb, jsonb, integer, uuid[], numeric) TO service_role;