ALTER TABLE public.intuizi_ingest_files
  ADD COLUMN IF NOT EXISTS row_group_cursor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS row_groups_total integer,
  ADD COLUMN IF NOT EXISTS rows_offset bigint NOT NULL DEFAULT 0;