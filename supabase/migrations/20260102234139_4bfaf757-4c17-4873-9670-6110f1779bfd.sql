-- Fix search_path for normalize_score_to_percentile function
CREATE OR REPLACE FUNCTION public.normalize_score_to_percentile(
  raw_score NUMERIC,
  pop_mean NUMERIC,
  pop_stddev NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
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