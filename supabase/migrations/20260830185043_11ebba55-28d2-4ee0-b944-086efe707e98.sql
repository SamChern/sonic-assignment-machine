REVOKE EXECUTE ON FUNCTION public.grounding_coverage() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grounding_gaps(integer, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.grounding_coverage() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grounding_gaps(integer, text) TO authenticated, service_role;