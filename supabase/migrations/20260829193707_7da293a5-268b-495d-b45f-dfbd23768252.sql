ALTER TABLE public.org_intuizi_activations
  ADD COLUMN IF NOT EXISTS last_export_object_key text,
  ADD COLUMN IF NOT EXISTS last_export_row_count integer,
  ADD COLUMN IF NOT EXISTS last_export_at timestamp with time zone;