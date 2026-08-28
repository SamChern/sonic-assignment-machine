-- 1. Sensitive-category suppression flag ------------------------------------
ALTER TABLE public.taxonomy_nodes
  ADD COLUMN IF NOT EXISTS suppressed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS taxonomy_nodes_suppressed_idx
  ON public.taxonomy_nodes (suppressed) WHERE suppressed;

-- 2. Retention run log -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.retention_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kind text NOT NULL DEFAULT 'intuizi_90d',
  cutoff timestamp with time zone NOT NULL,
  retention_days integer NOT NULL DEFAULT 90,
  subjects_matched integer NOT NULL DEFAULT 0,
  identifiers_deleted integer NOT NULL DEFAULT 0,
  sources_deleted integer NOT NULL DEFAULT 0,
  tags_deleted integer NOT NULL DEFAULT 0,
  analyses_deleted integer NOT NULL DEFAULT 0,
  embeddings_deleted integer NOT NULL DEFAULT 0,
  cohort_members_deleted integer NOT NULL DEFAULT 0,
  queue_rows_deleted integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  error text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.retention_runs TO authenticated;
GRANT ALL ON public.retention_runs TO service_role;

ALTER TABLE public.retention_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view retention runs"
  ON public.retention_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS retention_runs_created_idx
  ON public.retention_runs (created_at DESC);

CREATE TRIGGER update_retention_runs_updated_at
  BEFORE UPDATE ON public.retention_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Nightly retention routine ----------------------------------------------
