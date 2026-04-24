-- 1. Add confidence column to source_analyses
ALTER TABLE public.source_analyses 
ADD COLUMN IF NOT EXISTS confidence NUMERIC(4,3) NOT NULL DEFAULT 0.5;

-- 2. Add temporal + confidence columns to user_fingerprints
ALTER TABLE public.user_fingerprints
ADD COLUMN IF NOT EXISTS emotional_avg_recent NUMERIC NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS cognitive_avg_recent NUMERIC NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS social_avg_recent NUMERIC NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS communication_avg_recent NUMERIC NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS contextual_avg_recent NUMERIC NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS artistic_avg_recent NUMERIC NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS recent_sources_analyzed INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS fingerprint_confidence NUMERIC(4,3) NOT NULL DEFAULT 0;

-- 3. Backfill confidence for existing source_analyses based on category variance
-- Higher variance across the 6 categories = more decisive scoring = higher confidence
UPDATE public.source_analyses
SET confidence = LEAST(1.0, GREATEST(0.1, (
  -- compute population stddev of the 6 scores per row, normalized by 30
  (
    SELECT COALESCE(STDDEV_POP(v), 0)
    FROM (VALUES 
      (emotional_score::numeric),
      (cognitive_score::numeric),
      (social_score::numeric),
      (communication_score::numeric),
      (contextual_score::numeric),
      (artistic_score::numeric)
    ) AS t(v)
  ) / 30.0
)));

