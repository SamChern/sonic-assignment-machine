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

  SELECT count(*)::int INTO v_pending
  FROM public.source_analyses sa
  JOIN public.audio_sources a ON a.id = sa.audio_source_id
  WHERE COALESCE(sa.grounding_level, 'text-only') = 'text-only'
    AND a.profile_embedding IS NOT NULL;

  IF COALESCE(v_pending, 0) = 0 THEN
    RETURN jsonb_build_object('started', false, 'reason', 'nothing to re-score', 'pending', 0);
  END IF;

  INSERT INTO public.grounding_rescore_sweeps (status, batch_size, note)
  VALUES ('running', 200, 'auto-started for newly grounded audiences')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('started', true, 'sweep_id', v_id, 'pending', v_pending);
END;
$function$;

REVOKE ALL ON FUNCTION public.grounding_rescore_autostart() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grounding_rescore_autostart() TO authenticated, service_role;