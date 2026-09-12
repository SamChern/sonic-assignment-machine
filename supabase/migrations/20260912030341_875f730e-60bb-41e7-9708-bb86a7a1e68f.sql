CREATE OR REPLACE FUNCTION public.org_activation_enrichment(
  _organization_id uuid,
  _activation_id text,
  _sample integer DEFAULT 2000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sample integer := greatest(200, least(coalesce(_sample, 2000), 5000));
  v_total bigint := 0;
  v_scored bigint := 0;
  v_pending bigint := 0;
  v_failed bigint := 0;
  v_families jsonb := '[]'::jsonb;
  v_tags jsonb := '[]'::jsonb;
  v_conf numeric;
  v_kpis jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.has_org_access(_organization_id) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not a member of this organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.org_intuizi_activations g
     WHERE g.organization_id = _organization_id
       AND g.activation_id = _activation_id
  ) AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'this feed is not granted to your organization';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE status = 'done'),
         count(*) FILTER (WHERE status IN ('pending', 'processing')),
         count(*) FILTER (WHERE status IN ('failed', 'dead_letter'))
    INTO v_total, v_scored, v_pending, v_failed
    FROM public.intuizi_score_queue
   WHERE activation_id = _activation_id;

  WITH s AS (
    SELECT report_type, tags, confidence
      FROM public.intuizi_score_queue
     WHERE activation_id = _activation_id
     LIMIT v_sample
  )
  SELECT
    coalesce(
      (SELECT jsonb_agg(jsonb_build_object('family', report_type, 'rows', n) ORDER BY n DESC)
         FROM (SELECT report_type, count(*) n FROM s GROUP BY 1) f),
      '[]'::jsonb),
    coalesce(
      (SELECT jsonb_agg(jsonb_build_object('tag', tag, 'rows', n) ORDER BY n DESC)
         FROM (
           SELECT t.value #>> '{}' AS tag, count(*) n
             FROM s, jsonb_array_elements(
                    CASE WHEN jsonb_typeof(s.tags) = 'array' THEN s.tags ELSE '[]'::jsonb END
                  ) t(value)
            GROUP BY 1
            ORDER BY 2 DESC
            LIMIT 20
         ) g),
      '[]'::jsonb),
    (SELECT round(avg(confidence)::numeric, 3) FROM s WHERE confidence IS NOT NULL)
    INTO v_families, v_tags, v_conf;

  SELECT coalesce(
           jsonb_agg(jsonb_build_object('event', event_name, 'events', n) ORDER BY n DESC),
           '[]'::jsonb)
    INTO v_kpis
    FROM (
      SELECT event_name, count(*) n
        FROM public.pixel_events
       WHERE organization_id = _organization_id
         AND occurred_at > now() - interval '90 days'
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT 12
    ) k;

  RETURN jsonb_build_object(
    'activation_id', _activation_id,
    'rows_total', v_total,
    'rows_scored', v_scored,
    'rows_waiting', v_pending,
    'rows_failed', v_failed,
    'coverage_pct', CASE WHEN v_total > 0 THEN round((v_scored::numeric / v_total) * 100, 1) ELSE 0 END,
    'avg_confidence', v_conf,
    'signal_families', v_families,
    'top_tags', v_tags,
    'kpi_events', v_kpis,
    'sampled_rows', v_sample,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.org_activation_enrichment(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_activation_enrichment(uuid, text, integer) TO authenticated, service_role;