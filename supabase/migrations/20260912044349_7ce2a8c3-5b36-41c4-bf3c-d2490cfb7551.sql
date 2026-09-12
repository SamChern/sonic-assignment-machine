CREATE OR REPLACE FUNCTION public.org_signal_sonicsim(
  _organization_id uuid,
  _activation_id text,
  _family text DEFAULT NULL,
  _sample integer DEFAULT 2000,
  _top integer DEFAULT 12
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sample integer := LEAST(GREATEST(COALESCE(_sample, 2000), 200), 8000);
  v_top integer := LEAST(GREATEST(COALESCE(_top, 12), 1), 30);
  v_families jsonb := '[]'::jsonb;
  v_values jsonb := '[]'::jsonb;
  v_sampled integer := 0;
  v_scored integer := 0;
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

  PERFORM set_config('statement_timeout', '25000', true);

  CREATE TEMP TABLE _sigsim ON COMMIT DROP AS
  WITH s AS (
    SELECT q.id, q.identifier, q.report_type, q.tags, q.confidence
      FROM public.intuizi_score_queue q
     WHERE q.activation_id = _activation_id
     ORDER BY q.updated_at DESC
     LIMIT v_sample
  ), scored AS (
    SELECT s.id, s.identifier, s.report_type, s.tags,
           COALESCE(s.confidence, tc.confidence, lp.confidence) AS confidence,
           COALESCE(lp.grounding_level, tc.grounding_level, 'text-only') AS grounding_level,
           CASE WHEN lp.audio_source_id IS NOT NULL THEN jsonb_build_object(
                  'emotional', lp.emotional, 'cognitive', lp.cognitive, 'social', lp.social,
                  'communication', lp.communication, 'contextual', lp.contextual,
                  'artistic', lp.artistic)
                ELSE tc.scores END AS scores,
           (lp.audio_source_id IS NOT NULL) AS audio_backed
      FROM s
      LEFT JOIN public.intuizi_identifiers i ON i.primary_identifier = s.identifier
      LEFT JOIN public.listener_profiles lp ON lp.audio_source_id = i.audio_source_id
      LEFT JOIN public.intuizi_tag_score_cache tc
        ON tc.tag_signature = public.intuizi_tag_signature(s.report_type, s.tags)
       AND tc.report_type = s.report_type
  ), ex AS (
    SELECT sc.*, btrim(CASE
             WHEN jsonb_typeof(t.value) = 'object' THEN COALESCE(t.value->>'label', t.value->>'code')
             ELSE t.value #>> '{}'
           END) AS label
      FROM scored sc, jsonb_array_elements(
             CASE WHEN jsonb_typeof(sc.tags) = 'array' THEN sc.tags ELSE '[]'::jsonb END
           ) t(value)
  )
  SELECT id, identifier, confidence, grounding_level, scores, audio_backed, label,
         CASE WHEN position(': ' IN label) > 0 THEN split_part(label, ': ', 1)
              ELSE COALESCE(report_type, 'unknown') END AS family,
         CASE WHEN position(': ' IN label) > 0 THEN substr(label, position(': ' IN label) + 2)
              ELSE label END AS value
    FROM ex
   WHERE label IS NOT NULL AND label <> '';

  SELECT count(DISTINCT id)::int,
         count(DISTINCT id) FILTER (WHERE scores IS NOT NULL)::int
    INTO v_sampled, v_scored
    FROM _sigsim;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'family', family, 'values', values_n, 'devices', devices) ORDER BY devices DESC), '[]'::jsonb)
    INTO v_families
    FROM (
      SELECT family, count(DISTINCT value) AS values_n, count(DISTINCT id) AS devices
        FROM _sigsim
       WHERE scores IS NOT NULL
       GROUP BY family
       ORDER BY 3 DESC
       LIMIT 20
    ) f;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'value', value,
           'family', family,
           'devices', devices,
           'audio_devices', audio_devices,
           'avg_confidence', avg_confidence,
           'scores', jsonb_build_object(
             'emotional', emotional, 'cognitive', cognitive, 'social', social,
             'communication', communication, 'contextual', contextual, 'artistic', artistic),
           'lead_category', lead_category,
           'lead_score', lead_score
         ) ORDER BY devices DESC), '[]'::jsonb)
    INTO v_values
    FROM (
      SELECT family, value,
             count(DISTINCT id) AS devices,
             count(DISTINCT id) FILTER (WHERE audio_backed) AS audio_devices,
             round(avg(confidence)::numeric, 3) AS avg_confidence,
             round(avg((scores->>'emotional')::numeric), 1) AS emotional,
             round(avg((scores->>'cognitive')::numeric), 1) AS cognitive,
             round(avg((scores->>'social')::numeric), 1) AS social,
             round(avg((scores->>'communication')::numeric), 1) AS communication,
             round(avg((scores->>'contextual')::numeric), 1) AS contextual,
             round(avg((scores->>'artistic')::numeric), 1) AS artistic,
             (ARRAY['emotional','cognitive','social','communication','contextual','artistic'])[
               (SELECT n FROM (
                  SELECT 1 n, avg((scores->>'emotional')::numeric) v
                  UNION ALL SELECT 2, avg((scores->>'cognitive')::numeric)
                  UNION ALL SELECT 3, avg((scores->>'social')::numeric)
                  UNION ALL SELECT 4, avg((scores->>'communication')::numeric)
                  UNION ALL SELECT 5, avg((scores->>'contextual')::numeric)
                  UNION ALL SELECT 6, avg((scores->>'artistic')::numeric)
                ) x ORDER BY v DESC NULLS LAST LIMIT 1)] AS lead_category,
             (SELECT round(max(v), 1) FROM (
                  SELECT avg((scores->>'emotional')::numeric) v
                  UNION ALL SELECT avg((scores->>'cognitive')::numeric)
                  UNION ALL SELECT avg((scores->>'social')::numeric)
                  UNION ALL SELECT avg((scores->>'communication')::numeric)
                  UNION ALL SELECT avg((scores->>'contextual')::numeric)
                  UNION ALL SELECT avg((scores->>'artistic')::numeric)
                ) y) AS lead_score
        FROM _sigsim
       WHERE scores IS NOT NULL
         AND (_family IS NULL OR family = _family)
       GROUP BY family, value
      HAVING count(DISTINCT id) >= 3
       ORDER BY 3 DESC
       LIMIT v_top
    ) v;

  RETURN jsonb_build_object(
    'activation_id', _activation_id,
    'family', _family,
    'sample_size', v_sample,
    'sampled_devices', v_sampled,
    'scored_devices', v_scored,
    'families', v_families,
    'values', v_values,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.org_signal_sonicsim(uuid, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_signal_sonicsim(uuid, text, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.org_signal_sonicsim(uuid, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_signal_sonicsim(uuid, text, text, integer, integer) TO service_role;