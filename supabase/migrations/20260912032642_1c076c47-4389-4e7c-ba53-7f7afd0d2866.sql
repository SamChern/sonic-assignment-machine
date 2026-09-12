CREATE INDEX IF NOT EXISTS idx_listener_profiles_grounding_level ON public.listener_profiles (grounding_level);
CREATE INDEX IF NOT EXISTS idx_intuizi_identifiers_audio_source ON public.intuizi_identifiers (audio_source_id) WHERE audio_source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_identifier_grounding(_activation_id text DEFAULT NULL::text, _grounding text DEFAULT NULL::text, _scored_only boolean DEFAULT true, _sample integer DEFAULT 500, _limit integer DEFAULT 25, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sample integer := LEAST(GREATEST(COALESCE(_sample, 500), 50), 2000);
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 25), 1), 200);
  v_offset integer := GREATEST(COALESCE(_offset, 0), 0);
  v_targeted boolean := COALESCE(_grounding, '') IN ('grounded', 'bridged');
  v_rows jsonb;
  v_summary jsonb;
  v_matched integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM set_config('statement_timeout', '25000', true);

  CREATE TEMP TABLE _ident_sample ON COMMIT DROP AS
  WITH picked AS (
    SELECT i.primary_identifier
    FROM public.listener_profiles lp
    JOIN public.intuizi_identifiers i ON i.audio_source_id = lp.audio_source_id
    WHERE v_targeted AND lp.grounding_level = _grounding
    LIMIT v_sample
  ), candidate AS (
    SELECT q.id, q.identifier, q.activation_id, q.report_type, q.status,
           q.confidence, q.tags, q.attempts, q.last_error, q.updated_at
    FROM public.intuizi_score_queue q
    WHERE (_activation_id IS NULL OR q.activation_id = _activation_id)
      AND (NOT COALESCE(_scored_only, true) OR q.status IN ('done', 'skipped'))
      AND (NOT v_targeted OR q.identifier IN (SELECT primary_identifier FROM picked))
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
           'with_scores', count(*) FILTER (WHERE scores IS NOT NULL),
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

REVOKE ALL ON FUNCTION public.admin_identifier_grounding(text, text, boolean, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_identifier_grounding(text, text, boolean, integer, integer, integer) TO authenticated, service_role;