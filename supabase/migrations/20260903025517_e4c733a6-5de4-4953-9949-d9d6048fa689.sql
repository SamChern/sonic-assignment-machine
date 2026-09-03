CREATE OR REPLACE FUNCTION public.claim_intuizi_score_jobs(p_limit integer, p_activation_id text DEFAULT NULL)
RETURNS SETOF public.intuizi_score_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 1), 64));
BEGIN
  RETURN QUERY
  WITH stale AS (
    SELECT id FROM public.intuizi_score_queue
    WHERE status = 'processing'
      AND started_at < now() - interval '5 minutes'
      AND attempts < max_attempts
      AND (p_activation_id IS NULL OR activation_id = p_activation_id)
    ORDER BY started_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ),
  fresh AS (
    SELECT id FROM public.intuizi_score_queue
    WHERE status = 'pending'
      AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      AND attempts < max_attempts
      AND (p_activation_id IS NULL OR activation_id = p_activation_id)
    ORDER BY created_at ASC
    LIMIT greatest(0, v_limit - (SELECT count(*) FROM stale))
    FOR UPDATE SKIP LOCKED
  ),
  picked AS (
    SELECT id FROM stale UNION ALL SELECT id FROM fresh
  )
  UPDATE public.intuizi_score_queue q
     SET status = 'processing',
         started_at = now(),
         attempts = q.attempts + 1,
         updated_at = now()
   WHERE q.id IN (SELECT id FROM picked)
  RETURNING q.*;
END;
$$;

CREATE INDEX IF NOT EXISTS intuizi_score_queue_activation_pending_idx
  ON public.intuizi_score_queue (activation_id, status, created_at);