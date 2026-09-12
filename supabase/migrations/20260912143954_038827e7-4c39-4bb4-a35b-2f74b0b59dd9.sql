CREATE OR REPLACE FUNCTION public.grounding_rescore_guard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role'
     OR public.has_role(auth.uid(), 'admin')
     OR session_user IN ('postgres', 'supabase_admin') THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'admin or service role only';
END;
$function$;

REVOKE ALL ON FUNCTION public.grounding_rescore_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grounding_rescore_guard() TO authenticated, service_role;