ALTER TABLE public.audio_sources
  ADD COLUMN IF NOT EXISTS grounding_rescore_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_audio_sources_rescore_check
  ON public.audio_sources (grounding_rescore_checked_at)
  WHERE profile_embedding IS NOT NULL;

CREATE OR REPLACE FUNCTION public.grounding_rescore_candidates(_stale_hours integer DEFAULT 24)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT count(*)::int
  FROM public.source_analyses sa
  JOIN public.audio_sources a ON a.id = sa.audio_source_id
  WHERE COALESCE(sa.grounding_level, 'text-only') = 'text-only'
    AND a.profile_embedding IS NOT NULL
    AND (a.grounding_rescore_checked_at IS NULL
         OR a.grounding_rescore_checked_at < now() - make_interval(hours => GREATEST(COALESCE(_stale_hours, 24), 1)));
$function$;

REVOKE ALL ON FUNCTION public.grounding_rescore_candidates(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grounding_rescore_candidates(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.grounding_rescore_autostart()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active uuid;
  v_pending integer;
  v_id uuid;
BEGIN
  PERFORM public.grounding_rescore_guard();
  PERFORM set_config('statement_timeout', '15000', true);

  SELECT id INTO v_active FROM public.grounding_rescore_sweeps
  WHERE status IN ('running','paused') LIMIT 1;
  IF v_active IS NOT NULL THEN
    RETURN jsonb_build_object('started', false, 'reason', 'a sweep is already active', 'sweep_id', v_active);
  END IF;

  v_pending := public.grounding_rescore_candidates(24);
  IF COALESCE(v_pending, 0) = 0 THEN
    RETURN jsonb_build_object('started', false, 'reason', 'nothing new to re-score', 'pending', 0);
  END IF;

  INSERT INTO public.grounding_rescore_sweeps (status, batch_size, note)
  VALUES ('running', 200, 'auto-started for newly grounded audiences')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('started', true, 'sweep_id', v_id, 'pending', v_pending);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_grounding_rescore_status()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.grounding_rescore_sweeps;
  v_with_vector integer;
  v_text_only integer;
  v_pending integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM set_config('statement_timeout', '25000', true);

  SELECT * INTO v_row FROM public.grounding_rescore_sweeps
  ORDER BY (status IN ('running','paused')) DESC, updated_at DESC LIMIT 1;

  SELECT count(*)::int INTO v_with_vector
  FROM public.audio_sources WHERE profile_embedding IS NOT NULL;

  SELECT count(*)::int INTO v_text_only
  FROM public.source_analyses sa
  JOIN public.audio_sources a ON a.id = sa.audio_source_id
  WHERE COALESCE(sa.grounding_level, 'text-only') = 'text-only'
    AND a.profile_embedding IS NOT NULL;

  v_pending := public.grounding_rescore_candidates(24);

  RETURN jsonb_build_object(
    'sweep', to_jsonb(v_row),
    'sources_with_vector', v_with_vector,
    'queue_remaining', v_pending,
    'text_only_with_vector', v_text_only,
    'pending_candidates', v_pending,
    'computed_at', now());
END;
$function$;