-- 4. Replace recalculate_user_fingerprint with weighted + temporal version
CREATE OR REPLACE FUNCTION public.recalculate_user_fingerprint(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Population statistics
  pop_emotional_mean NUMERIC; pop_emotional_std NUMERIC;
  pop_cognitive_mean NUMERIC; pop_cognitive_std NUMERIC;
  pop_social_mean NUMERIC; pop_social_std NUMERIC;
  pop_communication_mean NUMERIC; pop_communication_std NUMERIC;
  pop_contextual_mean NUMERIC; pop_contextual_std NUMERIC;
  pop_artistic_mean NUMERIC; pop_artistic_std NUMERIC;

  -- All-time weighted normalized averages
  v_emotional NUMERIC(5,2); v_cognitive NUMERIC(5,2); v_social NUMERIC(5,2);
  v_communication NUMERIC(5,2); v_contextual NUMERIC(5,2); v_artistic NUMERIC(5,2);
  v_count INTEGER;
  v_avg_confidence NUMERIC;

  -- Recent (30d) weighted normalized averages
  r_emotional NUMERIC(5,2); r_cognitive NUMERIC(5,2); r_social NUMERIC(5,2);
  r_communication NUMERIC(5,2); r_contextual NUMERIC(5,2); r_artistic NUMERIC(5,2);
  r_count INTEGER;

  v_fp_confidence NUMERIC(4,3);
BEGIN
  -- Population stats from ALL source_analyses
  SELECT 
    COALESCE(AVG(emotional_score), 50), COALESCE(STDDEV(emotional_score), 1),
    COALESCE(AVG(cognitive_score), 50), COALESCE(STDDEV(cognitive_score), 1),
    COALESCE(AVG(social_score), 50), COALESCE(STDDEV(social_score), 1),
    COALESCE(AVG(communication_score), 50), COALESCE(STDDEV(communication_score), 1),
    COALESCE(AVG(contextual_score), 50), COALESCE(STDDEV(contextual_score), 1),
    COALESCE(AVG(artistic_score), 50), COALESCE(STDDEV(artistic_score), 1)
  INTO 
    pop_emotional_mean, pop_emotional_std,
    pop_cognitive_mean, pop_cognitive_std,
    pop_social_mean, pop_social_std,
    pop_communication_mean, pop_communication_std,
    pop_contextual_mean, pop_contextual_std,
    pop_artistic_mean, pop_artistic_std
  FROM public.source_analyses;

  -- All-time: weighted avg of normalized percentile by confidence
  SELECT 
    COALESCE(SUM(normalize_score_to_percentile(emotional_score, pop_emotional_mean, pop_emotional_std) * confidence) / NULLIF(SUM(confidence), 0), 50),
    COALESCE(SUM(normalize_score_to_percentile(cognitive_score, pop_cognitive_mean, pop_cognitive_std) * confidence) / NULLIF(SUM(confidence), 0), 50),
    COALESCE(SUM(normalize_score_to_percentile(social_score, pop_social_mean, pop_social_std) * confidence) / NULLIF(SUM(confidence), 0), 50),
    COALESCE(SUM(normalize_score_to_percentile(communication_score, pop_communication_mean, pop_communication_std) * confidence) / NULLIF(SUM(confidence), 0), 50),
    COALESCE(SUM(normalize_score_to_percentile(contextual_score, pop_contextual_mean, pop_contextual_std) * confidence) / NULLIF(SUM(confidence), 0), 50),
    COALESCE(SUM(normalize_score_to_percentile(artistic_score, pop_artistic_mean, pop_artistic_std) * confidence) / NULLIF(SUM(confidence), 0), 50),
    COUNT(*),
    COALESCE(AVG(confidence), 0)
  INTO v_emotional, v_cognitive, v_social, v_communication, v_contextual, v_artistic, v_count, v_avg_confidence
  FROM public.source_analyses
  WHERE user_id = p_user_id;

  -- Recent (last 30 days): same weighted formula
  SELECT 
    COALESCE(SUM(normalize_score_to_percentile(emotional_score, pop_emotional_mean, pop_emotional_std) * confidence) / NULLIF(SUM(confidence), 0), 0),
    COALESCE(SUM(normalize_score_to_percentile(cognitive_score, pop_cognitive_mean, pop_cognitive_std) * confidence) / NULLIF(SUM(confidence), 0), 0),
    COALESCE(SUM(normalize_score_to_percentile(social_score, pop_social_mean, pop_social_std) * confidence) / NULLIF(SUM(confidence), 0), 0),
    COALESCE(SUM(normalize_score_to_percentile(communication_score, pop_communication_mean, pop_communication_std) * confidence) / NULLIF(SUM(confidence), 0), 0),
    COALESCE(SUM(normalize_score_to_percentile(contextual_score, pop_contextual_mean, pop_contextual_std) * confidence) / NULLIF(SUM(confidence), 0), 0),
    COALESCE(SUM(normalize_score_to_percentile(artistic_score, pop_artistic_mean, pop_artistic_std) * confidence) / NULLIF(SUM(confidence), 0), 0),
    COUNT(*)
  INTO r_emotional, r_cognitive, r_social, r_communication, r_contextual, r_artistic, r_count
  FROM public.source_analyses
  WHERE user_id = p_user_id
    AND created_at > now() - interval '30 days';

  -- Overall fingerprint confidence: caps at 10 sources for full trust * avg per-source confidence
  v_fp_confidence := LEAST(1.0, (v_count::numeric / 10.0)) * COALESCE(v_avg_confidence, 0);

  -- Upsert
  INSERT INTO public.user_fingerprints (
    user_id, emotional_avg, cognitive_avg, social_avg, 
    communication_avg, contextual_avg, artistic_avg, total_sources_analyzed,
    emotional_avg_recent, cognitive_avg_recent, social_avg_recent,
    communication_avg_recent, contextual_avg_recent, artistic_avg_recent,
    recent_sources_analyzed, fingerprint_confidence
  )
  VALUES (
    p_user_id, v_emotional, v_cognitive, v_social,
    v_communication, v_contextual, v_artistic, v_count,
    r_emotional, r_cognitive, r_social,
    r_communication, r_contextual, r_artistic,
    r_count, v_fp_confidence
  )
  ON CONFLICT (user_id) DO UPDATE SET
    emotional_avg = v_emotional,
    cognitive_avg = v_cognitive,
    social_avg = v_social,
    communication_avg = v_communication,
    contextual_avg = v_contextual,
    artistic_avg = v_artistic,
    total_sources_analyzed = v_count,
    emotional_avg_recent = r_emotional,
    cognitive_avg_recent = r_cognitive,
    social_avg_recent = r_social,
    communication_avg_recent = r_communication,
    contextual_avg_recent = r_contextual,
    artistic_avg_recent = r_artistic,
    recent_sources_analyzed = r_count,
    fingerprint_confidence = v_fp_confidence,
    updated_at = now();
END;
$function$;

-- 5. Recalculate all existing fingerprints with new logic
SELECT public.recalculate_all_fingerprints();