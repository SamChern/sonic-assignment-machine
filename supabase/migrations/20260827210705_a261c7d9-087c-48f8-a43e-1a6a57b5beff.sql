ALTER TABLE public.intuizi_score_queue
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS failure_kind text,
  ADD COLUMN IF NOT EXISTS last_stage text,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS step_scale numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_intuizi_score_queue_ready
  ON public.intuizi_score_queue (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_intuizi_score_queue_trace
  ON public.intuizi_score_queue (trace_id);

CREATE OR REPLACE FUNCTION public.claim_intuizi_score_jobs(p_limit integer DEFAULT 3)
RETURNS SETOF public.intuizi_score_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Anything that exhausted its attempt budget goes to the dead-letter state so
  -- it is never silently retried forever nor silently dropped.
  UPDATE public.intuizi_score_queue q
  SET status = 'dead_letter',
      dead_lettered_at = now(),
      finished_at = COALESCE(q.finished_at, now()),
      failure_kind = COALESCE(q.failure_kind, 'attempts_exhausted')
  WHERE q.status IN ('pending', 'processing', 'failed')
    AND q.attempts >= q.max_attempts;

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
$$;

REVOKE ALL ON FUNCTION public.claim_intuizi_score_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.requeue_intuizi_score_failures(
  p_object_key text DEFAULT NULL,
  p_activation_id text DEFAULT NULL,
  p_include_dead_letter boolean DEFAULT true,
  p_extra_attempts integer DEFAULT 3
)
RETURNS TABLE(requeued integer, remaining_dead_letter integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_dlq integer;
BEGIN
  PERFORM public.require_admin();

  WITH upd AS (
    UPDATE public.intuizi_score_queue q
    SET status = 'pending',
        next_attempt_at = now(),
        max_attempts = q.attempts + GREATEST(COALESCE(p_extra_attempts, 3), 1),
        step_scale = LEAST(GREATEST(q.step_scale * 0.5, 0.25), 1),
        dead_lettered_at = NULL,
        started_at = NULL,
        finished_at = NULL
    WHERE (q.status = 'failed' OR (p_include_dead_letter AND q.status = 'dead_letter'))
      AND (p_object_key IS NULL OR q.object_key = p_object_key)
      AND (p_activation_id IS NULL OR q.activation_id = p_activation_id)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM upd;

  SELECT count(*)::int INTO v_dlq
  FROM public.intuizi_score_queue q
  WHERE q.status = 'dead_letter'
    AND (p_object_key IS NULL OR q.object_key = p_object_key)
    AND (p_activation_id IS NULL OR q.activation_id = p_activation_id);

  RETURN QUERY SELECT v_count, v_dlq;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_intuizi_score_failures(text, text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.requeue_intuizi_score_failures(text, text, boolean, integer) TO authenticated, service_role;