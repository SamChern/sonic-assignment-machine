-- Create source_cache table for storing analyzed source results
-- This enables skipping AI calls for previously-analyzed sources

CREATE TABLE public.source_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL UNIQUE,  -- spotify_id OR normalized source name hash
  source_type TEXT NOT NULL CHECK (source_type IN ('spotify', 'file')),
  emotional_score INTEGER NOT NULL CHECK (emotional_score >= 0 AND emotional_score <= 100),
  cognitive_score INTEGER NOT NULL CHECK (cognitive_score >= 0 AND cognitive_score <= 100),
  social_score INTEGER NOT NULL CHECK (social_score >= 0 AND social_score <= 100),
  communication_score INTEGER NOT NULL CHECK (communication_score >= 0 AND communication_score <= 100),
  contextual_score INTEGER NOT NULL CHECK (contextual_score >= 0 AND contextual_score <= 100),
  artistic_score INTEGER NOT NULL CHECK (artistic_score >= 0 AND artistic_score <= 100),
  emotional_desc TEXT,
  cognitive_desc TEXT,
  social_desc TEXT,
  communication_desc TEXT,
  contextual_desc TEXT,
  artistic_desc TEXT,
  source_name TEXT NOT NULL,  -- Original source name for reference
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for fast lookups by source_key
CREATE INDEX idx_source_cache_source_key ON public.source_cache(source_key);

-- Enable RLS
ALTER TABLE public.source_cache ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read from cache (it's shared analysis data)
CREATE POLICY "Anyone can read source cache"
ON public.source_cache
FOR SELECT
USING (true);

-- Only service role can insert (from edge function)
-- No INSERT policy for regular users - edge function uses service role