CREATE OR REPLACE FUNCTION public.admin_identifier_grounding(
  _activation_id text DEFAULT NULL,
  _grounding text DEFAULT NULL,
  _sample integer DEFAULT 500,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sample integer := LEAST(GREATEST(COALESCE(_sample, 500), 50), 2000);
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(_offset, 0), 0);
  v_rows jsonb;
  v_summary jsonb;
  v_matched integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM set_config('statement_timeout', '25000', true);

  CREATE TEMP TABLE _ident_sample ON COMMIT DROP AS
  WITH candidate AS (
    SELECT q.id, q.identifier, q.activation_id, q.report_type, q.status,
           q.confidence, q.tags, q.attempts, q.last_error, q.updated_at
    FROM public.intuizi_score_queue q
    WHERE (_activation_id IS NULL OR q.activation_id = _activation_id)
    ORDER BY q.updated_at DESC
    LIMIT v_sample
  )
  SELECT c.id,
         c.identifier,
         c.activation_id,
         c.report_type,
         c.status,
         c.attempts,
         c.last_error,
         c.updated_at,
         COALESCE(lp.grounding_level, tc.grounding_level, 'text-only') AS grounding_level,
         COALESCE(lp.has_audio_embedding, false) AS has_audio_embedding,
         COALESCE(c.confidence, tc.confidence, lp.confidence) AS confidence,
         CASE
           WHEN lp.audio_source_id IS NOT NULL THEN jsonb_build_object(
             'emotional', lp.emotional, 'cognitive', lp.cognitive, 'social', lp.social,
             'communication', lp.communication, 'contextual', lp.contextual, 'artistic', lp.artistic)
           ELSE tc.scores
         END AS scores,
         (
           SELECT COALESCE(jsonb_agg(COALESCE(t->>'label', t->>'code')) FILTER (
                    WHERE COALESCE(t->>'label', t->>'code') IS NOT NULL), '[]'::jsonb)
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(c.tags) = 'array' THEN c.tags ELSE '[]'::jsonb END) t
         ) AS tag_labels
  FROM candidate c
  LEFT JOIN public.intuizi_identifiers i ON i.primary_identifier = c.identifier
  LEFT JOIN public.listener_profiles lp ON lp.audio_source_id = i.audio_source_id
  LEFT JOIN public.intuizi_tag_score_cache tc
    ON tc.tag_signature = public.intuizi_tag_signature(c.report_type, c.tags)
   AND tc.report_type = c.report_type;

  SELECT jsonb_build_object(
           'sampled', count(*),
           'grounded', count(*) FILTER (WHERE grounding_level = 'grounded'),
           'bridged', count(*) FILTER (WHERE grounding_level = 'bridged'),
           'text_only', count(*) FILTER (WHERE grounding_level NOT IN ('grounded', 'bridged')),
           'with_audio', count(*) FILTER (WHERE has_audio_embedding),
           'avg_confidence', round(AVG(confidence)::numeric, 3))
    INTO v_summary
  FROM _ident_sample;

  SELECT count(*)::int INTO v_matched
  FROM _ident_sample s
  WHERE _grounding IS NULL
     OR (_grounding = 'text-only' AND s.grounding_level NOT IN ('grounded', 'bridged'))
     OR s.grounding_level = _grounding;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.updated_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT s.*
    FROM _ident_sample s
    WHERE _grounding IS NULL
       OR (_grounding = 'text-only' AND s.grounding_level NOT IN ('grounded', 'bridged'))
       OR s.grounding_level = _grounding
    ORDER BY s.updated_at DESC
    LIMIT v_limit OFFSET v_offset
  ) r;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'summary', COALESCE(v_summary, '{}'::jsonb),
    'matched', COALESCE(v_matched, 0),
    'sample_size', v_sample,
    'computed_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_identifier_grounding(text, text, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_identifier_grounding(text, text, integer, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_rescore_identifiers(
  _ids uuid[],
  _force_fresh boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[] := (SELECT array_agg(x) FROM unnest(COALESCE(_ids, '{}'::uuid[])) x LIMIT 1);
  v_requeued integer := 0;
  v_cleared integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('requeued', 0, 'cache_cleared', 0);
  END IF;
  IF array_length(_ids, 1) > 500 THEN
    RAISE EXCEPTION 'up to 500 devices per batch';
  END IF;
  PERFORM set_config('statement_timeout', '25000', true);

  IF _force_fresh THEN
    WITH sigs AS (
      SELECT DISTINCT public.intuizi_tag_signature(q.report_type, q.tags) AS sig, q.report_type
      FROM public.intuizi_score_queue q
      WHERE q.id = ANY(_ids)
    ), del AS (
      DELETE FROM public.intuizi_tag_score_cache tc
      USING sigs s
      WHERE tc.tag_signature = s.sig AND tc.report_type = s.report_type
      RETURNING 1
    )
    SELECT count(*)::int INTO v_cleared FROM del;
  END IF;

  WITH upd AS (
    UPDATE public.intuizi_score_queue q
    SET status = 'pending',
        next_attempt_at = now(),
        max_attempts = GREATEST(COALESCE(q.max_attempts, 3), q.attempts + 3),
        dead_lettered_at = NULL,
        started_at = NULL,
        finished_at = NULL,
        last_error = NULL,
        updated_at = now()
    WHERE q.id = ANY(_ids)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_requeued FROM upd;

  RETURN jsonb_build_object('requeued', v_requeued, 'cache_cleared', v_cleared);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_rescore_identifiers(uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rescore_identifiers(uuid[], boolean) TO authenticated, service_role;