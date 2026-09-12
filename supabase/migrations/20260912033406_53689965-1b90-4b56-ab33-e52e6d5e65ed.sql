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

  CREATE TEMP TABLE _sig ON COMMIT DROP AS
  WITH s AS (
    SELECT id, report_type, tags
      FROM public.intuizi_score_queue
     WHERE activation_id = _activation_id
     LIMIT v_sample
  )
  SELECT s.id,
         COALESCE(s.report_type, 'unknown') AS report_type,
         CASE
           WHEN jsonb_typeof(t.value) = 'object' THEN COALESCE(t.value->>'label', t.value->>'code')
           ELSE t.value #>> '{}'
         END AS label
    FROM s, jsonb_array_elements(
           CASE WHEN jsonb_typeof(s.tags) = 'array' THEN s.tags ELSE '[]'::jsonb END
         ) t(value);

  DELETE FROM _sig WHERE label IS NULL OR btrim(label) = '';

  SELECT count(DISTINCT id) INTO v_devices FROM _sig;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'devices')::bigint DESC), '[]'::jsonb)
    INTO v_values
  FROM (
    SELECT jsonb_build_object(
             'family', CASE WHEN position(': ' IN label) > 0
                            THEN split_part(label, ': ', 1)
                            ELSE report_type END,
             'value', CASE WHEN position(': ' IN label) > 0
                           THEN substr(label, position(': ' IN label) + 2)
                           ELSE label END,
             'label', label,
             'devices', count(DISTINCT id),
             'share_pct', CASE WHEN v_devices > 0
                               THEN round((count(DISTINCT id)::numeric / v_devices) * 100, 1)
                               ELSE 0 END) AS x
      FROM _sig
     GROUP BY 1, 2, 3
     ORDER BY count(DISTINCT id) DESC
     LIMIT v_top
  ) q;

  SELECT COALESCE(jsonb_agg(y ORDER BY (y->>'devices')::bigint DESC), '[]'::jsonb)
    INTO v_families
  FROM (
    SELECT jsonb_build_object(
             'family', CASE WHEN position(': ' IN label) > 0
                            THEN split_part(label, ': ', 1)
                            ELSE report_type END,
             'values', count(DISTINCT label),
             'devices', count(DISTINCT id)) AS y
      FROM _sig
     GROUP BY 1
     ORDER BY count(DISTINCT id) DESC
     LIMIT 12
  ) f;

  RETURN jsonb_build_object(
    'activation_id', _activation_id,
    'sampled_devices', v_devices,
    'sample_size', v_sample,
    'families', v_families,
    'values', v_values,
    'computed_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_activation_signal_values(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_activation_signal_values(text, integer, integer) TO authenticated, service_role;