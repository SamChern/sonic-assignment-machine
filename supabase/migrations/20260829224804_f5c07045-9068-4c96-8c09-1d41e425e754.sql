ALTER TABLE public.intuizi_ingest_files
  ADD COLUMN IF NOT EXISTS promotion_cursor text,
  ADD COLUMN IF NOT EXISTS promoted_subjects bigint NOT NULL DEFAULT 0;