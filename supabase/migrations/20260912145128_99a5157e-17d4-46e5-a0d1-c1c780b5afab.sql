CREATE OR REPLACE FUNCTION public.admin_enterprise_pipeline(
  _organization_id uuid,
  _sample integer DEFAULT 1500,
  _feeds integer DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sample integer := LEAST(GREATEST(COALESCE(_sample, 1500), 200), 3000);
  v_feeds integer := LEAST(GREATEST(COALESCE(_feeds, 6), 1), 12);
  v_row record;
  v_raw bigint;
  v_scored bigint;
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
    SELECT activation_id, label, is_active
      FROM public.org_intuizi_activations
     WHERE organization_id = _organization_id
     ORDER BY is_active DESC, activation_id
     LIMIT v_feeds
  LOOP
    SELECT count(*), count(*) FILTER (WHERE status = 'done')
      INTO v_raw, v_scored
      FROM public.intuizi_score_queue
     WHERE activation_id = v_row.activation_id;

    WITH s AS (
      SELECT identifier
        FROM public.intuizi_score_queue
       WHERE activation_id = v_row.activation_id
         AND status = 'done'
       LIMIT v_sample
    )
    SELECT count(*),
           count(ii.audio_source_id),
           count(*) FILTER (
             WHERE COALESCE(sa.grounding_level, 'text-only') IN ('grounded', 'bridged')
           )
      INTO v_sampled, v_enriched, v_tagged
      FROM s
      LEFT JOIN public.intuizi_identifiers ii
             ON ii.primary_identifier = s.identifier
      LEFT JOIN LATERAL (
             SELECT grounding_level
               FROM public.source_analyses
              WHERE audio_source_id = ii.audio_source_id
              ORDER BY created_at DESC
              LIMIT 1
           ) sa ON true;

    v_out := v_out || jsonb_build_object(
      'activation_id', v_row.activation_id,
      'label', v_row.label,
      'is_active', v_row.is_active,
      'raw', v_raw,
      'scored', v_scored,
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
    'feeds', v_out,
    'computed_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_enterprise_pipeline(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_enterprise_pipeline(uuid, integer, integer) TO authenticated, service_role;