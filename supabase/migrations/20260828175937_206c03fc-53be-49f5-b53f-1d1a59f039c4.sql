ALTER TABLE public.source_analyses
  ADD COLUMN IF NOT EXISTS context_neighbors jsonb;