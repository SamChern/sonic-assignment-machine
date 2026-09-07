REVOKE ALL ON FUNCTION public.refresh_listener_profiles(integer) FROM anon;
REVOKE ALL ON FUNCTION public.match_listener_profiles(jsonb, jsonb, integer, uuid[], numeric) FROM anon;