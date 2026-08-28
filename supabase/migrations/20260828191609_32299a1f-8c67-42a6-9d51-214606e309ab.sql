-- 1) Client-safe read of scope.* knobs (window length drives the Semantic Scope cadence).
CREATE OR REPLACE FUNCTION public.client_control(_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.value
  FROM public.control_registry r
  WHERE r.key = _key
    AND r.category = 'scope'
    AND auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.client_control(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_control(text) TO authenticated, service_role;

-- 2) Consumer feedback flywheel: users may label their own analyses.
GRANT INSERT, SELECT ON public.category_feedback TO authenticated;

CREATE POLICY "Users add feedback on own analyses"
  ON public.category_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (
    rater_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.source_analyses sa
      WHERE sa.id = category_feedback.source_analysis_id
        AND sa.user_id = auth.uid()
    )
  );

CREATE POLICY "Users read own feedback"
  ON public.category_feedback
  FOR SELECT
  TO authenticated
  USING (rater_user_id = auth.uid());