CREATE OR REPLACE FUNCTION public.admin_activation_signal_values(_activation_id text, _sample integer DEFAULT 2000, _top integer DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sample integer := LEAST(GREATEST(COALESCE(_sample, 2000), 200), 5000);
  v_top integer := LEAST(GREATEST(COALESCE(_top, 24), 4), 100);
  v_devices bigint := 0;
  v_values jsonb := '[]'::jsonb;
  v_families jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM set_config('statement_timeout', '20000', true);

  WITH s AS (
    SELECT id, COALESCE(report_type, 'unknown') AS report_type, tags
      FROM public.intuizi_score_queue
     WHERE activation_id = _activation_id
     LIMIT v_sample
  ), sig AS (
    SELECT s.id,
           s.report_type,
           btrim(CASE
             WHEN jsonb_typeof(t.value) = 'object' THEN COALESCE(t.value->>'label', t.value->>'code')
             ELSE t.value #>> '{}'
           END) AS label
      FROM s, jsonb_array_elements(
             CASE WHEN jsonb_typeof(s.tags) = 'array' THEN s.tags ELSE '[]'::jsonb END
           ) t(value)
  ), clean AS (
    SELECT id,
           CASE WHEN position(': ' IN label) > 0 THEN split_part(label, ': ', 1) ELSE report_type END AS family,
           CASE WHEN position(': ' IN label) > 0 THEN substr(label, position(': ' IN label) + 2) ELSE label END AS value,
           label
      FROM sig
     WHERE label IS NOT NULL AND label <> ''
  ), tot AS (
    SELECT count(DISTINCT id) AS devices FROM clean
  ), vals AS (
    SELECT family, value, label, count(DISTINCT id) AS devices
      FROM clean
     GROUP BY 1, 2, 3
     ORDER BY 4 DESC
     LIMIT v_top
  ), fams AS (
    SELECT family, count(DISTINCT label) AS values_n, count(DISTINCT id) AS devices
      FROM clean
     GROUP BY 1
     ORDER BY 3 DESC
     LIMIT 12
  )
  SELECT (SELECT devices FROM tot),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'family', family, 'value', value, 'label', label,
                     'devices', devices,
                     'share_pct', CASE WHEN (SELECT devices FROM tot) > 0
                                       THEN round((devices::numeric / (SELECT devices FROM tot)) * 100, 1)
                                       ELSE 0 END) ORDER BY devices DESC) FROM vals), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'family', family, 'values', values_n, 'devices', devices) ORDER BY devices DESC) FROM fams), '[]'::jsonb)
    INTO v_devices, v_values, v_families;

  RETURN jsonb_build_object(
    'activation_id', _activation_id,
    'sampled_devices', COALESCE(v_devices, 0),
    'sample_size', v_sample,
    'families', v_families,
    'values', v_values,
    'computed_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_activation_signal_values(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_activation_signal_values(text, integer, integer) TO authenticated, service_role;