CREATE OR REPLACE FUNCTION public.run_intuizi_retention(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_days integer := GREATEST(COALESCE(p_days, 90), 1);
  v_cutoff timestamp with time zone := now() - make_interval(days => v_days);
  v_run_id uuid;
  v_keys text[] := '{}';
  v_sources uuid[] := '{}';
  v_tags integer := 0;
  v_analyses integer := 0;
  v_embeddings integer := 0;
  v_cohort integer := 0;
  v_queue integer := 0;
  v_sources_deleted integer := 0;
  v_identifiers integer := 0;
BEGIN
  -- A signed-in caller must be an admin; the scheduled job runs with no JWT.
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.require_admin();
  END IF;

  INSERT INTO public.retention_runs (kind, cutoff, retention_days, status)
  VALUES ('intuizi_90d', v_cutoff, v_days, 'running')
  RETURNING id INTO v_run_id;

  BEGIN
    SELECT
      COALESCE(array_agg(primary_identifier), '{}'),
      COALESCE(array_agg(audio_source_id) FILTER (WHERE audio_source_id IS NOT NULL), '{}')
    INTO v_keys, v_sources
    FROM public.intuizi_identifiers
    WHERE COALESCE(last_seen_at, updated_at, created_at) < v_cutoff;

    IF array_length(v_keys, 1) IS NULL THEN
      UPDATE public.retention_runs
        SET status = 'succeeded', finished_at = now(), updated_at = now()
      WHERE id = v_run_id;
      RETURN jsonb_build_object(
        'run_id', v_run_id, 'status', 'succeeded', 'cutoff', v_cutoff,
        'subjects_matched', 0
      );
    END IF;

    DELETE FROM public.audio_source_tags WHERE audio_source_id = ANY (v_sources);
    GET DIAGNOSTICS v_tags = ROW_COUNT;

    DELETE FROM public.source_analyses WHERE audio_source_id = ANY (v_sources);
    GET DIAGNOSTICS v_analyses = ROW_COUNT;

    DELETE FROM public.audio_profile_embeddings WHERE cache_key = ANY (v_keys);
    GET DIAGNOSTICS v_embeddings = ROW_COUNT;

    DELETE FROM public.sonic_cohort_members WHERE subject_key = ANY (v_keys);
    GET DIAGNOSTICS v_cohort = ROW_COUNT;

    DELETE FROM public.intuizi_score_queue WHERE identifier = ANY (v_keys);
    GET DIAGNOSTICS v_queue = ROW_COUNT;

    DELETE FROM public.intuizi_identifiers WHERE primary_identifier = ANY (v_keys);
    GET DIAGNOSTICS v_identifiers = ROW_COUNT;

    DELETE FROM public.audio_sources
    WHERE id = ANY (v_sources) AND source_type = 'intuizi';
    GET DIAGNOSTICS v_sources_deleted = ROW_COUNT;

    IF v_cohort > 0 THEN
      UPDATE public.sonic_cohorts c
        SET member_count = (
              SELECT count(*) FROM public.sonic_cohort_members m WHERE m.cohort_id = c.id
            ),
            updated_at = now();
    END IF;

    UPDATE public.retention_runs
      SET status = 'succeeded',
          subjects_matched = array_length(v_keys, 1),
          identifiers_deleted = v_identifiers,
          sources_deleted = v_sources_deleted,
          tags_deleted = v_tags,
          analyses_deleted = v_analyses,
          embeddings_deleted = v_embeddings,
          cohort_members_deleted = v_cohort,
          queue_rows_deleted = v_queue,
          finished_at = now(),
          updated_at = now()
    WHERE id = v_run_id;

    RETURN jsonb_build_object(
      'run_id', v_run_id,
      'status', 'succeeded',
      'cutoff', v_cutoff,
      'retention_days', v_days,
      'subjects_matched', array_length(v_keys, 1),
      'identifiers_deleted', v_identifiers,
      'sources_deleted', v_sources_deleted,
      'tags_deleted', v_tags,
      'analyses_deleted', v_analyses,
      'embeddings_deleted', v_embeddings,
      'cohort_members_deleted', v_cohort,
      'queue_rows_deleted', v_queue
    );
  EXCEPTION WHEN OTHERS THEN
    -- The log row was inserted in the outer block, so it survives this rollback.
    UPDATE public.retention_runs
      SET status = 'failed', error = SQLERRM, finished_at = now(), updated_at = now()
    WHERE id = v_run_id;
    RETURN jsonb_build_object('run_id', v_run_id, 'status', 'failed', 'error', SQLERRM);
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.run_intuizi_retention(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_intuizi_retention(integer) TO authenticated, service_role;

-- 4. EID-custody compliance scan --------------------------------------------
-- Intuizi mapping keys must always arrive hashed (32-hex). A UUID-shaped value
-- means a raw MAID (GAID/IDFA) leaked in, and a dotted-quad means a raw IP.
CREATE OR REPLACE FUNCTION public.scan_intuizi_custody()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_maid_identifiers integer := 0;
  v_ip_identifiers integer := 0;
  v_maid_cohorts integer := 0;
  v_maid_sources integer := 0;
  v_maid_queue integer := 0;
  v_total integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.require_admin();
  END IF;

  SELECT count(*) INTO v_maid_identifiers FROM public.intuizi_identifiers
   WHERE primary_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  SELECT count(*) INTO v_ip_identifiers FROM public.intuizi_identifiers
   WHERE primary_identifier ~ '^\d{1,3}(\.\d{1,3}){3}$'
      OR primary_identifier ~* '^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$';

  SELECT count(*) INTO v_maid_cohorts FROM public.sonic_cohort_members
   WHERE subject_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  SELECT count(*) INTO v_maid_sources FROM public.audio_sources
   WHERE source_type = 'intuizi'
     AND (ctv_metadata->>'identifier') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  SELECT count(*) INTO v_maid_queue FROM public.intuizi_score_queue
   WHERE identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  v_total := v_maid_identifiers + v_ip_identifiers + v_maid_cohorts + v_maid_sources + v_maid_queue;

  RETURN jsonb_build_object(
    'scanned_at', now(),
    'clean', v_total = 0,
    'violations_total', v_total,
    'maid_shaped', jsonb_build_object(
      'intuizi_identifiers', v_maid_identifiers,
      'sonic_cohort_members', v_maid_cohorts,
      'audio_sources', v_maid_sources,
      'intuizi_score_queue', v_maid_queue
    ),
    'ip_shaped', jsonb_build_object('intuizi_identifiers', v_ip_identifiers)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.scan_intuizi_custody() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scan_intuizi_custody() TO authenticated, service_role;