ALTER TABLE public.ingest_rollup_chunks DROP CONSTRAINT ingest_rollup_chunks_pkey;
ALTER TABLE public.ingest_rollup_chunks DROP COLUMN IF EXISTS part;
ALTER TABLE public.ingest_rollup_chunks ADD COLUMN IF NOT EXISTS part_key text NOT NULL DEFAULT '';
ALTER TABLE public.ingest_rollup_chunks
  ADD CONSTRAINT ingest_rollup_chunks_pkey PRIMARY KEY (object_key, source_offset, part_key);

DROP FUNCTION IF EXISTS public.stage_ingest_rollups(text, text, bigint, jsonb, integer);

CREATE OR REPLACE FUNCTION public.stage_ingest_rollups(
  p_object_key text,
  p_report_type text,
  p_source_offset bigint,
  p_rows jsonb,
  p_part_key text DEFAULT ''
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed integer := 0;
  v_count integer := 0;
BEGIN
  IF COALESCE(p_object_key, '') = ''
     OR p_rows IS NULL
     OR jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  SET LOCAL statement_timeout = '25s';
  SET LOCAL lock_timeout = '4s';

  INSERT INTO public.ingest_rollup_chunks (object_key, source_offset, part_key, rows)
  VALUES (
    p_object_key,
    GREATEST(COALESCE(p_source_offset, 0), 0),
    left(COALESCE(NULLIF(p_part_key, ''), md5(p_rows::text)), 64),
    jsonb_array_length(p_rows)
  )
  ON CONFLICT (object_key, source_offset, part_key) DO NOTHING;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;

  IF v_claimed = 0 THEN
    RETURN 0;
  END IF;

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
  ), folded AS (
    SELECT subject_key, taxonomy_code, day, sum(weight) AS weight
    FROM src
    GROUP BY subject_key, taxonomy_code, day
  ), upserted AS (
    INSERT INTO public.ingest_rollups AS existing (
      object_key, report_type, subject_key, taxonomy_code, day, weight
    )
    SELECT p_object_key, p_report_type, f.subject_key, f.taxonomy_code, f.day, f.weight
    FROM folded f
    ON CONFLICT (object_key, subject_key, taxonomy_code, COALESCE(day, '-infinity'::date))
    DO UPDATE SET
      weight = existing.weight + EXCLUDED.weight,
      report_type = COALESCE(existing.report_type, EXCLUDED.report_type),
      updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upserted;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.stage_ingest_rollups(text, text, bigint, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_ingest_rollups(text, text, bigint, jsonb, text) TO service_role;