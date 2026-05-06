ALTER TABLE public.audio_sources
  ADD COLUMN IF NOT EXISTS librosa_features jsonb;

CREATE POLICY "Users can update their own audio sources"
ON public.audio_sources
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);