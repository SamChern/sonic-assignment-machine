CREATE OR REPLACE FUNCTION public.upsert_category_calibration(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  WITH incoming AS (
    SELECT (r->>'node_id')::uuid  AS node_id,
           r->>'category'         AS category,
           (r->>'value')::numeric AS value
    FROM jsonb_array_elements(p_rows) AS r
    WHERE r->>'node_id' IS NOT NULL
      AND r->>'category' IS NOT NULL
      AND r->>'value' IS NOT NULL
  ), rolled AS (
    -- n, batch mean, and m2 = sum of squared deviations within the batch.
    -- var_pop * n is the textbook identity for m2 and needs no window function.
    SELECT node_id,
           category,
           count(*)::numeric AS n,
           avg(value)        AS mean_score,
           COALESCE(var_pop(value), 0) * count(*)::numeric AS m2
    FROM incoming
    GROUP BY node_id, category
  ), merged AS (
    INSERT INTO public.category_calibration AS cc
      (taxonomy_node_id, category, n, mean_score, m2, bias, updated_at)
    SELECT r.node_id, r.category, r.n, r.mean_score, r.m2, 0, now()
    FROM rolled r
    ON CONFLICT (taxonomy_node_id, category) DO UPDATE
      SET n = cc.n + EXCLUDED.n,
          mean_score = ((cc.mean_score * cc.n) + (EXCLUDED.mean_score * EXCLUDED.n))
                       / NULLIF(cc.n + EXCLUDED.n, 0),
          m2 = cc.m2 + EXCLUDED.m2
               + ((EXCLUDED.mean_score - cc.mean_score) ^ 2)
                 * cc.n * EXCLUDED.n / NULLIF(cc.n + EXCLUDED.n, 0),
          updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM merged;

  RETURN v_count;
END;
$function$;