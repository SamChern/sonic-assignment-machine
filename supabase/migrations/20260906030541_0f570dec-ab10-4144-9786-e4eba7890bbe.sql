-- 1) Batched terminal write for the scoring queue: one call per claimed batch
-- instead of one UPDATE per identifier.
CREATE OR REPLACE FUNCTION public.finish_intuizi_score_jobs(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  WITH src AS (
    SELECT (r->>'id')::uuid AS id,
           r->>'status' AS status,
           nullif(r->>'last_error','') AS last_error,
           nullif(r->>'failure_kind','') AS failure_kind,
           nullif(r->>'last_stage','') AS last_stage,
           nullif(r->>'trace_id','') AS trace_id,
           nullif(r->>'step_scale','')::numeric AS step_scale,
           nullif(r->>'attempts','')::integer AS attempts,
           nullif(r->>'next_attempt_at','')::timestamptz AS next_attempt_at,
           nullif(r->>'dead_lettered_at','')::timestamptz AS dead_lettered_at,
           nullif(r->>'finished_at','')::timestamptz AS finished_at
      FROM jsonb_array_elements(p_rows) r
  ), upd AS (
    UPDATE public.intuizi_score_queue q
       SET status = coalesce(s.status, q.status),
           last_error = s.last_error,
           failure_kind = s.failure_kind,
           last_stage = coalesce(s.last_stage, q.last_stage),
           trace_id = coalesce(s.trace_id, q.trace_id),
           step_scale = coalesce(s.step_scale, q.step_scale),
           attempts = coalesce(s.attempts, q.attempts),
           next_attempt_at = coalesce(s.next_attempt_at, q.next_attempt_at),
           dead_lettered_at = s.dead_lettered_at,
           finished_at = s.finished_at
      FROM src s
     WHERE q.id = s.id
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM upd;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.finish_intuizi_score_jobs(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_intuizi_score_jobs(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_intuizi_score_jobs(jsonb) TO service_role;

-- 2) Retention history index: the compliance view filters by kind + status and
-- reads newest-first, which currently sorts the whole table.
CREATE INDEX IF NOT EXISTS retention_runs_kind_status_created_idx
  ON public.retention_runs (kind, status, created_at DESC);

-- 3) Covering index so the scoring-budget aggregate is index-only (no heap
-- fetches over a million queue rows) — this is what times the card out.
CREATE INDEX IF NOT EXISTS intuizi_score_queue_activation_status_idx
  ON public.intuizi_score_queue (activation_id, status)
  WHERE activation_id IS NOT NULL;