ALTER TABLE public.source_analyses
ADD COLUMN category text GENERATED ALWAYS AS (
  CASE GREATEST(emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score)
    WHEN emotional_score THEN 'Emotional'
    WHEN cognitive_score THEN 'Cognitive'
    WHEN social_score THEN 'Social'
    WHEN communication_score THEN 'Communication'
    WHEN contextual_score THEN 'Contextual'
    WHEN artistic_score THEN 'Artistic'
  END
) STORED;

CREATE INDEX IF NOT EXISTS source_analyses_category_idx ON public.source_analyses(category);