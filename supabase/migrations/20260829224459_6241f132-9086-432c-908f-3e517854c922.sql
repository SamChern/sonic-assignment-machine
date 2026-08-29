ALTER TABLE public.ingest_rollups
  ADD COLUMN IF NOT EXISTS source_offset bigint NOT NULL DEFAULT 0;

ALTER TABLE public.ingest_rollups
  DROP CONSTRAINT IF EXISTS ingest_rollups_chunk_item_key;
ALTER TABLE public.ingest_rollups
  ADD CONSTRAINT ingest_rollups_chunk_item_key
  UNIQUE NULLS NOT DISTINCT (object_key, source_offset, subject_key, taxonomy_code, day);

CREATE INDEX IF NOT EXISTS idx_ingest_rollups_promote
  ON public.ingest_rollups (object_key, subject_key, taxonomy_code);

CREATE OR REPLACE FUNCTION public.stage_ingest_rollups(
  p_object_key text,
  p_report_type text,
  p_source_offset bigint,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF COALESCE(p_object_key, '') = ''
     OR p_rows IS NULL
     OR jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  SET LOCAL statement_timeout = '20s';
  SET LOCAL lock_timeout = '4s';

  WITH src AS (
    SELECT
      left(trim(r->>'subject_key'), 512) AS subject_key,
      left(trim(r->>'taxonomy_code'), 200) AS taxonomy_code,
      CASE
        WHEN COALESCE(r->>'day', '') ~ '^\d{4}-\d{2}-\d{2}'
        THEN left(r->>'day', 10)::date
        ELSE NULL
      END AS day,
      COALESCE(NULLIF(r->>'weight', '')::numeric, 1) AS weight
    FROM jsonb_array_elements(p_rows) AS r
    WHERE COALESCE(trim(r->>'subject_key'), '') <> ''
      AND COALESCE(trim(r->>'taxonomy_code'), '') <> ''
  ), upserted AS (
    INSERT INTO public.ingest_rollups AS existing (
      object_key, report_type, source_offset, subject_key, taxonomy_code, day, weight
    )
    SELECT
      p_object_key,
      p_report_type,
      GREATEST(COALESCE(p_source_offset, 0), 0),
      subject_key,
      taxonomy_code,
      day,
      weight
    FROM src
    ON CONFLICT (object_key, source_offset, subject_key, taxonomy_code, day)
    DO UPDATE SET
      report_type = EXCLUDED.report_type,
      weight = EXCLUDED.weight
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM upserted;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.stage_ingest_rollups(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_ingest_rollups(text, text, bigint, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.read_ingest_rollup_subject_batch(
  p_object_key text,
  p_after_subject text DEFAULT NULL,
  p_limit integer DEFAULT 250
)
RETURNS TABLE(subject_key text, tags jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH subjects AS (
    SELECT DISTINCT r.subject_key
    FROM public.ingest_rollups r
    WHERE r.object_key = p_object_key
      AND (p_after_subject IS NULL OR r.subject_key > p_after_subject)
    ORDER BY r.subject_key
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 250), 1), 1000)
  )
  SELECT
    s.subject_key,
    jsonb_agg(
      jsonb_build_object('code', x.taxonomy_code, 'weight', x.weight)
      ORDER BY x.weight DESC, x.taxonomy_code
    ) AS tags
  FROM subjects s
  CROSS JOIN LATERAL (
    SELECT r.taxonomy_code, sum(r.weight) AS weight
    FROM public.ingest_rollups r
    WHERE r.object_key = p_object_key
      AND r.subject_key = s.subject_key
    GROUP BY r.taxonomy_code
    ORDER BY sum(r.weight) DESC, r.taxonomy_code
    LIMIT 64
  ) x
  GROUP BY s.subject_key
  ORDER BY s.subject_key;
$$;

REVOKE ALL ON FUNCTION public.read_ingest_rollup_subject_batch(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_ingest_rollup_subject_batch(text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_intuizi_score_jobs(p_limit integer DEFAULT 3)
RETURNS SETOF public.intuizi_score_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[] := '{}';
  v_need integer := LEAST(GREATEST(COALESCE(p_limit, 3), 1), 64);
BEGIN
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

  IF COALESCE(array_length(v_ids, 1), 0) < v_need THEN
    SELECT v_ids || COALESCE(array_agg(t.id), '{}') INTO v_ids
    FROM (
      SELECT c.id
      FROM public.intuizi_score_queue c
      WHERE c.status = 'processing'
        AND c.started_at < now() - interval '5 minutes'
        AND c.attempts < c.max_attempts
        AND NOT (c.id = ANY(v_ids))
      ORDER BY c.started_at
      LIMIT v_need - COALESCE(array_length(v_ids, 1), 0)
      FOR UPDATE SKIP LOCKED
    ) t;
  END IF;

  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
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
$$;

REVOKE ALL ON FUNCTION public.claim_intuizi_score_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_intuizi_score_jobs(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.retire_exhausted_intuizi_score_jobs(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH retired AS (
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
      ORDER BY c.created_at
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)
      FOR UPDATE SKIP LOCKED
    )
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM retired;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.retire_exhausted_intuizi_score_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retire_exhausted_intuizi_score_jobs(integer) TO service_role;