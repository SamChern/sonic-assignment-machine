ALTER TABLE public.source_cache ADD COLUMN IF NOT EXISTS feature_hash text;
CREATE INDEX IF NOT EXISTS idx_source_cache_feature_hash ON public.source_cache (feature_hash) WHERE feature_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.embedding_cache (
  text_hash text PRIMARY KEY,
  embedding vector(1536) NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT ALL ON public.embedding_cache TO service_role;
ALTER TABLE public.embedding_cache ENABLE ROW LEVEL SECURITY;