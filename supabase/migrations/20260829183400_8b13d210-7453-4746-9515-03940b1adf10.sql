CREATE OR REPLACE FUNCTION public.org_retention_summary(_org uuid)
RETURNS TABLE(
  retention_days integer,
  last_run_at timestamp with time zone,
  last_status text,
  org_sources_total integer,
  org_sources_recent integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer;
BEGIN
  IF NOT public.has_org_access(_org) THEN
    RAISE EXCEPTION 'not a member of this organization';
  END IF;

  SELECT COALESCE((value #>> '{}')::numeric::integer, 90) INTO v_days
  FROM public.control_registry WHERE key = 'retention.days';
  v_days := COALESCE(v_days, 90);

  RETURN QUERY
  SELECT
    v_days,
    r.finished_at,
    r.status,
    (SELECT COUNT(*)::integer FROM public.audio_sources s WHERE s.organization_id = _org),
    (SELECT COUNT(*)::integer FROM public.audio_sources s
       WHERE s.organization_id = _org
         AND s.created_at > now() - make_interval(days => v_days))
  FROM (
    SELECT finished_at, status FROM public.retention_runs
     WHERE kind <> 'custody_scan'
     ORDER BY created_at DESC LIMIT 1
  ) r
  UNION ALL
  SELECT v_days, NULL::timestamptz, NULL::text,
    (SELECT COUNT(*)::integer FROM public.audio_sources s WHERE s.organization_id = _org),
    (SELECT COUNT(*)::integer FROM public.audio_sources s
       WHERE s.organization_id = _org
         AND s.created_at > now() - make_interval(days => v_days))
  WHERE NOT EXISTS (SELECT 1 FROM public.retention_runs WHERE kind <> 'custody_scan')
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.org_retention_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_retention_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_retention_summary(uuid) TO service_role;