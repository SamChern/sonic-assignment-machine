CREATE INDEX IF NOT EXISTS idx_source_analyses_source_name ON public.source_analyses (source_name);
CREATE INDEX IF NOT EXISTS idx_enterprise_records_dataset ON public.enterprise_records (dataset_id, analysis_status);

CREATE OR REPLACE FUNCTION public.admin_enterprise_scoring_progress(
  _organization_id uuid,
  _sample integer DEFAULT 600
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sample integer := GREATEST(50, LEAST(COALESCE(_sample, 600), 2000));
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT jsonb_build_object(
    'organization_id', _organization_id,
    'sample_size', v_sample,
    'computed_at', now(),
    'datasets', COALESCE(jsonb_agg(d ORDER BY (d->>'name')), '[]'::jsonb)
  )
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'dataset_id', ds.id,
      'name', ds.name,
      'source_kind', ds.source_kind,
      'status', ds.status,
      'shared', ds.shared,
      'row_count', ds.row_count,
      'rows', counts.total,
      'scored', counts.scored,
      'unresolved', counts.unresolved,
      'pending', counts.pending,
      'avg_confidence', counts.avg_confidence,
      'sampled', COALESCE(ev.sampled, 0),
      'matched', COALESCE(ev.matched, 0),
      'grounded', COALESCE(ev.grounded, 0),
      'bridged', COALESCE(ev.bridged, 0),
      'audio_evidence', COALESCE(ev.audio_evidence, 0),
      'grounded_pct', CASE WHEN COALESCE(ev.sampled, 0) > 0
        THEN round((ev.grounded::numeric * 100) / ev.sampled, 1) ELSE 0 END,
      'audio_pct', CASE WHEN COALESCE(ev.sampled, 0) > 0
        THEN round((ev.audio_evidence::numeric * 100) / ev.sampled, 1) ELSE 0 END,
      'grounded_est', CASE WHEN COALESCE(ev.sampled, 0) > 0
        THEN round((ev.grounded::numeric / ev.sampled) * counts.total) ELSE 0 END,
      'audio_evidence_est', CASE WHEN COALESCE(ev.sampled, 0) > 0
        THEN round((ev.audio_evidence::numeric / ev.sampled) * counts.total) ELSE 0 END,
      'averages', jsonb_build_object(
        'emotional', ds.emotional_avg,
        'cognitive', ds.cognitive_avg,
        'social', ds.social_avg,
        'communication', ds.communication_avg,
        'contextual', ds.contextual_avg,
        'artistic', ds.artistic_avg
      ),
      'last_run', (
        SELECT jsonb_build_object(
          'status', r.status,
          'processed', r.processed,
          'scored', r.scored,
          'unresolved', r.unresolved,
          'avg_confidence', r.avg_confidence,
          'trigger_source', r.trigger_source,
          'error', r.error,
          'started_at', r.started_at,
          'finished_at', r.finished_at
        )
        FROM public.org_scoring_runs r
        WHERE r.organization_id = _organization_id
          AND (r.dataset_id = ds.id OR r.dataset_id IS NULL)
        ORDER BY r.started_at DESC NULLS LAST
        LIMIT 1
      )
    ) AS d
    FROM public.enterprise_datasets ds
    CROSS JOIN LATERAL (
      SELECT
        count(*)::bigint AS total,
        count(*) FILTER (WHERE er.analysis_status = 'scored')::bigint AS scored,
        count(*) FILTER (WHERE er.analysis_status = 'unresolved')::bigint AS unresolved,
        count(*) FILTER (WHERE er.analysis_status NOT IN ('scored', 'unresolved'))::bigint AS pending,
        round(avg(er.score_confidence) FILTER (WHERE er.score_confidence IS NOT NULL), 3) AS avg_confidence
      FROM public.enterprise_records er
      WHERE er.dataset_id = ds.id
    ) counts
    LEFT JOIN LATERAL (
      SELECT
        count(*)::bigint AS sampled,
        count(*) FILTER (WHERE m.grounding_level IS NOT NULL)::bigint AS matched,
        count(*) FILTER (WHERE m.grounding_level = 'grounded')::bigint AS grounded,
        count(*) FILTER (WHERE m.grounding_level = 'bridged')::bigint AS bridged,
        count(*) FILTER (WHERE m.audio_source_id IS NOT NULL)::bigint AS audio_evidence
      FROM (
        SELECT er.source_name
        FROM public.enterprise_records er
        WHERE er.dataset_id = ds.id
        ORDER BY er.updated_at DESC
        LIMIT v_sample
      ) s
      LEFT JOIN LATERAL (
        SELECT sa.grounding_level, sa.audio_source_id
        FROM public.source_analyses sa
        WHERE sa.source_name = s.source_name
        ORDER BY sa.created_at DESC
        LIMIT 1
      ) m ON true
    ) ev ON true
    WHERE ds.organization_id = _organization_id
  ) rows_out;

  RETURN COALESCE(v_result, jsonb_build_object(
    'organization_id', _organization_id,
    'sample_size', v_sample,
    'computed_at', now(),
    'datasets', '[]'::jsonb
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_enterprise_scoring_progress(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_enterprise_scoring_progress(uuid, integer) TO authenticated;