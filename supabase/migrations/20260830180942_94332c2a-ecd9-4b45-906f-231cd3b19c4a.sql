ALTER TABLE public.intuizi_ingest_files
  ADD COLUMN IF NOT EXISTS retryable_stops integer NOT NULL DEFAULT 0;