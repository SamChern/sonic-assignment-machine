CREATE INDEX IF NOT EXISTS idx_intuizi_identifiers_linked_recent
  ON public.intuizi_identifiers (last_seen_at DESC NULLS LAST, primary_identifier)
  WHERE audio_source_id IS NOT NULL;