-- Phase 2: Z-Score Normalization Functions

-- Helper function: Convert a raw score to a population-relative percentile
-- Uses z-score normalization then maps to 0-100 percentile scale
CREATE OR REPLACE FUNCTION public.normalize_score_to_percentile(
  raw_score NUMERIC,
  pop_mean NUMERIC,
  pop_stddev NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  z_score NUMERIC;
  percentile NUMERIC;
BEGIN
  -- Handle edge case of zero or near-zero stddev
  IF pop_stddev < 0.01 THEN
    RETURN 50; -- All scores are effectively the same
  END IF;
  
  -- Calculate z-score
  z_score := (raw_score - pop_mean) / pop_stddev;
  
  -- Convert z-score to percentile using approximate normal CDF
  -- Using logistic approximation: 1 / (1 + exp(-1.7 * z))
  percentile := 100 / (1 + EXP(-1.7 * z_score));
  
  -- Clamp to 0-100 range
  RETURN GREATEST(0, LEAST(100, percentile));
END;
$$;

-- Updated fingerprint recalculation that uses population-normalized scores
CREATE OR REPLACE FUNCTION public.recalculate_user_fingerprint(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Population statistics for each category
  pop_emotional_mean NUMERIC;
  pop_emotional_std NUMERIC;
  pop_cognitive_mean NUMERIC;
  pop_cognitive_std NUMERIC;
  pop_social_mean NUMERIC;
  pop_social_std NUMERIC;
  pop_communication_mean NUMERIC;
  pop_communication_std NUMERIC;
  pop_contextual_mean NUMERIC;
  pop_contextual_std NUMERIC;
  pop_artistic_mean NUMERIC;
  pop_artistic_std NUMERIC;
  
  -- User's normalized averages
  v_emotional NUMERIC(5,2);
  v_cognitive NUMERIC(5,2);
  v_social NUMERIC(5,2);
  v_communication NUMERIC(5,2);
  v_contextual NUMERIC(5,2);
  v_artistic NUMERIC(5,2);
  v_count INTEGER;
BEGIN
  -- Calculate population statistics from ALL source_analyses
  SELECT 
    COALESCE(AVG(emotional_score), 50),
    COALESCE(STDDEV(emotional_score), 1),
    COALESCE(AVG(cognitive_score), 50),
    COALESCE(STDDEV(cognitive_score), 1),
    COALESCE(AVG(social_score), 50),
    COALESCE(STDDEV(social_score), 1),
    COALESCE(AVG(communication_score), 50),
    COALESCE(STDDEV(communication_score), 1),
    COALESCE(AVG(contextual_score), 50),
    COALESCE(STDDEV(contextual_score), 1),
    COALESCE(AVG(artistic_score), 50),
    COALESCE(STDDEV(artistic_score), 1)
  INTO 
    pop_emotional_mean, pop_emotional_std,
    pop_cognitive_mean, pop_cognitive_std,
    pop_social_mean, pop_social_std,
    pop_communication_mean, pop_communication_std,
    pop_contextual_mean, pop_contextual_std,
    pop_artistic_mean, pop_artistic_std
  FROM public.source_analyses;

  -- Calculate user's normalized averages using population-relative percentiles
  SELECT 
    COALESCE(AVG(normalize_score_to_percentile(emotional_score, pop_emotional_mean, pop_emotional_std)), 50),
    COALESCE(AVG(normalize_score_to_percentile(cognitive_score, pop_cognitive_mean, pop_cognitive_std)), 50),
    COALESCE(AVG(normalize_score_to_percentile(social_score, pop_social_mean, pop_social_std)), 50),
    COALESCE(AVG(normalize_score_to_percentile(communication_score, pop_communication_mean, pop_communication_std)), 50),
    COALESCE(AVG(normalize_score_to_percentile(contextual_score, pop_contextual_mean, pop_contextual_std)), 50),
    COALESCE(AVG(normalize_score_to_percentile(artistic_score, pop_artistic_mean, pop_artistic_std)), 50),
    COUNT(*)
  INTO v_emotional, v_cognitive, v_social, v_communication, v_contextual, v_artistic, v_count
  FROM public.source_analyses
  WHERE user_id = p_user_id;

  -- Upsert the fingerprint with normalized scores
  INSERT INTO public.user_fingerprints (
    user_id, emotional_avg, cognitive_avg, social_avg, 
    communication_avg, contextual_avg, artistic_avg, total_sources_analyzed
  )
  VALUES (
    p_user_id, v_emotional, v_cognitive, v_social,
    v_communication, v_contextual, v_artistic, v_count
  )
  ON CONFLICT (user_id) DO UPDATE SET
    emotional_avg = v_emotional,
    cognitive_avg = v_cognitive,
    social_avg = v_social,
    communication_avg = v_communication,
    contextual_avg = v_contextual,
    artistic_avg = v_artistic,
    total_sources_analyzed = v_count,
    updated_at = now();
END;
$$;

-- Phase 4: Batch recalculate all user fingerprints
CREATE OR REPLACE FUNCTION public.recalculate_all_fingerprints()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_record RECORD;
  recalc_count INTEGER := 0;
BEGIN
  -- Loop through all users who have source analyses
  FOR user_record IN 
    SELECT DISTINCT user_id FROM public.source_analyses
  LOOP
    PERFORM public.recalculate_user_fingerprint(user_record.user_id);
    recalc_count := recalc_count + 1;
  END LOOP;
  
  RETURN recalc_count;
END;
$$;