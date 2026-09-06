create or replace function public.get_method_examples(_limit int default 6)
returns table (
  id uuid,
  source_name text,
  grounding_level text,
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
set search_path = public
as $$
  select a.id, a.source_name, a.grounding_level,
         a.emotional_score, a.cognitive_score, a.social_score,
         a.communication_score, a.contextual_score, a.artistic_score
  from public.source_analyses a
  where a.source_name is not null
  order by (case a.grounding_level when 'grounded' then 0 when 'bridged' then 1 else 2 end),
           a.created_at desc
  limit least(greatest(coalesce(_limit, 6), 1), 12)
$$;

grant execute on function public.get_method_examples(int) to anon, authenticated;