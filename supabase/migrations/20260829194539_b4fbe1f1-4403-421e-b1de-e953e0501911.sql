CREATE OR REPLACE FUNCTION public.acquire_named_lease(p_id text, p_owner text, p_seconds integer DEFAULT 300)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ok BOOLEAN;
BEGIN
  INSERT INTO public.job_worker_state (id) VALUES (p_id)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.job_worker_state
  SET lease_until = now() + make_interval(secs => p_seconds),
      lease_owner = p_owner,
      last_kick_at = now(),
      updated_at = now()
  WHERE id = p_id
    AND paused = false
    AND (lease_until IS NULL OR lease_until < now());
  GET DIAGNOSTICS v_ok = ROW_COUNT;
  RETURN v_ok;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_named_lease(p_id text, p_owner text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.job_worker_state
  SET lease_until = NULL, lease_owner = NULL, updated_at = now()
  WHERE id = p_id AND lease_owner = p_owner;
$function$;

REVOKE ALL ON FUNCTION public.acquire_named_lease(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_named_lease(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_named_lease(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_named_lease(text, text) TO service_role;