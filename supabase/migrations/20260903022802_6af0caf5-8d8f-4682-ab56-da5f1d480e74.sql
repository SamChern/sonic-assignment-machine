CREATE TABLE IF NOT EXISTS public.intuizi_tag_score_cache (
  tag_signature text PRIMARY KEY,
  report_type text NOT NULL,
  tag_codes text[] NOT NULL DEFAULT '{}',
  scores jsonb NOT NULL,
  descriptions jsonb,
  grounding_level text NOT NULL DEFAULT 'text-only',
  confidence numeric(4,3) NOT NULL DEFAULT 0.5,
  hits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.intuizi_tag_score_cache TO service_role;
GRANT SELECT ON public.intuizi_tag_score_cache TO authenticated;

ALTER TABLE public.intuizi_tag_score_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read tag score cache" ON public.intuizi_tag_score_cache;
CREATE POLICY "Admins read tag score cache"
  ON public.intuizi_tag_score_cache FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_tag_score_cache_report ON public.intuizi_tag_score_cache (report_type, updated_at DESC);

-- Stale reclaim must come FIRST, otherwise abandoned `processing` rows are
-- starved for as long as any pending backlog exists (1.1M rows => forever).
DROP FUNCTION IF EXISTS public.claim_intuizi_score_jobs(integer);
CREATE FUNCTION public.claim_intuizi_score_jobs(p_limit integer DEFAULT 3)
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
    ORDER BY started_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ),
  fresh AS (
    SELECT id FROM public.intuizi_score_queue
    WHERE status = 'pending'
      AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      AND attempts < max_attempts
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

GRANT EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer) TO service_role;

-- Recover the current backlog.
UPDATE public.intuizi_score_queue
   SET status = 'pending', started_at = NULL, next_attempt_at = now(), updated_at = now()
 WHERE status = 'processing'
   AND started_at < now() - interval '10 minutes';

-- Credit-limit / policy dead letters were never the identifier's fault.
UPDATE public.intuizi_score_queue
   SET status = 'pending', attempts = 0, last_error = NULL, failure_kind = NULL,
       next_attempt_at = now(), updated_at = now()
 WHERE status = 'dead_letter'
   AND (failure_kind IN ('policy', 'credits') OR last_error ILIKE '%credit_limit_reached%');

UPDATE public.intuizi_ingest_state
   SET paused = false, parked_until = NULL
 WHERE paused = true OR parked_until IS NOT NULL;