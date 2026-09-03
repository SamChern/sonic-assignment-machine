REVOKE ALL ON FUNCTION public.build_activation_profile(text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.backfill_intuizi_activation_ids(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_activation_profile(text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_intuizi_activation_ids(integer) TO authenticated, service_role;