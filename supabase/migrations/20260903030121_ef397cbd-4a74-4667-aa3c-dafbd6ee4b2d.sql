REVOKE ALL ON FUNCTION public.materialize_cached_intuizi_scores(text, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.intuizi_tag_signature(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intuizi_tag_signature(text, jsonb) TO service_role;