CREATE OR REPLACE FUNCTION public.claim_analysis_jobs(p_limit integer DEFAULT 2)
RETURNS SETOF public.analysis_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.analysis_jobs j
  SET status = 'processing',
      started_at = now(),
      attempts = j.attempts + 1
  WHERE j.id IN (
    SELECT c.id
    FROM public.analysis_jobs c
    WHERE c.status = 'pending'
       OR (c.status = 'processing' AND c.started_at < now() - interval '10 minutes')
    ORDER BY c.priority ASC, c.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING j.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_analysis_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_analysis_jobs(integer) TO service_role;