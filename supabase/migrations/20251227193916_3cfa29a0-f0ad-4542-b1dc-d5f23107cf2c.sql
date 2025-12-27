-- Create source_analyses table to store individual analysis results
CREATE TABLE public.source_analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  audio_source_id UUID REFERENCES public.audio_sources(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  emotional_score INTEGER NOT NULL CHECK (emotional_score >= 0 AND emotional_score <= 100),
  cognitive_score INTEGER NOT NULL CHECK (cognitive_score >= 0 AND cognitive_score <= 100),
  social_score INTEGER NOT NULL CHECK (social_score >= 0 AND social_score <= 100),
  communication_score INTEGER NOT NULL CHECK (communication_score >= 0 AND communication_score <= 100),
  contextual_score INTEGER NOT NULL CHECK (contextual_score >= 0 AND contextual_score <= 100),
  artistic_score INTEGER NOT NULL CHECK (artistic_score >= 0 AND artistic_score <= 100),
  emotional_desc TEXT,
  cognitive_desc TEXT,
  social_desc TEXT,
  communication_desc TEXT,
  contextual_desc TEXT,
  artistic_desc TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create user_fingerprints table for aggregate scores
CREATE TABLE public.user_fingerprints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  emotional_avg NUMERIC(5,2) NOT NULL DEFAULT 0,
  cognitive_avg NUMERIC(5,2) NOT NULL DEFAULT 0,
  social_avg NUMERIC(5,2) NOT NULL DEFAULT 0,
  communication_avg NUMERIC(5,2) NOT NULL DEFAULT 0,
  contextual_avg NUMERIC(5,2) NOT NULL DEFAULT 0,
  artistic_avg NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_sources_analyzed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on both tables
ALTER TABLE public.source_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_fingerprints ENABLE ROW LEVEL SECURITY;

-- RLS Policies for source_analyses
CREATE POLICY "Users can view their own analyses"
ON public.source_analyses
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own analyses"
ON public.source_analyses
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all analyses"
ON public.source_analyses
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for user_fingerprints
CREATE POLICY "Everyone can view fingerprints"
ON public.user_fingerprints
FOR SELECT
USING (true);

CREATE POLICY "Users can insert their own fingerprint"
ON public.user_fingerprints
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own fingerprint"
ON public.user_fingerprints
FOR UPDATE
USING (auth.uid() = user_id);

-- Add trigger to update updated_at on user_fingerprints
CREATE TRIGGER update_user_fingerprints_updated_at
BEFORE UPDATE ON public.user_fingerprints
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to recalculate user fingerprint
CREATE OR REPLACE FUNCTION public.recalculate_user_fingerprint(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emotional NUMERIC(5,2);
  v_cognitive NUMERIC(5,2);
  v_social NUMERIC(5,2);
  v_communication NUMERIC(5,2);
  v_contextual NUMERIC(5,2);
  v_artistic NUMERIC(5,2);
  v_count INTEGER;
BEGIN
  -- Calculate averages from source_analyses
  SELECT 
    COALESCE(AVG(emotional_score), 0),
    COALESCE(AVG(cognitive_score), 0),
    COALESCE(AVG(social_score), 0),
    COALESCE(AVG(communication_score), 0),
    COALESCE(AVG(contextual_score), 0),
    COALESCE(AVG(artistic_score), 0),
    COUNT(*)
  INTO v_emotional, v_cognitive, v_social, v_communication, v_contextual, v_artistic, v_count
  FROM public.source_analyses
  WHERE user_id = p_user_id;

  -- Upsert the fingerprint
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