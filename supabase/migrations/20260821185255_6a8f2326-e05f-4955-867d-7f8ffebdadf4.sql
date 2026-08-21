ALTER TABLE public.embedding_cache
  ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT 'gateway:openai/text-embedding-3-small';

ALTER TABLE public.embedding_cache DROP CONSTRAINT IF EXISTS embedding_cache_pkey;
ALTER TABLE public.embedding_cache ADD PRIMARY KEY (text_hash, model);

GRANT ALL ON public.embedding_cache TO service_role;