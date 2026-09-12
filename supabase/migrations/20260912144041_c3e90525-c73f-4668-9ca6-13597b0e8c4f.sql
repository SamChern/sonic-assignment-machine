CREATE OR REPLACE FUNCTION public.grounding_rescore_tick(_batch integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sweep public.grounding_rescore_sweeps;
  v_batch integer;
  v_deadline timestamptz;
  v_cand record;
  v_agg record;
  v_ana record;
  v_vec text;
  v_min_sim numeric := 0.15;
  v_max_weight numeric := 0.35;
  v_conf_cap numeric := 0.9;
  v_conf_boost numeric := 0.25;
  v_agreement numeric;
  v_weight numeric;
  v_conf_before numeric;
  v_conf_after numeric;
  v_scanned integer := 0;
  v_upgraded integer := 0;
  v_skipped integer := 0;
  v_last uuid;
  v_exhausted boolean := true;
BEGIN
  PERFORM public.grounding_rescore_guard();
  PERFORM set_config('statement_timeout', '55000', true);

  UPDATE public.grounding_rescore_sweeps s
  SET lease_until = now() + interval '2 minutes', updated_at = now()
  WHERE s.status = 'running'
    AND (s.lease_until IS NULL OR s.lease_until < now())
  RETURNING * INTO v_sweep;

  IF v_sweep.id IS NULL THEN
    RETURN jsonb_build_object('ran', false, 'reason', 'no idle running sweep');
  END IF;

  v_batch := LEAST(GREATEST(COALESCE(_batch, v_sweep.batch_size, 100), 1), 500);
  v_deadline := clock_timestamp() + interval '40 seconds';
  v_last := v_sweep.last_source_id;

  FOR v_cand IN
    SELECT a.id AS source_id, a.profile_embedding::text AS vec
    FROM public.audio_sources a
    WHERE a.profile_embedding IS NOT NULL
      AND (v_last IS NULL OR a.id > v_last)
    ORDER BY a.id
    LIMIT v_batch
  LOOP
    v_last := v_cand.source_id;
    v_scanned := v_scanned + 1;
    IF clock_timestamp() > v_deadline THEN
      v_exhausted := false;
      EXIT;
    END IF;

    SELECT sa.id, sa.confidence, sa.grounding_level, sa.raw_scores,
           sa.emotional_score, sa.cognitive_score, sa.social_score,
           sa.communication_score, sa.contextual_score, sa.artistic_score
      INTO v_ana
    FROM public.source_analyses sa
    WHERE sa.audio_source_id = v_cand.source_id
    ORDER BY sa.created_at DESC
    LIMIT 1;

    IF v_ana.id IS NULL OR COALESCE(v_ana.grounding_level, 'text-only') <> 'text-only' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_vec := v_cand.vec;

    SELECT count(*)::int AS n,
           avg(q.sim) AS avg_sim,
           sum(q.emotional * q.sim) / NULLIF(sum(q.sim), 0) AS e,
           sum(q.cognitive * q.sim) / NULLIF(sum(q.sim), 0) AS c,
           sum(q.social * q.sim) / NULLIF(sum(q.sim), 0) AS s,
           sum(q.communication * q.sim) / NULLIF(sum(q.sim), 0) AS m,
           sum(q.contextual * q.sim) / NULLIF(sum(q.sim), 0) AS x,
           sum(q.artistic * q.sim) / NULLIF(sum(q.sim), 0) AS r,
           (COALESCE(stddev_pop(q.emotional), 0) + COALESCE(stddev_pop(q.cognitive), 0)
            + COALESCE(stddev_pop(q.social), 0) + COALESCE(stddev_pop(q.communication), 0)
            + COALESCE(stddev_pop(q.contextual), 0) + COALESCE(stddev_pop(q.artistic), 0)) / 6.0 AS spread
      INTO v_agg
    FROM (
      SELECT 1 - (a.profile_embedding <=> v_vec::vector) AS sim,
             COALESCE(sa2.emotional_score, 0)::numeric AS emotional,
             COALESCE(sa2.cognitive_score, 0)::numeric AS cognitive,
             COALESCE(sa2.social_score, 0)::numeric AS social,
             COALESCE(sa2.communication_score, 0)::numeric AS communication,
             COALESCE(sa2.contextual_score, 0)::numeric AS contextual,
             COALESCE(sa2.artistic_score, 0)::numeric AS artistic
      FROM public.audio_sources a
      JOIN LATERAL (
        SELECT grounding_level, emotional_score, cognitive_score, social_score,
               communication_score, contextual_score, artistic_score
        FROM public.source_analyses
        WHERE audio_source_id = a.id
        ORDER BY created_at DESC
        LIMIT 1
      ) sa2 ON true
      WHERE a.profile_embedding IS NOT NULL
        AND a.id <> v_cand.source_id
        AND COALESCE(sa2.grounding_level, 'text-only') = 'grounded'
      ORDER BY a.profile_embedding <=> v_vec::vector
      LIMIT 8
    ) q
    WHERE q.sim >= v_min_sim;

    IF COALESCE(v_agg.n, 0) = 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_agreement := LEAST(1, GREATEST(0, 1 - COALESCE(v_agg.spread, 0) / 40.0));
    v_weight := LEAST(v_max_weight,
      GREATEST(0, v_max_weight * v_agg.avg_sim * v_agreement * LEAST(1, v_agg.n / 3.0)));

    IF v_weight <= 0.01 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_conf_before := LEAST(1, GREATEST(0, COALESCE(v_ana.confidence, 0.5)));
    v_conf_after := LEAST(v_conf_cap,
      round((v_conf_before + v_conf_boost * v_weight * v_agreement)::numeric, 3));

    UPDATE public.source_analyses sa
    SET emotional_score = round((1 - v_weight) * COALESCE(v_ana.emotional_score, 0) + v_weight * v_agg.e)::int,
        cognitive_score = round((1 - v_weight) * COALESCE(v_ana.cognitive_score, 0) + v_weight * v_agg.c)::int,
        social_score = round((1 - v_weight) * COALESCE(v_ana.social_score, 0) + v_weight * v_agg.s)::int,
        communication_score = round((1 - v_weight) * COALESCE(v_ana.communication_score, 0) + v_weight * v_agg.m)::int,
        contextual_score = round((1 - v_weight) * COALESCE(v_ana.contextual_score, 0) + v_weight * v_agg.x)::int,
        artistic_score = round((1 - v_weight) * COALESCE(v_ana.artistic_score, 0) + v_weight * v_agg.r)::int,
        confidence = v_conf_after,
        grounding_level = 'grounded',
        raw_scores = COALESCE(sa.raw_scores, '{}'::jsonb) || jsonb_build_object(
          'clap_tuning', jsonb_build_object(
            'source', 'grounding_rescore_sweep',
            'sweep_id', v_sweep.id,
            'tuned_at', now(),
            'neighbours', v_agg.n,
            'avg_similarity', round(v_agg.avg_sim::numeric, 3),
            'agreement', round(v_agreement, 3),
            'weight', round(v_weight, 3),
            'confidence_before', v_conf_before,
            'text_only_scores', jsonb_build_object(
              'emotional', v_ana.emotional_score, 'cognitive', v_ana.cognitive_score,
              'social', v_ana.social_score, 'communication', v_ana.communication_score,
              'contextual', v_ana.contextual_score, 'artistic', v_ana.artistic_score),
            'audio_neighbour_scores', jsonb_build_object(
              'emotional', round(v_agg.e), 'cognitive', round(v_agg.c),
              'social', round(v_agg.s), 'communication', round(v_agg.m),
              'contextual', round(v_agg.x), 'artistic', round(v_agg.r))
          ))
    WHERE sa.id = v_ana.id;

    UPDATE public.listener_profiles p
    SET emotional = sa.emotional_score,
        cognitive = sa.cognitive_score,
        social = sa.social_score,
        communication = sa.communication_score,
        contextual = sa.contextual_score,
        artistic = sa.artistic_score,
        confidence = sa.confidence,
        grounding_level = sa.grounding_level,
        has_audio_embedding = true,
        updated_at = now()
    FROM public.source_analyses sa
    WHERE sa.id = v_ana.id AND p.audio_source_id = v_cand.source_id;

    v_upgraded := v_upgraded + 1;
  END LOOP;

  IF v_scanned < v_batch AND v_exhausted THEN
    UPDATE public.grounding_rescore_sweeps
    SET status = 'done',
        scanned = scanned + v_scanned,
        upgraded = upgraded + v_upgraded,
        skipped = skipped + v_skipped,
        last_source_id = COALESCE(v_last, last_source_id),
        lease_until = NULL,
        note = 'every audience with a grounded audio vector has been re-scored',
        updated_at = now()
    WHERE id = v_sweep.id;
  ELSE
    UPDATE public.grounding_rescore_sweeps
    SET scanned = scanned + v_scanned,
        upgraded = upgraded + v_upgraded,
        skipped = skipped + v_skipped,
        last_source_id = COALESCE(v_last, last_source_id),
        lease_until = NULL,
        updated_at = now()
    WHERE id = v_sweep.id;
  END IF;

  RETURN jsonb_build_object(
    'ran', true, 'sweep_id', v_sweep.id,
    'scanned', v_scanned, 'upgraded', v_upgraded, 'skipped', v_skipped,
    'exhausted', (v_scanned < v_batch AND v_exhausted));
END;
$function$;