CREATE OR REPLACE FUNCTION public.admin_enterprise_pipeline(
  _organization_id uuid,
  _sample integer DEFAULT 1500,
  _feeds integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sample integer := LEAST(GREATEST(COALESCE(_sample, 1500), 200), 3000);
  v_limit integer := LEAST(GREATEST(COALESCE(_feeds, 12), 1), 24);
  v_row record;
  v_raw bigint;
  v_scored bigint;
  v_pending bigint;
  v_failed bigint;
  v_oldest timestamptz;
  v_last timestamptz;
  v_sampled bigint;
  v_enriched bigint;
  v_tagged bigint;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM set_config('statement_timeout', '55000', true);

  FOR v_row IN
    SELECT d.id, d.name, d.source_kind, d.status, d.shared
      FROM public.enterprise_datasets d
     WHERE d.organization_id = _organization_id
     ORDER BY d.updated_at DESC NULLS LAST, d.created_at DESC
     LIMIT v_limit
  LOOP
    SELECT count(*),
           count(*) FILTER (WHERE analysis_status = 'scored'),
           count(*) FILTER (WHERE analysis_status IS NULL
                              OR analysis_status IN ('pending', 'queued', 'processing')),
           count(*) FILTER (WHERE analysis_status IN ('failed', 'error')),
           min(created_at) FILTER (WHERE analysis_status IS NULL
                                     OR analysis_status IN ('pending', 'queued', 'processing')),
           max(updated_at) FILTER (WHERE analysis_status = 'scored')
      INTO v_raw, v_scored, v_pending, v_failed, v_oldest, v_last
      FROM public.enterprise_records
     WHERE organization_id = _organization_id
       AND dataset_id = v_row.id;

    WITH s AS (
      SELECT source_name
        FROM public.enterprise_records
       WHERE organization_id = _organization_id
         AND dataset_id = v_row.id
         AND analysis_status = 'scored'
       LIMIT v_sample
    )
    SELECT count(*),
           count(sa.id),
           count(*) FILTER (
             WHERE COALESCE(sa.grounding_level, 'text-only') IN ('grounded', 'bridged')
           )
      INTO v_sampled, v_enriched, v_tagged
      FROM s
      LEFT JOIN LATERAL (
             SELECT a.id, a.grounding_level
               FROM public.source_analyses a
              WHERE a.source_name = s.source_name
              ORDER BY a.created_at DESC
              LIMIT 1
           ) sa ON true;

    v_out := v_out || jsonb_build_object(
      'dataset_id', v_row.id,
      'name', COALESCE(v_row.name, 'Untitled dataset'),
      'source_kind', v_row.source_kind,
      'status', v_row.status,
      'shared', COALESCE(v_row.shared, false),
      'raw', v_raw,
      'scored', v_scored,
      'pending', v_pending,
      'failed', v_failed,
      'oldest_pending_at', v_oldest,
      'last_scored_at', v_last,
      'pending_age_hours', CASE WHEN v_oldest IS NULL THEN NULL
                                ELSE round(EXTRACT(EPOCH FROM (now() - v_oldest)) / 3600.0, 1) END,
      'sampled', v_sampled,
      'enriched_sampled', v_enriched,
      'tagged_sampled', v_tagged,
      'enriched_pct', CASE WHEN v_sampled > 0
                           THEN round((v_enriched::numeric / v_sampled) * 100, 1) ELSE 0 END,
      'tagged_pct', CASE WHEN v_sampled > 0
                         THEN round((v_tagged::numeric / v_sampled) * 100, 1) ELSE 0 END,
      'enriched_est', CASE WHEN v_sampled > 0
                           THEN round(v_scored * (v_enriched::numeric / v_sampled)) ELSE 0 END,
      'tagged_est', CASE WHEN v_sampled > 0
                         THEN round(v_scored * (v_tagged::numeric / v_sampled)) ELSE 0 END
    );
  END LOOP;

  RETURN jsonb_build_object(
    'organization_id', _organization_id,
    'sample_size', v_sample,
    'datasets', v_out,
    'computed_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_enterprise_pipeline(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enterprise_pipeline(uuid, integer, integer) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_enterprise_records_dataset_status
  ON public.enterprise_records (dataset_id, analysis_status);