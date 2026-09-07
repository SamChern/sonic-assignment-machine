DROP INDEX IF EXISTS public.idx_intuizi_identifiers_updated_at;
CREATE INDEX idx_intuizi_identifiers_updated_at ON public.intuizi_identifiers USING btree (updated_at DESC NULLS FIRST);
ANALYZE public.intuizi_identifiers;