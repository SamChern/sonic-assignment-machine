CREATE OR REPLACE FUNCTION public.match_grounded_audio_profiles(query_embedding vector, match_count integer DEFAULT 8, exclude_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, similarity double precision, confidence numeric, emotional_score numeric, cognitive_score numeric, social_score numeric, communication_score numeric, contextual_score numeric, artistic_score numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    a.id,
    a.name,
    1 - (a.profile_embedding <=> query_embedding) as similarity,
    sa.confidence,
    sa.emotional_score,
    sa.cognitive_score,
    sa.social_score,
    sa.communication_score,
    sa.contextual_score,
    sa.artistic_score
  from public.audio_sources a
  join lateral (
    select grounding_level, confidence, emotional_score, cognitive_score,
           social_score, communication_score, contextual_score, artistic_score
    from public.source_analyses
    where audio_source_id = a.id
    order by created_at desc
    limit 1
  ) sa on true
  where a.profile_embedding is not null
    and (exclude_id is null or a.id <> exclude_id)
    -- 'grounded' already means real audio was analysed for this row; requiring a
    -- still-live file/preview url on top of that starved the neighbour pool
    -- (2 candidates out of ~2,900 grounded rows), so audience profiles never had
    -- enough audio evidence to tune against.
    and coalesce(sa.grounding_level, 'text-only') = 'grounded'
  order by a.profile_embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 8), 50));
$function$;

REVOKE ALL ON FUNCTION public.match_grounded_audio_profiles(vector, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_grounded_audio_profiles(vector, integer, uuid) TO service_role;