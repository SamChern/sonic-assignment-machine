-- Admin gate helper
CREATE OR REPLACE FUNCTION public.require_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authorized: authentication required'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorized: admin role required'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.require_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_admin() TO service_role;

-- Admin-only entry points for privileged maintenance routines
CREATE OR REPLACE FUNCTION public.admin_recalculate_user_fingerprint(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_admin();
  PERFORM public.recalculate_user_fingerprint(p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_recalculate_all_fingerprints()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  PERFORM public.require_admin();
  SELECT public.recalculate_all_fingerprints() INTO v_count;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_prune_analysis_telemetry(
  p_log_days integer DEFAULT 30,
  p_job_days integer DEFAULT 7,
  p_cache_idle_days integer DEFAULT 180
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.require_admin();
  SELECT public.prune_analysis_telemetry(p_log_days, p_job_days, p_cache_idle_days) INTO v_result;
  RETURN v_result;
END;
$$;

-- Only signed-in users may call the admin wrappers (the wrapper itself enforces the admin role)
REVOKE ALL ON FUNCTION public.admin_recalculate_user_fingerprint(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_recalculate_all_fingerprints() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_prune_analysis_telemetry(integer, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_recalculate_user_fingerprint(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_recalculate_all_fingerprints() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_prune_analysis_telemetry(integer, integer, integer) TO authenticated, service_role;

-- Underlying internal routines remain backend-only
REVOKE ALL ON FUNCTION public.recalculate_user_fingerprint(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_all_fingerprints() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_analysis_telemetry(integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_analysis_jobs(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acquire_intuizi_lease(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_intuizi_lease(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.recalculate_user_fingerprint(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_all_fingerprints() TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_analysis_telemetry(integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_analysis_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_intuizi_lease(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_intuizi_lease(text) TO service_role;