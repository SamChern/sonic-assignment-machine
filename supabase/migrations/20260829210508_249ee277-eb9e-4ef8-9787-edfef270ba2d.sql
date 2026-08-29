CREATE INDEX IF NOT EXISTS idx_score_queue_pending_ready
  ON public.intuizi_score_queue (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_score_queue_stale_processing
  ON public.intuizi_score_queue (started_at)
  WHERE status = 'processing';

CREATE OR REPLACE FUNCTION public.claim_intuizi_score_jobs(p_limit integer DEFAULT 3)
RETURNS SETOF public.intuizi_score_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Bounded dead-letter sweep. The extra `attempts >= 3` predicate lets this use
  -- the partial index instead of scanning the whole backlog.
  UPDATE public.intuizi_score_queue q
  SET status = 'dead_letter',
      dead_lettered_at = now(),
      finished_at = COALESCE(q.finished_at, now()),
      failure_kind = COALESCE(q.failure_kind, 'attempts_exhausted')
  WHERE q.id IN (
    SELECT c.id
    FROM public.intuizi_score_queue c
    WHERE c.status IN ('pending', 'processing', 'failed')
      AND c.attempts >= 3
      AND c.attempts >= c.max_attempts
    LIMIT 200
  );

  RETURN QUERY
  UPDATE public.intuizi_score_queue q
  SET status = 'processing',
      started_at = now(),
      attempts = q.attempts + 1
  WHERE q.id IN (
    SELECT s.id FROM (
      -- Fresh work: ordered partial-index scan, oldest first.
      (SELECT c.id, c.created_at
         FROM public.intuizi_score_queue c
        WHERE c.status = 'pending'
          AND c.next_attempt_at <= now()
          AND c.attempts < c.max_attempts
        ORDER BY c.created_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED)
      UNION ALL
      -- Rows abandoned by a dead worker.
      (SELECT c.id, c.created_at
         FROM public.intuizi_score_queue c
        WHERE c.status = 'processing'
          AND c.started_at < now() - interval '5 minutes'
          AND c.attempts < c.max_attempts
        ORDER BY c.started_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED)
    ) s
    ORDER BY s.created_at
    LIMIT p_limit
  )
  RETURNING q.*;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer) TO service_role;