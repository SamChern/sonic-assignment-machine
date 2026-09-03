CREATE OR REPLACE FUNCTION public.build_activation_profile(
  p_activation text,
  p_sample integer DEFAULT 40000,
  p_top_tags integer DEFAULT 40
)
RETURNS TABLE(
  audio_source_id uuid,
  tags_written integer,
  identifiers_seen integer,
  scored_identifiers integer,
  analysis_written boolean,
  category text,
  confidence numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_source uuid;
  v_sample integer := GREATEST(500, LEAST(COALESCE(p_sample, 40000), 200000));
  v_top integer := GREATEST(5, LEAST(COALESCE(p_top_tags, 40), 120));
  v_ident text := 'activation:' || p_activation;
  v_rows integer := 0;
  v_tags integer := 0;
  v_scored integer := 0;
  v_total integer := 0;
  v_cat text;
  v_conf numeric := 0.5;
  v_avg record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF coalesce(p_activation, '') = '' THEN
    RAISE EXCEPTION 'activation id required';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.intuizi_score_queue
  WHERE activation_id = p_activation;

  IF v_total = 0 THEN
    RETURN;
  END IF;

  SELECT owner_id INTO v_owner
  FROM public.intuizi_score_queue
  WHERE activation_id = p_activation AND owner_id IS NOT NULL
  LIMIT 1;
  IF v_owner IS NULL THEN
    SELECT user_id INTO v_owner FROM public.user_roles WHERE role = 'admin' LIMIT 1;
  END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'no owner available for the activation profile';
  END IF;

  SELECT i.audio_source_id INTO v_source
  FROM public.intuizi_identifiers i
  WHERE i.primary_identifier = v_ident;

  IF v_source IS NULL THEN
    INSERT INTO public.audio_sources (user_id, source_type, name, analysis_status, ctv_metadata)
    VALUES (
      v_owner,
      'intuizi',
      'Activation ' || p_activation || ' audience profile',
      'complete',
      jsonb_build_object('activation_id', p_activation, 'scope', 'activation_profile')
    )
    RETURNING id INTO v_source;
  ELSE
    UPDATE public.audio_sources
    SET analysis_status = 'complete',
        analysis_error = NULL,
        ctv_metadata = coalesce(ctv_metadata, '{}'::jsonb)
          || jsonb_build_object('activation_id', p_activation, 'scope', 'activation_profile')
    WHERE id = v_source;
  END IF;

  DROP TABLE IF EXISTS _act_sample;
  DROP TABLE IF EXISTS _act_tags;

  CREATE TEMP TABLE _act_sample ON COMMIT DROP AS
  SELECT q.identifier, q.tags
  FROM public.intuizi_score_queue q
  WHERE q.activation_id = p_activation
  LIMIT v_sample;

  SELECT count(*) INTO v_rows FROM _act_sample;

  CREATE TEMP TABLE _act_tags ON COMMIT DROP AS
  WITH exploded AS (
    SELECT lower(t->>'code') AS code, count(*)::numeric AS hits
    FROM _act_sample s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.tags) = 'array' THEN s.tags ELSE '[]'::jsonb END
    ) AS t
    WHERE coalesce(t->>'code', '') <> ''
    GROUP BY 1
  )
  SELECT n.id AS node_id,
         round((e.hits / GREATEST(1, v_rows))::numeric, 4) AS weight
  FROM exploded e
  JOIN public.taxonomy_nodes n ON lower(n.code) = e.code
  WHERE coalesce(n.suppressed, false) = false
  ORDER BY e.hits DESC
  LIMIT v_top;

  DELETE FROM public.audio_source_tags WHERE audio_source_tags.audio_source_id = v_source;
  INSERT INTO public.audio_source_tags (audio_source_id, node_id, weight)
  SELECT v_source, node_id, weight FROM _act_tags
  ON CONFLICT DO NOTHING;
  SELECT count(*) INTO v_tags
  FROM public.audio_source_tags WHERE audio_source_tags.audio_source_id = v_source;

  SELECT count(*)::integer AS n,
         avg(a.emotional_score) AS emotional,
         avg(a.cognitive_score) AS cognitive,
         avg(a.social_score) AS social,
         avg(a.communication_score) AS communication,
         avg(a.contextual_score) AS contextual,
         avg(a.artistic_score) AS artistic,
         avg(a.confidence) AS confidence
  INTO v_avg
  FROM _act_sample s
  JOIN public.intuizi_identifiers i ON i.primary_identifier = s.identifier
  JOIN public.source_analyses a ON a.audio_source_id = i.audio_source_id;

  v_scored := coalesce(v_avg.n, 0);

  IF v_scored > 0 THEN
    v_conf := round(LEAST(1, GREATEST(0, coalesce(v_avg.confidence, 0.5)))::numeric, 3);
    SELECT k INTO v_cat FROM (
      VALUES
        ('emotional', v_avg.emotional),
        ('cognitive', v_avg.cognitive),
        ('social', v_avg.social),
        ('communication', v_avg.communication),
        ('contextual', v_avg.contextual),
        ('artistic', v_avg.artistic)
    ) AS t(k, v)
    ORDER BY v DESC NULLS LAST
    LIMIT 1;

    DELETE FROM public.source_analyses WHERE source_analyses.audio_source_id = v_source;
    INSERT INTO public.source_analyses (
      user_id, audio_source_id, source_name,
      emotional_score, cognitive_score, social_score,
      communication_score, contextual_score, artistic_score,
      confidence, grounding_level, raw_scores
    ) VALUES (
      v_owner, v_source, 'Activation ' || p_activation || ' audience profile',
      round(coalesce(v_avg.emotional, 0))::int,
      round(coalesce(v_avg.cognitive, 0))::int,
      round(coalesce(v_avg.social, 0))::int,
      round(coalesce(v_avg.communication, 0))::int,
      round(coalesce(v_avg.contextual, 0))::int,
      round(coalesce(v_avg.artistic, 0))::int,
      v_conf, 'bridged',
      jsonb_build_object(
        'scope', 'activation_profile',
        'activation_id', p_activation,
        'sampled_rows', v_rows,
        'scored_identifiers', v_scored,
        'total_rows', v_total
      )
    );
  END IF;

  INSERT INTO public.intuizi_identifiers (
    primary_identifier, audio_source_id, tag_codes, observation_count, last_seen_at
  )
  SELECT v_ident, v_source,
         (SELECT array_agg(n.code) FROM public.taxonomy_nodes n JOIN _act_tags t ON t.node_id = n.id),
         v_total, now()
  ON CONFLICT (primary_identifier) DO UPDATE
  SET audio_source_id = EXCLUDED.audio_source_id,
      tag_codes = EXCLUDED.tag_codes,
      observation_count = EXCLUDED.observation_count,
      last_seen_at = now(),
      updated_at = now();

  RETURN QUERY SELECT v_source, v_tags, v_total, v_scored, (v_scored > 0), v_cat, v_conf;
END;
$$;