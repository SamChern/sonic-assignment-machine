CREATE OR REPLACE FUNCTION public.claim_intuizi_score_jobs(p_limit integer DEFAULT 3)
RETURNS SETOF public.intuizi_score_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[] := '{}';
  v_need integer := GREATEST(COALESCE(p_limit, 3), 1);
BEGIN
  -- Bounded dead-letter sweep; the `attempts >= 3` predicate keeps it on the
  -- partial index instead of scanning the whole backlog.
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

  -- Fresh work first: ordered partial-index scan, oldest first.
  SELECT COALESCE(array_agg(t.id), '{}') INTO v_ids
  FROM (
    SELECT c.id
    FROM public.intuizi_score_queue c
    WHERE c.status = 'pending'
      AND c.next_attempt_at <= now()
      AND c.attempts < c.max_attempts
    ORDER BY c.created_at
    LIMIT v_need
    FOR UPDATE SKIP LOCKED
  ) t;

  -- Top up with rows abandoned mid-flight by a dead worker.
  IF array_length(v_ids, 1) IS NULL OR array_length(v_ids, 1) < v_need THEN
    SELECT v_ids || COALESCE(array_agg(t.id), '{}') INTO v_ids
    FROM (
      SELECT c.id
      FROM public.intuizi_score_queue c
      WHERE c.status = 'processing'
        AND c.started_at < now() - interval '5 minutes'
        AND c.attempts < c.max_attempts
      ORDER BY c.started_at
      LIMIT v_need - COALESCE(array_length(v_ids, 1), 0)
      FOR UPDATE SKIP LOCKED
    ) t;
  END IF;

  IF array_length(v_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.intuizi_score_queue q
  SET status = 'processing',
      started_at = now(),
      attempts = q.attempts + 1
  WHERE q.id = ANY(v_ids)
  RETURNING q.*;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer) TO service_role;