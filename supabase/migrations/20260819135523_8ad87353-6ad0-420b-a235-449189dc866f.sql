REVOKE EXECUTE ON FUNCTION public.acquire_intuizi_lease(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_intuizi_lease(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_intuizi_lease(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_intuizi_lease(TEXT) TO service_role;