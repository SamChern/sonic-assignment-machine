-- Only admins (JWT path) and the scheduler/service role may run these routines.
REVOKE EXECUTE ON FUNCTION public.run_intuizi_retention(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.scan_intuizi_custody() FROM anon;

-- Nightly custody scan wrapper: runs the scan and logs the outcome so the
-- admin compliance card always has a dated assertion to display.
CREATE OR REPLACE FUNCTION public.log_intuizi_custody_scan()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_result jsonb;
  v_clean boolean;
  v_run_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.require_admin();
  END IF;

  v_result := public.scan_intuizi_custody();
  v_clean := COALESCE((v_result->>'clean')::boolean, false);

  INSERT INTO public.retention_runs (kind, cutoff, retention_days, status, details, finished_at, error)
  VALUES (
    'custody_scan', now(), 90,
    CASE WHEN v_clean THEN 'succeeded' ELSE 'failed' END,
    v_result, now(),
    CASE WHEN v_clean THEN NULL ELSE 'raw identifier patterns detected in Intuizi-sourced tables' END
  )
  RETURNING id INTO v_run_id;

  RETURN v_result || jsonb_build_object('run_id', v_run_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.log_intuizi_custody_scan() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_intuizi_custody_scan() TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_intuizi_custody_scan() TO service_role;

-- Nightly schedules (idempotent: unschedule if already present).
DO $cron$
BEGIN
  PERFORM cron.unschedule('intuizi-retention-90d');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$cron$;

DO $cron$
BEGIN
  PERFORM cron.unschedule('intuizi-custody-scan');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$cron$;

SELECT cron.schedule(
  'intuizi-retention-90d',
  '15 3 * * *',
  $$SELECT public.run_intuizi_retention(90);$$
);

SELECT cron.schedule(
  'intuizi-custody-scan',
  '45 3 * * *',
  $$SELECT public.log_intuizi_custody_scan();$$
);