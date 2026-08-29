-- ---------------------------------------------------------------------------
-- Bulk scoring-task enqueue in one guarded statement.
-- The old path upserted 1000 full rows at once into a 743 MB, six-index table;
-- every conflicting row rewrote its JSON payload and all six index entries,
-- which crossed the statement timeout and killed the worker's file.
-- Here the conflict path only touches rows that are still pending, so already
-- scored work is never rewritten, and the local timeout fails fast instead of
-- burning the whole request budget.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_score_tasks(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  -- Fail fast and retryably rather than sitting on a lock for the whole request.
  SET LOCAL statement_timeout = '20s';
  SET LOCAL lock_timeout = '4s';

  WITH src AS (
    SELECT
      r->>'object_key'                                   AS object_key,
      r->>'report_type'                                  AS report_type,
      r->>'identifier'                                   AS identifier,
      NULLIF(r->>'activation_id', '')                    AS activation_id,
      NULLIF(r->>'owner_id', '')::uuid                   AS owner_id,
      NULLIF(r->>'label', '')                            AS label,
      COALESCE(r->'tags', '[]'::jsonb)                   AS tags,
      COALESCE(r->'signals', '{}'::jsonb)                AS signals,
      COALESCE((r->>'confidence')::numeric, 0.5)         AS confidence,
      NULLIF(r->>'trace_id', '')                         AS trace_id
    FROM jsonb_array_elements(p_rows) AS r
    WHERE COALESCE(r->>'object_key', '') <> ''
      AND COALESCE(r->>'identifier', '') <> ''
  ), ins AS (
    INSERT INTO public.intuizi_score_queue AS q (
      object_key, report_type, identifier, activation_id, owner_id,
      label, tags, signals, confidence, status, trace_id, next_attempt_at, last_error
    )
    SELECT
      object_key, COALESCE(report_type, 'ctv'), identifier, activation_id, owner_id,
      label, tags, signals, confidence, 'pending', trace_id, now(), NULL
    FROM src
    ON CONFLICT (object_key, identifier) DO UPDATE
      SET tags            = EXCLUDED.tags,
          signals         = EXCLUDED.signals,
          confidence      = EXCLUDED.confidence,
          label           = COALESCE(EXCLUDED.label, q.label),
          trace_id        = EXCLUDED.trace_id,
          next_attempt_at = now(),
          last_error      = NULL,
          updated_at      = now()
      -- Only refresh work that has not been scored yet. Rows already done,
      -- skipped or dead-lettered stay exactly as they are.
      WHERE q.status = 'pending'
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM ins;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_score_tasks(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_score_tasks(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Requeue: a transient write failure must not cost us the file. The saved
-- rows_offset / row_group_cursor stay put, so the next lease resumes exactly
-- where the worker stopped. Past the attempt cap the row lands in `failed`
-- so a human looks at it instead of it cycling forever.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.requeue_ingest_file(
  p_id uuid,
  p_reason text DEFAULT NULL,
  p_max_attempts integer DEFAULT 8
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts integer;
  v_status text;
BEGIN
  SELECT COALESCE(dispatch_attempts, 0) INTO v_attempts
  FROM public.intuizi_ingest_files WHERE id = p_id;
  IF v_attempts IS NULL THEN
    RETURN NULL;
  END IF;

  v_status := CASE WHEN v_attempts + 1 >= GREATEST(COALESCE(p_max_attempts, 8), 1)
                   THEN 'failed' ELSE 'discovered' END;

  UPDATE public.intuizi_ingest_files
  SET status = v_status,
      error_message = left(COALESCE(p_reason, 'retryable write failure'), 2000),
      dispatch_attempts = v_attempts + 1,
      worker_id = NULL,
      heartbeat_at = now(),
      finished_at = CASE WHEN v_status = 'failed' THEN now() ELSE NULL END
  WHERE id = p_id;

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_ingest_file(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.requeue_ingest_file(uuid, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Blocked: the object exists but our credentials may not read it (S3 403).
-- Retrying spends nothing but time, and it is not our failure to fix, so the
-- row parks in its own terminal state and gets listed for the data provider.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_ingest_file(p_id uuid, p_reason text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.intuizi_ingest_files
  SET status = 'blocked',
      error_message = left(COALESCE(p_reason, 'object not readable with current credentials'), 2000),
      worker_id = NULL,
      heartbeat_at = now(),
      finished_at = now()
  WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.block_ingest_file(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.block_ingest_file(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Control Room knobs for the two new behaviours.
-- ---------------------------------------------------------------------------
INSERT INTO public.control_registry (key, value, value_type, bounds, description, category)
VALUES
  ('ingest.rollup_row_threshold', '5000000'::jsonb, 'number',
   '{"min": 100000, "max": 200000000, "step": 100000}'::jsonb,
   'Files with more rows than this are summarised into subject x taxonomy rollups instead of queued device by device.',
   'ingest'),
  ('ingest.max_dispatch_attempts', '8'::jsonb, 'number',
   '{"min": 1, "max": 50, "step": 1}'::jsonb,
   'How many times one ingest file may be requeued after a retryable failure before it is parked for review.',
   'ingest')
ON CONFLICT (key) DO NOTHING;