CREATE INDEX IF NOT EXISTS intuizi_score_queue_tag_signature_pending_idx
  ON public.intuizi_score_queue (public.intuizi_tag_signature(report_type, tags))
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.materialize_cached_intuizi_scores(
  p_activation_id text,
  p_limit integer DEFAULT 500
)
RETURNS TABLE(materialized integer, remaining_pending integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
  v_owner uuid;
  v_count integer := 0;
  r record;
  v_source uuid;
  v_codes text[];
BEGIN
  SELECT (value #>> '{}')::uuid INTO v_owner
    FROM public.control_registry WHERE key = 'ingest.system_owner_user_id';
  IF v_owner IS NULL THEN
    SELECT user_id INTO v_owner FROM public.user_roles WHERE role = 'admin' LIMIT 1;
  END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'no system owner configured for Intuizi ingest';
  END IF;

  FOR r IN
    SELECT q.id, q.identifier, q.report_type, q.tags, q.label, q.confidence,
           q.activation_id,
           c.scores, c.descriptions, c.grounding_level
      FROM public.intuizi_score_queue q
      JOIN public.intuizi_tag_score_cache c
        ON c.tag_signature = public.intuizi_tag_signature(q.report_type, q.tags)
     WHERE (p_activation_id IS NULL OR q.activation_id = p_activation_id)
       AND q.status = 'pending'
     ORDER BY q.created_at ASC
     LIMIT v_limit
  LOOP
    UPDATE public.intuizi_score_queue
       SET status = 'processing', started_at = now(), updated_at = now()
     WHERE id = r.id AND status = 'pending';
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT array_agg(DISTINCT t->>'code')
      INTO v_codes
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.tags) = 'array' THEN r.tags ELSE '[]'::jsonb END) t
     WHERE t->>'code' IS NOT NULL;

    SELECT audio_source_id INTO v_source
      FROM public.intuizi_identifiers WHERE primary_identifier = r.identifier;

    IF v_source IS NULL THEN
      INSERT INTO public.audio_sources (user_id, source_type, name, ctv_metadata)
      VALUES (
        v_owner, 'intuizi',
        coalesce(r.label, 'Intuizi ' || r.report_type || ': ' || left(r.identifier, 12)),
        jsonb_build_object(
          'provider', 'intuizi',
          'report_type', r.report_type,
          'identifier', r.identifier,
          'activation_id', r.activation_id,
          'from_tag_cache', true
        )
      )
      RETURNING id INTO v_source;
    END IF;

    INSERT INTO public.source_analyses (
      user_id, audio_source_id, source_name, confidence, grounding_level, raw_scores,
      emotional_score, cognitive_score, social_score,
      communication_score, contextual_score, artistic_score,
      emotional_desc, cognitive_desc, social_desc,
      communication_desc, contextual_desc, artistic_desc
    ) VALUES (
      v_owner, v_source,
      coalesce(r.label, 'Intuizi ' || r.report_type || ': ' || left(r.identifier, 12)),
      coalesce(r.confidence, 0.5), coalesce(r.grounding_level, 'text-only'),
      jsonb_build_object('scores', r.scores, 'from_tag_cache', true,
        'tag_signature', public.intuizi_tag_signature(r.report_type, r.tags)),
      round(coalesce((r.scores->>'emotional')::numeric, 0)),
      round(coalesce((r.scores->>'cognitive')::numeric, 0)),
      round(coalesce((r.scores->>'social')::numeric, 0)),
      round(coalesce((r.scores->>'communication')::numeric, 0)),
      round(coalesce((r.scores->>'contextual')::numeric, 0)),
      round(coalesce((r.scores->>'artistic')::numeric, 0)),
      r.descriptions->>'emotional', r.descriptions->>'cognitive', r.descriptions->>'social',
      r.descriptions->>'communication', r.descriptions->>'contextual', r.descriptions->>'artistic'
    );

    INSERT INTO public.audio_source_tags (audio_source_id, node_id, weight)
    SELECT v_source, n.id, coalesce(r.confidence, 0.5)
      FROM public.taxonomy_nodes n
     WHERE n.code = ANY(coalesce(v_codes, '{}'::text[]))
    ON CONFLICT (audio_source_id, node_id) DO NOTHING;

    INSERT INTO public.intuizi_identifiers (primary_identifier, audio_source_id, tag_codes, observation_count, last_seen_at, updated_at)
    VALUES (r.identifier, v_source, coalesce(v_codes, '{}'::text[]), 1, now(), now())
    ON CONFLICT (primary_identifier) DO UPDATE
      SET audio_source_id = coalesce(public.intuizi_identifiers.audio_source_id, excluded.audio_source_id),
          tag_codes = (
            SELECT array_agg(DISTINCT x)
              FROM unnest(coalesce(public.intuizi_identifiers.tag_codes, '{}'::text[]) || coalesce(excluded.tag_codes, '{}'::text[])) x
          ),
          observation_count = coalesce(public.intuizi_identifiers.observation_count, 0) + 1,
          last_seen_at = now(),
          updated_at = now();

    UPDATE public.intuizi_score_queue
       SET status = 'done', finished_at = now(), updated_at = now(),
           last_error = NULL, failure_kind = NULL, last_stage = 'done'
     WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY
  SELECT v_count,
         (SELECT count(*)::integer FROM (
            SELECT 1 FROM public.intuizi_score_queue
             WHERE (p_activation_id IS NULL OR activation_id = p_activation_id)
               AND status = 'pending'
             LIMIT 100000
          ) s);
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_cached_intuizi_scores(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_cached_intuizi_scores(text, integer) TO service_role;