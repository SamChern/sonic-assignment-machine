-- Nearest neighbours restricted to sources whose scores came from actually
-- listening to audio (grounding_level = 'grounded' and a playable location).
create or replace function public.match_grounded_audio_profiles(
  query_embedding vector,
  match_count integer default 8,
  exclude_id uuid default null
)
returns table(
  id uuid,
  name text,
  similarity double precision,
  confidence numeric,
  emotional_score numeric,
  cognitive_score numeric,
  social_score numeric,
  communication_score numeric,
  contextual_score numeric,
  artistic_score numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
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
    and coalesce(sa.grounding_level, 'text-only') = 'grounded'
    and (a.file_url is not null or a.preview_url is not null)
  order by a.profile_embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 8), 50));
$$;

revoke all on function public.match_grounded_audio_profiles(vector, integer, uuid) from public;
revoke all on function public.match_grounded_audio_profiles(vector, integer, uuid) from anon;
revoke all on function public.match_grounded_audio_profiles(vector, integer, uuid) from authenticated;
grant execute on function public.match_grounded_audio_profiles(vector, integer, uuid) to service_role;

insert into public.control_registry (key, value, value_type, bounds, description, category)
values
  ('clap.profile_tune_weight', '0.35'::jsonb, 'number', '{"min":0,"max":0.8}'::jsonb, 'How far an activation profile''s six scores may move toward its audio-grounded neighbours (0 disables).', 'clap'),
  ('clap.profile_tune_min_similarity', '0.15'::jsonb, 'number', '{"min":0,"max":1}'::jsonb, 'Minimum CLAP similarity for a grounded neighbour to influence an audience profile.', 'clap'),
  ('clap.profile_tune_neighbours', '8'::jsonb, 'number', '{"min":1,"max":30}'::jsonb, 'How many audio-grounded neighbours to retrieve when tuning an audience profile.', 'clap'),
  ('clap.profile_tune_confidence_cap', '0.9'::jsonb, 'number', '{"min":0.5,"max":0.99}'::jsonb, 'Ceiling for confidence after audio grounding raises it.', 'clap'),
  ('clap.profile_tune_confidence_boost', '0.25'::jsonb, 'number', '{"min":0,"max":0.5}'::jsonb, 'Maximum confidence gain when grounded audio agrees with the profile.', 'clap')
on conflict (key) do nothing;