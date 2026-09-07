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
           max(i.last_seen_at) AS last_seen_at
    FROM public.intuizi_identifiers i
    WHERE i.audio_source_id IS NOT NULL
    GROUP BY i.audio_source_id
    LIMIT v_limit
  ), tags AS (
    SELECT DISTINCT ON (i.audio_source_id) i.audio_source_id, i.tag_codes
    FROM public.intuizi_identifiers i
    WHERE i.audio_source_id IS NOT NULL
    ORDER BY i.audio_source_id, i.updated_at DESC
  ), latest AS (
    SELECT DISTINCT ON (sa.audio_source_id)
           sa.audio_source_id, sa.emotional_score, sa.cognitive_score, sa.social_score,
           sa.communication_score, sa.contextual_score, sa.artistic_score,
           sa.confidence, sa.grounding_level, sa.source_name
    FROM public.source_analyses sa
    WHERE sa.audio_source_id IS NOT NULL
    ORDER BY sa.audio_source_id, sa.created_at DESC
  )
  INSERT INTO public.listener_profiles (
    audio_source_id, identifier_count, observation_count,
    emotional, cognitive, social, communication, contextual, artistic,
    confidence, grounding_level, has_audio_embedding, tag_codes, source_name, last_seen_at, updated_at
  )
  SELECT src.audio_source_id, src.identifier_count, src.observation_count,
         COALESCE(latest.emotional_score, 0), COALESCE(latest.cognitive_score, 0),
         COALESCE(latest.social_score, 0), COALESCE(latest.communication_score, 0),
         COALESCE(latest.contextual_score, 0), COALESCE(latest.artistic_score, 0),
         latest.confidence, latest.grounding_level, s.profile_embedding IS NOT NULL,
         tags.tag_codes, COALESCE(latest.source_name, s.name), src.last_seen_at, now()
  FROM src
  JOIN latest ON latest.audio_source_id = src.audio_source_id
  LEFT JOIN tags ON tags.audio_source_id = src.audio_source_id
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
REVOKE ALL ON FUNCTION public.refresh_listener_profiles(integer) FROM anon;
REVOKE ALL ON FUNCTION public.refresh_listener_profiles(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_listener_profiles(integer) TO service_role;