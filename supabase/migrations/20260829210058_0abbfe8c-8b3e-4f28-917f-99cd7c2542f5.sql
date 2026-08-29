CREATE INDEX IF NOT EXISTS idx_intuizi_score_queue_exhausted
  ON public.intuizi_score_queue (created_at)
  WHERE status IN ('pending', 'processing', 'failed') AND attempts >= 3;

CREATE OR REPLACE FUNCTION public.claim_intuizi_score_jobs(p_limit integer DEFAULT 3)
RETURNS SETOF public.intuizi_score_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Bounded dead-letter sweep: retire at most a few hundred exhausted rows per
  -- claim so this never turns into a full-table update on a large backlog.
  UPDATE public.intuizi_score_queue q
  SET status = 'dead_letter',
      dead_lettered_at = now(),
      finished_at = COALESCE(q.finished_at, now()),
      failure_kind = COALESCE(q.failure_kind, 'attempts_exhausted')
  WHERE q.id IN (
    SELECT c.id
    FROM public.intuizi_score_queue c
    WHERE c.status IN ('pending', 'processing', 'failed')
      AND c.attempts >= c.max_attempts
    LIMIT 200
  );

  RETURN QUERY
  UPDATE public.intuizi_score_queue q
  SET status = 'processing',
      started_at = now(),
      attempts = q.attempts + 1
  WHERE q.id IN (
    SELECT c.id
    FROM public.intuizi_score_queue c
    WHERE c.attempts < c.max_attempts
      AND (
        (c.status = 'pending' AND c.next_attempt_at <= now())
        OR (c.status = 'processing' AND c.started_at < now() - interval '5 minutes')
      )
    ORDER BY c.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING q.*;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer) TO service_role;