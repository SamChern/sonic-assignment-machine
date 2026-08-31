insert into public.control_registry (key, value, value_type, bounds, description, category)
values
  ('clap.top_k', '5'::jsonb, 'number', '{"min":1,"max":12}'::jsonb,
   'How many nearest AudioSet taxonomy nodes CLAP audio grounding attaches per source.', 'semantic'),
  ('clap.min_similarity', '0.05'::jsonb, 'number', '{"min":0,"max":1}'::jsonb,
   'Minimum CLAP cosine similarity for an AudioSet node to be attached as a tag.', 'semantic')
on conflict (key) do nothing;

insert into public.semantic_normalization (scope, enabled, speech_bias, redistribute, notes)
values ('global', true, 0.35, true,
        'Default speech-skew correction for CTV/audio-app heavy corpora. Adjust in Admin -> Speech normalization.')
on conflict (scope) do update set enabled = true;