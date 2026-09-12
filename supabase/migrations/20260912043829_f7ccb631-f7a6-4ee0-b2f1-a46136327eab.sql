CREATE OR REPLACE FUNCTION public.admin_signal_explorer(
  _activation_id text,
  _family text DEFAULT NULL,
  _value text DEFAULT NULL,
  _search text DEFAULT NULL,
  _sample integer DEFAULT 2000,
  _limit integer DEFAULT 25,
  _offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sample integer := LEAST(GREATEST(COALESCE(_sample, 2000), 200), 8000);
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 25), 1), 100);
  v_offset integer := GREATEST(COALESCE(_offset, 0), 0);
  v_families jsonb := '[]'::jsonb;
  v_values jsonb := '[]'::jsonb;
  v_devices jsonb := '[]'::jsonb;
  v_matched integer := 0;
  v_sampled integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM set_config('statement_timeout', '25000', true);

  CREATE TEMP TABLE _sigx ON COMMIT DROP AS
  WITH s AS (
    SELECT q.id, q.identifier, q.report_type, q.status, q.confidence, q.tags, q.updated_at
      FROM public.intuizi_score_queue q
     WHERE q.activation_id = _activation_id
     ORDER BY q.updated_at DESC
     LIMIT v_sample
  ), ex AS (
    SELECT s.id, s.identifier, s.report_type, s.status, s.confidence, s.updated_at,
           btrim(CASE
             WHEN jsonb_typeof(t.value) = 'object' THEN COALESCE(t.value->>'label', t.value->>'code')
             ELSE t.value #>> '{}'
           END) AS label
      FROM s, jsonb_array_elements(
             CASE WHEN jsonb_typeof(s.tags) = 'array' THEN s.tags ELSE '[]'::jsonb END
           ) t(value)
  )
  SELECT id, identifier, report_type, status, confidence, updated_at, label,
         CASE WHEN position(': ' IN label) > 0
              THEN split_part(label, ': ', 1)
              ELSE COALESCE(report_type, 'unknown') END AS family,
         CASE WHEN position(': ' IN label) > 0
              THEN substr(label, position(': ' IN label) + 2)
              ELSE label END AS value
    FROM ex
   WHERE label IS NOT NULL AND label <> '';

  SELECT count(DISTINCT id)::int INTO v_sampled FROM _sigx;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'family', family, 'values', values_n, 'devices', devices) ORDER BY devices DESC), '[]'::jsonb)
    INTO v_families
    FROM (
      SELECT family, count(DISTINCT value) AS values_n, count(DISTINCT id) AS devices
        FROM _sigx
       GROUP BY family
       ORDER BY 3 DESC
       LIMIT 20
    ) f;

  IF _family IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'value', value, 'devices', devices,
             'share_pct', CASE WHEN v_sampled > 0
                               THEN round((devices::numeric / v_sampled) * 100, 1) ELSE 0 END
           ) ORDER BY devices DESC), '[]'::jsonb)
      INTO v_values
      FROM (
        SELECT value, count(DISTINCT id) AS devices
          FROM _sigx
         WHERE family = _family
           AND (_search IS NULL OR _search = '' OR value ILIKE '%' || _search || '%')
         GROUP BY value
         ORDER BY 2 DESC
         LIMIT 50
      ) v;
  END IF;

  SELECT count(*)::int INTO v_matched
    FROM (
      SELECT DISTINCT id
        FROM _sigx
       WHERE (_family IS NULL OR family = _family)
         AND (_value IS NULL OR value = _value)
    ) m;

  IF _value IS NOT NULL AND _family IS NOT NULL THEN
    WITH sel AS (
      SELECT s.id,
             min(s.identifier) AS identifier,
             min(s.report_type) AS report_type,
             min(s.status) AS status,
             max(s.confidence) AS confidence,
             max(s.updated_at) AS updated_at,
             jsonb_agg(DISTINCT s.label) AS labels
        FROM _sigx s
       WHERE s.family = _family AND s.value = _value
       GROUP BY s.id
       ORDER BY max(s.updated_at) DESC
       LIMIT v_limit OFFSET v_offset
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', p.id,
             'identifier', p.identifier,
             'report_type', p.report_type,
             'status', p.status,
             'labels', p.labels,
             'updated_at', p.updated_at,
             'grounding_level', COALESCE(lp.grounding_level, tc.grounding_level, 'text-only'),
             'confidence', COALESCE(p.confidence, tc.confidence, lp.confidence),
             'scores', CASE
                 WHEN lp.audio_source_id IS NOT NULL THEN jsonb_build_object(
                   'emotional', lp.emotional, 'cognitive', lp.cognitive, 'social', lp.social,
                   'communication', lp.communication, 'contextual', lp.contextual,
                   'artistic', lp.artistic)
                 ELSE tc.scores END
           ) ORDER BY p.updated_at DESC), '[]'::jsonb)
      INTO v_devices
      FROM sel p
      LEFT JOIN public.intuizi_score_queue q ON q.id = p.id
      LEFT JOIN public.intuizi_identifiers i ON i.primary_identifier = p.identifier
      LEFT JOIN public.listener_profiles lp ON lp.audio_source_id = i.audio_source_id
      LEFT JOIN public.intuizi_tag_score_cache tc
        ON tc.tag_signature = public.intuizi_tag_signature(q.report_type, q.tags)
       AND tc.report_type = q.report_type;
  END IF;

  RETURN jsonb_build_object(
    'activation_id', _activation_id,
    'family', _family,
    'value', _value,
    'sampled_devices', v_sampled,
    'sample_size', v_sample,
    'families', v_families,
    'values', v_values,
    'devices', v_devices,
    'matched', v_matched,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_signal_explorer(text, text, text, text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_signal_explorer(text, text, text, text, integer, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_signal_explorer(text, text, text, text, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_signal_explorer(text, text, text, text, integer, integer, integer) TO service_role;