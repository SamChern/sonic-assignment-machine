
CREATE OR REPLACE FUNCTION public.match_audio_profiles(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  exclude_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  similarity float,
  emotional_score numeric,
  cognitive_score numeric,
  social_score numeric,
  communication_score numeric,
  contextual_score numeric,
  artistic_score numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    a.id,
    a.name,
    1 - (a.profile_embedding <=> query_embedding) AS similarity,
    sa.emotional_score,
    sa.cognitive_score,
    sa.social_score,
    sa.communication_score,
    sa.contextual_score,
    sa.artistic_score
  FROM public.audio_sources a
  JOIN LATERAL (
    SELECT emotional_score, cognitive_score, social_score,
           communication_score, contextual_score, artistic_score
    FROM public.source_analyses
    WHERE audio_source_id = a.id
    ORDER BY created_at DESC
    LIMIT 1
  ) sa ON true
  WHERE a.profile_embedding IS NOT NULL
    AND (exclude_id IS NULL OR a.id <> exclude_id)
  ORDER BY a.profile_embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_audio_profiles(vector, int, uuid) TO authenticated, service_role;
