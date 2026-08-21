DROP POLICY IF EXISTS "Signed in users can read call log" ON public.librosa_call_log;

CREATE POLICY "Owners and admins read call log"
ON public.librosa_call_log
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR (
    audio_source_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.audio_sources s
      WHERE s.id = librosa_call_log.audio_source_id
        AND s.user_id = auth.uid()
    )
  )
);