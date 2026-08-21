CREATE TABLE IF NOT EXISTS public.audio_profile_embeddings (
  cache_key TEXT NOT NULL,
  model TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  dims INTEGER NOT NULL DEFAULT 1536,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cache_key, model)
);

GRANT ALL ON public.audio_profile_embeddings TO service_role;

ALTER TABLE public.audio_profile_embeddings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS audio_profile_embeddings_last_used_idx
  ON public.audio_profile_embeddings (last_used_at DESC);

CREATE OR REPLACE FUNCTION public.touch_audio_profile_embedding(p_cache_key TEXT, p_model TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.audio_profile_embeddings
     SET hit_count = hit_count + 1, last_used_at = now()
   WHERE cache_key = p_cache_key AND model = p_model;
$$;