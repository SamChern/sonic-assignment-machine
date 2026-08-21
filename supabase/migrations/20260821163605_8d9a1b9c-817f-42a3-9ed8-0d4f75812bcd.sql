ALTER TABLE public.audio_sources DROP CONSTRAINT IF EXISTS audio_sources_source_type_check;
ALTER TABLE public.audio_sources ADD CONSTRAINT audio_sources_source_type_check
  CHECK (source_type = ANY (ARRAY['file'::text, 'spotify'::text, 'apple'::text, 'ctv'::text, 'intuizi'::text]));